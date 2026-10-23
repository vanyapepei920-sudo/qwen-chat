/* ═══════════ dashboard.js — UI сетевой консоли (без симуляторов) ═══════════
   Все данные берутся из NET (netmonitor.js) — реальные замеры браузера. */
"use strict";

const DASH = (() => {
  const ui = {
    tab: "netlive",
    metric: "download",
    window: 300,
    dense: store.get("ui.dense", false),
    sound: store.get("ui.sound", true),
    grid: store.get("ui.grid", true),
    pingRounds: 0,
  };
  const alerts = []; // события соединения (offline/loss/degraded) — реальные

  function pushAlert(level, text) {
    alerts.unshift({ ts: Date.now(), level, text });
    if (alerts.length > 60) alerts.pop();
    renderAlerts();
    if ((level === "error" || level === "crit") && ui.sound) beep(level === "crit" ? 1180 : 740, 0.14, 0.05);
  }

  /* ─────────── init ─────────── */
  function init() {
    bindTabs(); bindTopbar(); bindSidebar(); bindLive();
    renderKpis(); renderLineChart(); renderGauge(); renderPingList(); renderHostBars(); renderAlerts();
    applyUiFlags();
    setInterval(tickClock, 1000); tickClock();

    NET.on((kind) => {
      if (kind === "ping") {
        ui.pingRounds++;
        renderSignal(); renderPingList(); renderHostBars();
        const last = NET.state.latencies.at(-1) || 0;
        if (last > 400) pushAlert("warn", `Высокий ping: ${Math.round(last)} мс`);
        const lossPct = lossPctNow();
        if (lossPct > 20) pushAlert("error", `Потери пакетов ${lossPct.toFixed(0)}% — связь нестабильна`);
      }
      if (kind === "conn") {
        renderConn();
        if (!NET.state.online) pushAlert("crit", "Соединение с интернетом ПОТЕРЯНО");
        else pushAlert("info", "Соединение восстановлено");
      }
      if (kind === "info") renderNetInfo();
      if (kind === "hist" || kind === "ping") {
        if (ui.tab === "netlive") { renderKpis(); renderLineChart(); renderGauge(); }
        updateSideSpeeds();
      }
      if (kind === "fulltest") renderStResults(NET.state.lastFull);
    });

    NET.start();
    toast("Сетевая консоль активна — начаты реальные замеры интернета", "ok");
  }

  function lossPctNow() {
    return NET.state.probes ? (NET.state.lossEvents / NET.state.probes) * 100 : 0;
  }
  function jitterNow() {
    const arr = NET.state.pings.slice(-12).map((p) => p.ms);
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + Math.abs(b - m), 0) / arr.length;
  }

  /* ─────────── clock & uptime ─────────── */
  function tickClock() {
    $("#clock").textContent = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    $("#uptimeVal").textContent = fmt.hms(NET.uptimeSec());
    const lat = NET.state.latencies.at(-1);
    $("#latencyVal").textContent = lat != null ? Math.round(lat) + " мс" : "— мс";
    $("#jitterSide").textContent = Math.round(jitterNow()) + " мс";
    $("#lossSide").textContent = lossPctNow().toFixed(1) + " %";
    $("#probeCount").textContent = NET.state.probes;
    $("#pingRounds").textContent = ui.pingRounds;
    renderSignal();
    updateSideSpeeds();
  }
  function updateSideSpeeds() {
    const dl = NET.state.dlBps / 1e6, ul = NET.state.ulBps / 1e6;
    $("#sideDl").textContent = dl.toFixed(1);
    $("#sideUl").textContent = ul.toFixed(1);
    $("#dlBar").style.width = clamp(dl / 5, 0, 100) + "%";
    const d1 = $("#stDlLive"), u1 = $("#stUlLive"), p1 = $("#stPingLast");
    if (d1) d1.textContent = NET.fmtSpeed(NET.state.dlBps);
    if (u1) u1.textContent = NET.fmtSpeed(NET.state.ulBps);
    if (p1) p1.textContent = (NET.state.latencies.at(-1) != null ? Math.round(NET.state.latencies.at(-1)) + " мс" : "—");
  }
  function renderSignal() {
    const host = $("#signalMeter");
    const s = NET.state.signal;
    if (host.children.length !== 8) {
      host.innerHTML = Array.from({ length: 8 }, () => '<div class="signal-bar"></div>').join("");
    }
    [...host.children].forEach((bar, i) => {
      const on = NET.state.online && (i + 1) / 8 <= s + 0.06;
      bar.style.height = (25 + i * 9) + "%";
      bar.style.background = on ? (i > 5 ? "var(--ok)" : i > 3 ? "var(--accent)" : "var(--warn)") : "var(--line)";
    });
  }
  function renderConn() {
    const pill = $("#connPill"), dot = $("#connDot"), txt = $("#connText");
    const online = NET.state.online;
    pill.classList.toggle("off", !online);
    dot.style.background = online ? "var(--ok)" : "var(--err)";
    txt.textContent = online ? "ONLINE" : "OFFLINE";
  }
  function renderNetInfo() {
    $("#ispInfo").textContent = NET.state.ispInfo || "определяется…";
    const n = NET.readNetInfo();
    $("#netApiInfo").textContent = n
      ? `Network Info API: тип ${n.effectiveType} · downlink ${n.downlink} Мбит/с · RTT ${n.rtt} мс${n.saveData ? " · экономия трафика" : ""}`
      : "Network Info API: недоступен в этом браузере";
    const stIsp = $("#stIsp"); if (stIsp) stIsp.textContent = NET.state.ispInfo;
  }

  /* ─────────── tabs ─────────── */
  function bindTabs() {
    $("#tabs").addEventListener("click", e => {
      const t = e.target.closest(".tab"); if (!t) return;
      ui.tab = t.dataset.tab;
      $$(".tab").forEach(x => x.classList.toggle("active", x === t));
      $$(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + ui.tab));
      if (ui.tab === "netlive") onTickForce();
    });
  }
  function onTickForce() { renderKpis(); renderLineChart(); renderGauge(); }

  /* ─────────── topbar ─────────── */
  function bindTopbar() {
    $("#btnLive").addEventListener("click", () => {
      const running = NET.togglePause();
      $("#btnLive").classList.toggle("paused", !running);
      $("#liveLabel").textContent = running ? "LIVE" : "PAUSE";
      toast(running ? "Замеры сети возобновлены" : "Замеры приостановлены (фоновый трафик остановлен)", running ? "ok" : "warn");
    });
    $("#btnReport").addEventListener("click", async () => {
      const snap = NET.snapshot();
      const ok = await modal(
        "Отчёт по сетевой сессии",
        `<p>Снимок реальных показателей. «Скачать» сохранит JSON-файл.</p><pre>${JSON.stringify(snap, null, 2)}</pre>`,
        "Скачать JSON ↓"
      );
      if (ok) { download(`net-report-${Date.now()}.json`, JSON.stringify(snap, null, 2), "application/json"); toast("Отчёт выгружен", "ok"); }
    });
  }

  /* ─────────── sidebar actions ─────────── */
  function bindSidebar() {
    $(".quick-actions").addEventListener("click", async e => {
      const btn = e.target.closest("[data-cmd]"); if (!btn) return;
      const cmd = btn.dataset.cmd;
      if (cmd === "snapshot") {
        const snap = NET.snapshot();
        modal("Снимок сети", `<pre>${JSON.stringify(snap, null, 2)}</pre>`, "Копировать");
        try { await navigator.clipboard.writeText(JSON.stringify(snap, null, 2)); toast("Снимок скопирован в буфер", "ok"); } catch { /* noop */ }
      }
      if (cmd === "clear-history") {
        if (await modal("Очистить историю", "<p>Удалить все сохранённые результаты speedtest?</p>", "Очистить")) {
          localStorage.removeItem("st_history");
          const box = $("#stHistory"); if (box) box.innerHTML = '<p class="hint">История очищена.</p>';
          toast("История тестов очищена", "ok");
        }
      }
    });
  }

  /* ─────────── KPI cards (реальные метрики) ─────────── */
  const KPI_DEFS = [
    { key: "dl", label: "Download сейчас", unit: "Мбит/с", get: () => NET.state.dlBps / 1e6, hist: () => NET.state.dlHist.map(v => v / 1e6), good: v => v > 20 ? "good" : v > 5 ? "warn" : "bad" },
    { key: "ul", label: "Upload сейчас", unit: "Мбит/с", get: () => NET.state.ulBps / 1e6, hist: () => NET.state.ulHist.map(v => v / 1e6), good: v => v > 10 ? "good" : v > 2 ? "warn" : "bad" },
    { key: "ping", label: "Ping (среднее)", unit: "мс", get: () => NET.state.latencies.at(-1) ?? 0, hist: () => NET.state.latencies, invert: true, good: v => v < 60 ? "good" : v < 150 ? "warn" : "bad" },
    { key: "jit", label: "Джиттер", unit: "мс", get: () => jitterNow(), hist: () => [], invert: true, good: v => v < 20 ? "good" : v < 60 ? "warn" : "bad" },
    { key: "loss", label: "Потери пакетов", unit: "%", get: () => lossPctNow(), hist: () => [], invert: true, good: v => v < 1 ? "good" : v < 5 ? "warn" : "bad" },
    { key: "sig", label: "Качество сигнала", unit: "%", get: () => NET.state.signal * 100, hist: () => NET.state.latencies.map(l => clamp(100 - (l - 30) / 3.7, 5, 100)), good: v => v > 75 ? "good" : v > 45 ? "warn" : "bad" },
  ];

  function renderKpis() {
    const row = $("#kpiRow");
    if (row.children.length !== KPI_DEFS.length) {
      row.innerHTML = KPI_DEFS.map(k => `
        <div class="kpi" id="kpi-${k.key}">
          <div class="k-label">${k.label}</div>
          <div class="k-value mono"><span class="v">—</span><small style="font-size:13px;color:var(--muted)"> ${k.unit}</small></div>
          <div class="k-delta flat">Δ —</div>
          <canvas class="spark"></canvas>
        </div>`).join("");
    }
    for (const k of KPI_DEFS) {
      const card = $("#kpi-" + k.key);
      const cur = k.get();
      const h = k.hist();
      const prev = h.length > 30 ? avg(h.slice(-60, -30)) : cur;
      const delta = cur - prev;
      const dEl = card.querySelector(".k-delta");
      const dir = Math.abs(delta) < 1e-6 ? "flat" : (delta > 0) !== !!k.invert ? "up" : "down";
      dEl.className = "k-delta " + dir;
      dEl.textContent = `${delta >= 0 ? "▲" : "▼"} ${fmt.num(Math.abs(delta), 1)} за 30с`;
      card.querySelector(".v").textContent = fmt.num(cur, cur > 100 ? 0 : 1);
      card.className = "kpi " + (k.good ? (typeof k.good(cur) === "string" ? k.good(cur) : "") : "");
      if (h.length > 1) CHARTS.spark(card.querySelector(".spark"), h.slice(-60), dir === "down" ? CHARTS.COL.warn : CHARTS.COL.accent);
    }
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

  /* ─────────── главный live-график ─────────── */
  const METRIC_META = {
    download: { color: CHARTS.COL.accent, secPerTick: 1 },
    upload: { color: CHARTS.COL.ok, secPerTick: 1 },
    ping: { color: CHARTS.COL.warn, secPerTick: 3 },
  };
  function currentSeries() {
    const m = ui.metric;
    const src = m === "download" ? NET.state.dlHist.map(v => v / 1e6)
      : m === "upload" ? NET.state.ulHist.map(v => v / 1e6)
      : NET.state.latencies;
    return src.slice(-ui.window);
  }
  function renderLineChart() {
    const canvas = $("#lineChart");
    const data = currentSeries();
    const meta = METRIC_META[ui.metric];
    CHARTS.line(canvas, data, { color: meta.color, threshold: null, grid: ui.grid, secPerTick: meta.secPerTick });
    const st = stats(data);
    $("#statMin").textContent = fmt.num(st.min, 1);
    $("#statAvg").textContent = fmt.num(st.avg, 1);
    $("#statMax").textContent = fmt.num(st.max, 1);
    $("#statStd").textContent = fmt.num(st.std, 2);
    $("#statTrend").textContent = (st.trend >= 0 ? "+" : "") + fmt.num(st.trend, 2);
    $("#statTrend").style.color = st.trend > 0.5 ? CHARTS.COL.ok : st.trend < -0.5 ? CHARTS.COL.err : "";
  }

  function bindLive() {
    $("#metricSel").onchange = e => { ui.metric = e.target.value; renderLineChart(); };
    document.querySelectorAll("#panel-netlive .chart-tools .chip").forEach(ch => {
      ch.onclick = () => {
        document.querySelectorAll("#panel-netlive .chart-tools .chip").forEach(c => c.classList.remove("active"));
        ch.classList.add("active");
        ui.window = +ch.dataset.window;
        renderLineChart();
      };
    });
    const tip = document.createElement("div"); tip.className = "risk-tip"; tip.hidden = true;
    document.body.appendChild(tip);
    const canvas = $("#lineChart");
    canvas.onmousemove = e => {
      const r = canvas.getBoundingClientRect();
      const pt = CHARTS.lineHover(canvas, e.clientX - r.left);
      if (!pt) return;
      tip.hidden = false;
      tip.style.left = (e.clientX + 14) + "px";
      tip.style.top = (e.clientY - 10) + "px";
      const ago = (currentSeries().length - 1 - pt.idx);
      const unit = ui.metric === "ping" ? "мс" : "Мбит/с";
      tip.textContent = `${fmt.num(pt.value, 2)} ${unit} · −${ago}с`;
    };
    canvas.onmouseleave = () => tip.hidden = true;
    $("#btnAckAll").onclick = () => { alerts.length = 0; renderAlerts(); toast("Список событий очищен", "ok"); };
  }

  /* ─────────── gauge качества связи ─────────── */
  function renderGauge() {
    const sig = Math.round(NET.state.signal * 100);
    CHARTS.gauge($("#gauge"), sig, "качество связи (по ping)");
    const hosts = {};
    for (const p of NET.state.pings) { if (p.ms >= 0) (hosts[p.host] ||= []).push(p.ms); }
    $("#gaugeLegend").innerHTML = Object.entries(hosts).slice(0, 6).map(([h, arr]) => {
      const m = avg(arr.slice(-6));
      const col = m < 60 ? CHARTS.COL.ok : m < 150 ? CHARTS.COL.warn : CHARTS.COL.err;
      return `<div class="li"><span class="sw" style="background:${col}"></span>${h}<span class="val">${Math.round(m)} мс</span></div>`;
    }).join("") || '<div class="li dim">ожидание замеров…</div>';
  }

  /* ─────────── списки хостов и пингов ─────────── */
  function renderPingList() {
    const host = $("#pingList");
    const list = NET.state.pings.slice(-14).reverse();
    if (!list.length) { host.innerHTML = '<li class="alert-empty">Ещё нет замеров…</li>'; return; }
    host.innerHTML = list.map(p => `
      <li class="alert-item ${p.ms < 0 ? "crit" : p.ms > 200 ? "warn" : "info"}">
        <span class="a-time">${fmt.time(p.ts)}</span>
        <span class="a-msg"><b>${p.host}</b> ${p.ms < 0 ? "timeout ✕" : p.ms + " мс"}</span>
      </li>`).join("");
  }
  function renderHostBars() {
    const host = $("#shopBars");
    const agg = {};
    for (const p of NET.state.pings) {
      const a = (agg[p.host] ||= { ok: 0, fail: 0, sum: 0 });
      if (p.ms >= 0) { a.ok++; a.sum += p.ms; } else a.fail++;
    }
    const maxScale = 400;
    host.innerHTML = Object.entries(agg).map(([h, a]) => {
      const m = a.ok ? a.sum / a.ok : maxScale;
      const pct = clamp((m / maxScale) * 100, 2, 100);
      const col = m < 60 ? "var(--ok)" : m < 150 ? "var(--warn)" : "var(--err)";
      const loss = ((a.fail / (a.ok + a.fail)) * 100).toFixed(0);
      return `<div class="mini-bar-row">
        <div class="t"><span>${h} <small style="color:var(--muted)">· потери ${loss}%</small></span><b>${a.ok ? Math.round(m) + " мс" : "нет ответа"}</b></div>
        <div class="track"><div class="fill" style="width:${pct}%;background:${col}"></div></div>
      </div>`;
    }).join("") || '<p class="hint">ожидание…</p>';
  }
  function renderAlerts() {
    const host = $("#alertList");
    if (!alerts.length) { host.innerHTML = '<li class="alert-empty">Событий нет — связь стабильна ✅</li>'; return; }
    host.innerHTML = alerts.slice(0, 14).map(a => `
      <li class="alert-item ${a.level}">
        <span class="a-time">${fmt.time(a.ts)}</span>
        <span class="a-msg">${a.text}</span>
      </li>`).join("");
  }

  /* ─────────── speedtest results (для панели nettest) ─────────── */
  function renderStResults(r) {
    if (!r) return;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("#stPing", r.ping + " мс");
    set("#stJitter", r.jitter + " мс");
    set("#stLoss", r.loss + " %");
    set("#stDown", fmtMbps(r.down));
    set("#stUp", fmtMbps(r.up));
    const g = r.ping < 30 && r.loss < 1 ? ["A+", "var(--ok)"] : r.ping < 80 && r.loss < 2 ? ["A", "var(--accent)"] : r.ping < 150 ? ["B", "var(--warn)"] : ["C", "var(--err)"];
    set("#stGrade", g[0]); const gel = $("#stGrade"); if (gel) gel.style.color = g[1];
    const pf = $("#stProgFill"); if (pf) pf.style.width = "100%";
  }
  function fmtMbps(bps) {
    if (!isFinite(bps) || bps <= 0) return "— Мбит/с";
    if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " Гбит/с";
    return (bps / 1e6).toFixed(1) + " Мбит/с";
  }

  function applyUiFlags() { document.body.classList.toggle("dense", ui.dense); renderLineChart(); }

  return { init, renderStResults, pushAlert };
})();

document.addEventListener("DOMContentLoaded", DASH.init);
