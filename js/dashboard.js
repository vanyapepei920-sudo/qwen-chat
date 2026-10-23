/* ═══════════ dashboard.js — UI wiring, tabs, KPI, tables, interactions ═══════════ */
"use strict";

const DASH = (() => {
  const PAGE = 15;
  const ui = {
    tab: "overview",
    metric: "throughput",
    window: 300,
    shopFilter: null,     // null = aggregate
    eventsPage: 0,
    evSearch: "", evLevel: "all", evSort: "time-desc",
    dense: store.get("ui.dense", false),
    sound: store.get("ui.sound", true),
    grid: store.get("ui.grid", true),
    speed: store.get("ui.speed", 1),
    depth: store.get("ui.depth", 600),
    calcMode: "oee",
    lastEventsRev: 0,
  };

  /* ─────────── hooks called by SIM ─────────── */
  function onEvent(ev) {
    if ((ev.level === "error" || ev.level === "crit") && ui.sound) {
      beep(ev.level === "crit" ? 1180 : 740, 0.14, 0.05);
    }
    if (ui.tab === "events") renderEvents();
    updateBadge();
  }
  function onAlert(a) { toast(`⚠ ${a.text}`, a.level === "crit" ? "err" : "warn"); renderAlerts(); renderShops(); }
  function onAlertClear() { renderAlerts(); renderShops(); }
  let tickRenderCounter = 0;
  function onTick() {
    tickRenderCounter++;
    if (tickRenderCounter % 2 === 0) return; // throttle heavy renders to ~every other tick
    if (ui.tab === "overview") { renderKpis(); renderLineChart(); renderGauge(); renderDonut(); renderShopBars(); }
    if (ui.tab === "analytics") { renderOee(); renderCalc(); }
  }

  /* ─────────── init ─────────── */
  function init() {
    SIM.setSpeed(ui.speed); SIM.setDepth(ui.depth);
    bindTabs(); bindTopbar(); bindSidebar(); bindOverview(); bindAnalytics(); bindEvents(); bindSettings();
    renderShops(); renderAlerts(); renderKpis(); renderLineChart(); renderGauge(); renderDonut();
    renderShopBars(); renderOee(); renderRiskMatrix(); renderCalc(); renderEvents(); renderThresholdForm();
    applyUiFlags();
    setInterval(tickClock, 1000); tickClock();
    window.addEventListener("resize", debounce(() => {
      renderLineChart(); renderGauge(); renderDonut(); renderOee(); renderCalc();
    }, 250));
    SIM.start();
    toast("Добро пожаловать в Синтеко Лаб — стенд телеметрии активен", "ok");
  }

  /* ─────────── clock & uptime ─────────── */
  function tickClock() {
    $("#clock").textContent = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    $("#uptimeVal").textContent = fmt.hms(SIM.uptimeSec());
    const sla = SIM.sla();
    $("#slaVal").textContent = fmt.pct(sla, 2);
    $("#slaBar").style.width = clamp((sla - 90) / 10 * 100, 0, 100) + "%";
    $("#latencyVal").textContent = Math.round(SIM.latencyAvg()) + " мс";
    renderSignal();
    updateBadge();
  }
  function renderSignal() {
    const host = $("#signalMeter");
    const s = SIM.state.signal;
    if (host.children.length !== 8) {
      host.innerHTML = Array.from({ length: 8 }, () => '<div class="signal-bar"></div>').join("");
    }
    [...host.children].forEach((bar, i) => {
      const on = (i + 1) / 8 <= s + 0.06;
      bar.style.height = (25 + i * 9) + "%";
      bar.style.background = on ? (i > 5 ? "var(--ok)" : i > 3 ? "var(--accent)" : "var(--warn)") : "var(--line)";
    });
  }
  function updateBadge() {
    const unacked = SIM.state.alerts.filter(a => !a.acked).length;
    const b = $("#badgeEvents");
    b.hidden = unacked === 0;
    b.textContent = unacked;
  }

  /* ─────────── tabs ─────────── */
  function bindTabs() {
    $("#tabs").addEventListener("click", e => {
      const t = e.target.closest(".tab"); if (!t) return;
      ui.tab = t.dataset.tab;
      $$(".tab").forEach(x => x.classList.toggle("active", x === t));
      $$(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + ui.tab));
      if (ui.tab === "overview") onTickForce();
      if (ui.tab === "analytics") { renderOee(); renderCalc(); }
      if (ui.tab === "events") renderEvents();
    });
  }
  function onTickForce() {
    renderKpis(); renderLineChart(); renderGauge(); renderDonut(); renderShopBars();
  }

  /* ─────────── topbar ─────────── */
  function bindTopbar() {
    $("#btnLive").addEventListener("click", () => {
      const running = SIM.togglePause();
      $("#btnLive").classList.toggle("paused", !running);
      $("#liveLabel").textContent = running ? "LIVE" : "PAUSE";
      toast(running ? "Поток данных возобновлён" : "Поток данных приостановлен", running ? "ok" : "warn");
    });
    $("#btnReport").addEventListener("click", async () => {
      const snap = SIM.snapshot();
      const ok = await modal(
        "Отчёт по сессии мониторинга",
        `<p>Снимок текущих показателей. «Скачать» сохранит JSON-файл.</p><pre>${JSON.stringify(snap, null, 2)}</pre>`,
        "Скачать JSON ↓"
      );
      if (ok) {
        download(`sintheco-report-${Date.now()}.json`, JSON.stringify(snap, null, 2), "application/json");
        toast("Отчёт выгружен", "ok");
      }
    });
  }

  /* ─────────── sidebar ─────────── */
  function bindSidebar() {
    $(".quick-actions").addEventListener("click", async e => {
      const btn = e.target.closest("[data-cmd]"); if (!btn) return;
      const cmd = btn.dataset.cmd;
      if (cmd === "calibrate") { SIM.calibrate(); toast("Калибровка датчиков выполнена", "ok"); }
      if (cmd === "snapshot") {
        const snap = SIM.snapshot();
        modal("Снимок телеметрии", `<pre>${JSON.stringify(snap, null, 2)}</pre>`, "Копировать");
        try { await navigator.clipboard.writeText(JSON.stringify(snap, null, 2)); toast("Снимок скопирован в буфер", "ok"); } catch { /* noop */ }
      }
      if (cmd === "reset-counters") {
        if (await modal("Сброс счётчиков", "<p>Обнулить выработку, брак, энергию и аптайм сессии? История графиков сохранится.</p>", "Сбросить")) {
          SIM.resetCounters(); toast("Счётчики обнулены", "warn");
        }
      }
      if (cmd === "emergency") {
        if (await modal("Аварийный останов", "<p style='color:var(--err)'>Все линии будут немедленно остановлены. Это симуляция — данные не пострадают.</p>", "E-STOP ⛔")) {
          SIM.emergencyStop(); toast("E-STOP активирован: все линии остановлены", "err", 6000);
          setTimeout(async () => {
            if (await modal("Возврат в работу", "<p>Вернуть все цеха в автоматический режим?</p>", "Запустить всё")) {
              SIM.resumeAll(); toast("Линии снова в авторежиме", "ok");
            }
          }, 6000);
        }
      }
    });
  }

  function renderShops() {
    const list = $("#shopList");
    list.innerHTML = SIM.state.shops.map(sh => `
      <li class="shop-item ${ui.shopFilter === sh.id ? "selected" : ""}" data-shop="${sh.id}" title="Клик — фильтр графика, двойной клик — стоп/пуск">
        <span class="status-dot ${sh.status}"></span>
        <span>${sh.name}</span>
        <span class="load">${Math.round(sh.cur.throughput / sh.capacity * 100)}%</span>
      </li>`).join("");
    list.onclick = e => {
      const li = e.target.closest(".shop-item"); if (!li) return;
      ui.shopFilter = ui.shopFilter === li.dataset.shop ? null : li.dataset.shop;
      renderShops(); renderLineChart(); renderKpis();
    };
    list.ondblclick = e => {
      const li = e.target.closest(".shop-item"); if (!li) return;
      SIM.toggleShop(li.dataset.shop); renderShops(); renderShopBars();
    };
  }

  function renderShopBars() {
    const host = $("#shopBars");
    host.innerHTML = SIM.state.shops.map(sh => {
      const loadPct = clamp(sh.cur.throughput / sh.capacity * 100, 0, 100);
      const col = loadPct > 92 ? "var(--err)" : loadPct > 78 ? "var(--warn)" : "var(--ok)";
      return `<div class="mini-bar-row">
        <div class="t"><span>${sh.name} <small style="color:var(--muted)">· ${sh.status.toUpperCase()}</small></span><b>${fmt.num(sh.cur.throughput)} ед/мин</b></div>
        <div class="track"><div class="fill" style="width:${loadPct}%;background:${col}"></div></div>
      </div>`;
    }).join("");
  }

  /* ─────────── KPI cards ─────────── */
  const KPI_DEFS = [
    { key: "produced", label: "Выработка", unit: "ед.", get: () => SIM.state.totalProduced, hist: () => SIM.aggregate("throughput"), good: v => v },
    { key: "oee", label: "OEE (последняя смена)", unit: "%", get: () => SIM.state.oeeShifts.at(-1), hist: () => SIM.state.oeeShifts, good: v => v >= 85 ? "good" : v >= 75 ? "warn" : "bad" },
    { key: "defect", label: "Уровень брака", unit: "%", get: () => SIM.defectRate() * 100, hist: () => SIM.avgMetric("vibration"), invert: true, good: v => v <= 1 ? "good" : v <= 2.5 ? "warn" : "bad" },
    { key: "power", label: "Мощность сейчас", unit: "кВт", get: () => SIM.state.shops.reduce((a, s) => a + s.cur.power, 0), hist: () => SIM.aggregate("power") },
    { key: "energy", label: "Энергия за сессию", unit: "кВт·ч", get: () => SIM.state.energyKwh, hist: () => SIM.aggregate("power") },
    { key: "alerts", label: "Активные алерты", unit: "", get: () => SIM.state.alerts.length, hist: () => [], good: v => v === 0 ? "good" : v <= 2 ? "warn" : "bad" },
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
      dEl.textContent = `${delta >= 0 ? "▲" : "▼"} ${fmt.num(Math.abs(delta), Math.abs(cur) > 500 ? 0 : 2)} за 30с`;
      card.querySelector(".v").textContent = cur > 1000 ? fmt.int(cur) : fmt.num(cur, 2);
      card.className = "kpi " + (k.good ? (typeof k.good(cur) === "string" ? k.good(cur) : "") : "");
      if (h.length > 1) CHARTS.spark(card.querySelector(".spark"), h.slice(-60), dir === "down" ? CHARTS.COL.warn : CHARTS.COL.accent);
    }
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

  /* ─────────── line chart ─────────── */
  const METRIC_META = {
    throughput: { color: CHARTS.COL.accent, th: () => null, secPerTick: 1 },
    temperature: { color: CHARTS.COL.warn, th: () => SIM.thresholds().temperatureHigh, secPerTick: 1 },
    vibration: { color: CHARTS.COL.crit, th: () => SIM.thresholds().vibrationHigh, secPerTick: 1 },
    power: { color: CHARTS.COL.ok, th: () => SIM.thresholds().powerHigh, secPerTick: 1 },
  };

  function currentSeries() {
    const m = ui.metric;
    const src = ui.shopFilter ? SIM.metricsOf(ui.shopFilter, m) : (m === "throughput" || m === "power" ? SIM.aggregate(m) : SIM.avgMetric(m));
    return src.slice(-ui.window);
  }

  function renderLineChart() {
    const canvas = $("#lineChart");
    const data = currentSeries();
    const meta = METRIC_META[ui.metric];
    CHARTS.line(canvas, data, {
      color: meta.color, threshold: meta.th(), grid: ui.grid, secPerTick: meta.secPerTick,
    });
    const st = stats(data);
    $("#statMin").textContent = fmt.num(st.min, 1);
    $("#statAvg").textContent = fmt.num(st.avg, 1);
    $("#statMax").textContent = fmt.num(st.max, 1);
    $("#statStd").textContent = fmt.num(st.std, 2);
    $("#statTrend").textContent = (st.trend >= 0 ? "+" : "") + fmt.num(st.trend, 2);
    $("#statTrend").style.color = st.trend > 0.5 ? CHARTS.COL.ok : st.trend < -0.5 ? CHARTS.COL.err : "";
  }

  function bindOverview() {
    $("#metricSel").onchange = e => { ui.metric = e.target.value; renderLineChart(); };
    document.querySelectorAll("#panel-overview .chart-tools .chip").forEach(ch => {
      ch.onclick = () => {
        document.querySelectorAll("#panel-overview .chart-tools .chip").forEach(c => c.classList.remove("active"));
        ch.classList.add("active");
        ui.window = +ch.dataset.window;
        renderLineChart();
      };
    });
    // hover crosshair tooltip
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
      tip.textContent = `${fmt.num(pt.value, 2)} · −${ago}с`;
    };
    canvas.onmouseleave = () => tip.hidden = true;

    $("#btnAckAll").onclick = () => { SIM.ackAll(); updateBadge(); renderAlerts(); toast("Все алерты приняты", "ok"); };
    renderAlerts();
  }

  /* ─────────── gauge & donut ─────────── */
  function renderGauge() {
    const load = SIM.avgLoad() * 100;
    CHARTS.gauge($("#gauge"), load, "средняя загрузка мощностей");
    const host = $("#gaugeLegend");
    host.innerHTML = SIM.state.shops.map(sh => {
      const p = clamp(sh.cur.throughput / sh.capacity * 100, 0, 100);
      const col = p > 92 ? CHARTS.COL.err : p > 78 ? CHARTS.COL.warn : CHARTS.COL.ok;
      return `<div class="li"><span class="sw" style="background:${col}"></span>${sh.name}<span class="val">${fmt.num(p, 0)}%</span></div>`;
    }).join("");
  }

  const DONUT_COLORS = ["#35c4ff", "#38e896", "#ffb020", "#ff5470", "#d63bff", "#7ddba0"];
  function renderDonut() {
    const labels = SIM.DEFECT_TYPES;
    const values = labels.map(t => SIM.state.shops.reduce((a, s) => a + s.defectByType[t], 0));
    const total = values.reduce((a, b) => a + b, 0);
    const safe = total > 0 ? values : labels.map(() => 1);
    CHARTS.donut($("#donut"), safe, labels, DONUT_COLORS);
  }

  /* ─────────── alerts panel ─────────── */
  function renderAlerts() {
    const host = $("#alertList");
    const list = SIM.state.alerts;
    if (!list.length) { host.innerHTML = '<li class="alert-empty">Активных алертов нет ✅</li>'; return; }
    host.innerHTML = list.map(a => `
      <li class="alert-item ${a.level}" data-key="${a.key}">
        <span class="a-time">${fmt.time(a.ts)}</span>
        <span class="a-msg"><b>${a.shopId}${a.acked ? " · ACK" : ""}</b>${a.text}</span>
        ${a.acked ? "" : '<button class="btn btn-small" data-ack>ACK</button>'}
      </li>`).join("");
    host.onclick = e => {
      const li = e.target.closest(".alert-item");
      if (li && e.target.hasAttribute("data-ack")) { SIM.ackAlert(li.dataset.key); renderAlerts(); updateBadge(); }
    };
  }

  /* ─────────── analytics: OEE bars ─────────── */
  function renderOee() {
    CHARTS.bars($("#oeeChart"), SIM.state.oeeShifts, { target: 85, color: CHARTS.COL.accent });
  }

  /* ─────────── analytics: risk matrix ─────────── */
  function renderRiskMatrix() {
    const host = $("#riskMatrix");
    const incidents = SIM.state.events.filter(e => e.level === "crit" || e.level === "error").length;
    const heat = clamp(incidents / 6, 0, 1);
    const cells = [];
    for (let r = 0; r < 5; r++) {         // severity rows (top = max)
      for (let c = 0; c < 5; c++) {       // probability cols
        const score = (5 - r) * (c + 1);
        const col = score >= 16 ? "#ff5470" : score >= 10 ? "#ffb020" : score >= 5 ? "#35c4ff" : "#38e896";
        const active = (5 - r) * (c + 1) >= 15 && heat > 0.5;
        cells.push(`<div class="risk-cell" style="background:${col};opacity:${active ? 1 : .45 + (score / 50)}"
          data-tip="${sevName(5 - r)} × ${probName(c + 1)} — приоритет ${priority(score)}">${score}</div>`);
      }
    }
    host.innerHTML = cells.join("") ;
    host.insertAdjacentHTML("afterend", "");
    const tip = document.createElement("div"); tip.className = "risk-tip"; tip.hidden = true;
    document.body.appendChild(tip);
    host.onmousemove = e => {
      const cell = e.target.closest(".risk-cell");
      if (!cell) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.textContent = cell.dataset.tip;
      tip.style.left = e.clientX + 12 + "px";
      tip.style.top = e.clientY - 8 + "px";
    };
    host.onmouseleave = () => tip.hidden = true;
  }
  const sevName = s => ["Незначительные простои", "Браки партии", "Повреждение оснастки", "Остановка цеха", "Авария и травма"][s - 1];
  const probName = p => ["Редко (<1/мес)", "Иногда", "Регулярно", "Часто", "Ежедневно"][p - 1];
  const priority = sc => sc >= 16 ? "КРИТИЧЕСКИЙ 🔴" : sc >= 10 ? "Высокий 🟠" : sc >= 5 ? "Средний 🔵" : "Низкий 🟢";

  /* ─────────── analytics: economics calculator ─────────── */
  const ECON = { pricePerUnit: 240, energyTariff: 6.8, shiftUnitsBase: 60000 };
  function renderCalc() {
    const oee = SIM.state.oeeShifts.at(-1) / 100;
    const dr = SIM.defectRate();
    const powerNow = SIM.state.shops.reduce((a, s) => a + s.cur.power, 0);
    $("#calcReadouts").innerHTML = `
      <div>OEE: <b>${fmt.pct(oee * 100)}</b></div>
      <div>Брак: <b>${fmt.pct(dr * 100, 2)}</b></div>
      <div>Мощность: <b>${fmt.num(powerNow, 0)} кВт</b></div>
      <div>Цена изделия: <b>${fmt.int(ECON.pricePerUnit)} ₽</b></div>`;

    const pct = +$("#calcSlider").value;
    let eff = 0, label = "";
    if (ui.calcMode === "oee") {
      eff = ECON.shiftUnitsBase * 2 * 250 * ECON.pricePerUnit * (pct / 100) * 0.35;
      label = "Прирост OEE";
    } else if (ui.calcMode === "defect") {
      eff = ECON.shiftUnitsBase * 2 * 250 * ECON.pricePerUnit * dr * Math.min(pct, dr * 100 * 0.8);
      label = "Снижение брака (относительно)";
    } else {
      eff = powerNow * 8760 * 0.55 * ECON.energyTariff * (pct / 100);
      label = "Экономия энергии";
    }
    $("#sliderLabel").textContent = label;
    $("#sliderVal").textContent = pct + "%";
    animateNumber($("#calcNum"), eff, v => fmt.money(v));

    // year-over projection mini chart
    const canvas = $("#calcChart");
    const months = Array.from({ length: 12 }, (_, i) => eff / 12 * (0.75 + 0.5 * (i / 11)) * (0.9 + RNG() * 0.2));
    CHARTS.bars(canvas, months.map(m => m / (eff / 12 || 1) * 100), { color: CHARTS.COL.ok, target: null });
  }

  const _numAnims = new WeakMap();
  function animateNumber(el, target, format) {
    const from = _numAnims.get(el)?.cur ?? 0;
    const t0 = performance.now(), dur = 500;
    cancelAnimationFrame(_numAnims.get(el)?.raf ?? 0);
    const step = (now) => {
      const p = clamp((now - t0) / dur, 0, 1);
      const eased = 1 - (1 - p) ** 3;
      const cur = lerp(from, target, eased);
      el.textContent = format(cur);
      if (p < 1) _numAnims.set(el, { cur, raf: requestAnimationFrame(step) });
      else _numAnims.set(el, { cur: target, raf: 0 });
    };
    _numAnims.set(el, { cur: from, raf: requestAnimationFrame(step) });
  }

  function bindAnalytics() {
    $("#calcSeg").onclick = e => {
      const ch = e.target.closest(".chip"); if (!ch) return;
      $$("#calcSeg .chip").forEach(c => c.classList.remove("active"));
      ch.classList.add("active");
      ui.calcMode = ch.dataset.mode;
      renderCalc();
    };
    $("#calcSlider").oninput = () => renderCalc();
  }

  /* ─────────── events journal ─────────── */
  function filteredEvents() {
    let list = SIM.state.events.slice();
    if (ui.evLevel !== "all") list = list.filter(e => e.level === ui.evLevel);
    if (ui.evSearch) {
        const q = ui.evSearch.toLowerCase();
        list = list.filter(e => (e.message + " " + e.source + " " + e.value).toLowerCase().includes(q));
    }
    const lvlOrder = { crit: 0, error: 1, warn: 2, info: 3 };
    if (ui.evSort === "time-asc") list.sort((a, b) => a.ts - b.ts);
    else if (ui.evSort === "level") list.sort((a, b) => lvlOrder[a.level] - lvlOrder[b.level] || b.ts - a.ts);
    else list.sort((a, b) => b.ts - a.ts);
    return list;
  }

  function renderEvents() {
    const list = filteredEvents();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    ui.eventsPage = clamp(ui.eventsPage, 0, pages - 1);
    const slice = list.slice(ui.eventsPage * PAGE, ui.eventsPage * PAGE + PAGE);
    $("#eventBody").innerHTML = slice.map(e => `
      <tr>
        <td class="mono" style="white-space:nowrap">${fmt.dt(e.ts)}</td>
        <td><span class="lvl ${e.level}">${e.level.toUpperCase()}</span></td>
        <td class="mono">${e.source}</td>
        <td>${e.message}</td>
        <td class="mono" style="white-space:nowrap">${e.value}</td>
      </tr>`).join("") || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Ничего не найдено</td></tr>';
    $("#eventCount").textContent = `${list.length} записей · стр. ${ui.eventsPage + 1}/${pages}`;
    const pager = $("#eventPager");
    const mk = (n, cur) => `<button class="${cur ? "cur" : ""}" data-p="${n - 1}">${n}</button>`;
    let btns = "";
    if (pages <= 7) for (let p = 1; p <= pages; p++) btns += mk(p, p - 1 === ui.eventsPage);
    else {
      const cur = ui.eventsPage + 1;
      btns += mk(1, cur === 1) + (cur > 3 ? "<button disabled>…</button>" : "");
      for (let p = Math.max(2, cur - 1); p <= Math.min(pages - 1, cur + 1); p++) btns += mk(p, p - 1 === ui.eventsPage);
      btns += (cur < pages - 2 ? "<button disabled>…</button>" : "") + mk(pages, cur === pages);
    }
    pager.innerHTML = btns;
    pager.onclick = e => {
      const b = e.target.closest("button[data-p]"); if (!b) return;
      ui.eventsPage = +b.dataset.p; renderEvents();
    };
  }

  function bindEvents() {
    $("#eventSearch").oninput = debounce(e => { ui.evSearch = e.target.value; ui.eventsPage = 0; renderEvents(); }, 180);
    $("#eventLevel").onchange = e => { ui.evLevel = e.target.value; ui.eventsPage = 0; renderEvents(); };
    $("#eventSort").onchange = e => { ui.evSort = e.target.value; ui.eventsPage = 0; renderEvents(); };
    $("#btnExportCsv").onclick = () => {
      const list = filteredEvents();
      const esc = s => `"${String(s).replace(/"/g, '""')}"`;
      const csv = "\uFEFF" + ["time,level,source,message,value",
        ...list.map(e => [new Date(e.ts).toISOString(), e.level, e.source, esc(e.message), esc(e.value)].join(","))].join("\n");
      download(`sintheco-events-${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
      toast(`Экспортировано ${list.length} событий в CSV`, "ok");
    };
  }

  /* ─────────── settings ─────────── */
  const TH_FIELDS = [
    ["temperatureHigh", "Температура, верхний порог (°C)"],
    ["vibrationHigh", "Вибрация, верхний порог (мм/с)"],
    ["powerHigh", "Мощность, верхний порог (кВт)"],
    ["throughputLow", "Производительность, нижний порог (ед/мин)"],
  ];
  function renderThresholdForm() {
    const th = SIM.thresholds();
    $("#thresholdsForm").innerHTML = TH_FIELDS.map(([k, lab]) => `
      <label class="field">${lab}
        <input type="number" step="0.1" name="${k}" value="${th[k]}"/></label>`).join("");
  }
  function bindSettings() {
    $("#btnSaveThresholds").onclick = () => {
      const obj = {};
      $$("#thresholdsForm input").forEach(i => obj[i.name] = +i.value);
      SIM.saveThresholds(obj);
      toast("Пороги сохранены (localStorage)", "ok");
      renderLineChart();
    };
    const setToggle = (id, key, cls) => {
      const el = $(id); el.checked = ui[key];
      el.onchange = () => { ui[key] = el.checked; store.set("ui." + key, el.checked); applyUiFlags(); };
    };
    setToggle("#setDense", "dense"); setToggle("#setSound", "sound"); setToggle("#setGrid", "grid");
    $("#setSpeed").value = ui.speed;
    $("#speedVal").textContent = ui.speed.toFixed(2).replace(/0$/, "") + "×";
    $("#setSpeed").oninput = e => {
      ui.speed = +e.target.value; SIM.setSpeed(ui.speed);
      $("#speedVal").textContent = ui.speed + "×";
      store.set("ui.speed", ui.speed);
    };
    $("#setDepth").value = ui.depth;
    $("#setDepth").oninput = debounce(e => {
      ui.depth = +e.target.value; SIM.setDepth(ui.depth); store.set("ui.depth", ui.depth);
    }, 300);
    $("#btnResetAll").onclick = async () => {
      if (await modal("Сброс настроек", "<p>Будут удалены пороги алертов и все настройки интерфейса из localStorage. Перезагрузить страницу?</p>", "Сбросить и перезагрузить")) {
        store.clearAll(); location.reload();
      }
    };
  }
  function applyUiFlags() {
    document.body.classList.toggle("dense", ui.dense);
    renderLineChart();
  }

  return { init, onEvent, onAlert, onAlertClear, onTick };
})();

document.addEventListener("DOMContentLoaded", DASH.init);
