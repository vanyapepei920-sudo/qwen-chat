/* ═══════════════════════════════════════════════════════════════
   speedtest.js — SpeedTest v2 PRO
   • latency: 16 замеров → min/avg/max/jitter/loss (stddev + RFC3550)
   • download/upload: ПАРАЛЛЕЛЬНЫЕ соединения (4 потока), прогрессивная
     длительность (warmup → ramp → sustain), live-спарклайн, экспоненциальное
     сглаживание, отбрасывание выбросов при старте
   • автовыбор лучшего edge-сервера (Cloudflare / jsDelivr / GitHub / Google)
   • оценка качества канала + видео-профиль (SD/HD/4K/8K)
   • история: localStorage + сервер (/api/result, /api/history) для залогиненных
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const LS_KEY = "st_history_v2";
  const CANCELLED = new Error("cancelled");

  /* ───────── конфигурация ───────── */
  const CFG = {
    pingCount: 16,
    dlDurationMs: 9000,
    ulDurationMs: 7000,
    maxConnections: 4,
    samplesPerSec: 10,
    edges: [
      { name: "Cloudflare", down: "https://speed.cloudflare.com/__down?bytes=", up: "https://speed.cloudflare.com/__up" },
      { name: "jsDelivr CDN", down: "https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/", up: null },
      { name: "GitHub raw", down: "https://raw.githubusercontent.com/sindresorhus/is/main/readme.md?cb=", up: null },
      { name: "Google gstatic", down: "https://www.gstatic.com/inputtools/images/tiles.png?cb=", up: null },
    ],
    pingTargets: [
      "https://speed.cloudflare.com/__down?bytes=0",
      "https://www.google.com/generate_204",
      "https://api.github.com/zen",
      "https://httpbingo.org/status/204",
    ],
  };

  /* ───────── утилиты ───────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function fmtSpeed(bps) {
    if (!isFinite(bps) || bps <= 0) return { val: "—", unit: "Мбит/с" };
    if (bps >= 1e9) return { val: (bps / 1e9).toFixed(2), unit: "Гбит/с" };
    if (bps >= 1e6) return { val: (bps / 1e6).toFixed(1), unit: "Мбит/с" };
    return { val: (bps / 1e3).toFixed(0), unit: "кбит/с" };
  }
  function mbps(bps) { return bps / 1e6; }

  function statsOf(arr) {
    if (!arr.length) return { min: 0, avg: 0, max: 0, jitter: 0, lossPct: 100 };
    const sorted = [...arr].sort((a, b) => a - b);
    // trimmed mean: отбрасываем по 15% с краёв (стабилизация результата)
    const cut = Math.floor(sorted.length * 0.15);
    const core = sorted.slice(cut, sorted.length - cut) ;
    const use = core.length ? core : sorted;
    const avg = use.reduce((a, b) => a + b, 0) / use.length;
    const meanAll = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - meanAll) ** 2, 0) / arr.length);
    let rf = 0; for (let i = 1; i < arr.length; i++) rf += Math.abs(arr[i] - arr[i - 1]);
    const jitter = arr.length > 1 ? (rf / (arr.length - 1)) * 0.5 + sd * 0.5 : 0;
    return { min: sorted[0], avg, max: sorted[sorted.length - 1], jitter, lossPct: 0 };
  }

  /* ───────── состояние запуска ───────── */
  let runId = 0;
  let running = false;

  class CancelToken {
    constructor(id) { this.id = id; }
    get cancelled() { return runId !== this.id; }
    check() { if (this.cancelled) throw CANCELLED; }
  }

  /* ───────── выбор лучшего edge ───────── */
  async function pickEdge(tok) {
    const results = [];
    for (const e of CFG.edges) {
      if (tok.cancelled) throw CANCELLED;
      const t0 = performance.now();
      try {
        await fetch(e.down + (e.down.includes("?") ? "" : "?") + "_t=" + Math.random(), { cache: "no-store", signal: AbortSignal.timeout(4000) });
        results.push({ edge: e, ms: performance.now() - t0 });
      } catch (err) { /* недоступен */ }
    }
    if (!results.length) return CFG.edges[0];
    results.sort((a, b) => a.ms - b.ms);
    return results[0].edge;
  }

  /* ───────── ping / jitter / loss ───────── */
  async function measurePing(tok, onSample) {
    const samples = [];
    let fail = 0;
    const perTarget = Math.ceil(CFG.pingCount / CFG.pingTargets.length);
    for (const target of CFG.pingTargets) {
      for (let i = 0; i < perTarget && samples.length + fail < CFG.pingCount; i++) {
        tok.check();
        const t0 = performance.now();
        try {
          const r = await fetch(target + (target.includes("?") ? "&" : "?") + "_=" + Math.random(), { cache: "no-store", signal: AbortSignal.timeout(5000) });
          await r.text();
          const ms = performance.now() - t0;
          samples.push(ms);
          onSample && onSample(Math.round(ms), new URL(target).hostname);
        } catch (e) { fail++; onSample && onSample(-1, new URL(target).hostname); }
        await sleep(30);
      }
    }
    const st = statsOf(samples);
    st.lossPct = +((fail / (samples.length + fail)) * 100).toFixed(1);
    st.samples = samples.map((x) => +x.toFixed(1));
    return st;
  }

  /* ───────── параллельный throughput (download / upload) ───────── */
  async function measureThroughput(tok, { direction, edge, durationMs, connCount, onLive }) {
    const tStart = performance.now();
    let totalBytes = 0;
    let emaMbps = 0;
    const timeline = []; // [{t, mbps}]
    const inflight = new Map(); // streamId -> {start, bytes}
    let seq = 0;
    let stopped = false;
    const active = () => inflight.size;

    function tickSamples() {
      if (stopped || tok.cancelled) return;
      const now = performance.now();
      const secs = (now - tStart) / 1000;
      const inst = secs > 0 ? (totalBytes * 8) / secs / 1e6 : 0;
      // EMA: быстрее реагирует на рост, медленнее на шум первых байт
      emaMbps = emaMbps === 0 ? inst : emaMbps * 0.7 + inst * 0.3;
      timeline.push({ t: now - tStart, mbps: emaMbps });
      onLive && onLive(emaMbps, totalBytes);
      setTimeout(tickSamples, 1000 / CFG.samplesPerSec);
    }
    tickSamples();

    function spawnStream() {
      if (stopped || tok.cancelled) return Promise.resolve();
      const id = ++seq;
      const start = performance.now();
      inflight.set(id, { start, bytes: 0 });

      if (direction === "download") {
        // размер растёт с оставшимся временем: короткие прогревающие + длинные основной поток
        const remain = durationMs - (start - tStart);
        const estBytes = Math.max(250_000, Math.min(30_000_000, (emaMbps || 20) * 1e6 / 8 * Math.min(remain, 3000) / 1000));
        return fetch(edge.down + (edge.down.includes("bytes=") ? Math.round(estBytes) : "") +
          (edge.down.includes("?") ? "&" : "?") + "cb=" + Math.random(), { cache: "no-store", signal: AbortSignal.timeout(15000) })
          .then((res) => res.arrayBuffer())
          .then((buf) => {
            totalBytes += buf.byteLength;
            inflight.get(id).bytes = buf.byteLength;
          })
          .catch(() => {})
          .finally(() => { inflight.delete(id); });
      } else {
        const size = Math.max(200_000, Math.min(8_000_000, (emaMbps || 10) * 1e6 / 8 * Math.min(durationMs - (start - tStart), 2500) / 1000));
        const body = new Uint8Array(size);
        return fetch(edge.up, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(15000) })
          .then(() => { totalBytes += size; })
          .catch(() => {})
          .finally(() => { inflight.delete(id); });
      }
    }

    // warmup: сначала 1 соединение, затем наращиваем до connCount
    const pending = [];
    let spawned = 0;
    const rampStep = durationMs / (connCount + 1);
    for (let c = 0; c < connCount; c++) {
      const wait = Math.max(0, c * rampStep - (performance.now() - tStart));
      await sleep(wait);
      if (stopped || tok.cancelled) break;
      const loop = async () => {
        while (!stopped && !tok.cancelled && performance.now() - tStart < durationMs) {
          await spawnStream();
        }
      };
      pending.push(loop());
      spawned++;
    }
    // ждём завершения окна теста
    const remain = durationMs - (performance.now() - tStart);
    if (remain > 0) await sleep(remain);
    stopped = true;
    await Promise.race([Promise.allSettled(pending), sleep(3000)]);

    const secs = (performance.now() - tStart) / 1000;
    const rawMbps = (totalBytes * 8) / secs / 1e6;
    // финальное значение: медиана второй половины timeline (устойчивая фаза)
    const half = timeline.slice(Math.floor(timeline.length / 2)).map((s) => s.mbps).sort((a, b) => a - b);
    const sustained = half.length ? half[Math.floor(half.length / 2)] : rawMbps;
    const finalMbps = Math.max(sustained * 0.9, Math.min(rawMbps, sustained * 1.15));
    return { mbps: finalMbps, peak: Math.max(...timeline.map((s) => s.mbps), 0), bytes: totalBytes, timeline, streams: spawned };
  }

  /* ───────── live-спарклайн в canvas ───────── */
  function drawSpark(canvas, points, color, maxMbps) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (points.length < 2) return;
    const top = Math.max(maxMbps, ...points.map((p) => p.y)) * 1.1 || 10;
    const xs = (i) => (i / (points.length - 1)) * w;
    const ys = (v) => h - (v / top) * (h - 6) - 3;
    // область
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "55"); grad.addColorStop(1, color + "00");
    ctx.beginPath(); ctx.moveTo(xs(0), h);
    points.forEach((p, i) => ctx.lineTo(xs(i), ys(p.y)));
    ctx.lineTo(xs(points.length - 1), h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // линия
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(xs(i), ys(p.y)) : ctx.moveTo(xs(i), ys(p.y)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    // точка текущего значения
    const last = points[points.length - 1];
    ctx.beginPath(); ctx.arc(xs(points.length - 1), ys(last.y), 3.5, 0, 7);
    ctx.fillStyle = color; ctx.fill();
    // сетка подписей
    ctx.font = "10px JetBrains Mono, monospace"; ctx.fillStyle = "rgba(125,147,173,.7)";
    ctx.fillText(top.toFixed(0), 2, 10);
  }

  /* ───────── оценка качества ───────── */
  function rateLink({ down, up, ping, loss }) {
    let score = 0;
    score += Math.min(50, mbps(down) >= 500 ? 50 : Math.pow(mbps(down) / 500, 0.6) * 50);
    score += Math.min(25, mbps(up) >= 100 ? 25 : Math.pow(mbps(up) / 100, 0.6) * 25);
    score += Math.min(15, ping <= 10 ? 15 : Math.max(0, 15 - (ping - 10) / 8));
    score += loss <= 0.5 ? 10 : Math.max(0, 10 - loss * 3);
    score = Math.round(score);
    let grade = "F", gc = "var(--err)";
    if (score >= 85) { grade = "A+"; gc = "var(--ok)"; }
    else if (score >= 70) { grade = "A"; gc = "var(--ok)"; }
    else if (score >= 55) { grade = "B"; gc = "var(--accent)"; }
    else if (score >= 40) { grade = "C"; gc = "var(--warn)"; }
    else if (score >= 25) { grade = "D"; gc = "var(--warn)"; }
    let video = "—";
    if (mbps(down) >= 50 && mbps(up) >= 10) video = "8K · видеоконференции 4K";
    else if (mbps(down) >= 25) video = "4K стриминг ✔";
    else if (mbps(down) >= 10) video = "Full HD ×2 ✔";
    else if (mbps(down) >= 5) video = "HD 720p ✔";
    else video = "SD 480p — узкий канал";
    return { score, grade, gc, video };
  }

  /* ───────── UI хелперы ───────── */
  function setTxt(sel, v) { const el = $(sel); if (el) el.textContent = v; }
  function setHtml(sel, v) { const el = $(sel); if (el) el.innerHTML = v; }
  function setProg(pct) { const el = $("#stProgFill"); if (el) el.style.width = pct + "%"; }
  function setPhase(txt, step) {
    setTxt("#stPhase", txt);
    $$(".st-step").forEach((s) => s.classList.remove("active", "done"));
    $$(".st-step").forEach((s) => { if (+s.dataset.step < step) s.classList.add("done"); if (+s.dataset.step === step) s.classList.add("active"); });
  }
  function bigVal(sel, mbpsVal, phase) {
    const el = $(sel); if (!el) return;
    const f = fmtSpeed(mbpsVal * 1e6);
    el.textContent = f.val;
    const u = el.parentElement.querySelector(".st-unit"); if (u) u.textContent = f.unit;
    el.classList.toggle("idle", !(mbpsVal > 0));
    if (phase) el.dataset.phase = phase;
  }

  /* ───────── главный раннер ───────── */
  async function runPro() {
    if (running) { runId++; /* отмена предыдущего */ await sleep(50); }
    running = true;
    const tok = new CancelToken(++runId);
    const btn = $("#stRunPro"); if (btn) { btn.disabled = true; btn.innerHTML = "■ Остановить"; btn.onclick = () => { runId++; }; }
    $("#stChartWrap")?.classList.remove("hidden");
    const chart = $("#stLiveChart");
    let chartPts = [];
    let chartMax = 10;
    const drawChart = () => {
      const col = chartMode === "dl" ? "#3ee0a4" : "#6ea8ff";
      drawSpark(chart, chartPts, col, chartMax);
    };
    let chartMode = "dl";
    const rafLoop = setInterval(drawChart, 100);

    try {
      setProg(2);
      setPhase("Выбор ближайшего edge-сервера…", 1);
      const edge = await pickEdge(tok);
      setTxt("#stServer", edge.name);

      /* 1 — ping */
      setProg(8);
      setPhase(`1/4 · Пинг: ${CFG.pingCount} замеров через ${edge.name}…`, 2);
      const ping = await measurePing(tok, (ms, host) => {
        setTxt("#stPingLast", ms >= 0 ? `${ms} мс · ${host}` : `timeout ✕ ${host}`);
      });
      setTxt("#stPingV", Math.round(ping.avg));
      setTxt("#stJitterV", ping.jitter.toFixed(1));
      setTxt("#stLossV", ping.lossPct.toFixed(1));
      setProg(18);

      /* 2 — download */
      chartMode = "dl"; chartPts = []; chartMax = 10;
      setPhase(`2/4 · Download: ${CFG.maxConnections} параллельных соединений, ${(CFG.dlDurationMs / 1000).toFixed(0)} с…`, 3);
      const dl = await measureThroughput(tok, {
        direction: "download", edge, durationMs: CFG.dlDurationMs, connCount: CFG.maxConnections,
        onLive: (m, bytes) => {
          bigVal("#stDownBig", m, "dl");
          chartPts.push({ x: bytes, y: m }); if (chartPts.length > 120) chartPts.shift();
          chartMax = Math.max(chartMax, m);
          setProg(18 + Math.min(40, (m / Math.max(chartMax, 1)) * 12));
          setTxt("#stDlLive", fmtSpeed(m * 1e6).val + " " + fmtSpeed(m * 1e6).unit + " · " + (bytes / 1048576).toFixed(1) + " МБ");
        },
      });
      bigVal("#stDownBig", dl.mbps, "dl");
      setTxt("#stDownPeak", dl.peak.toFixed(0));
      setProg(60);

      /* 3 — upload */
      chartMode = "ul"; chartPts = []; chartMax = 5;
      if (edge.up) {
        setPhase(`3/4 · Upload: ${CFG.maxConnections} потока, ${(CFG.ulDurationMs / 1000).toFixed(0)} с…`, 4);
        var ul = await measureThroughput(tok, {
          direction: "upload", edge, durationMs: CFG.ulDurationMs, connCount: CFG.maxConnections,
          onLive: (m, bytes) => {
            bigVal("#stUpBig", m, "ul");
            chartPts.push({ x: bytes, y: m }); if (chartPts.length > 120) chartPts.shift();
            chartMax = Math.max(chartMax, m);
            setProg(60 + Math.min(30, (m / Math.max(chartMax, 1)) * 10));
            setTxt("#stUlLive", fmtSpeed(m * 1e6).val + " " + fmtSpeed(m * 1e6).unit + " · " + (bytes / 1048576).toFixed(1) + " МБ");
          },
        });
      } else {
        setPhase("3/4 · Upload: edge не принимает POST — пропуск", 4);
        var ul = { mbps: 0, peak: 0, bytes: 0 };
      }
      bigVal("#stUpBig", ul.mbps, "ul");
      setProg(92);

      /* 4 — вердикт */
      setPhase("4/4 · Обработка результатов…", 5);
      const rating = rateLink({ down: dl.mbps * 1e6, up: ul.mbps * 1e6, ping: ping.avg, loss: ping.lossPct });
      const gel = $("#stGradeV"); if (gel) { gel.textContent = rating.grade + " · " + rating.score; gel.style.color = rating.gc; }
      setTxt("#stVideo", rating.video);
      setTxt("#stConnInfo", `${rating.score}/100 · ↓${dl.mbps.toFixed(0)} ↑${ul.mbps.toFixed(0)} Мбит/с · пинг ${Math.round(ping.avg)} мс · ${edge.name}`);

      const result = {
        ts: Date.now(), server: edge.name, conns: CFG.maxConnections,
        ping: +ping.avg.toFixed(1), jitter: +ping.jitter.toFixed(1), loss: ping.lossPct,
        down: +(dl.mbps).toFixed(1), downPeak: +(dl.peak).toFixed(1),
        up: +(ul.mbps).toFixed(1), upPeak: +(ul.peak).toFixed(1),
        score: rating.score, grade: rating.grade,
      };
      saveLocal(result);
      saveServer(result);
      renderHistory();
      setProg(100);
      setPhase(`Готово ✔ Сервер: ${edge.name} · ${CFG.maxConnections} соединений · скачано ${(dl.bytes / 1048576).toFixed(0)} МБ, отправлено ${(ul.bytes / 1048576).toFixed(0)} МБ`, 5);
      if (typeof beep === "function") beep(880, 0.15);
    } catch (e) {
      if (e === CANCELLED) { setPhase("Тест остановлен", 0); setProg(0); }
      else { setPhase("Ошибка: " + e.message, 0); if (typeof toast === "function") toast("Speedtest: " + e.message, "error", 6000); }
    } finally {
      clearInterval(rafLoop);
      running = false;
      const b = $("#stRunPro"); if (b) { b.disabled = false; b.innerHTML = "▶ Запустить тест"; b.onclick = runPro; }
    }
  }

  /* ───────── история: локально + сервер ───────── */
  function loadLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; } }
  function saveLocal(r) { const h = loadLocal(); h.unshift(r); localStorage.setItem(LS_KEY, JSON.stringify(h.slice(0, 50))); }
  async function saveServer(r) {
    try {
      await fetch("/api/result", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ download_mbps: r.down, upload_mbps: r.up, ping_ms: r.ping, jitter_ms: r.jitter, note: `grade ${r.grade} (${r.score}/100), server ${r.server}, ${r.conns} conn` }),
      }).catch(() => {});
    } catch (e) { /* не залогинен — ок */ }
  }

  function renderHistory() {
    const box = $("#stHistory"); if (!box) return;
    const h = loadLocal();
    if (!h.length) { box.innerHTML = '<p class="hint">История пуста — запустите первый тест.</p>'; return; }
    box.innerHTML = `<table class="table"><thead><tr><th>Время</th><th>Сервер</th><th>Ping</th><th>Jitter</th><th>Потери</th><th>↓ Мбит/с</th><th>↑ Мбит/с</th><th>Оценка</th></tr></thead><tbody>` +
      h.slice(0, 20).map((x) => `<tr>
        <td class="mono">${new Date(x.ts).toLocaleString("ru-RU")}</td>
        <td>${x.server || "—"}</td>
        <td class="mono">${x.ping ?? "—"}</td><td class="mono">${x.jitter ?? "—"}</td>
        <td class="mono">${x.loss ?? 0}%</td>
        <td class="mono" style="color:var(--ok)">${x.down ?? "—"}</td>
        <td class="mono" style="color:var(--accent)">${x.up ?? "—"}</td>
        <td class="mono"><b>${x.grade || "—"}</b> <small class="hint">${x.score ?? ""}/100</small></td></tr>`).join("") +
      "</tbody></table>";
  }

  /* ───────── bootstrap ───────── */
  function init() {
    const btn = $("#stRunPro");
    if (btn) { btn.addEventListener("click", runPro); }
    const tabs = document.querySelector('[data-tab="nettools"]');
    if (tabs) tabs.addEventListener("click", renderHistory);
    renderHistory();
    // пред-заполним единицы измерения
    ["#stDownBig", "#stUpBig"].forEach((s) => { const el = $(s); if (el && !el.textContent.trim()) el.textContent = "—"; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.SpeedTestPro = { runPro, measurePing, measureThroughput, fmtSpeed, rateLink };
})();
