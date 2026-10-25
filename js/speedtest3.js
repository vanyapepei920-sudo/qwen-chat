/* ═══════════════════════════════════════════════════════════════
   speedtest3.js — SpeedNet REAL v3 (как настоящий speedtest.net)
   • Реальные test-серверы Cloudflare по городам (/api/servers)
   • Автовыбор ближайшего: geo клиента → дистанции + ping от браузера
   • Ручной выбор сервера из списка (как «Change Server»)
   • Gauge-спидометр (полудуга 270°, стрелка, дуга значения)
   • Ping → Download (8 потоков, ramp-up) → Upload (4 потока)
   • Live-график, результаты ↓↑ пинг джиттер потери, оценка A+…F
   • Поделиться результатом — ссылка с параметрами + картинка-постер
   • История localStorage + сервер /api/result
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const LS_KEY = "st_history_v3";
  const CANCELLED = new Error("cancelled");

  const CFG = {
    pingCount: 12,
    dlDurationMs: 10000,
    ulDurationMs: 6000,
    dlStreams: 8,
    ulStreams: 4,
    samplesPerSec: 20,
    fallbackServers: [
      { id: "speed.cloudflare.com", name: "Cloudflare (auto)", country: "—",
        down: "https://speed.cloudflare.com/__down?bytes=", up: "https://speed.cloudflare.com/__up" },
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
  const mbps = (b) => b / 1e6;
  const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

  /* ───────── состояние ───────── */
  let runId = 0, running = false;
  let SERVERS = null;          // кэш списка серверов
  let chosenServer = null;     // выбранный вручную или авто
  let lastResult = null;

  class CancelToken {
    constructor(id) { this.id = id; }
    get cancelled() { return runId !== this.id; }
    check() { if (this.cancelled) throw CANCELLED; }
  }

  /* ───────── загрузка серверов ───────── */
  async function loadServers() {
    if (SERVERS) return SERVERS;
    try {
      const r = await fetch("/api/servers", { cache: "no-store" });
      if (r.ok) { SERVERS = (await r.json()).servers; return SERVERS; }
    } catch (e) { /* офлайн/не залогинен */ }
    SERVERS = CFG.fallbackServers;
    return SERVERS;
  }

  /* ping до конкретного сервера (несколько замеров, берём минимум) */
  async function pingServer(url, times = 3, tok) {
    let best = Infinity, fails = 0;
    for (let i = 0; i < times; i++) {
      if (tok && tok.cancelled) throw CANCELLED;
      const t0 = performance.now();
      try {
        const u = url.endsWith("=") ? url + "0" : url;
        const r = await fetch(u + (u.includes("?") ? "&" : "?") + "_=" + Math.random(),
          { cache: "no-store", signal: AbortSignal.timeout(4000) });
        await r.arrayBuffer();
        best = Math.min(best, performance.now() - t0);
      } catch (e) { fails++; }
    }
    return { ms: best === Infinity ? null : best, fails };
  }

  /* автовыбор: geo клиента → ближайшие по haversine + ping из браузера */
  async function autoPickServer(tok) {
    const servers = await loadServers();
    setPhase("Поиск ближайшего сервера (geo + ping)…", 1);
    let geo = null;
    try {
      const r = await fetch("/api/client-geo", { cache: "no-store" });
      if (r.ok) geo = await r.json();
    } catch (e) {}
    let candidates = servers;
    if (geo && geo.lat != null) {
      const hav = (a, b, c, d) => {
        const p = Math.PI / 180, q = Math.cos((c * p)) * Math.cos((a * p));
        return 12742 * Math.asin(Math.sqrt(Math.sin((c - a) * p / 2) ** 2 + q * Math.sin((d - b) * p / 2) ** 2));
      };
      const scored = servers.map((s) => ({ s, km: hav(geo.lat, s.lat, geo.lon, s.lon) }))
        .sort((x, y) => x.km - y.km);
      candidates = scored.slice(0, 5).map((x) => x.s);
      $("#stGeo").textContent = `${geo.city || "?"}, ${geo.country || "?"} · ISP: ${geo.isp || "—"}`;
    }
    // ping-рейтинг кандидатов из браузера: у Cloudflare каждый запрос идёт
    // в ближайший POP, поэтому реальный пинг различается между «городами»
    const ranked = [];
    for (const s of candidates) {
      if (tok.cancelled) throw CANCELLED;
      const p = await pingServer(s.down, 4, tok);
      if (p.ms != null) ranked.push({ ...s, _ping: p.ms });
    }
    if (!ranked.length) return servers[0];
    ranked.sort((a, b) => a._ping - b._ping);
    setTxt("#stGeo", ($("#stGeo").textContent || "") + ` · лучший POP: ${ranked[0].name} (${Math.round(ranked[0]._ping)} мс)`);
    return ranked[0];
  }

  /* ───────── gauge-спидометр ───────── */
  const GAUGE_STOPS = [[0, "#3ee0a4"], [10, "#7ee06a"], [50, "#ffd166"], [100, "#ff9f43"], [300, "#ff6b6b"], [1000, "#c86bff"]];
  function gaugeColor(v) {
    let c = GAUGE_STOPS[GAUGE_STOPS.length - 1][1];
    for (let i = 0; i < GAUGE_STOPS.length - 1; i++) {
      if (v <= GAUGE_STOPS[i + 1][0]) { c = GAUGE_STOPS[i][1]; break; }
    }
    return c;
  }
  function drawGauge(canvas, value, maxV, label) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 + h * 0.06, R = Math.min(w, h) * 0.42;
    const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5; // 270°
    const logMax = Math.log10(maxV + 1);
    const frac = Math.min(1, Math.log10(value + 1) / logMax);
    // фон
    ctx.lineWidth = R * 0.16; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy, R, A0, A0 + SWEEP);
    ctx.strokeStyle = "rgba(110,130,165,.18)"; ctx.stroke();
    // цветные сегменты шкалы (тонкие)
    for (let i = 0; i < GAUGE_STOPS.length - 1; i++) {
      const f1 = Math.log10(GAUGE_STOPS[i][0] + 1) / logMax;
      const f2 = Math.log10(GAUGE_STOPS[i + 1][0] + 1) / logMax;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, A0 + SWEEP * f1, A0 + SWEEP * f2);
      ctx.lineWidth = 3; ctx.strokeStyle = GAUGE_STOPS[i][1] + "66"; ctx.stroke();
    }
    // дуга значения
    if (value > 0) {
      const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      grad.addColorStop(0, "#3ee0a4"); grad.addColorStop(0.6, gaugeColor(value)); grad.addColorStop(1, gaugeColor(value));
      ctx.beginPath(); ctx.arc(cx, cy, R, A0, A0 + SWEEP * frac);
      ctx.lineWidth = R * 0.16; ctx.lineCap = "round"; ctx.strokeStyle = grad; ctx.stroke();
      // glow
      ctx.save(); ctx.shadowColor = gaugeColor(value); ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(cx, cy, R, Math.max(A0, A0 + SWEEP * frac - 0.12), A0 + SWEEP * frac);
      ctx.strokeStyle = gaugeColor(value); ctx.lineWidth = R * 0.1; ctx.stroke(); ctx.restore();
      // стрелка
      const ang = A0 + SWEEP * frac;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(-R * 0.12, 0); ctx.lineTo(R * 0.82, 0);
      ctx.strokeStyle = "#e8f0ff"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fillStyle = "#e8f0ff"; ctx.fill();
      ctx.restore();
    }
    // деления
    ctx.font = `600 ${Math.max(9, R * 0.13)}px JetBrains Mono, monospace`;
    ctx.fillStyle = "rgba(125,147,173,.85)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const ticks = [0, 1, 10, 50, 100, 250, 500, 1000].filter((t) => t <= maxV);
    for (const t of ticks) {
      const f = Math.log10(t + 1) / logMax, ang = A0 + SWEEP * f;
      const rr = R * 1.3;
      ctx.fillText(t >= 1000 ? "1G" : String(t), cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    }
    if (label) {
      ctx.font = `700 ${Math.max(10, R * 0.14)}px Inter, sans-serif`;
      ctx.fillStyle = "rgba(125,147,173,.9)";
      ctx.fillText(label, cx, cy + R * 0.62);
    }
  }

  /* ───────── ping / jitter / loss (по RFC3550) ───────── */
  async function measurePing(tok, server, onSample) {
    const samples = []; let fail = 0;
    const url = server.down;
    for (let i = 0; i < CFG.pingCount; i++) {
      tok.check();
      const t0 = performance.now();
      try {
        const r = await fetch(url + "0&_=" + Math.random(), { cache: "no-store", signal: AbortSignal.timeout(5000) });
        await r.arrayBuffer();
        const ms = performance.now() - t0;
        samples.push(ms); onSample && onSample(Math.round(ms), true);
      } catch (e) { fail++; onSample && onSample(-1, false); }
      await sleep(60);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
    const sd = Math.sqrt(samples.reduce((a, b) => a + (b - avg) ** 2, 0) / (samples.length || 1));
    let rf = 0; for (let i = 1; i < samples.length; i++) rf += Math.abs(samples[i] - samples[i - 1]);
    const jitter = samples.length > 1 ? rf / (samples.length - 1) * 0.5 + sd * 0.5 : 0;
    return {
      min: sorted[0] ?? 0, avg, max: sorted[sorted.length - 1] ?? 0, jitter,
      lossPct: +((fail / (samples.length + fail || 1)) * 100).toFixed(1),
      samples: samples.map((x) => +x.toFixed(1)),
    };
  }

  /* ───────── параллельный throughput ───────── */
  async function measureThroughput(tok, { direction, server, durationMs, connCount, onLive }) {
    const tStart = performance.now();
    let totalBytes = 0, emaMbps = 0, seq = 0, stopped = false;
    const timeline = [], inflight = new Map();

    (function tick() {
      if (stopped || tok.cancelled) return;
      const secs = (performance.now() - tStart) / 1000;
      const inst = secs > 0 ? (totalBytes * 8) / secs / 1e6 : 0;
      emaMbps = emaMbps === 0 ? inst : emaMbps * 0.72 + inst * 0.28;
      timeline.push({ t: performance.now() - tStart, mbps: emaMbps });
      onLive && onLive(emaMbps, totalBytes);
      setTimeout(tick, 1000 / CFG.samplesPerSec);
    })();

    function spawnStream() {
      if (stopped || tok.cancelled) return Promise.resolve();
      const id = ++seq;
      inflight.set(id, { start: performance.now(), bytes: 0 });
      if (direction === "download") {
        const remain = durationMs - (performance.now() - tStart);
        const estBytes = Math.max(300_000, Math.min(40_000_000,
          (emaMbps || 25) * 1e6 / 8 * Math.min(remain, 3000) / 1000));
        return fetch(server.down + Math.round(estBytes) + "&cb=" + Math.random(),
            { cache: "no-store", signal: AbortSignal.timeout(20000) })
          .then((res) => res.arrayBuffer())
          .then((buf) => { totalBytes += buf.byteLength; })
          .catch(() => {})
          .finally(() => inflight.delete(id));
      }
      const size = Math.max(250_000, Math.min(8_000_000,
        (emaMbps || 10) * 1e6 / 8 * Math.min(durationMs - (performance.now() - tStart), 2500) / 1000));
      const body = new Uint8Array(size);
      return fetch(server.up, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(20000) })
        .then(() => { totalBytes += size; })
        .catch(() => {})
        .finally(() => inflight.delete(id));
    }

    const pending = [];
    const rampStep = durationMs / (connCount + 1);
    for (let c = 0; c < connCount; c++) {
      await sleep(Math.max(0, c * rampStep - (performance.now() - tStart)));
      if (stopped || tok.cancelled) break;
      pending.push((async () => {
        while (!stopped && !tok.cancelled && performance.now() - tStart < durationMs) await spawnStream();
      })());
    }
    const remain = durationMs - (performance.now() - tStart);
    if (remain > 0) await sleep(remain);
    stopped = true;
    await Promise.race([Promise.allSettled(pending), sleep(3500)]);

    const secs = (performance.now() - tStart) / 1000;
    const rawMbps = (totalBytes * 8) / secs / 1e6;
    const half = timeline.slice(Math.floor(timeline.length / 2)).map((s) => s.mbps).sort((a, b) => a - b);
    const sustained = half.length ? half[Math.floor(half.length / 2)] : rawMbps;
    const finalMbps = Math.max(sustained * 0.9, Math.min(rawMbps, sustained * 1.15));
    return { mbps: finalMbps, peak: Math.max(...timeline.map((s) => s.mbps), 0), bytes: totalBytes, timeline, streams: connCount };
  }

  /* ───────── live-график ───────── */
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
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "55"); grad.addColorStop(1, color + "00");
    ctx.beginPath(); ctx.moveTo(xs(0), h);
    points.forEach((p, i) => ctx.lineTo(xs(i), ys(p.y)));
    ctx.lineTo(xs(points.length - 1), h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(xs(i), ys(p.y)) : ctx.moveTo(xs(i), ys(p.y)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    const last = points[points.length - 1];
    ctx.beginPath(); ctx.arc(xs(points.length - 1), ys(last.y), 3.5, 0, 7);
    ctx.fillStyle = color; ctx.fill();
    ctx.font = "10px JetBrains Mono, monospace"; ctx.fillStyle = "rgba(125,147,173,.7)";
    ctx.fillText(top.toFixed(0), 2, 10);
  }

  /* ───────── вердикт ───────── */
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
    let video = "SD 480p — узкий канал";
    if (mbps(down) >= 50 && mbps(up) >= 10) video = "8K · видеоконференции 4K ✔";
    else if (mbps(down) >= 25) video = "4K стриминг ✔";
    else if (mbps(down) >= 10) video = "Full HD ×2 ✔";
    else if (mbps(down) >= 5) video = "HD 720p ✔";
    let use = "Офис/мессенджер";
    if (mbps(down) >= 300) use = "Идеально: игры, торренты, 8K, удалённая работа";
    else if (mbps(down) >= 100) use = "Отлично: 4K на нескольких устройствах";
    else if (mbps(down) >= 30) use = "Хорошо: FullHD + видеозвонки";
    return { score, grade, gc, video, use };
  }

  /* ───────── UI хелперы ───────── */
  function setTxt(sel, v) { const el = $(sel); if (el) el.textContent = v; }
  function setProg(pct) { const el = $("#stProgFill"); if (el) el.style.width = pct + "%"; }
  function setPhase(txt, step) {
    setTxt("#stPhase", txt);
    document.querySelectorAll(".st-step").forEach((s) => {
      s.classList.remove("active", "done");
      if (+s.dataset.step < step) s.classList.add("done");
      if (+s.dataset.step === step) s.classList.add("active");
    });
  }
  let gaugeTimer = null, gaugePts = [], gaugeMax = 100, gaugeMode = "dl";
  function gaugeLoop() {
    clearInterval(gaugeTimer);
    gaugeTimer = setInterval(() => {
      const cur = gaugePts.length ? gaugePts[gaugePts.length - 1].y : 0;
      drawGauge($("#stGauge"), cur, gaugeMax, gaugeMode === "dl" ? "↓ DOWNLOAD Мбит/с" : "↑ UPLOAD Мбит/с");
    }, 80);
  }

  /* ───────── главный раннер ───────── */
  async function runReal() {
    if (running) { runId++; await sleep(50); }
    running = true;
    const tok = new CancelToken(++runId);
    const btn = $("#stRunReal");
    if (btn) { btn.disabled = true; btn.textContent = "■ Остановить"; btn.onclick = () => { runId++; }; }
    $("#stChartWrap")?.classList.remove("hidden");
    $("#stActions")?.classList.add("hidden");
    $("#stResults")?.classList.add("hidden");
    $("#stShareCard")?.classList.add("hidden");
    gaugePts = []; gaugeMax = 100; gaugeMode = "dl"; gaugeLoop();
    const chart = $("#stLiveChart"); let chartPts = [], chartMax = 10;
    const raf = setInterval(() => drawSpark(chart, chartPts, gaugeMode === "dl" ? "#3ee0a4" : "#6ea8ff", chartMax), 100);

    try {
      setProg(2);
      /* сервер: ручной выбор или авто */
      let server = chosenServer;
      if (!server) server = await autoPickServer(tok);
      else { setPhase(`Сервер: ${server.name} — проверка доступности…`, 1);
             const p = await pingServer(server.down, 2, tok); if (p.ms == null) server = await autoPickServer(tok); }
      chosenServer = server;
      setTxt("#stServerName", server.name + (server.country !== "—" ? ` (${server.country})` : ""));

      /* 1 — ping */
      setProg(8); setPhase(`1/4 · Пинг до ${server.name}: ${CFG.pingCount} замеров…`, 2);
      const ping = await measurePing(tok, server, (ms) =>
        setTxt("#stPingLast", ms >= 0 ? `${ms} мс` : `timeout ✕`));
      setTxt("#stPingV", Math.round(ping.avg));
      setTxt("#stJitterV", ping.jitter.toFixed(1));
      setTxt("#stLossV", ping.lossPct.toFixed(1));
      setProg(16);

      /* 2 — download */
      gaugeMode = "dl"; gaugePts = []; chartPts = []; chartMax = 10; gaugeMax = 100;
      setPhase(`2/4 · Download: ${CFG.dlStreams} потоков, ${(CFG.dlDurationMs / 1000)} с…`, 3);
      const dl = await measureThroughput(tok, {
        direction: "download", server, durationMs: CFG.dlDurationMs, connCount: CFG.dlStreams,
        onLive: (m, bytes) => {
          gaugePts.push({ y: m }); if (gaugePts.length > 240) gaugePts.shift();
          gaugeMax = Math.max(gaugeMax, m * 1.15);
          chartPts.push({ x: bytes, y: m }); if (chartPts.length > 160) chartPts.shift();
          chartMax = Math.max(chartMax, m);
          const f = fmtSpeed(m * 1e6);
          setTxt("#stBigVal", f.val); setTxt("#stBigUnit", f.unit);
          setTxt("#stDlLive", `${nf.format(m)} Мбит/с · ${(bytes / 1048576).toFixed(1)} МБ`);
          setProg(16 + Math.min(44, (m / Math.max(chartMax, 1)) * 14));
        },
      });
      gaugeMax = Math.max(gaugeMax, dl.mbps * 1.15);
      const fd = fmtSpeed(dl.mbps * 1e6);
      setTxt("#stBigVal", fd.val); setTxt("#stBigUnit", fd.unit);
      setTxt("#stDownFinal", nf.format(dl.mbps));
      setTxt("#stDownPeak", nf.format(dl.peak));
      setProg(62);

      /* 3 — upload */
      gaugeMode = "ul"; gaugePts = []; chartPts = []; chartMax = 5; gaugeMax = 50;
      let ul = { mbps: 0, peak: 0, bytes: 0 };
      if (server.up) {
        setPhase(`3/4 · Upload: ${CFG.ulStreams} потоков, ${(CFG.ulDurationMs / 1000)} с…`, 4);
        ul = await measureThroughput(tok, {
          direction: "upload", server, durationMs: CFG.ulDurationMs, connCount: CFG.ulStreams,
          onLive: (m, bytes) => {
            gaugePts.push({ y: m }); if (gaugePts.length > 240) gaugePts.shift();
            gaugeMax = Math.max(gaugeMax, m * 1.15);
            chartPts.push({ x: bytes, y: m }); if (chartPts.length > 160) chartPts.shift();
            chartMax = Math.max(chartMax, m);
            const f = fmtSpeed(m * 1e6);
            setTxt("#stBigVal", f.val); setTxt("#stBigUnit", f.unit);
            setTxt("#stUlLive", `${nf.format(m)} Мбит/с · ${(bytes / 1048576).toFixed(1)} МБ`);
            setProg(62 + Math.min(28, (m / Math.max(chartMax, 1)) * 10));
          },
        });
      } else { setPhase("3/4 · Upload: сервер не принимает POST — пропуск", 4); }
      gaugeMax = Math.max(gaugeMax, ul.mbps * 1.15);
      setTxt("#stUpFinal", nf.format(ul.mbps));
      setTxt("#stUpPeak", nf.format(ul.peak));
      setProg(92);

      /* 4 — вердикт */
      setPhase("4/4 · Вердикт…", 5);
      const rating = rateLink({ down: dl.mbps * 1e6, up: ul.mbps * 1e6, ping: ping.avg, loss: ping.lossPct });
      const gel = $("#stGradeV");
      if (gel) { gel.textContent = rating.grade; gel.style.color = rating.gc; }
      setTxt("#stScoreV", rating.score + "/100");
      setTxt("#stVideo", "🎬 " + rating.video);
      setTxt("#stUse", "💡 " + rating.use);
      drawGauge($("#stGauge"), dl.mbps, Math.max(gaugeMax, dl.mbps * 1.2), "↓ DOWNLOAD Мбит/с");

      lastResult = {
        ts: Date.now(), server: server.name, host: server.host || server.id,
        conns: CFG.dlStreams, ping: +ping.avg.toFixed(1), pingMin: +ping.min.toFixed(1), pingMax: +ping.max.toFixed(1),
        jitter: +ping.jitter.toFixed(1), loss: ping.lossPct,
        down: +dl.mbps.toFixed(1), downPeak: +dl.peak.toFixed(1),
        up: +ul.mbps.toFixed(1), upPeak: +ul.peak.toFixed(1),
        score: rating.score, grade: rating.grade,
      };
      saveLocal(lastResult); saveServer(lastResult); renderHistory();
      $("#stResults")?.classList.remove("hidden");
      $("#stActions")?.classList.remove("hidden");
      setProg(100);
      setPhase(`Готово ✔ ${server.name} · ↓${nf.format(dl.mbps)} ↑${nf.format(ul.mbps)} Мбит/с · скачано ${(dl.bytes / 1048576).toFixed(0)} МБ`, 5);
      if (typeof beep === "function") beep(880, 0.15);
    } catch (e) {
      if (e === CANCELLED) { setPhase("Тест остановлен", 0); setProg(0); }
      else { setPhase("Ошибка: " + e.message, 0); if (typeof toast === "function") toast("Speedtest: " + e.message, "error", 6000); }
    } finally {
      clearInterval(raf); clearInterval(gaugeTimer);
      running = false;
      const b = $("#stRunReal");
      if (b) { b.disabled = false; b.textContent = "▶ Запустить тест"; b.onclick = runReal; }
    }
  }

  /* ───────── выбор сервера (модалка со списком) ───────── */
  async function openServerPicker() {
    const box = $("#stServerList"); if (!box) return;
    $("#stServerModal")?.classList.remove("hidden");
    box.innerHTML = '<p class="hint">Загрузка списка серверов и пингов…</p>';
    const servers = await loadServers();
    box.innerHTML = servers.map((s) =>
      `<button class="srv-row" data-id="${s.id}"><span>${s.name}</span><small class="mono">${s.country}</small></button>`).join("");
    box.querySelectorAll(".srv-row").forEach((btnEl) => {
      btnEl.addEventListener("click", async () => {
        const s = servers.find((x) => x.id === btnEl.dataset.id);
        btnEl.querySelector("small").textContent = "ping…";
        const p = await pingServer(s.down, 3);
        btnEl.querySelector("small").textContent = p.ms != null ? Math.round(p.ms) + " мс" : "✕";
      });
    });
    $("#stPickAuto")?.addEventListener("click", () => {
      chosenServer = null; closePicker(); $("#stServerName").textContent = "авто";
    });
  }
  function closePicker() { $("#stServerModal")?.classList.add("hidden"); }

  /* ───────── поделиться ───────── */
  function shareResult() {
    if (!lastResult) return;
    const card = $("#stShareCard");
    const url = location.origin + location.pathname +
      `#r=${lastResult.down},${lastResult.up},${lastResult.ping},${encodeURIComponent(lastResult.server)}`;
    const cv = $("#stPoster");
    if (cv) {
      const w = 640, h = 360; cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#0b1020"); g.addColorStop(1, "#101a33");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#3ee0a4"; ctx.font = "700 26px Inter, sans-serif";
      ctx.fillText("⚡ SpeedNet — результат теста", 30, 52);
      ctx.font = "700 64px JetBrains Mono, monospace";
      ctx.fillStyle = "#eafff5"; ctx.fillText(nf.format(lastResult.down) + " Мбит/с", 30, 140);
      ctx.font = "600 22px Inter, sans-serif"; ctx.fillStyle = "#9fb4d8";
      ctx.fillText("DOWNLOAD ↓", 30, 172);
      ctx.fillStyle = "#6ea8ff"; ctx.font = "700 44px JetBrains Mono, monospace";
      ctx.fillText(nf.format(lastResult.up) + " Мбит/с", 30, 235);
      ctx.font = "600 22px Inter, sans-serif"; ctx.fillStyle = "#9fb4d8";
      ctx.fillText("UPLOAD ↑", 30, 262);
      ctx.fillStyle = "#ffd166"; ctx.font = "700 30px JetBrains Mono, monospace";
      ctx.fillText(`${lastResult.ping} мс · ${lastResult.grade} (${lastResult.score}/100)`, 30, 315);
      ctx.fillStyle = "rgba(125,147,173,.7)"; ctx.font = "500 14px Inter, sans-serif";
      ctx.fillText(lastResult.server + " · " + new Date(lastResult.ts).toLocaleString("ru-RU"), 30, 342);
    }
    const inp = $("#stShareLink"); if (inp) inp.value = url;
    card?.classList.remove("hidden");
    navigator.clipboard?.writeText(url).then(
      () => setTxt("#stShareHint", "Ссылка скопирована в буфер ✔"),
      () => setTxt("#stShareHint", "Скопируйте ссылку вручную"));
  }
  function importFromHash() {
    const m = location.hash.match(/#r=([\d.]+),([\d.]+),([\d.]+),([^&]+)/);
    if (!m) return;
    const box = $("#stSharedResult");
    if (box) {
      box.innerHTML = `<div class="shared-box">🔗 Результат по ссылке: <b class="mono" style="color:var(--ok)">↓${m[1]}</b> ·
        <b class="mono" style="color:var(--accent)">↑${m[2]}</b> Мбит/с · пинг <b class="mono">${m[3]} мс</b> ·
        сервер <b>${decodeURIComponent(m[4])}</b></div>`;
      box.classList.remove("hidden");
    }
  }

  /* ───────── история ───────── */
  function loadLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; } }
  function saveLocal(r) { const h = loadLocal(); h.unshift(r); localStorage.setItem(LS_KEY, JSON.stringify(h.slice(0, 60))); }
  async function saveServer(r) {
    try {
      await fetch("/api/result", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          download_mbps: r.down, upload_mbps: r.up, ping_ms: r.ping, jitter_ms: r.jitter,
          note: `v3 ${r.grade}(${r.score}/100) srv=${r.server} ping${r.pingMin}/${r.pingMax} loss${r.loss}%`,
        }),
      }).catch(() => {});
    } catch (e) {}
  }
  function renderHistory() {
    const box = $("#stHistory"); if (!box) return;
    const h = loadLocal();
    if (!h.length) { box.innerHTML = '<p class="hint">История пуста — запустите первый тест.</p>'; return; }
    box.innerHTML = `<table class="table"><thead><tr><th>Время</th><th>Сервер</th><th>Ping</th><th>Jitter</th><th>Потери</th><th>↓</th><th>↑</th><th>Оценка</th></tr></thead><tbody>` +
      h.slice(0, 20).map((x) => `<tr>
        <td class="mono">${new Date(x.ts).toLocaleString("ru-RU")}</td>
        <td>${x.server || "—"}</td><td class="mono">${x.ping ?? "—"}</td>
        <td class="mono">${x.jitter ?? "—"}</td><td class="mono">${x.loss ?? 0}%</td>
        <td class="mono" style="color:var(--ok)">${x.down ?? "—"}</td>
        <td class="mono" style="color:var(--accent)">${x.up ?? "—"}</td>
        <td class="mono"><b>${x.grade || "—"}</b> <small class="hint">${x.score ?? ""}</small></td></tr>`).join("") +
      "</tbody></table>";
  }

  /* ───────── bootstrap ───────── */
  function init() {
    importFromHash();
    $("#stRunReal")?.addEventListener("click", runReal);
    $("#stChangeServer")?.addEventListener("click", openServerPicker);
    $("#stCloseModal")?.addEventListener("click", closePicker);
    $("#stCancelModal")?.addEventListener("click", closePicker);
    $("#stShareBtn")?.addEventListener("click", shareResult);
    $("#stHideShare")?.addEventListener("click", () => $("#stShareCard")?.classList.add("hidden"));
    const tab = document.querySelector('[data-tab="nettools"]');
    if (tab) tab.addEventListener("click", renderHistory);
    renderHistory();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.SpeedNetReal = { runReal, loadServers, pingServer, fmtSpeed, rateLink, drawGauge };
})();
