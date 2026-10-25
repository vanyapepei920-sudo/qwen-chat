/* ═══════════════════════════════════════════════════════════════
   NETMON — живой монитор интернета (реальные замеры, без симуляций)
   ping / jitter / качество сигнала / download / upload / IP-провайдер
   ═══════════════════════════════════════════════════════════════ */
'use strict';

var NETMON = (() => {
  const PING_HOSTS_FULL = [
    ['GitHub CDN', 'https://api.github.com/zen?cb='],
    ['HTTP Bingo', 'https://httpbingo.org/status/200?cb='],
    ['Google 204', 'https://www.gstatic.com/generate_204?cb='],
    ['Cloudflare', 'https://speed.cloudflare.com/__down?bytes=0&cb='],
    ['Yandex', 'https://yandex.com/images/icon-home.svg?cb='],
    ['Wikipedia', 'https://en.wikipedia.org/wiki/Special:Random?url=&cb='],
  ];
  const DL_URL = 'https://speed.cloudflare.com/__down?bytes=';
  const UL_URL = 'https://speed.cloudflare.com/__up';
  const HIST_KEY = 'netmon_history_v1';

  let timer = null, running = false, dlAbort = null, ulAbort = null;
  let lastPing = [], lastJitter = 0, lastLoss = 0, sigSamples = [];
  let curDown = 0, curUp = 0;
  let cycles = 0, totalDownBytes = 0, totalUpBytes = 0;
  const listeners = new Set();

  /* ── конфигурация (управляется из netlab «Параметры») ─────── */
  const cfg = {
    periodMs: +(localStorage.getItem('nl_period') || 0) || 2500,
    dlBytes: +(localStorage.getItem('nl_dl_bytes') || 0) || 4 * 1024 * 1024,
    hostsCount: +(localStorage.getItem('nl_hosts') || 3) || 3,
  };
  function setConfig(patch) { Object.assign(cfg, patch); }

  /* ── helpers ─────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const fmtMbps = bps => bps >= 1e9 ? (bps / 1e9).toFixed(2) + ' Гбит/с'
    : bps >= 1e6 ? (bps / 1e6).toFixed(1) + ' Мбит/с'
    : bps >= 1e3 ? (bps / 1e3).toFixed(0) + ' Кбит/с' : Math.round(bps) + ' бит/с';

  function emit(evt, data) { listeners.forEach(fn => { try { fn(evt, data); } catch (e) {} }); }
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  async function timedFetch(url, opts) {
    const t0 = performance.now();
    const r = await fetch(url, opts);
    await r.arrayBuffer().catch(() => {});
    return performance.now() - t0;
  }

  /* ── ping cycle ──────────────────────────────────────────── */
  async function measurePing() {
    const res = [];
    for (const [name, base] of PING_HOSTS_FULL.slice(0, cfg.hostsCount)) {
      try {
        const ms = await timedFetch(base + Date.now() + Math.random(), { cache: 'no-store' });
        res.push({ name, ok: true, ms: Math.round(ms) });
      } catch (e) { res.push({ name, ok: false, ms: null }); }
    }
    lastPing = res;
    const oks = res.filter(r => r.ok).map(r => r.ms);
    if (oks.length > 1) {
      let sum = 0;
      for (let i = 1; i < oks.length; i++) sum += Math.abs(oks[i] - oks[i - 1]);
      lastJitter = Math.round(sum / (oks.length - 1));
    } else lastJitter = 0;
    lastLoss = Math.round((res.filter(r => !r.ok).length / res.length) * 100);
    if (oks.length) rememberPing(oks[0]);
    // сигнал: 100% при 20мс и 0 потерь → падает с пингом и потерями
    const avg = oks.length ? oks.reduce((a, b) => a + b, 0) / oks.length : 800;
    const byPing = Math.max(0, Math.min(100, 100 - (Math.min(avg, 500) / 500) * 100));
    const sig = Math.round(byPing * (1 - lastLoss / 100));
    sigSamples.push(sig); if (sigSamples.length > 12) sigSamples.shift();
    emit('ping', { hosts: res, jitter: lastJitter, loss: lastLoss, signal: sig });
    return sig;
  }

  /* ── bandwidth burst ─────────────────────────────────────── */
  async function measureDownload(onProgress) {
    const bytes = cfg.dlBytes;
    dlAbort = new AbortController();
    const t0 = performance.now();
    let got = 0;
    const resp = await fetch(DL_URL + bytes + '&cb=' + Date.now(), {
      cache: 'no-store', signal: dlAbort.signal,
    });
    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      const dt = (performance.now() - t0) / 1000;
      if (dt > 0.2 && onProgress) onProgress((got * 8) / dt);
    }
    const secs = (performance.now() - t0) / 1000;
    curDown = secs > 0 ? (got * 8) / secs : 0;
    totalDownBytes += got;
    emit('download', { bps: curDown, bytes: got });
    return curDown;
  }

  async function measureUpload(onProgress) {
    const blob = new Uint8Array(768 * 1024); // 0.75 МБ
    ulAbort = new AbortController();
    const t0 = performance.now();
    await fetch(UL_URL + '?cb=' + Date.now(), {
      method: 'POST', body: blob, cache: 'no-store', signal: ulAbort.signal,
    });
    const secs = (performance.now() - t0) / 1000;
    curUp = secs > 0 ? (blob.length * 8) / secs : 0;
    totalUpBytes += blob.length;
    emit('upload', { bps: curUp, bytes: blob.length });
    return curUp;
  }

  /* ── public IP / провайдер (без ключа) ──────────────────── */
  let whois = null;
  async function fetchWhois() {
    try {
      const r = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
      const j = await r.json();
      whois = { ip: j.ip, org: j.org || j.asn, city: j.city, country: j.country_name };
      emit('whois', whois);
    } catch (e) { emit('whois', null); }
  }

  /* ── online/offline статус ───────────────────────────────── */
  window.addEventListener('online', () => emit('status', { online: true }));
  window.addEventListener('offline', () => emit('status', { online: false }));

  /* ── главный цикл ────────────────────────────────────────── */
  let phase = 0;
  async function cycle() {
    if (!running) return;
    try {
      if (phase % 3 === 0) {
        await measureDownload(bps => emit('download-live', { bps }));
      } else if (phase % 3 === 1) {
        await measureUpload(bps => emit('upload-live', { bps }));
      }
      await measurePing();
      if (phase === 0) fetchWhois();
      phase++; cycles++;
      emit('stats', getStats());
      if (phase % 12 === 0) pushHistory();
    } catch (e) {
      if (e.name !== 'AbortError') emit('error', String(e.message || e));
    }
  }

  function pushHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      h.unshift({
        t: Date.now(), down: Math.round(curDown), up: Math.round(curUp),
        ping: lastPing.filter(p => p.ok).map(p => p.ms)[0] || null,
        jitter: lastJitter, loss: lastLoss,
        signal: sigSamples[sigSamples.length - 1] || 0,
      });
      localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 60)));
    } catch (e) {}
  }
  function history() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } }

  function getStats() {
    const oks = lastPing.filter(r => r.ok).map(r => r.ms);
    let pings = [];
    try { pings = JSON.parse(localStorage.getItem(HIST_KEY + '_pings') || '[]'); } catch (e) {}
    return { cycles, totalDownBytes, totalUpBytes,
      pingMin: pings.length ? Math.min(...pings) : null,
      pingMax: pings.length ? Math.max(...pings) : null,
      pingAvg: pings.length ? Math.round(pings.reduce((a,b)=>a+b,0)/pings.length) : null,
      pings };
  }
  function resetStats() {
    cycles = 0; totalDownBytes = 0; totalUpBytes = 0;
    try { localStorage.removeItem(HIST_KEY + '_pings'); } catch (e) {}
    emit('stats', getStats());
  }
  function rememberPing(ms) {
    if (ms == null) return;
    try {
      const a = JSON.parse(localStorage.getItem(HIST_KEY + '_pings') || '[]');
      a.push(ms); if (a.length > 90) a.shift();
      localStorage.setItem(HIST_KEY + '_pings', JSON.stringify(a));
    } catch (e) {}
  }
  function start(periodMs) {
    if (running) return;
    running = true;
    cycle();
    timer = setInterval(cycle, periodMs || cfg.periodMs);
    emit('state', { running: true });
  }
  function restart() { stop(); setTimeout(() => start(), 60); }
  function stop() {
    running = false; clearInterval(timer); timer = null;
    try { dlAbort && dlAbort.abort(); ulAbort && ulAbort.abort(); } catch (e) {}
    emit('state', { running: false });
  }

  return {
    start, stop, restart, on, history, pushHistory, setConfig, resetStats, getStats,
    get cfg() { return Object.assign({}, cfg); },
    get state() { return { running, curDown, curUp, lastPing, lastJitter, lastLoss, signal: sigSamples[sigSamples.length - 1] || 0, whois }; },
    fmtMbps,
  };
})();

