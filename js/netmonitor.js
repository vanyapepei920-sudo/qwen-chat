/* ═══════════════════════════════════════════════════════════════
   netmonitor.js — РЕАЛЬНЫЙ монитор интернета (без симуляций!)
   Всё измеряется фактическими сетевыми запросами браузера:
     • ping/jitter к нескольким CDN каждые 3 сек;
     • live-поток download/upload (Cloudflare Speed edge) → график
       «сколько отдаёт и получает» в реальном времени;
     • качество сигнала = среднее ping за окно (0..100);
     • Network Information API (downlink/rtt/saveData/type), если есть;
     • online/offline события + история замеров.
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const NET = (() => {
  const PING_TARGETS = [
    "https://api.github.com/zen",
    "https://httpbingo.org/get",
    "https://www.google.com/generate_204",
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/package.json",
  ];
  const CF_DOWN = "https://speed.cloudflare.com/__down?bytes=";
  const CF_UP = "https://speed.cloudflare__com.__up".replace("cloudflare__com.", "cloudflare.com/") + "__up";
  const HISTORY_LEN = 900; // 15 минут при шаге 1с

  const state = {
    running: false,
    pings: [],            // {ts, ms, host}
    latencies: [],        // последние avg-пинги по тикам
    signal: 0.8,          // 0..1 — качество связи (из реальных замеров)
    dlBps: 0, ulBps: 0,   // мгновенные скорости live-фонов
    dlHist: [], ulHist: [],
    lastFull: null,       // последний полный speedtest
    online: navigator.onLine,
    lossEvents: 0, probes: 0,
    ispInfo: "",
    timer: null, histTimer: null, probeTimer: null,
  };

  const listeners = [];
  function on(fn) { listeners.push(fn); }
  function emit(kind) { listeners.forEach((fn) => { try { fn(kind); } catch (e) { console.warn(e); } }); }

  async function timed(url, opts = {}) {
    const t0 = performance.now();
    const res = await fetch(url, { cache: "no-store", mode: "cors", ...opts });
    const text = await res.text();
    return { ms: performance.now() - t0, bytes: new Blob([text]).size };
  }

  /* ─────────── ping-щупальца (реальные) ─────────── */
  async function pingOnce(target) {
    try {
      const r = await timed(target + (target.includes("?") ? "&" : "?") + "_=" + Math.random());
      return { ts: Date.now(), ms: Math.round(r.ms), host: new URL(target).hostname, ok: true };
    } catch (e) {
      return { ts: Date.now(), ms: -1, host: new URL(target).hostname, ok: false };
    }
  }

  async function pingRound() {
    const results = await Promise.all(PING_TARGETS.map(pingOnce));
    state.probes += results.length;
    state.lossEvents += results.filter((r) => !r.ok).length;
    for (const r of results) if (r.ok) state.pings.push(r);
    state.pings = state.pings.slice(-60);
    const ok = results.filter((r) => r.ok).map((r) => r.ms);
    const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 999;
    state.latencies.push(avg); state.latencies = state.latencies.slice(-HISTORY_LEN);
    // качество сигнала из РЕАЛЬНОГО пинга: <30мс→1.0, >400мс→0.05
    state.signal = clamp(1 - (avg - 30) / 370, 0.05, 1);
    emit("ping");
    return { avg, results };
  }

  /* ─────────── live-поток: постоянный мягкий download+upload ─────────── */
  let dlAbort = null, ulStop = false;

  async function liveDownloadLoop() {
    while (state.running) {
      try {
        const url = CF_DOWN + (700 * 1000 + Math.floor(RNG() * 900 * 1000)); // 0.7–1.6 МБ
        dlAbort = new AbortController();
        const t0 = performance.now();
        const res = await fetch(url, { cache: "no-store", signal: dlAbort.signal });
        const reader = res.body.getReader();
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          const secs = (performance.now() - t0) / 1000;
          state.dlBps = secs > 0.05 ? (received * 8) / secs : state.dlBps;
        }
        dlAbort = null;
      } catch (e) {
        state.dlBps = 0;
        if (!state.running) break;
        await sleep(1500); // сеть моргнула — подождать и продолжить
      }
      if (state.running) await sleep(400);
    }
  }

  async function liveUploadLoop() {
    while (state.running) {
      try {
        const payload = new Uint8Array(200 * 1000 + Math.floor(RNG() * 350 * 1000));
        const t0 = performance.now();
        await fetch(CF_UP, { method: "POST", cache: "no-store", body: payload });
        const secs = Math.max(0.05, (performance.now() - t0) / 1000);
        state.ulBps = (payload.length * 8) / secs;
      } catch (e) {
        state.ulBps = 0;
        if (state.running) await sleep(1500);
      }
      if (state.running) await sleep(600);
    }
  }

  function historyTick() {
    state.dlHist.push(state.online ? state.dlBps : 0);
    state.ulHist.push(state.online ? state.ulBps : 0);
    state.dlHist = state.dlHist.slice(-HISTORY_LEN);
    state.ulHist = state.ulHist.slice(-HISTORY_LEN);
    emit("hist");
  }

  /* ─────────── Network Information API (реальные данные ОС/браузера) ─────────── */
  function readNetInfo() {
    const n = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!n) return null;
    const info = {
      effectiveType: n.effectiveType || "—",
      downlink: n.downlink, rtt: n.rtt, saveData: !!n.saveData,
    };
    if (typeof n.addEventListener === "function") {
      try { n.addEventListener("change", () => { emit("info"); }); } catch (e) { /* noop */ }
    }
    return info;
  }

  async function fetchIsp() {
    try {
      const r = await fetch("https://ipapi.co/json/", { cache: "no-store" });
      if (!r.ok) throw 0;
      const j = await r.json();
      state.ispInfo = `${j.org || j.asn || "?"} · ${j.city || "?"}, ${j.country_name || j.country_code || ""} · ${j.ip}`;
    } catch (e) {
      try {
        const r2 = await fetch("https://cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
        const txt = await r2.text();
        const ip = (txt.match(/ip=(.+)/) || [])[1] || "";
        const loc = (txt.match(/loc=(.+)/) || [])[1] || "";
        const sla = (txt.match(/colo=(.+)/) || [])[1] || "";
        state.ispInfo = `IP ${ip} · локация ${loc} · ближайший edge ${sla}`;
      } catch (e2) { state.ispInfo = "сервис определения провайдера недоступен"; }
    }
    emit("info");
  }

  /* ─────────── полные тесты download/upload (для speedtest-кнопки) ─────────── */
  async function measureDownload(sizeBytes, onProgress) {
    const t0 = performance.now();
    const res = await fetch(CF_DOWN + sizeBytes, { cache: "no-store" });
    const reader = res.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      onProgress && onProgress(received, (received * 8 * 1000) / (performance.now() - t0));
    }
    const secs = (performance.now() - t0) / 1000;
    return { bitsPerSec: secs > 0 ? (received * 8) / secs : 0, bytes: received, secs };
  }

  async function measureUpload(payloadBytes, onProgress) {
    const payload = new Uint8Array(payloadBytes);
    const t0 = performance.now();
    const res = await fetch(CF_UP, { method: "POST", cache: "no-store", body: payload }).catch(() => null);
    const secs = Math.max(0.01, (performance.now() - t0) / 1000);
    const ok = res && res.ok;
    onProgress && onProgress(payloadBytes, ok ? (payloadBytes * 8) / secs : 0);
    return { bitsPerSec: ok ? (payloadBytes * 8) / secs : 0, bytes: payloadBytes, secs };
  }

  async function fullSpeedTest(onStep) {
    const say = (m) => onStep && onStep(m);
    say("Ping…");
    const { avg } = await pingRound();
    say("Download 25 МБ…");
    const d = await measureDownload(25e6, (b, r) => say(`↓ ${(r / 1e6).toFixed(0)} Мбит/с`));
    say("Upload 2 МБ…");
    const u = await measureUpload(2e6, (b, r) => say(`↑ ${(r / 1e6).toFixed(0)} Мбит/с`));
    const jitterArr = state.pings.slice(-12).map((p) => p.ms);
    const med = jitterArr.length ? jitterArr.reduce((a, b) => a + b, 0) / jitterArr.length : avg;
    const jitter = jitterArr.length ? jitterArr.reduce((a, b) => a + Math.abs(b - med), 0) / jitterArr.length : 0;
    const loss = state.probes ? (state.lossEvents / state.probes) * 100 : 0;
    const result = {
      ts: Date.now(), ping: Math.round(avg), jitter: Math.round(jitter),
      loss: +loss.toFixed(1), down: d.bitsPerSec, up: u.bitsPerSec,
    };
    state.lastFull = result;
    const hist = JSON.parse(localStorage.getItem("st_history") || "[]");
    hist.unshift(result); localStorage.setItem("st_history", JSON.stringify(hist.slice(0, 20)));
    emit("fulltest");
    return result;
  }

  /* ─────────── старт/стоп ─────────── */
  function start() {
    if (state.running) return;
    state.running = true;
    window.addEventListener("online", () => { state.online = true; emit("conn"); });
    window.addEventListener("offline", () => { state.online = false; emit("conn"); });
    pingRound().then(fetchIsp);
    state.probeTimer = setInterval(() => { if (state.online) pingRound(); }, 3000);
    state.histTimer = setInterval(historyTick, 1000);
    liveDownloadLoop();
    liveUploadLoop();
    emit("conn");
  }
  function stop() {
    state.running = false;
    clearInterval(state.probeTimer); clearInterval(state.histTimer);
    if (dlAbort) try { dlAbort.abort(); } catch (e) { /* noop */ }
    emit("conn");
  }
  function togglePause() {
    if (state.running) { stop(); return false; } else { start(); return true; }
  }

  /* совместимость с dashboard: snapshot/uptime для отчётов */
  function uptimeSec() { return Math.floor((Date.now() - bootTs) / 1000); }
  const bootTs = Date.now();
  function snapshot() {
    return {
      generatedAt: new Date().toISOString(),
      connection: { online: state.online, signalPct: Math.round(state.signal * 100), isp: state.ispInfo },
      latencyMs: { current: Math.round(state.latencies.at(-1) ?? 0), avgLastMin: Math.round(avgOf(state.latencies.slice(-60))) },
      liveThroughput: { downloadMbps: +(state.dlBps / 1e6).toFixed(1), uploadMbps: +(state.ulBps / 1e6).toFixed(1) },
      lastFullTest: state.lastFull ? { ...state.lastFull, downMbps: +(state.lastFull.down / 1e6).toFixed(1), upMbps: +(state.lastFull.up / 1e6).toFixed(1) } : null,
      packetLossPct: state.probes ? +((state.lossEvents / state.probes) * 100).toFixed(2) : 0,
      netInfo: readNetInfo(),
      sessionUptimeSec: uptimeSec(),
    };
  }
  const avgOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  return { state, start, stop, togglePause, on, pingRound, fullSpeedTest, measureDownload, measureUpload, readNetInfo, snapshot, uptimeSec, fmtSpeed };

  function fmtSpeed(bps) {
    if (!isFinite(bps) || bps <= 0) return "— Мбит/с";
    if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " Гбит/с";
    if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " Мбит/с";
    return (bps / 1e3).toFixed(0) + " кбит/с";
  }
})();
