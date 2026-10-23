/* ═══════════ dashboard.js — UI-слой: вкладки, живой интернет-мониторинг, журнал, настройки ═══════════ */
"use strict";

var DASH = (() => {
  const PAGE = 15;
  const bootT = Date.now();
  const ui = {
    tab: "netmon",
    eventsPage: 0,
    evSearch: "", evLevel: "all", evSort: "time-desc",
    dense: store.get("ui.dense", false),
    sound: store.get("ui.sound", true),
    grid: store.get("ui.grid", true),
  };

  const events = [];   // реальные события соединения (без симуляций)

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function logEvent(level, text) {
    events.unshift({ id: events.length + 1, t: Date.now(), level, text });
    if (events.length > 500) events.pop();
    updateBadge();
    if (level === "error" || level === "crit") {
      toast(`⚠ ${text}`, level === "crit" ? "err" : "warn");
      if (ui.sound) beep(level === "crit" ? 1180 : 740, 0.14, 0.05);
    }
    if (ui.tab === "events") renderEvents();
  }

  /* ─────────── init ─────────── */
  function init() {
    bindTabs(); bindTopbar(); bindSidebar(); bindEvents(); bindSettings();
    applyUiFlags();
    setInterval(tickClock, 1000); tickClock();
    wireNetMon();
    NETMON.start(2500);
    toast("Монитор интернета активен — замеры в реальном времени", "ok");
  }

  /* ─────────── clock & live status ─────────── */
  function tickClock() {
    $("#clock").textContent = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    if (!window.NETMON) return;
    const st = NETMON.state;
    const up = $("#uptimeVal"); if (up) up.textContent = fmt.hms(Math.round((Date.now() - bootT) / 1000));
    const okPing = st.lastPing.find(p => p.ok);
    const lat = $("#latencyVal"); if (lat) lat.textContent = okPing ? okPing.ms + " мс" : "— мс";
    const bars = $("#signalBars");
    if (bars) bars.innerHTML = [1, 2, 3, 4, 5].map(i =>
      `<span class="bar ${st.signal >= i * 20 ? "on" : ""}"></span>`).join("");
    const sv = $("#signalVal"); if (sv) sv.textContent = st.signal + "%";
  }

  /* ─────────── NETMON wiring ─────────── */
  function wireNetMon() {
    NETMON.on((evt, d) => {
      if (evt === "status" && !d.online) logEvent("crit", "Соединение с интернетом потеряно (offline)");
      if (evt === "status" && d.online) logEvent("info", "Соединение восстановлено");
      if (evt === "ping" && d.loss >= 34) logEvent("error", `Высокие потери пакетов: ${d.loss}%`);
      if (evt === "ping" && d.jitter > 150) logEvent("warn", `Дрожжание сети ${d.jitter} мс — видеосвязь будет рваться`);
      if (evt === "error") logEvent("warn", "Ошибка замера: " + d);
    });
    $("#btnLive").addEventListener("click", () => {
      if (NETMON.state.running) {
        NETMON.stop();
        $("#btnLive").classList.add("paused"); $("#liveLabel").textContent = "PAUSE";
        logEvent("info", "Мониторинг приостановлен пользователем");
      } else {
        NETMON.start(2500);
        $("#btnLive").classList.remove("paused"); $("#liveLabel").textContent = "LIVE";
        logEvent("info", "Мониторинг запущен");
      }
    });
  }

  /* ─────────── tabs ─────────── */
  function bindTabs() {
    $("#tabs").addEventListener("click", e => {
      const t = e.target.closest(".tab"); if (!t) return;
      ui.tab = t.dataset.tab;
      $$(".tab").forEach(x => x.classList.toggle("active", x === t));
      $$(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + ui.tab));
      if (ui.tab === "events") renderEvents();
    });
  }

  /* ─────────── topbar ─────────── */
  function bindTopbar() {
    $("#btnReport").addEventListener("click", async () => {
      const snap = {
        ts: new Date().toISOString(),
        net: NETMON.state,
        history: NETMON.history().slice(0, 20),
        events: events.slice(0, 50),
      };
      try { await navigator.clipboard.writeText(JSON.stringify(snap, null, 2)); toast("Снимок сети скопирован в буфер обмена", "ok"); }
      catch (e) { toast("Не удалось скопировать: " + e.message, "err"); }
    });
    const st = $("#btnStudio");
    if (st) st.addEventListener("click", () => { location.href = "studio/index.html"; });
  }

  /* ─────────── events journal (реальные события) ─────────── */
  function updateBadge() {
    const b = $("#badgeEvents"); if (!b) return;
    const n = events.filter(e => e.level === "error" || e.level === "crit").length;
    b.hidden = n === 0; b.textContent = n;
  }

  /* ─────────── sidebar live summary ─────────── */
  function bindSidebar() {
    NETMON.on((evt) => { if (evt === "ping" || evt === "download" || evt === "upload") renderSide(); });
    renderSide();
  }
  function renderSide() {
    const st = NETMON.state, okPing = st.lastPing.find(p => p.ok);
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set("#sideDown", st.curDown ? NETMON.fmtMbps(st.curDown) : "—");
    set("#sideUp", st.curUp ? NETMON.fmtMbps(st.curUp) : "—");
    set("#sidePing", okPing ? okPing.ms + " мс" : "—");
    set("#sideLoss", st.lastLoss + "%");
    const sla = $("#slaVal");
    if (sla) { sla.textContent = st.running ? (st.lastLoss >= 34 ? "деградация" : "стабилен") : "пауза"; sla.style.color = st.lastLoss >= 34 ? "#ff5470" : "#3ee0a4"; }
  }

  function bindEvents() {
    $("#qaSnapshot")?.addEventListener("click", () => $("#btnReport").click());
    $("#qaTestNow")?.addEventListener("click", () => { document.querySelector('[data-tab="nettools"]').click(); setTimeout(() => $("#stRun")?.click(), 150); });
    $("#qaStudio")?.addEventListener("click", () => { location.href = "studio/index.html"; });
    $("#evSearch").addEventListener("input", e => { ui.evSearch = e.target.value.toLowerCase(); ui.eventsPage = 0; renderEvents(); });
    $("#evLevel").addEventListener("change", e => { ui.evLevel = e.target.value; ui.eventsPage = 0; renderEvents(); });
    $("#evSort").addEventListener("change", e => { ui.evSort = e.target.value; renderEvents(); });
    $("#evPrev").addEventListener("click", () => { ui.eventsPage = Math.max(0, ui.eventsPage - 1); renderEvents(); });
    $("#evNext").addEventListener("click", () => { ui.eventsPage++; renderEvents(); });
    $("#evExport").addEventListener("click", () => exportCSV());
  }
  function filteredEvents() {
    let list = events.slice();
    if (ui.evSearch) list = list.filter(e => e.text.toLowerCase().includes(ui.evSearch));
    if (ui.evLevel !== "all") list = list.filter(e => e.level === ui.evLevel);
    list.sort(ui.evSort === "time-asc" ? (a, b) => a.t - b.t : (a, b) => b.t - a.t);
    return list;
  }
  function renderEvents() {
    const list = filteredEvents();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    ui.eventsPage = Math.min(ui.eventsPage, pages - 1);
    const slice = list.slice(ui.eventsPage * PAGE, ui.eventsPage * PAGE + PAGE);
    $("#eventTable tbody").innerHTML = slice.map(e => `
      <tr><td class="mono">${new Date(e.t).toLocaleTimeString("ru-RU")}</td>
      <td><span class="lvl lvl-${e.level}">${e.level.toUpperCase()}</span></td>
      <td>${esc(e.text)}</td></tr>`).join("") ||
      `<tr><td colspan="3" style="opacity:.5;text-align:center;padding:24px">Событий нет — сеть стабильна</td></tr>`;
    $("#evFoot").textContent = `${list.length} событий · стр. ${ui.eventsPage + 1}/${pages}`;
  }
  function exportCSV() {
    const csv = ["time,level,text", ...filteredEvents().map(e => `${new Date(e.t).toISOString()},${e.level},"${String(e.text).replace(/"/g, '""')}"`)].join("\n");
    download("network-events.csv", csv, "text/csv;charset=utf-8");
    toast("Журнал событий выгружен в CSV", "ok");
  }

  /* ─────────── settings ─────────── */
  function bindSettings() {
    $("#setSound").checked = ui.sound;
    $("#setDense").checked = ui.dense;
    $("#setGrid").checked = ui.grid;
    $("#setSound").addEventListener("change", e => { ui.sound = e.target.checked; store.set("ui.sound", ui.sound); });
    $("#setDense").addEventListener("change", e => { ui.dense = e.target.checked; store.set("ui.dense", ui.dense); applyUiFlags(); });
    $("#setGrid").addEventListener("change", e => { ui.grid = e.target.checked; store.set("ui.grid", ui.grid); applyUiFlags(); });
    $("#btnWipe").addEventListener("click", () => {
      modal("Очистить историю и журнал?", "<p>Будут удалены локальные замеры сети, speedtest-история и журнал событий.</p>", "Очистить")
        .then(ok => { if (!ok) return;
          localStorage.removeItem("netmon_history_v1"); localStorage.removeItem("st_history_v1");
          events.length = 0; updateBadge(); renderEvents();
          toast("История очищена", "warn");
        });
    });
  }
  function applyUiFlags() {
    document.body.classList.toggle("dense", ui.dense);
    document.body.classList.toggle("nogrid", !ui.grid);
  }

  return { init, logEvent };
})();

document.addEventListener("DOMContentLoaded", () => DASH.init());
