/* ═══════════ simulation.js — synthetic industrial telemetry engine ═══════════ */
"use strict";

/**
 * Simulates a factory with 4 shops, each producing metrics every tick (~1s).
 * Metrics: throughput (units/min), temperature (°C), vibration (mm/s), power (kW).
 * Includes regime changes, drift, spikes, rare incidents and defect counting.
 */
const SIM = (() => {
  const TICK_MS = 1000;

  const SHOPS = [
    { id: "A", name: "Литьё А-1", base: { throughput: 42, temperature: 615, vibration: 3.1, power: 210 }, capacity: 60 },
    { id: "B", name: "Механообработка Б-2", base: { throughput: 78, temperature: 64, vibration: 2.2, power: 145 }, capacity: 95 },
    { id: "C", name: "Сборка В-3", base: { throughput: 110, temperature: 41, vibration: 1.4, power: 96 }, capacity: 130 },
    { id: "D", name: "Упаковка Г-4", base: { throughput: 140, temperature: 33, vibration: 1.1, power: 70 }, capacity: 160 },
  ];

  const DEFECT_TYPES = ["Пористость", "Отклонение размера", "Царапина", "Расслоение", "Пайка/контакт", "Маркировка"];

  const state = {
    t: 0,                       // tick counter
    running: true,
    speed: 1,
    historyDepth: 600,
    shops: SHOPS.map(s => ({
      ...s,
      status: "ok",             // ok | warn | err | off
      phase: rnd(0, Math.PI * 2),
      incidentTicks: 0,
      load: rnd(0.55, 0.85),
      counters: { produced: 0, defects: 0 },
      defectByType: Object.fromEntries(DEFECT_TYPES.map(d => [d, 0])),
      hist: { throughput: [], temperature: [], vibration: [], power: [] },
      cur: { throughput: s.base.throughput, temperature: s.base.temperature, vibration: s.base.vibration, power: s.base.power },
      emaTemp: null,
    })),
    oeeShifts: Array.from({ length: 12 }, () => clamp(rnd(72, 93), 0, 100)),
    events: [],                 // event log
    alerts: [],                 // active alerts
    channelLatency: [],         // ms samples
    signal: 0.9,
    totalProduced: 0,
    totalDefects: 0,
    energyKwh: 0,
    startedAt: Date.now(),
    downtimeSec: 0,
    thresholds: store.get("thresholds", {
      temperatureHigh: 660, vibrationHigh: 4.6, powerHigh: 250, throughputLow: 25,
    }),
  };

  /* ── event/alert plumbing ── */
  let evSeq = 0;
  function logEvent(level, source, message, value) {
    const ev = { id: ++evSeq, ts: Date.now(), level, source, message, value };
    state.events.push(ev);
    if (state.events.length > 4000) state.events.splice(0, state.events.length - 4000);
    if (window.DASH && DASH.onEvent) DASH.onEvent(ev);
    return ev;
  }

  function raiseAlert(key, level, shopId, text) {
    if (state.alerts.some(a => a.key === key)) return;
    const al = { key, level, shopId, text, ts: Date.now(), acked: false };
    state.alerts.unshift(al);
    if (state.alerts.length > 12) state.alerts.pop();
    logEvent(level === "crit" ? "crit" : level, shopId, text, "—");
    if (window.DASH && DASH.onAlert) DASH.onAlert(al);
  }

  function clearAlert(key) {
    const i = state.alerts.findIndex(a => a.key === key);
    if (i >= 0) {
      const [a] = state.alerts.splice(i, 1);
      logEvent("info", a.shopId, `Алерт снят: ${a.text}`, "—");
      if (window.DASH && DASH.onAlertClear) DASH.onAlertClear(a);
    }
  }

  /* ── per-shop metric evolution ── */
  function stepShop(sh) {
    if (sh.status === "off") {
      // ramp down to zero
      for (const k of Object.keys(sh.cur)) sh.cur[k] = Math.max(0, sh.cur[k] * 0.85);
      pushHist(sh, true);
      return;
    }
    const b = sh.base, t = state.t;
    // slow sinusoidal production regime + noise
    const wave = Math.sin(t / 45 + sh.phase) * 0.10 + Math.sin(t / 11 + sh.phase * 2) * 0.04;
    const loadF = clamp(sh.load + wave * 0.3, 0.15, 1.05);

    let thr = b.throughput * loadF + gauss(0, b.throughput * 0.025);
    let temp = b.temperature + (loadF - 0.7) * b.temperature * 0.10 + gauss(0, b.temperature * 0.006);
    let vib = b.vibration * (0.8 + loadF * 0.5) + Math.abs(gauss(0, 0.12));
    let pow = b.power * (0.35 + loadF * 0.8) + gauss(0, b.power * 0.02);

    // rare incident: spike in temperature & vibration, throughput drops
    if (sh.incidentTicks > 0) {
      sh.incidentTicks--;
      temp += b.temperature * 0.14 + rnd(4, 12);
      vib *= rnd(1.5, 2.2);
      thr *= rnd(0.45, 0.7);
      pow *= rnd(1.05, 1.2);
      if (sh.incidentTicks === 0) {
        sh.status = "ok";
        clearAlert(`incident-${sh.id}`);
        logEvent("info", sh.id, "Режим восстановлен после инцидента", "—");
      }
    } else if (RNG() < 0.0016) {
      sh.incidentTicks = rndInt(12, 30);
      sh.status = "err";
      raiseAlert(`incident-${sh.id}`, "error", sh.id, `Инцидент на линии «${sh.name}»: перегрев/вибрация`);
    }

    // thermal inertia smoothing for temperature
    sh.emaTemp = ema(sh.emaTemp, temp, 0.35);
    sh.cur.throughput = Math.max(0, thr);
    sh.cur.temperature = sh.emaTemp;
    sh.cur.vibration = Math.max(0.1, vib);
    sh.cur.power = Math.max(0, pow);

    // counters
    const units = sh.cur.throughput * (TICK_MS / 60000) * state.speed;
    const defectRate = clamp(0.004 + (sh.cur.vibration - b.vibration) * 0.004 + (sh.cur.temperature > b.temperature * 1.05 ? 0.02 : 0), 0, 0.25);
    sh.counters.produced += units;
    const newDefects = units * defectRate;
    sh.counters.defects += newDefects;
    sh.defectByType[pick(DEFECT_TYPES)] += Math.round(newDefects * 10) / 10;

    state.totalProduced += units;
    state.totalDefects += newDefects;
    state.energyKwh += sh.cur.power * (TICK_MS / 3600000) * state.speed;

    // threshold checks
    const th = state.thresholds;
    if (sh.cur.temperature > th.temperatureHigh && sh.id === "A")
      raiseAlert(`temp-${sh.id}`, "warn", sh.id, `Температура выше порога: ${fmt.num(sh.cur.temperature)} °C`);
    else if (sh.cur.temperature <= th.temperatureHigh - 5) clearAlert(`temp-${sh.id}`);

    if (sh.cur.vibration > th.vibrationHigh)
      raiseAlert(`vib-${sh.id}`, "warn", sh.id, `Вибрация ${fmt.num(sh.cur.vibration, 2)} мм/с превышает норму`);
    else if (sh.cur.vibration <= th.vibrationHigh - 0.4) clearAlert(`vib-${sh.id}`);

    if (sh.cur.power > th.powerHigh)
      raiseAlert(`pow-${sh.id}`, "error", sh.id, `Перегрузка по мощности: ${fmt.num(sh.cur.power)} кВт`);
    else if (sh.cur.power <= th.powerHigh - 15) clearAlert(`pow-${sh.id}`);

    if (sh.cur.throughput < th.throughputLow && sh.status !== "off" && sh.incidentTicks === 0)
      raiseAlert(`thr-${sh.id}`, "warn", sh.id, `Провал производительности: ${fmt.num(sh.cur.throughput)} ед/мин`);
    else if (sh.cur.throughput > th.throughputLow + 8) clearAlert(`thr-${sh.id}`);

    // shop status from alerts presence
    const hasErr = state.alerts.some(a => a.shopId === sh.id && (a.level === "error" || a.level === "crit"));
    const hasWarn = state.alerts.some(a => a.shopId === sh.id);
    sh.status = hasErr ? "err" : hasWarn ? "warn" : "ok";

    pushHist(sh, false);
  }

  function pushHist(sh, zeros) {
    for (const k of Object.keys(sh.cur)) {
      sh.hist[k].push(zeros ? 0 : sh.cur[k]);
      if (sh.hist[k].length > state.historyDepth) sh.hist[k].shift();
    }
  }

  /* ── channel quality simulation ── */
  function stepChannel() {
    const lat = clamp(gauss(38, 14) + (RNG() < 0.02 ? rnd(60, 220) : 0), 4, 900);
    state.channelLatency.push(lat);
    if (state.channelLatency.length > 120) state.channelLatency.shift();
    state.signal = clamp(state.signal + gauss(0, 0.05) - (lat > 200 ? 0.12 : 0.01), 0.15, 1);
    if (lat > 500) logEvent("warn", "CHANNEL", `Деградация канала связи: задержка ${Math.round(lat)} мс`, `${Math.round(lat)} мс`);
  }

  /* ── random informational chatter ── */
  const CHATTER = [
    ["info", "PLC", "Плановая смена рецептуры партии"],
    ["info", "SCADA", "Синхронизация тегов завершена"],
    ["info", "WMS", "Поддон перемещён в зону отгрузки"],
    ["warn", "QA", "Выборочный контроль: 1 образец вне допуска"],
    ["info", "ENERGY", "Пик потребления сглажен накопителем"],
    ["info", "MAINT", "Вибродиагностика подшипников: норма"],
    ["warn", "PLC", "Датчик Холла: пропущен 1 импульс"],
    ["info", "MES", "Задание на смену обновлено оператором"],
  ];
  function stepChatter() {
    if (RNG() < 0.05) {
      const [lvl, src, msg] = pick(CHATTER);
      const sh = pick(state.shops);
      logEvent(lvl, src, `${msg} · цех ${sh.id}`, fmt.num(sh.cur.throughput) + " ед/мин");
    }
    if (RNG() < 0.004) {
      const sh = pick(state.shops);
      logEvent("crit", sh.id, `Аварийная остановка привода «${sh.name}» (тест стенда)`, "STOP");
      raiseAlert(`drive-${sh.id}`, "crit", sh.id, `Аварийная остановка привода «${sh.name}»`);
      setTimeout(() => clearAlert(`drive-${sh.id}`), rnd(8000, 20000));
    }
  }

  /* ── OEE bookkeeping ── */
  function shiftOee() {
    const avail = clamp(1 - state.downtimeSec / (8 * 3600), 0.55, 1);
    const perf = clamp(avgLoad(), 0.4, 1.05);
    const qual = clamp(1 - defectRate(), 0.8, 1);
    return +(avail * perf * qual * 100);
  }
  function avgLoad() {
    const on = state.shops.filter(s => s.status !== "off");
    if (!on.length) return 0;
    return on.reduce((a, s) => a + s.cur.throughput / s.capacity, 0) / on.length;
  }
  function defectRate() {
    return state.totalProduced > 0 ? state.totalDefects / state.totalProduced : 0;
  }

  /* ── main tick ── */
  let acc = 0, lastReal = performance.now();
  function tickLoop(now) {
    const dt = now - lastReal; lastReal = now;
    if (state.running) {
      acc += dt * state.speed;
      while (acc >= TICK_MS) {
        acc -= TICK_MS;
        state.t++;
        state.shops.forEach(stepShop);
        stepChannel();
        stepChatter();
        if (state.shops.some(s => s.status === "err")) state.downtimeSec += TICK_MS / 1000;
        if (state.t % 45 === 0) {
          state.oeeShifts.push(shiftOee());
          if (state.oeeShifts.length > 12) state.oeeShifts.shift();
        }
        if (window.DASH && DASH.onTick) DASH.onTick();
      }
    }
    requestAnimationFrame(tickLoop);
  }

  /* ── public actions ── */
  const api = {
    state, SHOPS, DEFECT_TYPES, start() { requestAnimationFrame(tickLoop); },
    togglePause() { state.running = !state.running; return state.running; },
    setSpeed(v) { state.speed = v; },
    setDepth(d) { state.historyDepth = d; },
    calibrate() {
      state.shops.forEach(sh => {
        sh.emaTemp = sh.base.temperature;
        sh.phase = rnd(0, Math.PI * 2);
      });
      logEvent("info", "MAINT", "Калибровка датчиков выполнена (все цеха)", "Δ≈0");
    },
    resetCounters() {
      state.shops.forEach(sh => {
        sh.counters = { produced: 0, defects: 0 };
        sh.defectByType = Object.fromEntries(DEFECT_TYPES.map(d => [d, 0]));
      });
      state.totalProduced = 0; state.totalDefects = 0; state.energyKwh = 0; state.downtimeSec = 0;
      state.startedAt = Date.now();
      logEvent("info", "MES", "Счётчики смен обнулены оператором", "0");
    },
    toggleShop(id) {
      const sh = state.shops.find(s => s.id === id);
      if (!sh) return;
      sh.status = sh.status === "off" ? "ok" : "off";
      logEvent(sh.status === "off" ? "warn" : "info", id,
        sh.status === "off" ? `Цех «${sh.name}» переведён в режим ожидания` : `Цех «${sh.name}» запущен`, "—");
    },
    emergencyStop() {
      state.shops.forEach(sh => { sh.status = "off"; });
      raiseAlert("emergency", "crit", "ALL", "АВАРИЙНЫЙ СТОП: все линии остановлены");
      logEvent("crit", "SAFETY", "Активирована кнопка аварийного останова (E-STOP)", "ALL STOP");
    },
    resumeAll() {
      state.shops.forEach(sh => { sh.status = "ok"; sh.incidentTicks = 0; });
      clearAlert("emergency");
      logEvent("info", "SAFETY", "Линии возвращены в автоматический режим", "AUTO");
    },
    ackAlert(key) {
      const a = state.alerts.find(x => x.key === key);
      if (a) { a.acked = true; logEvent("info", a.shopId, `Оператор принял алерт: ${a.text}`, "ACK"); }
    },
    ackAll() { state.alerts.forEach(a => a.acked = true); },
    snapshot() {
      return {
        ts: new Date().toISOString(), tick: state.t,
        produced: Math.round(state.totalProduced),
        defects: Math.round(state.totalDefects),
        defectRatePct: +(defectRate() * 100).toFixed(3),
        energyKwh: +state.energyKwh.toFixed(1),
        oeeLastShift: state.oeeShifts[state.oeeShifts.length - 1],
        activeAlerts: state.alerts.length,
        shops: state.shops.map(s => ({ id: s.id, status: s.status, ...Object.fromEntries(Object.entries(s.cur).map(([k, v]) => [k, +v.toFixed(2)])) })),
      };
    },
    thresholds: () => state.thresholds,
    saveThresholds(obj) {
      state.thresholds = { ...state.thresholds, ...obj };
      store.set("thresholds", state.thresholds);
      logEvent("info", "CONFIG", "Пороги алертов обновлены", JSON.stringify(state.thresholds));
    },
    metricsOf(id, metric) {
      const sh = state.shops.find(s => s.id === id);
      return sh ? sh.hist[metric] : [];
    },
    aggregate(metric) {
      // sum across shops per timestamp index (aligned tails)
      const lists = state.shops.map(s => s.hist[metric]);
      const n = Math.min(...lists.map(l => l.length));
      if (!n) return [];
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = lists.reduce((a, l) => a + l[l.length - n + i], 0);
      return out;
    },
    avgMetric(metric) {
      const lists = state.shops.map(s => s.hist[metric]);
      const n = Math.min(...lists.map(l => l.length));
      if (!n) return [];
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = lists.reduce((a, l) => a + l[l.length - n + i], 0) / lists.length;
      return out;
    },
    defectRate, avgLoad, shiftOee,
    latencyAvg() {
      if (!state.channelLatency.length) return 0;
      return state.channelLatency.reduce((a, b) => a + b, 0) / state.channelLatency.length;
    },
    sla() {
      const up = (Date.now() - state.startedAt) / 1000;
      return up > 0 ? clamp(100 * (1 - state.downtimeSec / up), 0, 100) : 100;
    },
    uptimeSec() { return (Date.now() - state.startedAt) / 1000; },
  };

  // warm-up: pre-fill ~90 ticks of history so charts aren't empty at first paint
  for (let i = 0; i < 90; i++) {
    state.t++;
    state.shops.forEach(stepShop);
    stepChannel();
  }
  logEvent("info", "SYSTEM", "Стенд телеметрии инициализирован, канал активен", "OK");

  return api;
})();