/* ═════ UI вкладки «Интернет» ═════ */
(function mountNetPanel() {
  const panel = document.getElementById('panel-netmon');
  if (!panel) return;

  const el = id => panel.querySelector('#' + id);
  const sigTrace = [];

  function gaugeDraw(value) {
    const cv = el('nmGauge'); if (!cv || !window.CHARTS) return;
    CHARTS.gauge(cv, value, 'СИГНАЛ');
  }

  function drawSpark() {
    const cv = el('nmSignalSpark'); if (!cv || !window.CHARTS) return;
    const hist = sigTrace.slice(-60);
    if (hist.length < 2) return;
    CHARTS.line(cv, hist, { color: '#3ee0a4', area: true });
  }

  function renderHosts() {
    const box = el('nmHosts'); if (!box) return;
    box.innerHTML = NETMON.state.lastPing.map(h => `
      <div class="nm-host ${h.ok ? 'ok' : 'bad'}">
        <span>${h.name}</span><b>${h.ok ? h.ms + ' мс' : 'потеря'}</b>
      </div>`).join('');
  }

  function renderHist() {
    const tb = el('nmHistBody'); if (!tb) return;
    const rows = NETMON.history().slice(0, 12);
    tb.innerHTML = rows.map(h => `<tr>
      <td>${new Date(h.t).toLocaleTimeString()}</td>
      <td>${h.ping ?? '—'} мс</td><td>${h.jitter} мс</td>
      <td>${NETMON.fmtMbps(h.down)}</td><td>${NETMON.fmtMbps(h.up)}</td>
      <td>${h.signal}%</td></tr>`).join('') || '<tr><td colspan="6" style="opacity:.5">нет данных</td></tr>';
  }

  NETMON.on((evt, d) => {
    switch (evt) {
      case 'ping':
        el('nmPing').textContent = (d.hosts.find(h => h.ok) || { ms: '—' }).ms + ' мс';
        el('nmJitter').textContent = d.jitter + ' мс';
        el('nmLoss').textContent = d.loss + '%';
        gaugeDraw(d.signal);
        el('nmSigVal').textContent = d.signal + '%';
        sigTrace.push(d.signal); if (sigTrace.length > 60) sigTrace.shift(); renderHosts(); drawSpark();
        break;
      case 'download-live': el('nmDownLive').textContent = '↓ ' + NETMON.fmtMbps(d.bps); break;
      case 'download':
        el('nmDown').textContent = NETMON.fmtMbps(d.bps);
        el('nmDownTotal').textContent = (d.bytes / 1048576).toFixed(1) + ' МБ';
        break;
      case 'upload-live': el('nmUpLive').textContent = '↑ ' + NETMON.fmtMbps(d.bps); break;
      case 'upload':
        el('nmUp').textContent = NETMON.fmtMbps(d.bps);
        el('nmUpTotal').textContent = (d.bytes / 1048576).toFixed(2) + ' МБ';
        renderHist();
        break;
      case 'whois':
        el('nmIp').textContent = d ? `${d.ip} · ${d.org || ''}` : 'н/д';
        el('nmGeo').textContent = d ? `${d.city}, ${d.country}` : '';
        break;
      case 'status':
        el('nmOnline').textContent = d.online ? '● В сети' : '● Нет сети';
        el('nmOnline').style.color = d.online ? '#3ee0a4' : '#ff5470';
        break;
    }
  });

  const btn = panel.querySelector('#nmToggle');
  btn.addEventListener('click', () => {
    if (NETMON.state.running) { NETMON.stop(); btn.textContent = '▶ Запустить мониторинг'; }
    else { NETMON.start(2500); btn.textContent = '⏸ Остановить'; }
  });

  // автозапуск при активации вкладки
  const ro = new MutationObserver(() => {
    if (panel.classList.contains('active') && !NETMON.state.running) btn.click();
  });
  ro.observe(panel, { attributes: true, attributeFilter: ['class'] });
  renderHist();
})();
