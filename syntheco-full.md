# Синтеко Лаб · WebStudio — ПОЛНЫЙ ПРОЕКТ (все исходники)

**Виртуальный сервер для создания сайтов + IoT-дашборд телеметрии.** 16 файлов, ~3000 строк, ноль зависимостей.

В конце файла — **SHAR-архив**: сохраните его как `syntheco-project.sh`, запустите `bash syntheco-project.sh` — и весь проект развернётся автоматически.

## Структура

```
index.html            — дашборд «Синтеко Лаб» (5 вкладок, кнопка «Опубликовать на GitHub»: только API-ключ)
css/style.css         — общая тёмная тема (dark neon)
js/utils.js           — PRNG mulberry32, статистика, fmt, store, toast/modal, beep, HiDPI canvas
js/simulation.js      — движок телеметрии: 4 цеха × 4 метрики, алерты с гистерезисом, OEE, SLA, E-STOP
js/charts.js          — свои canvas-графики: line/gauge/donut/bars/sparkline
js/dashboard.js       — UI дашборда: KPI, журнал событий, экономика, матрица рисков, настройки
js/publish.js         — публикация сайта на GitHub Pages по одному API-ключу (владелец/репо — авто)
js/nettest.js         — Speedtest (ping/jitter/loss/↓/↑) + GitHub Tools (search/profile/release/issues/tree/star/fork/gist/commit)
studio/index.html     — WebStudio: виртуальный сервер для создания сайтов
studio/css/studio.css — стили студии
studio/js/store.js    — база данных проектов (IndexedDB VFS + localStorage fallback)
studio/js/zip.js      — генератор ZIP (CRC32) без зависимостей
studio/js/publish.js  — Publisher: публикация проекта из БД на GitHub Pages (только ключ)
studio/js/studio.js   — UI студии: проекты, редактор, предпросмотр, вкл/выкл сервера БД
README.md · .gitignore
```

Запуск: открыть `index.html` в браузере, либо `python3 -m http.server`. WebStudio — кнопка 🛠 WebStudio в топбаре.

---

## Файл: .gitignore (4 строк)

`````````text
node_modules/
dist/
.DS_Store
*.log
`````````

## Файл: README.md (56 строк)

````````````markdown
# Синтеко Лаб — Industrial Telemetry Console

Интерактивный одностраничный дашборд промышленного IoT-мониторинга. Полностью клиентское приложение **без единой зависимости**: движок симуляции телеметрии, canvas-графики собственной реализации, журнал событий, алерты, расчёт экономики.

## Возможности

### 📡 Движок симуляции (`js/simulation.js`)
- 4 цеха с 4 метриками каждый (производительность, температура, вибрация, мощность)
- Генеративные процессы: синусоидальные режимы + гауссов шум (Box–Muller), EMA-инерция температуры, случайные инциденты и восстановление
- Симуляция канала связи: задержка, деградация сигнала
- Счётчики выработки/брака по типам, энергия, OEE по сменам, SLA/аптайм
- Пороги алертов, raising/clearing алертов с гистерезисом, журнал до 4000 событий

### 📊 Графики на чистом Canvas (`js/charts.js`)
- Line/area-чарт с сеткой, пороговой линией, маркером последней точки и hover-перекрестием
- Полукольцевой gauge загрузки мощностей, donut брака с легендой, bar-чарт OEE с целью
- Sparkline в KPI-карточках; всё поддерживает HiDPI (devicePixelRatio)

### 🖥 Интерфейс (`js/dashboard.js`)
- 4 вкладки: **Обзор / Аналитика / Журнал событий / Настройки**
- 6 KPI-карточек с дельтой за 30 секунд и спарклайнами
- Фильтр графика по цеху (клик), стоп/пуск цеха (двойной клик)
- Быстрые действия: калибровка, снимок JSON (clipboard), сброс счётчиков, E-STOP с подтверждением в модалке
- Экономика: калькулятор эффекта (рост OEE / снижение брака / экономия энергии) с анимацией числа и проекцией по месяцам
- Матрица рисков 5×5 с тултипами
- Журнал событий: живой поиск, фильтр по уровню, сортировка, пагинация, экспорт CSV (BOM для Excel)
- Звуковые уведомления ERROR/CRIT через WebAudio, тосты, модальные диалоги (Promise-based)
- Настройки сохраняются в localStorage; скорость симуляции 0.25–4×, глубина истории, плотная таблица, сетка графиков
- Полностью адаптивная тёмная тема, sticky-топбар, live/pause потока данных

## Структура

```
index.html          — разметка всех секций
css/style.css       — тема, layout, компоненты (~330 строк)
js/utils.js         — PRNG (mulberry32), статистика, fmt, store, toast/modal, canvas HiDPI
js/simulation.js    — движок телеметрии (IIFE-модуль SIM)
js/charts.js        — примитивы графиков (CHARTS)
js/dashboard.js     — связующий слой UI (DASH)
.github/workflows/  — автодеплой статичных файлов в GitHub Pages
```

## Запуск

Просто откройте `index.html` в браузере — сервер не нужен. Либо:

```bash
python3 -m http.server 8080   # или npx serve
```

## Демо

🔗 https://<username>.github.io/syntheco-lab/

---
*Все данные генерируются локально в браузере и не покидают ваше устройство.*
````````````

## Файл: css/style.css (364 строк)

`````````css
/* ═══════════ SINTHTECO LAB — Industrial Telemetry Console ═══════════ */
:root {
  --bg: #070b12;
  --bg2: #0b1120;
  --panel: #0e1626;
  --panel2: #131f33;
  --line: #1d2c45;
  --text: #dbe7f4;
  --muted: #7d93ad;
  --accent: #35c4ff;
  --ok: #38e896;
  --warn: #ffb020;
  --err: #ff5470;
  --crit: #d63bff;
  --radius: 14px;
  --shadow: 0 10px 30px rgba(0, 0, 0, .45);
  --mono: "JetBrains Mono", ui-monospace, monospace;
  --sans: "Manrope", system-ui, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: radial-gradient(1200px 700px at 80% -10%, #10203a 0%, var(--bg) 55%) fixed;
  color: var(--text);
  font: 400 15px/1.5 var(--sans);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.mono { font-family: var(--mono); }
button { font: inherit; color: inherit; cursor: pointer; background: none; border: none; }
input, select { font: inherit; }
hr { border: 0; border-top: 1px solid var(--line); margin: 16px 0; }

.bg-grid {
  position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: .35;
  background-image: linear-gradient(var(--line) 1px, transparent 1px),
                    linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(900px 500px at 70% 0%, #000 10%, transparent 75%);
  -webkit-mask-image: radial-gradient(900px 500px at 70% 0%, #000 10%, transparent 75%);
}

/* ─────────── TOPBAR ─────────── */
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: 20px;
  padding: 12px 22px;
  background: rgba(8, 13, 22, .82);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 12px; }
.brand-logo { width: 38px; height: 38px; }
.brand b { font-size: 16px; letter-spacing: .12em; display: block; }
.brand small { color: var(--muted); font-size: 11px; letter-spacing: .04em; }

.tabs { display: flex; gap: 4px; margin-left: auto; }
.tab {
  padding: 8px 16px; border-radius: 9px; color: var(--muted);
  font-weight: 600; font-size: 14px; transition: .18s;
  display: flex; align-items: center; gap: 8px;
}
.tab:hover { color: var(--text); background: var(--panel2); }
.tab.active { color: #06121e; background: linear-gradient(120deg, var(--accent), #6ee7ff); }
.badge {
  background: var(--err); color: #fff; font-size: 11px; font-weight: 800;
  border-radius: 99px; padding: 1px 7px; font-family: var(--mono);
}
.tab.active .badge { background: #06121e; color: #9ff1ff; }

.top-actions { display: flex; align-items: center; gap: 12px; }
.clock { font-size: 15px; font-weight: 600; color: var(--muted); letter-spacing: .06em; }

/* ─────────── BUTTONS / CHIPS ─────────── */
.btn {
  border: 1px solid var(--line); border-radius: 10px;
  padding: 8px 15px; font-weight: 700; font-size: 13.5px;
  transition: .18s; background: var(--panel);
}
.btn:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.btn-primary { background: linear-gradient(120deg, var(--accent), #58b6ff); color: #06121e; border-color: transparent; }
.btn-primary:hover { color: #000; filter: brightness(1.1); }
.btn-ghost { background: transparent; }
.btn-danger { border-color: rgba(255, 84, 112, .5); color: var(--err); }
.btn-danger:hover { background: rgba(255, 84, 112, .12); border-color: var(--err); color: #ff8aa0; }
.btn-small { padding: 4px 11px; font-size: 12.5px; }
.btn-live { display: flex; align-items: center; gap: 8px; }
.btn-live.paused { opacity: .55; }
.pulse-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ok); animation: pulse 1.6s infinite; }
.btn-live.paused .pulse-dot { background: var(--warn); animation: none; }
@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(56,232,150,.5);} 50% { box-shadow: 0 0 0 7px rgba(56,232,150,0);} }

.chip {
  border: 1px solid var(--line); border-radius: 8px; padding: 3px 11px;
  font-size: 12.5px; font-weight: 700; color: var(--muted); transition: .15s;
}
.chip:hover { color: var(--text); }
.chip.active { color: var(--accent); border-color: var(--accent); background: rgba(53,196,255,.1); }
.seg { display: flex; gap: 6px; }

.select, input[type="search"] {
  background: var(--panel2); border: 1px solid var(--line); color: var(--text);
  border-radius: 9px; padding: 6px 11px; font-size: 13.5px; outline: none;
}
.select:focus, input[type="search"]:focus { border-color: var(--accent); }
input[type="range"] { width: 100%; accent-color: var(--accent); }

/* ─────────── LAYOUT ─────────── */
.layout {
  display: grid; grid-template-columns: 250px 1fr; gap: 18px;
  padding: 18px 22px; flex: 1; position: relative; z-index: 1;
  max-width: 1680px; width: 100%; margin: 0 auto;
}
.sidebar { display: flex; flex-direction: column; gap: 14px; }
.side-block {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 15px 16px;
}
.side-block h3 {
  font-size: 11px; text-transform: uppercase; letter-spacing: .14em;
  color: var(--muted); margin-bottom: 10px;
}
.side-note { font-size: 12.5px; color: var(--muted); margin-top: 8px; }
.mono.big { font-size: 26px; font-weight: 800; letter-spacing: .04em; }

.shop-list { list-style: none; display: flex; flex-direction: column; gap: 7px; }
.shop-item {
  display: flex; align-items: center; gap: 9px; padding: 7px 9px;
  border-radius: 9px; cursor: pointer; transition: .15s; font-size: 13.5px;
}
.shop-item:hover { background: var(--panel2); }
.shop-item.selected { background: rgba(53,196,255,.12); outline: 1px solid rgba(53,196,255,.4); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.status-dot.ok { background: var(--ok); box-shadow: 0 0 7px var(--ok); }
.status-dot.warn { background: var(--warn); box-shadow: 0 0 7px var(--warn); }
.status-dot.err { background: var(--err); box-shadow: 0 0 7px var(--err); animation: blink .9s infinite; }
.status-dot.off { background: #45596f; }
@keyframes blink { 50% { opacity: .25; } }
.shop-item .load { margin-left: auto; font-family: var(--mono); font-size: 12px; color: var(--muted); }

.signal-meter { display: flex; align-items: flex-end; gap: 4px; height: 34px; }
.signal-bar { flex: 1; background: var(--line); border-radius: 3px; transition: height .4s, background .4s; min-height: 4px; }

.quick-actions { display: flex; flex-direction: column; gap: 7px; }
.quick-actions .btn { text-align: left; font-size: 12.8px; padding: 8px 11px; }

.progress { height: 7px; background: var(--panel2); border-radius: 99px; overflow: hidden; margin-top: 8px; border: 1px solid var(--line); }
.progress i { display: block; height: 100%; background: linear-gradient(90deg, var(--ok), #9dffce); transition: width .6s; border-radius: 99px; }

/* ─────────── PANELS / CARDS ─────────── */
.content { min-width: 0; }
.panel { display: none; flex-direction: column; gap: 16px; animation: fadein .25s ease; }
.panel.active { display: flex; }
@keyframes fadein { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; } }

.row { display: grid; gap: 16px; }
.row-main { grid-template-columns: 1fr 320px; }
.row-second { grid-template-columns: 1.1fr 1fr 1fr; }
.row-an1 { grid-template-columns: 1.4fr 1fr; }
.row-set { grid-template-columns: 1fr 1fr; }

.card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow);
  min-width: 0;
}
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.card-head h2 { font-size: 15px; font-weight: 800; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chart-tools { display: flex; gap: 5px; }
canvas { width: 100%; display: block; border-radius: 8px; }
.hint { font-size: 12px; color: var(--muted); margin-top: 10px; }

/* KPI */
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; }
.kpi {
  background: linear-gradient(160deg, var(--panel2), var(--panel));
  border: 1px solid var(--line); border-radius: var(--radius);
  padding: 14px 16px; position: relative; overflow: hidden;
}
.kpi::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--accent); }
.kpi.good::after { background: var(--ok); } .kpi.warn::after { background: var(--warn); } .kpi.bad::after { background: var(--err); }
.kpi .k-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
.kpi .k-value { font-family: var(--mono); font-size: 27px; font-weight: 800; margin: 4px 0 2px; }
.kpi .k-delta { font-size: 12.5px; font-weight: 700; }
.k-delta.up { color: var(--ok); } .k-delta.down { color: var(--err); } .k-delta.flat { color: var(--muted); }
.kpi .spark { position: absolute; right: 8px; bottom: 8px; opacity: .8; }

.chart-foot { display: flex; gap: 22px; margin-top: 10px; font-size: 12.5px; color: var(--muted); flex-wrap: wrap; }
.chart-foot b { color: var(--text); font-weight: 600; }
.legend { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; font-size: 12.5px; }
.legend .li { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.legend .sw { width: 10px; height: 10px; border-radius: 3px; }
.legend .val { margin-left: auto; font-family: var(--mono); color: var(--text); }

/* Alerts */
.alert-list { list-style: none; display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
.alert-item {
  display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center;
  border: 1px solid var(--line); border-left-width: 4px; border-radius: 9px;
  padding: 9px 11px; font-size: 13px; background: var(--panel2);
  animation: slidein .3s ease;
}
@keyframes slidein { from { opacity: 0; transform: translateX(12px);} }
.alert-item.warn { border-left-color: var(--warn); }
.alert-item.error { border-left-color: var(--err); }
.alert-item.crit { border-left-color: var(--crit); background: rgba(214,59,255,.07); }
.alert-item .a-time { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.alert-item .a-msg b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.alert-item button { align-self: stretch; }
.alert-empty { color: var(--muted); font-size: 13px; padding: 14px; text-align: center; }

/* Shop mini bars */
.mini-bar-row { margin-bottom: 12px; }
.mini-bar-row .t { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 4px; }
.mini-bar-row .t b { font-family: var(--mono); }
.mini-bar-row .track { height: 6px; border-radius: 99px; background: var(--panel2); overflow: hidden; }
.mini-bar-row .fill { height: 100%; border-radius: 99px; transition: width .8s ease; }

/* Risk matrix */
.risk-matrix { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
.risk-cell {
  aspect-ratio: 1; border-radius: 7px; display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: 12px; font-weight: 700; color: #0a0f18;
  transition: .15s; position: relative; cursor: default;
}
.risk-cell:hover { transform: scale(1.08); z-index: 2; }
.risk-axis { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-top: 6px; display: flex; justify-content: space-between; }
.risk-tip {
  position: fixed; z-index: 99; background: #0a1322; border: 1px solid var(--accent);
  color: var(--text); border-radius: 8px; padding: 7px 10px; font-size: 12px;
  pointer-events: none; box-shadow: var(--shadow); max-width: 240px;
}

/* Calc */
.calc-grid { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 20px; align-items: start; }
.calc-grid label { font-size: 13px; color: var(--muted); display: block; }
.calc-readouts { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; font-size: 13px; color: var(--text); }
.calc-result { text-align: center; }
.calc-num { font-size: 34px; font-weight: 800; color: var(--ok); text-shadow: 0 0 24px rgba(56,232,150,.35); }
.calc-sub { font-size: 12px; color: var(--muted); margin-bottom: 8px; }

/* Table */
.event-tools { display: flex; gap: 8px; flex-wrap: wrap; }
.table-wrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 13.2px; }
.table th {
  text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .1em;
  color: var(--muted); padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap;
}
.table td { padding: 8px 10px; border-bottom: 1px solid rgba(29,44,69,.5); vertical-align: top; }
.dense .table td { padding: 4px 10px; font-size: 12.4px; }
.table tbody tr { transition: background .12s; }
.table tbody tr:hover { background: var(--panel2); }
.lvl { font-family: var(--mono); font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
.lvl.info { color: var(--accent); background: rgba(53,196,255,.12); }
.lvl.warn { color: var(--warn); background: rgba(255,176,32,.12); }
.lvl.error { color: var(--err); background: rgba(255,84,112,.12); }
.lvl.crit { color: var(--crit); background: rgba(214,59,255,.14); }
.table-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; flex-wrap: wrap; gap: 10px; }
.pager { display: flex; gap: 5px; }
.pager button { border: 1px solid var(--line); border-radius: 7px; padding: 4px 10px; font-family: var(--mono); font-size: 12px; color: var(--muted); }
.pager button:hover { color: var(--text); border-color: var(--accent); }
.pager button.cur { color: #06121e; background: var(--accent); border-color: var(--accent); font-weight: 800; }

/* Settings */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-bottom: 14px; }
.field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--muted); }
.field input { background: var(--panel2); border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 7px 10px; font-family: var(--mono); }
.field input:focus { border-color: var(--accent); outline: none; }
.settings-list { display: flex; flex-direction: column; gap: 13px; }
.switch-row, .range-row { display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; cursor: pointer; }
.switch-row { flex-direction: row; align-items: center; justify-content: space-between; }
.switch-row input { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; }

/* Toasts */
.toasts { position: fixed; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 9px; z-index: 100; }
.toast {
  background: #0d1a2c; border: 1px solid var(--line); border-left: 4px solid var(--accent);
  border-radius: 11px; padding: 11px 15px; font-size: 13.5px; min-width: 250px; max-width: 360px;
  box-shadow: var(--shadow); animation: toastin .28s cubic-bezier(.2,.9,.3,1.2);
}
.toast.out { animation: toastout .3s forwards; }
.toast.ok { border-left-color: var(--ok); }
.toast.warn { border-left-color: var(--warn); }
.toast.err { border-left-color: var(--err); }
@keyframes toastin { from { opacity: 0; transform: translateX(40px);} }
@keyframes toastout { to { opacity: 0; transform: translateX(40px);} }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(4,8,14,.72); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; z-index: 90; animation: fadein .2s;
}
.modal-backdrop[hidden] { display: none; }
.modal { width: min(520px, 92vw); }
.modal-x { margin-left: auto; color: var(--muted); font-size: 15px; }
.modal-x:hover { color: var(--err); }
.modal-body { font-size: 14px; color: var(--muted); line-height: 1.6; }
.modal-body pre { background: var(--bg2); border: 1px solid var(--line); border-radius: 9px; padding: 12px; overflow: auto; max-height: 300px; color: var(--text); font-size: 12px; margin-top: 10px; }
.modal-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

.site-foot { text-align: center; font-size: 11.5px; color: #4c6178; padding: 14px; border-top: 1px solid var(--line); position: relative; z-index: 1; }

/* Scrollbars */
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 9px; }
::-webkit-scrollbar-thumb:hover { background: #2a4066; }
::-webkit-scrollbar-track { background: transparent; }

/* Responsive */
@media (max-width: 1280px) {
  .row-main { grid-template-columns: 1fr; }
  .row-second { grid-template-columns: 1fr 1fr; }
  .row-an1 { grid-template-columns: 1fr; }
  .calc-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { flex-direction: row; flex-wrap: wrap; }
  .side-block { flex: 1 1 220px; }
  .topbar { flex-wrap: wrap; }
  .tabs { order: 3; width: 100%; overflow-x: auto; }
  .row-second, .row-set, .calc-grid { grid-template-columns: 1fr; }
}

/* ─────────── PUBLISH TO GITHUB (кнопка + модалка) ─────────── */
.btn-gh { display: inline-flex; align-items: center; gap: 8px; background: #0d1117; color: #e6edf3; border-color: #30363d; }
.btn-gh:hover { border-color: #8b949e; color: #fff; filter: brightness(1.15); }
.btn-gh svg { flex: none; }
.pub-note { font-size: 12.8px; color: var(--muted); margin: 0 0 12px; line-height: 1.5; }
.pub-label { display: block; font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 10px; }
.pub-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.inp { width: 100%; margin-top: 4px; background: var(--bg, #0a1420); color: var(--text, #dbe9f5);
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 11px; font-size: 13px; box-sizing: border-box; }
.inp:focus { outline: none; border-color: var(--accent); }
.pub-track { height: 6px; border-radius: 4px; background: rgba(255,255,255,.08); overflow: hidden; margin: 6px 0 10px; }
.pub-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), #58b6ff); transition: width .3s; }
.pub-log { max-height: 150px; overflow-y: auto; font-size: 11.5px; line-height: 1.55; white-space: pre-wrap;
  background: #06101c; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 0 0 10px; color: #9fe8c8; }
.pub-hint { font-size: 11.5px; color: var(--muted); line-height: 1.5; margin: 0; }
#modalLink { text-decoration: none; }

/* ═══ Speedtest & GitHub Tools (nettools panel) ═══ */
.st-card { flex: 1 1 420px; }
.st-grid { display: grid; grid-template-columns: 260px 1fr; gap: 14px; align-items: center; margin-bottom: 10px; }
.st-gauge-wrap canvas { width: 100%; height: auto; display: block; }
.st-results { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.st-cell { background: var(--bg2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; text-align: center; }
.st-cell small { display: block; font-size: 10px; letter-spacing: .08em; color: var(--muted); }
.st-cell b { font-size: 17px; color: var(--text); }
.st-cell.big b { font-size: 21px; color: var(--accent); }
.gt-bar { display: grid; grid-template-columns: 210px 1fr auto; gap: 8px; margin-bottom: 8px; }
.gt-token { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-bottom: 10px; }
.gt-results { max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.gt-item { background: var(--bg2); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; font-size: 13px; line-height: 1.55; }
.gt-item .btn-small { margin-left: 6px; }
.input { background: var(--bg2); color: var(--text); border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; font: inherit; font-size: 13px; width: 100%; box-sizing: border-box; }
.input:focus { outline: none; border-color: var(--accent); }
textarea.input { resize: vertical; min-height: 60px; margin-top: 8px; }
.chk { display: inline-flex; gap: 6px; align-items: center; font-size: 12.5px; color: var(--muted); }
.btn-small { padding: 4px 9px; font-size: 11.5px; border-radius: 7px; }
@media (max-width: 900px) { .st-grid { grid-template-columns: 1fr; } .gt-bar { grid-template-columns: 1fr; } }
`````````

## Файл: index.html (359 строк)

`````````html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Синтеко Лаб — интерактивный дашборд промышленного мониторинга IoT: телеметрия в реальном времени, графики, алерты, журнал событий, расчёт KPI." />
  <meta name="theme-color" content="#070b12" />
  <title>Синтеко Лаб — IoT-мониторинг производства</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%230b1524'/><path d='M10 40 L22 28 L32 36 L54 14' stroke='%2338e896' stroke-width='6' fill='none' stroke-linecap='round' stroke-linejoin='round'/><circle cx='54' cy='14' r='5' fill='%23ffb020'/></svg>" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Manrope:wght@400;600;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="./css/style.css" />
  <style id="extraPublishStyles">
    .pub-progress { height: 8px; border-radius: 6px; background: rgba(120,160,255,.14); margin: .8rem 0 .5rem; overflow: hidden; }
    .pub-bar { height: 100%; width: 0%; background: linear-gradient(90deg, #38e896, #6ee7ff); transition: width .3s ease; }
    .pub-log { list-style: none; margin: 0; padding: .5rem .6rem; max-height: 150px; overflow-y: auto; background: #0a111f; border-radius: 10px; font-size: .72rem; color: #9fb4d8; }
    .pub-log li { padding: .12rem 0; }
    .modal label { display: block; margin: .55rem 0; font-size: .85rem; }
    .modal input[type="password"], .modal input[type="text"] { width: 100%; margin-top: .3rem; padding: .55rem .7rem; border-radius: 10px; border: 1px solid rgba(120,160,255,.25); background: #0c1424; color: #e8ecf5; font: inherit; }
    .modal .chk { display: flex; gap: .5rem; align-items: center; }
  </style>
</head>
<body>
  <div class="bg-grid" aria-hidden="true"></div>

  <!-- ══════════ TOPBAR ══════════ -->
  <header class="topbar">
    <div class="brand">
      <svg viewBox="0 0 64 64" class="brand-logo" aria-hidden="true">
        <path d="M10 40 L22 28 L32 36 L54 14" stroke="var(--ok)" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="54" cy="14" r="6" fill="var(--warn)"/>
      </svg>
      <div>
        <b>СИНТЕКО&nbsp;ЛАБ</b>
        <small>Industrial Telemetry Console · v3.2</small>
      </div>
    </div>

    <nav class="tabs" role="tablist" id="tabs">
      <button class="tab active" role="tab" data-tab="overview">Обзор</button>
      <button class="tab" role="tab" data-tab="analytics">Аналитика</button>
      <button class="tab" role="tab" data-tab="events">Журнал событий <span class="badge" id="badgeEvents" hidden>0</span></button>
      <button class="tab" role="tab" data-tab="nettools">🌐 Speedtest · GitHub</button>
      <button class="tab" role="tab" data-tab="settings">Настройки</button>
    </nav>

    <div class="top-actions">
      <div class="clock mono" id="clock">--:--:--</div>
      <button class="btn btn-live" id="btnLive" title="Пауза / запуск потока данных">
        <span class="pulse-dot"></span><span id="liveLabel">LIVE</span>
      </button>
      <button class="btn btn-primary" id="btnReport">Отчёт</button>
      <a class="btn btn-ghost" href="./studio/index.html" title="WebStudio — виртуальный сервер для создания сайтов">🛠 WebStudio</a>
      <button class="btn btn-gh" id="btnPublish" title="Опубликовать этот сайт на GitHub Pages — нужен только API-ключ">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-.99.08-2.07 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.08.16 1.87.08 2.07.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        Опубликовать на GitHub
      </button>
    </div>
  </header>

  <main class="layout">
    <!-- ══════════ SIDEBAR ══════════ -->
    <aside class="sidebar">
      <div class="side-block">
        <h3>Цеха</h3>
        <ul class="shop-list" id="shopList"></ul>
      </div>
      <div class="side-block">
        <h3>Качество сигнала</h3>
        <div class="signal-meter" id="signalMeter"></div>
        <p class="side-note">Средняя задержка канала: <b class="mono" id="latencyVal">— мс</b></p>
      </div>
      <div class="side-block">
        <h3>Быстрые действия</h3>
        <div class="quick-actions">
          <button class="btn btn-ghost" data-cmd="calibrate">Калибровка датчиков</button>
          <button class="btn btn-ghost" data-cmd="snapshot">Снимок телеметрии</button>
          <button class="btn btn-ghost" data-cmd="reset-counters">Сброс счётчиков</button>
          <button class="btn btn-danger" data-cmd="emergency">Аварийный стоп ✕</button>
        </div>
      </div>
      <div class="side-block uptime">
        <h3>Аптайм сессии</h3>
        <div class="mono big" id="uptimeVal">00:00:00</div>
        <div class="progress"><i id="slaBar" style="width:0%"></i></div>
        <p class="side-note">SLA-цель: <b>99.2%</b> · факт: <b id="slaVal">—</b></p>
      </div>
    </aside>

    <!-- ══════════ CONTENT ══════════ -->
    <section class="content" id="content">

      <!-- ── TAB: OVERVIEW ── -->
      <div class="panel active" id="panel-overview">
        <div class="kpis" id="kpiRow"><!-- KPI-карточки рендерятся JS --></div>

        <div class="row row-main">
          <article class="card chart-card">
            <header class="card-head">
              <h2>Телеметрия линии
                <select id="metricSel" class="select">
                  <option value="throughput">Производительность, ед/мин</option>
                  <option value="temperature">Температура, °C</option>
                  <option value="vibration">Вибрация, мм/с</option>
                  <option value="power">Потребление, кВт</option>
                </select>
              </h2>
              <div class="chart-tools">
                <button class="chip active" data-window="60">1м</button>
                <button class="chip" data-window="300">5м</button>
                <button class="chip" data-window="900">15м</button>
              </div>
            </header>
            <canvas id="lineChart" height="300"></canvas>
            <footer class="chart-foot mono">
              <span>min <b id="statMin">—</b></span>
              <span>avg <b id="statAvg">—</b></span>
              <span>max <b id="statMax">—</b></span>
              <span>σ <b id="statStd">—</b></span>
              <span>trend <b id="statTrend">—</b></span>
            </footer>
          </article>

          <article class="card gauge-card">
            <header class="card-head"><h2>Загрузка мощностей</h2></header>
            <canvas id="gauge" width="260" height="210"></canvas>
            <div class="legend" id="gaugeLegend"></div>
          </article>
        </div>

        <div class="row row-second">
          <article class="card">
            <header class="card-head"><h2>Распределение брака по типам</h2></header>
            <canvas id="donut" width="420" height="240"></canvas>
          </article>

          <article class="card alerts-card">
            <header class="card-head">
              <h2>Активные алерты</h2>
              <button class="btn btn-small" id="btnAckAll">Принять все</button>
            </header>
            <ul class="alert-list" id="alertList"></ul>
          </article>

          <article class="card shops-mini">
            <header class="card-head"><h2>Статус цехов</h2></header>
            <div id="shopBars"></div>
          </article>
        </div>
      </div>

      <!-- ── TAB: ANALYTICS ── -->
      <div class="panel" id="panel-analytics">
        <div class="row row-an1">
          <article class="card">
            <header class="card-head"><h2>OEE по сменам (последние 12)</h2></header>
            <canvas id="oeeChart" height="280"></canvas>
            <p class="hint">OEE = Доступность × Производительность × Качество. Порог цели — 85%.</p>
          </article>
          <article class="card">
            <header class="card-head"><h2>Матрица рисков</h2></header>
            <div class="risk-matrix" id="riskMatrix"></div>
            <p class="hint">Вероятность инцидента × тяжесть последствий. Наведите на ячейку.</p>
          </article>
        </div>
        <div class="row row-an2">
          <article class="card wide">
            <header class="card-head">
              <h2>Экономический эффект</h2>
              <div class="seg" id="calcSeg">
                <button class="chip active" data-mode="oee">Рост OEE</button>
                <button class="chip" data-mode="defect">Снижение брака</button>
                <button class="chip" data-mode="energy">Экономия энергии</button>
              </div>
            </header>
            <div class="calc-grid">
              <label>Текущие показатели (подставляются из телеметрии):
                <div class="calc-readouts mono" id="calcReadouts"></div>
              </label>
              <label><span id="sliderLabel">Прирост OEE</span>: <b class="mono" id="sliderVal">5%</b>
                <input type="range" id="calcSlider" min="1" max="30" value="5" />
              </label>
              <div class="calc-result">
                <div class="calc-num mono" id="calcNum">0 ₽</div>
                <div class="calc-sub">ожидаемый эффект за год</div>
                <canvas id="calcChart" height="120"></canvas>
              </div>
            </div>
          </article>
        </div>
      </div>

      <!-- ── TAB: EVENTS ── -->
      <div class="panel" id="panel-events">
        <article class="card">
          <header class="card-head">
            <h2>Журнал событий</h2>
            <div class="event-tools">
              <input type="search" id="eventSearch" placeholder="Поиск по описанию…" />
              <select id="eventLevel" class="select">
                <option value="all">Все уровни</option>
                <option value="info">INFO</option>
                <option value="warn">WARN</option>
                <option value="error">ERROR</option>
                <option value="crit">CRIT</option>
              </select>
              <select id="eventSort" class="select">
                <option value="time-desc">Сначала новые</option>
                <option value="time-asc">Сначала старые</option>
                <option value="level">По уровню</option>
              </select>
              <button class="btn btn-small" id="btnExportCsv">CSV ↓</button>
            </div>
          </header>
          <div class="table-wrap">
            <table class="table" id="eventTable">
              <thead><tr>
                <th>Время</th><th>Уровень</th><th>Источник</th><th>Событие</th><th>Значение</th>
              </tr></thead>
              <tbody id="eventBody"></tbody>
            </table>
          </div>
          <footer class="table-foot">
            <span class="mono" id="eventCount">0 записей</span>
            <div class="pager" id="eventPager"></div>
          </footer>
        </article>
      </div>

      <!-- ── TAB: SETTINGS ── -->
      <div class="panel" id="panel-nettools">
        <div class="row">
          <!-- ═══ SPEEDTEST ═══ -->
          <article class="card st-card">
            <header class="card-head"><h2>🌐 Speedtest — проверка скорости интернета</h2>
              <button class="btn btn-primary" id="stRun">▶ Запустить тест</button></header>
            <div class="st-grid">
              <div class="st-gauge-wrap"><canvas id="stGauge" width="260" height="170"></canvas></div>
              <div class="st-results">
                <div class="st-cell"><small>PING</small><b class="mono" id="stPing">— мс</b></div>
                <div class="st-cell"><small>JITTER</small><b class="mono" id="stJitter">— мс</b></div>
                <div class="st-cell"><small>ПОТЕРИ</small><b class="mono" id="stLoss">— %</b></div>
                <div class="st-cell big"><small>DOWNLOAD ↓</small><b class="mono" id="stDown">— Мбит/с</b></div>
                <div class="st-cell big"><small>UPLOAD ↑</small><b class="mono" id="stUp">— Мбит/с</b></div>
                <div class="st-cell"><small>ОЦЕНКА</small><b class="mono" id="stGrade">—</b></div>
              </div>
            </div>
            <div class="pub-track"><div class="pub-fill" id="stProgFill" style="width:0%"></div></div>
            <p class="hint mono" id="stPhase">Готов. Тест использует Cloudflare Speed edge и GitHub CDN (HTTP-замеры, как speed.cloudflare.com).</p>
            <p class="hint mono">live: ↓ <span id="stDlLive">—</span> · ↑ <span id="stUlLive">—</span> · последний пинг: <span id="stPingLast">—</span></p>
            <p class="hint" id="stIsp"></p>
            <details open><summary class="hint">История замеров (последние 20)</summary><div id="stHistory"></div></details>
          </article>

          <!-- ═══ GITHUB TOOLS ═══ -->
          <article class="card">
            <header class="card-head"><h2>🐙 GitHub Tools — стороние функции GitHub</h2></header>
            <div class="gt-bar">
              <select id="gtKind" class="input">
                <option value="search">Поиск репозиториев</option>
                <option value="profile">Профиль пользователя</option>
                <option value="release">Релизы репозитория</option>
                <option value="issues-open">Issues (открытые)</option>
                <option value="issues-closed">Issues (закрытые)</option>
                <option value="tree">Дерево файлов репо</option>
              </select>
              <input id="gtQuery" class="input" placeholder="например: react  ·  @torvalds  ·  microsoft/vscode" />
              <button class="btn btn-primary" id="gtGo">Выполнить</button>
            </div>
            <div class="gt-token">
              <input id="gtToken" type="password" class="input" placeholder="API-ключ для звёзд / форков / gist / коммитов (необязательно)" autocomplete="off"/>
              <button class="btn btn-ghost" id="gtTokenSave">💾 Проверить и сохранить ключ</button>
            </div>
            <div id="gtResults" class="gt-results"><p class="hint">Публичные операции работают без ключа. Для «In stars», «Fork», gist и записи коммитов ключ запросится автоматически.</p></div>

            <details><summary class="hint">✍ Быстрый gist (нужен ключ со scope gist)</summary>
              <div class="form-grid">
                <input id="gtGistDesc" class="input" placeholder="описание" />
                <input id="gtGistFile" class="input" placeholder="имя файла (snippet.js)" />
                <label class="chk"><input id="gtGistPublic" type="checkbox" checked /> публичный</label>
              </div>
              <textarea id="gtGistCode" class="input mono" rows="4" placeholder="// код…"></textarea>
              <button class="btn btn-small btn-primary" id="gtMakeGist">Создать gist</button>
            </details>

            <details><summary class="hint">📝 Коммит файла в любой свой репозиторий (Contents RW)</summary>
              <div class="form-grid">
                <input id="gtCommitRepo" class="input" placeholder="owner/repo" />
                <input id="gtCommitBranch" class="input" placeholder="main" />
                <input id="gtCommitFile" class="input" placeholder="docs/note.md" />
                <input id="gtCommitMsg" class="input" placeholder="commit message" />
                <label class="chk"><input id="gtCommitUpdate" type="checkbox" checked /> обновлять если существует</label>
              </div>
              <textarea id="gtCommitText" class="input mono" rows="3" placeholder="содержимое файла…"></textarea>
              <button class="btn btn-small btn-primary" id="gtCommitBtn">Закоммитить →</button>
            </details>
          </article>
        </div>
      </div>

      <div class="panel" id="panel-settings">
        <div class="row row-set">
          <article class="card">
            <header class="card-head"><h2>Пороги срабатывания алертов</h2></header>
            <div id="thresholdsForm" class="form-grid"></div>
            <button class="btn btn-primary" id="btnSaveThresholds">Сохранить пороги</button>
          </article>
          <article class="card">
            <header class="card-head"><h2>Интерфейс и данные</h2></header>
            <div class="settings-list">
              <label class="switch-row"><span>Плотная таблица событий</span>
                <input type="checkbox" id="setDense" /></label>
              <label class="switch-row"><span>Звуковые уведомления об ERROR/CRIT</span>
                <input type="checkbox" id="setSound" checked /></label>
              <label class="switch-row"><span>Показывать сетку на графиках</span>
                <input type="checkbox" id="setGrid" checked /></label>
              <label class="range-row"><span>Скорость симуляции: <b class="mono" id="speedVal">1.0×</b></span>
                <input type="range" id="setSpeed" min="0.25" max="4" step="0.25" value="1" /></label>
              <label class="range-row"><span>Глубина истории (точек)</span>
                <input type="range" id="setDepth" min="120" max="1200" step="120" value="600" /></label>
            </div>
            <hr/>
            <button class="btn btn-danger" id="btnResetAll">Сбросить всё к заводским</button>
          </article>
        </div>
      </div>
    </section>
  </main>

  <!-- ══════════ TOASTS ══════════ -->
  <div class="toasts" id="toasts" aria-live="polite"></div>

  <!-- ══════════ MODAL ══════════ -->
  <div class="modal-backdrop" id="modalBackdrop" hidden>
    <div class="modal card" role="dialog" aria-modal="true">
      <header class="card-head"><h2 id="modalTitle">Подтверждение</h2>
        <button class="modal-x" id="modalX" aria-label="Закрыть">✕</button></header>
      <div class="modal-body" id="modalBody"></div>
      <footer class="modal-foot">
        <button class="btn btn-ghost" id="modalCancel">Отмена</button>
        <button class="btn btn-primary" id="modalOk">Подтвердить</button>
        <a class="btn btn-ghost" id="modalLink" hidden target="_blank" rel="noopener">🔗 Открыть сайт</a>
      </footer>
    </div>
  </div>

  <footer class="site-foot mono">
    СИНТЕКО Лаб · демо-стенд симуляции промышленных данных · всё генерируется локально в браузере, без сервера
  </footer>

  <script src="./js/utils.js"></script>
  <script src="./js/simulation.js"></script>
  <script src="./js/charts.js"></script>
  <script src="./js/dashboard.js"></script>
  <script src="./js/publish.js"></script>
  <script src="./js/nettest.js"></script>
</body>
</html>
`````````

## Файл: js/charts.js (244 строк)

`````````javascript
/* ═══════════ charts.js — dependency-free canvas chart primitives ═══════════ */
"use strict";

const CHARTS = (() => {
  const COL = {
    accent: "#35c4ff", ok: "#38e896", warn: "#ffb020", err: "#ff5470", crit: "#d63bff",
    grid: "rgba(125,147,173,.14)", text: "#7d93ad", fill: "rgba(53,196,255,.12)",
  };

  /* ── Line/area chart with optional threshold band & hover crosshair ── */
  function line(canvas, data, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 46, padR = 12, padT = 12, padB = 26;
    if (!data.length) { ctx.clearRect(0, 0, w, h); return; }

    let min = Math.min(...data), max = Math.max(...data);
    if (opts.threshold != null) { min = Math.min(min, opts.threshold * 0.9); max = Math.max(max, opts.threshold * 1.05); }
    const span = (max - min) || 1;
    min -= span * 0.08; max += span * 0.08;

    const X = i => padL + (i / Math.max(1, data.length - 1)) * (w - padL - padR);
    const Y = v => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);

    ctx.clearRect(0, 0, w, h);

    // grid + y labels
    if (opts.grid !== false) {
      ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.text;
      ctx.font = "10px JetBrains Mono, monospace"; ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        const v = min + (g / 4) * (max - min), y = Y(v);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.textAlign = "right"; ctx.fillText(fmt.num(v, v > 100 ? 0 : 1), padL - 6, y + 3);
      }
      // x time labels
      ctx.textAlign = "center";
      for (let g = 0; g <= 4; g++) {
        const idx = Math.floor((g / 4) * (data.length - 1));
        const secAgo = (data.length - 1 - idx) * (opts.secPerTick || 1);
        ctx.fillText(secAgo === 0 ? "сейчас" : `-${Math.round(secAgo)}с`, X(idx), h - 8);
      }
    }

    // threshold dashed line
    if (opts.threshold != null) {
      ctx.save();
      ctx.strokeStyle = opts.thresholdColor || COL.warn;
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(padL, Y(opts.threshold)); ctx.lineTo(w - padR, Y(opts.threshold)); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = opts.thresholdColor || COL.warn;
      ctx.font = "10px JetBrains Mono, monospace"; ctx.textAlign = "left";
      ctx.fillText("порог", padL + 4, Y(opts.threshold) - 5);
    }

    // area fill
    const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
    grad.addColorStop(0, opts.color ? hexA(opts.color, .25) : "rgba(53,196,255,.25)");
    grad.addColorStop(1, "rgba(53,196,255,0)");
    ctx.beginPath();
    data.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.lineTo(X(data.length - 1), h - padB); ctx.lineTo(X(0), h - padB); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // stroke line
    ctx.beginPath();
    data.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.strokeStyle = opts.color || COL.accent; ctx.lineWidth = 2;
    ctx.lineJoin = "round"; ctx.shadowColor = hexA(opts.color || COL.accent, .5); ctx.shadowBlur = 8;
    ctx.stroke(); ctx.shadowBlur = 0;

    // last point marker
    const lx = X(data.length - 1), ly = Y(data[data.length - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 7); ctx.fillStyle = opts.color || COL.accent; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 8, 0, 7); ctx.strokeStyle = hexA(opts.color || COL.accent, .4); ctx.stroke();

    // hover crosshair
    canvas._lineData = { data, X, Y, padL, padR, padT, padB, w, h };
  }

  function lineHover(canvas, mx) {
    const d = canvas._lineData;
    if (!d || !d.data.length) return null;
    const { data, X, Y, padL, w, padR } = d;
    const rel = (mx - padL) / (w - padL - padR);
    const idx = clamp(Math.round(rel * (data.length - 1)), 0, data.length - 1);
    return { idx, value: data[idx], x: X(idx), y: Y(data[idx]) };
  }

  /* ── Gauge (semi-donut) ── */
  function gauge(canvas, value, label) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.78, r = Math.min(w / 2 - 14, h * 0.66);
    const a0 = Math.PI, a1 = 2 * Math.PI;
    const v = clamp(value, 0, 100);

    ctx.lineCap = "round";
    ctx.lineWidth = 18;
    ctx.strokeStyle = "rgba(125,147,173,.15)";
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();

    const col = v > 92 ? COL.err : v > 78 ? COL.warn : COL.ok;
    const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    grad.addColorStop(0, COL.accent); grad.addColorStop(1, col);
    ctx.strokeStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (v / 100) * Math.PI); ctx.stroke();

    // ticks
    ctx.strokeStyle = "rgba(219,231,244,.25)"; ctx.lineWidth = 1.5;
    for (let t = 0; t <= 10; t++) {
      const a = a0 + (t / 10) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r + 12), cy + Math.sin(a) * (r + 12));
      ctx.lineTo(cx + Math.cos(a) * (r + 18), cy + Math.sin(a) * (r + 18));
      ctx.stroke();
    }

    ctx.fillStyle = "#dbe7f4"; ctx.textAlign = "center";
    ctx.font = "800 34px JetBrains Mono, monospace";
    ctx.fillText(fmt.num(v, 1) + "%", cx, cy - 8);
    ctx.font = "12px Manrope, sans-serif"; ctx.fillStyle = COL.text;
    ctx.fillText(label || "", cx, cy + 14);
  }

  /* ── Donut chart with legend drawn beside (labels list passed in opts.labels) ── */
  function donut(canvas, values, labels, colors) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = w * 0.32, cy = h / 2, r = Math.min(w * 0.30, h / 2 - 12), ir = r * 0.62;
    let a = -Math.PI / 2;
    values.forEach((val, i) => {
      const frac = val / total, a2 = a + frac * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a, a2);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      a = a2;
    });
    // hole
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, 7); ctx.fillStyle = "#0e1626"; ctx.fill();
    ctx.fillStyle = "#dbe7f4"; ctx.textAlign = "center";
    ctx.font = "800 20px JetBrains Mono, monospace";
    ctx.fillText(fmt.int(total), cx, cy + 2);
    ctx.font = "10px Manrope"; ctx.fillStyle = COL.text;
    ctx.fillText("шт брака", cx, cy + 18);

    // side legend
    const lx = w * 0.62;
    ctx.textAlign = "left"; ctx.font = "12px Manrope, sans-serif";
    labels.forEach((lab, i) => {
      const ly = 18 + i * Math.max(16, (h - 30) / labels.length);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(lx, ly - 8, 9, 9);
      ctx.fillStyle = "#dbe7f4";
      const pctV = (values[i] / total) * 100;
      ctx.fillText(`${lab}  ${fmt.num(pctV, 1)}%`, lx + 15, ly);
    });
  }

  /* ── Vertical bars with target line ── */
  function bars(canvas, values, { target = null, color = COL.accent, labelEvery = 1 } = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 34, padB = 24, padT = 10;
    const max = Math.max(100, ...values);
    const bw = (w - padL - 8) / values.length;
    ctx.font = "10px JetBrains Mono, monospace";

    // grid
    ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.text;
    for (let g = 0; g <= 4; g++) {
      const v = (g / 4) * max, y = padT + (1 - v / max) * (h - padT - padB);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - 4, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(Math.round(v), padL - 5, y + 3);
    }

    values.forEach((v, i) => {
      const x = padL + i * bw + bw * 0.18;
      const bh = (v / max) * (h - padT - padB);
      const y = h - padB - bh;
      const col = target != null && v < target ? COL.warn : color;
      const grad = ctx.createLinearGradient(0, y, 0, h - padB);
      grad.addColorStop(0, col); grad.addColorStop(1, hexA(col, .25));
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, bw * 0.64, bh, 4); ctx.fill();
      if (i % labelEvery === 0) {
        ctx.fillStyle = COL.text; ctx.textAlign = "center";
        ctx.fillText("#" + (i + 1), x + bw * 0.32, h - 8);
      }
    });

    if (target != null) {
      const ty = padT + (1 - target / max) * (h - padT - padB);
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = COL.err; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(w - 4, ty); ctx.stroke(); ctx.restore();
      ctx.fillStyle = COL.err; ctx.textAlign = "left";
      ctx.fillText("цель " + target + "%", padL + 4, ty - 4);
    }
  }

  /* ── Mini sparkline (for KPI cards) ── */
  function spark(canvas, data, color = COL.accent) {
    const dpr = window.devicePixelRatio || 1;
    const w = 84, h = 30;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const min = Math.min(...data), max = Math.max(...data), span = (max - min) || 1;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
  }

  /* helpers */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); if (r < 0) r = 0;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hexA(hex, a) {
    const m = hex.replace("#", "");
    const n = m.length === 3 ? m.split("").map(c => c + c).join("") : m;
    const i = parseInt(n, 16);
    return `rgba(${(i >> 16) & 255},${(i >> 8) & 255},${i & 255},${a})`;
  }

  return { line, lineHover, gauge, donut, bars, spark, COL, hexA };
})();
`````````

## Файл: js/dashboard.js (529 строк)

`````````javascript
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
`````````

## Файл: js/nettest.js (386 строк)

`````````javascript
/* ═══════════════════════════════════════════════════════════════
   nettest.js — SpeedTest (ping / download / upload / jitter / loss)
   + GitHub Tools: стороние функции GitHub (публичный API, без токена;
   для приватных операций запрашивается API-ключ).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const API = "https://api.github.com";
  const LS_GH_TOKEN = "gh_tools_token";

  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function ghFetch(path, opts = {}, token) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      let msg = res.status + " " + res.statusText;
      try { msg = (await res.json()).message || msg; } catch (e) { /* noop */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  /* ───────────────────────── SPEEDTEST ───────────────────────── */
  const EDGE_URLS = [
    "https://raw.githubusercontent.com/",
    "https://cdn.jsdelivr.net/gh/Rustin-Github/CloudflareSpeedTest@master/LICENSE",
    "https://speed.cloudflare.com/__down?bytes=",
  ];
  const PING_TARGETS = [
    "https://api.github.com/zen",
    "https://httpbingo.org/get",
    "https://www.google.com/generate_204",
  ];

  async function timedFetch(url, opts = {}) {
    const t0 = performance.now();
    const res = await fetch(url, { cache: "no-store", ...opts });
    const text = await res.text();
    return { ms: performance.now() - t0, bytes: new Blob([text]).size };
  }

  async function measurePing(onSample) {
    const samples = [];
    for (const target of PING_TARGETS) {
      for (let i = 0; i < 4; i++) {
        try {
          const r = await timedFetch(target + "?_=" + Math.random());
          samples.push({ host: new URL(target).hostname, ms: r.ms });
          onSample && onSample(samples[samples.length - 1]);
        } catch (e) { samples.push({ host: new URL(target).hostname, ms: -1 }); }
        await sleep(60);
      }
    }
    const ok = samples.filter((s) => s.ms >= 0).map((s) => s.ms);
    const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
    const jitter = ok.length > 1
      ? ok.reduce((a, b) => a + Math.abs(b - (ok.reduce((x, y) => x + y, 0) / ok.length)), 0) / ok.length
      : 0;
    const loss = ((samples.length - ok.length) / Math.max(1, samples.length)) * 100;
    return { min: Math.min(...ok, 0) || 0, avg, max: Math.max(...ok, 0), jitter, loss, samples };
  }

  async function measureDownload(sizeBytes, onProgress) {
    const url = EDGE_URLS[2] + sizeBytes;
    const t0 = performance.now();
    const res = await fetch(url, { cache: "no-store" });
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
    const payload = new Uint8Array(payloadBytes); // нули — сжатие не искажает: сервер просто принимает
    const t0 = performance.now();
    const res = await fetch(EDGE_URLS[2].replace("__down", "__up"), {
      method: "POST", cache: "no-store", body: payload,
    }).catch(() => null);
    const secs = (performance.now() - t0) / 1000;
    const ok = res && res.ok;
    onProgress && onProgress(payloadBytes, ok ? (payloadBytes * 8) / secs : 0);
    return { bitsPerSec: ok && secs > 0 ? (payloadBytes * 8) / secs : 0, bytes: payloadBytes, secs };
  }

  function fmtSpeed(bps) {
    if (!isFinite(bps) || bps <= 0) return "— Мбит/с";
    if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " Гбит/с";
    if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " Мбит/с";
    return (bps / 1e3).toFixed(0) + " кбит/с";
  }
  function grade(p) {
    if (p.avg < 30 && p.loss < 1) return ["A+", "var(--ok)"];
    if (p.avg < 80 && p.loss < 2) return ["A", "var(--accent)"];
    if (p.avg < 150) return ["B", "var(--warn)"];
    return ["C", "var(--err)"];
  }

  let stTimer = null;
  function stopTimers() { if (stTimer) { clearInterval(stTimer); stTimer = null; } }

  async function runSpeedTest() {
    const btn = $("#stRun"); if (!btn) return;
    btn.disabled = true; btn.textContent = "Идёт тест…";
    stopTimers();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const gaugeCanvas = $("#stGauge");
    const hist = JSON.parse(localStorage.getItem("st_history") || "[]");
    let liveDl = 0;

    const drawGauge = () => {
      if (!gaugeCanvas || typeof CHARTS === "undefined") return;
      // шкала: логарифмическая доля 0..100 от 1 Мбит/с до 1 Гбит/с
      const mbps = Math.max(0, liveDl / 1e6);
      const frac = mbps <= 1 ? 0 : Math.min(1, Math.log10(mbps) / 3);
      CHARTS.gauge(gaugeCanvas, Math.round(frac * 100), fmtSpeed(liveDl).replace(" Мбит/с", "").replace(" Гбит/с", "") + " · ↓ download");
    };
    stTimer = setInterval(drawGauge, 250);

    try {
      set("#stPhase", "1/3 · Пинг и джиттер (12 запросов)…");
      
      const pf0 = $("#stProgFill"); if (pf0) pf0.style.width = "10%";
      const ping = await measurePing((s) => set("#stPingLast", s.ms >= 0 ? Math.round(s.ms) + " мс (" + s.host + ")" : "timeout ✕"));

      set("#stPhase", "2/3 · Download: 1 МБ → 10 МБ → 25 МБ…");
      
      if (pf0) pf0.style.width = "35%";
      const d1 = await measureDownload(1e6, (b, r) => { liveDl = r; set("#stDlLive", fmtSpeed(r)); });
      await sleep(200);
      const d10 = await measureDownload(10e6, (b, r) => { liveDl = r; set("#stDlLive", fmtSpeed(r)); });
      await sleep(200);
      const d25 = await measureDownload(25e6, (b, r) => { liveDl = r; set("#stDlLive", fmtSpeed(r)); });
      const dl = d25.bytes > 1e6 ? d25 : d10;

      set("#stPhase", "3/3 · Upload: 0.5 МБ → 2 МБ…");
      
      if (pf0) pf0.style.width = "70%";
      const u1 = await measureUpload(5e5, (b, r) => set("#stUlLive", fmtSpeed(r)));
      const u2 = await measureUpload(2e6, (b, r) => set("#stUlLive", fmtSpeed(r)));
      const ul = u2.bitsPerSec > 0 ? u2 : u1;

      const result = {
        ts: Date.now(),
        ping: Math.round(ping.avg), jitter: Math.round(ping.jitter), loss: +ping.loss.toFixed(1),
        down: dl.bitsPerSec, up: ul.bitsPerSec,
        downSamples: [d1, d10, d25].map((d) => Math.round(d.bitsPerSec / 1e6 * 10) / 10),
      };
      hist.unshift(result); localStorage.setItem("st_history", JSON.stringify(hist.slice(0, 20)));

      const [g, gc] = grade(ping);
      set("#stPing", result.ping + " мс");
      set("#stJitter", result.jitter + " мс");
      set("#stLoss", result.loss + " %");
      set("#stDown", fmtSpeed(result.down));
      set("#stUp", fmtSpeed(result.up));
      set("#stGrade", g); const gel = $("#stGrade"); if (gel) gel.style.color = gc;
      set("#stIsp", "тест через Cloudflare Speed edge · GitHub CDN");
      set("#stPhase", "Готово ✔"); const pf=$("#stProgFill"); if(pf) pf.style.width="100%";
      renderStHistory();
      if (typeof beep === "function") beep(880, 0.15);
    } catch (e) {
      set("#stPhase", "Ошибка: " + e.message);
      toast("Speedtest: " + e.message, "error", 6000);
    } finally {
      stopTimers(); btn.disabled = false; btn.textContent = "▶ Запустить тест";
    }
  }

  function renderStHistory() {
    const box = $("#stHistory"); if (!box) return;
    const hist = JSON.parse(localStorage.getItem("st_history") || "[]");
    if (!hist.length) { box.innerHTML = '<p class="hint">История пуста — запустите первый тест.</p>'; return; }
    box.innerHTML = "<table class='table'><thead><tr><th>Время</th><th>Ping</th><th>Jitter</th><th>↓ Мбит/с</th><th>↑ Мбит/с</th></tr></thead><tbody>" +
      hist.map((h) => `<tr><td class="mono">${new Date(h.ts).toLocaleString("ru-RU")}</td><td>${h.ping} мс</td><td>${h.jitter} мс</td><td>${(h.down / 1e6).toFixed(1)}</td><td>${(h.up / 1e6).toFixed(1)}</td></tr>`).join("") +
      "</tbody></table>";
  }

  /* ───────────────────── GITHUB TOOLS ───────────────────── */
  const gtCache = {};

  async function gtSearch(q) {
    const list = $("#gtResults");
    list.innerHTML = "<p class='hint'>Поиск «" + q + "»…</p>";
    const items = await ghFetch("/search/repositories?q=" + encodeURIComponent(q) + "&sort=stars&per_page=12");
    gtCache.repos = {};
    list.innerHTML = items.items.length ? "" : "<p class='hint'>Ничего не найдено.</p>";
    for (const r of items.items.slice(0, 12)) {
      gtCache.repos[r.full_name] = r;
      const row = document.createElement("div");
      row.className = "gt-item";
      row.innerHTML = `<b class="mono">${r.full_name}</b> <span class="badge">★ ${r.stargazers_count.toLocaleString("ru")}</span>
        <span class="badge">${r.language || "—"}</span><br/><small class="hint">${(r.description || "").slice(0, 110)}</small>
        <button class="btn btn-small" data-star="${r.full_name}">☆ In stars</button>
        <button class="btn btn-small" data-fork="${r.full_name}">⑂ Fork</button>
        <a class="btn btn-small btn-ghost" href="${r.html_url}" target="_blank" rel="noopener">Открыть ↗</a>`;
      list.appendChild(row);
    }
    list.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", () => gtStar(b.dataset.star, b)));
    list.querySelectorAll("[data-fork]").forEach((b) => b.addEventListener("click", () => gtFork(b.dataset.fork, b)));
  }

  async function gtTokenOrAsk() {
    let t = localStorage.getItem(LS_GH_TOKEN);
    if (t) return t;
    const ok = await modal("Нужен API-ключ",
      '<p class="pub-note">Эта операция требует авторизации. Введите GitHub Personal Access Token (права: Contents RW' +
      ", для fork — Administration RW на целевой репозиторий).</p>" +
      '<input id="gtTok" type="password" class="input" placeholder="ghp_… / github_pat_…" autocomplete="off"/>', "Проверить и продолжить");
    if (!ok) return null;
    const val = ($("#gtTok").value || "").trim();
    try { await ghFetch("/user", {}, val); } catch (e) { toast("Ключ отклонён: " + e.message, "error", 6000); return null; }
    localStorage.setItem(LS_GH_TOKEN, val);
    toast("Ключ принят и сохранён в этом браузере", "ok");
    return val;
  }

  async function gtStar(full, btn) {
    const t = await gtTokenOrAsk(); if (!t) return;
    try { await ghFetch("/user/starred/" + full, { method: "PUT" }, t); btn.textContent = "★ in stars ✓"; toast("Поставлено в stars: " + full, "ok"); }
    catch (e) { toast("Stars: " + e.message, "error", 6000); }
  }
  async function gtFork(full, btn) {
    const t = await gtTokenOrAsk(); if (!t) return;
    try { const r = await ghFetch("/repos/" + full + "/forks", { method: "POST" }, t); toast("Форк создан: " + r.full_name, "ok", 7000); btn.textContent = "⑂ готово ✓"; }
    catch (e) { toast("Fork: " + e.message, "error", 6000); }
  }

  async function gtProfile(login) {
    const box = $("#gtResults");
    box.innerHTML = "<p class='hint'>Загрузка @" + login + "…</p>";
    const u = await ghFetch("/users/" + encodeURIComponent(login));
    const repos = await ghFetch("/users/" + encodeURIComponent(login) + "/repos?sort=updated&per_page=30");
    const top = [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 6);
    box.innerHTML = `
      <div class="gt-item"><img src="${u.avatar_url}&s=64" width="48" height="48" style="border-radius:50%;float:right" alt="" />
        <b>@${u.login}</b> — ${u.name || "без имени"}<br/>
        <small class="hint">${(u.bio || "").slice(0, 140)} · 🏢 ${u.company || "—"} · 📍 ${u.location || "—"}</small><br/>
        <span class="badge">repos: ${u.public_repos}</span> <span class="badge">followers: ${u.followers}</span>
        <span class="badge">gists: ${u.public_gists}</span>
        <a class="btn btn-small btn-ghost" href="${u.html_url}" target="_blank" rel="noopener">GitHub ↗</a></div>` +
      (top.length ? "<p class='hint'>Топ репозиториев по ⭐:</p>" + top.map((r) =>
        `<div class="gt-item mono">★ ${String(r.stargazers_count).padStart(5)} · <b>${r.name}</b> <small class="hint">${(r.description || "").slice(0, 90)}</small></div>`).join("") : "");
  }

  async function gtRelease(ownerRepo) {
    const box = $("#gtResults");
    box.innerHTML = "<p class='hint'>Релизы " + ownerRepo + "…</p>";
    const rel = await ghFetch("/repos/" + ownerRepo + "/releases?per_page=8");
    if (!rel.length) { box.innerHTML = "<p class='hint'>Релизов нет.</p>"; return; }
    box.innerHTML = rel.map((r) => `
      <div class="gt-item"><b class="mono">${r.tag_name}</b> ${r.prerelease ? '<span class="badge">pre</span>' : ""}
        <small class="hint">· ${new Date(r.published_at).toLocaleDateString("ru-RU")} · ${r.assets.reduce((a, x) => a + x.download_count, 0).toLocaleString("ru")} скачиваний</small><br/>
        ${(r.body || "").slice(0, 160).replace(/\n/g, " ")}<br/>
        ${r.assets.slice(0, 4).map((a) => `<a class="btn btn-small" href="${a.browser_download_url}">⬇ ${a.name.slice(0, 30)}</a>`).join(" ")}</div>`).join("");
  }

  async function gtIssues(ownerRepo, state) {
    const box = $("#gtResults");
    box.innerHTML = "<p class='hint'>Загрузка issues…</p>";
    const iss = await ghFetch(`/repos/${ownerRepo}/issues?state=${state}&per_page=15`);
    box.innerHTML = iss.length ? "" : "<p class='hint'>Пусто.</p>";
    for (const it of iss) {
      const div = document.createElement("div");
      div.className = "gt-item";
      div.innerHTML = `<b>#${it.number}</b> ${it.title.slice(0, 90)} <span class="badge">${it.state}</span>
        <small class="hint">· @${it.user.login} · 💬 ${it.comments} · ${new Date(it.created_at).toLocaleDateString("ru-RU")}</small>`;
      box.appendChild(div);
    }
  }

  async function gtCreateGist() {
    const t = await gtTokenOrAsk(); if (!t) return;
    const desc = $("#gtGistDesc").value.trim() || "Web snippet";
    const content = $("#gtGistCode").value || "console.log('hi from Syntheco Console')";
    const filename = $("#gtGistFile").value.trim() || "snippet.js";
    const pub = $("#gtGistPublic").checked;
    try {
      const g = await ghFetch("/gists", { method: "POST", body: JSON.stringify({ description: desc, public: pub, files: { [filename]: { content } } }) }, t);
      $("#gtResults").innerHTML = `<div class="gt-item">✔ Гист создан: <b class="mono">${g.id}</b><br/>
        <a class="btn btn-small" href="${g.html_url}" target="_blank" rel="noopener">Открыть gist ↗</a>
        <button class="btn btn-small" data-copy="${g.html_url}">Копировать ссылку</button></div>`;
      $("#gtResults [data-copy]").addEventListener("click", (b) => navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Ссылка скопирована", "ok")));
      toast("Gist опубликован", "ok");
    } catch (e) { toast("Gist: " + e.message, "error", 6000); }
  }

  async function gtTree(ownerRepo) {
    const box = $("#gtResults");
    box.innerHTML = "<p class='hint'>Дерево файлов " + ownerRepo + "…</p>";
    let ref;
    try { ref = await ghFetch(`/repos/${ownerRepo}/git/ref/heads/main`); }
    catch (e) { ref = await ghFetch(`/repos/${ownerRepo}/git/ref/heads/master`); }
    const tree = await ghFetch(`/repos/${ownerRepo}/git/trees/${ref.object.sha}?recursive=1`);
    const rows = tree.tree.slice(0, 200).map((t) =>
      `<tr><td class="mono">${t.type === "tree" ? "📁" : "📄"} ${t.path}</td><td class="mono">${t.size != null ? (t.size / 1024).toFixed(1) + " КБ" : "—"}</td></tr>`).join("");
    box.innerHTML = `<p class="hint">Файлов: ${tree.tree.length}${tree.truncated ? " (показаны первые 200)" : ""}</p>
      <table class="table"><tbody>${rows}</tbody></table>`;
  }

  async function gtCommit(ownerRepo, file, branch, msg, content, isUpdate) {
    const t = await gtTokenOrAsk(); if (!t) return false;
    try {
      let sha = null;
      if (isUpdate) { try { const cur = await ghFetch(`/repos/${ownerRepo}/contents/${encodeURIComponent(file).replace(/%2F/g, "/")}?ref=${branch}`, {}, t); sha = cur.sha; } catch (e) { /* нет файла */ } }
      await ghFetch(`/repos/${ownerRepo}/contents/${encodeURIComponent(file).replace(/%2F/g, "/")}`, {
        method: "PUT", body: JSON.stringify({ message: msg, content: b64(content), ...(sha ? { sha } : {}), ...(branch ? { branch } : {}) }),
      }, t);
      toast("✔ Коммит записан в " + ownerRepo + "/" + file, "ok", 6000);
      return true;
    } catch (e) { toast("Commit: " + e.message, "error", 7000); return false; }
  }

  function bindGithubTab() {
    const go = (fn) => fn().catch((e) => { $("#gtResults").innerHTML = `<p class="hint" style="color:var(--err)">✖ ${e.message}${e.status === 403 ? " (rate limit — вставьте API-ключ ниже)" : ""}</p>`; });

    $("#gtGo").addEventListener("click", () => {
      const kind = $("#gtKind").value, q = $("#gtQuery").value.trim();
      if (!q) return toast("Укажите запрос", "warn");
      if (kind === "search") go(() => gtSearch(q));
      else if (kind === "profile") go(() => gtProfile(q.replace(/^@/, "")));
      else if (kind === "release") go(() => gtRelease(q));
      else if (kind === "issues-open") go(() => gtIssues(q, "open"));
      else if (kind === "issues-closed") go(() => gtIssues(q, "closed"));
      else if (kind === "tree") go(() => gtTree(q));
    });
    $("#gtQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#gtGo").click(); });
    $("#gtMakeGist").addEventListener("click", () => gtCreateGist().catch((e) => toast(e.message, "error")));

    $("#gtCommitBtn").addEventListener("click", async () => {
      const or = $("#gtCommitRepo").value.trim(), br = $("#gtCommitBranch").value.trim() || "main";
      const fl = $("#gtCommitFile").value.trim() || "notes.txt", ms = $("#gtCommitMsg").value.trim() || "update via console";
      const tx = $("#gtCommitText").value;
      if (!/^[\w.-]+\/[\w.-]+$/.test(or)) return toast("Формат репо: owner/name", "warn");
      if (!tx) return toast("Пустое содержимое файла", "warn");
      const ok = await gtCommit(or, fl, br, ms, tx, $("#gtCommitUpdate").checked);
      if (ok) $("#gtResults").innerHTML = `<div class="gt-item">✔ Файл <b class="mono">${fl}</b> закоммичен в <b class="mono">${or}</b> (${br})<br/>
        <a class="btn btn-small" href="https://github.com/${or}/blob/${br}/${fl}" target="_blank" rel="noopener">Посмотреть на GitHub ↗</a></div>`;
    });

    const savedT = localStorage.getItem(LS_GH_TOKEN) || "";
    $("#gtToken").value = savedT;
    $("#gtTokenSave").addEventListener("click", () => {
      const v = $("#gtToken").value.trim();
      if (!v) { localStorage.removeItem(LS_GH_TOKEN); return toast("Ключ удалён из браузера", "ok"); }
      ghFetch("/user", {}, v).then((u) => { localStorage.setItem(LS_GH_TOKEN, v); toast("Ключ проверен: @" + u.login, "ok"); })
        .catch((e) => toast("Ключ не прошёл проверку: " + e.message, "error", 6000));
    });
  }

  /* ───────────────────────── bootstrap ───────────────────────── */
  function init() {
    const tabBtn = document.querySelector('[data-tab="nettools"]');
    if (tabBtn) {
      tabBtn.addEventListener("click", () => { renderStHistory(); });
    }
    const run = $("#stRun"); if (run) run.addEventListener("click", runSpeedTest);
    if ($("#gtGo")) bindGithubTab();
    renderStHistory();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.NetTools = { runSpeedTest, measurePing, measureDownload, measureUpload, fmtSpeed };
})();
`````````

## Файл: js/publish.js (209 строк)

`````````javascript
/* ═══════════════════════════════════════════════════════════════
   publish.js — кнопка «Опубликовать на GitHub»
   ТРЕБУЕТСЯ ТОЛЬКО API-КЛЮЧ:
     • владелец (login) определяется автоматически из токена (GET /user);
     • имя репозитория генерируется автоматически (можно переопределить);
     • дальше всё само: создание репо → загрузка файлов сайта →
       включение GitHub Pages → живая ссылка.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const API = "https://api.github.com";
  const LS_TOKEN = "gh_pub_token";

  async function ghFetch(path, opts = {}, token) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      let msg = res.status + " " + res.statusText;
      try { msg = (await res.json()).message || msg; } catch (e) { /* noop */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* ---------- сбор файлов сайта ---------- */
  const SRC_FILES = [
    "index.html", "README.md", ".gitignore",
    "css/style.css",
    "js/utils.js", "js/simulation.js", "js/charts.js", "js/dashboard.js", "js/publish.js",
    "studio/index.html", "studio/css/studio.css",
    "studio/js/store.js", "studio/js/zip.js", "studio/js/publish.js", "studio/js/studio.js",
    "js/nettest.js",
  ];

  // Этап 1: готовые <script type="text/plain" id="src:path"> блоки в DOM
  function collectStage1() {
    const out = {};
    for (const f of SRC_FILES) {
      const el = document.getElementById("src:" + f);
      if (el) out[f] = el.textContent;
    }
    return out;
  }

  // Этап 2: fetch (когда сайт открыт по http/https)
  async function collectViaFetch() {
    const out = {};
    for (const f of SRC_FILES) {
      try {
        const r = await fetch("./" + f, { cache: "no-store" });
        if (r.ok) out[f] = await r.text();
      } catch (e) { /* файл опционален */ }
    }
    return out;
  }

  // Этап 3 (fallback для file://): сериализация текущего DOM
  function collectFromDom() {
    const doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll("script[type='text/plain']").forEach((n) => n.remove());
    return { "index.html": "<!doctype html>\n" + doc.outerHTML };
  }

  async function collectFiles(onStep) {
    let files = collectStage1();
    if (Object.keys(files).length < 3) files = await collectViaFetch();
    if (Object.keys(files).length < 3) files = collectFromDom();
    onStep("Файлов к публикации: " + Object.keys(files).length);
    return Object.entries(files).map(([path, content]) => ({ path, content }));
  }

  /* ---------- прогресс ---------- */
  function setProgress(pct) {
    const bar = $("#pubBar") || $("#stProgFill");
    if (bar) bar.style.width = Math.round(pct) + "%";
  }
  function logLine(msg) {
    const log = $("#pubLog");
    if (!log) return;
    const li = document.createElement("li");
    li.textContent = msg;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  /* ---------- конвейер ---------- */
  async function runPublish(token, repoNameInput) {
    logLine("1/5 Проверка API-ключа…");
    const me = await ghFetch("/user", {}, token);
    if (!me || !me.login) throw new Error("Токен не распознан GitHub");
    logLine("1/5 ✔ владелец определён автоматически: @" + me.login);

    const repoName = (repoNameInput || "").trim() || "syntheco-console-" + Date.now().toString(36);
    logLine("2/5 Репозиторий: " + repoName);

    let repo;
    try {
      repo = await ghFetch("/repos/" + me.login + "/" + repoName, {}, token);
      logLine("2/5 ✔ репозиторий существует — обновляем файлы");
    } catch (e) {
      if (e.status === 404) {
        repo = await ghFetch("/user/repos", { method: "POST", body: JSON.stringify({ name: repoName, public: true, auto_init: false }) }, token);
        logLine("2/5 ✔ создан публичный репозиторий");
      } else if (e.status === 401) throw new Error("Ключ недействителен (401). Выпустите новый с правами Contents: Read and Write.");
      else if (e.status === 403) throw new Error("Доступ запрещён (403). Проверьте права ключа.");
      else throw e;
    }

    const files = await collectFiles(logLine);
    logLine("3/5 Загрузка " + files.length + " файлов…");
    let i = 0;
    for (const f of files) {
      const enc = "/repos/" + me.login + "/" + repoName + "/contents/" + encodeURIComponent(f.path).replace(/%2F/g, "/");
      let sha = null;
      try { const cur = await ghFetch(enc, {}, token); sha = cur && cur.sha; } catch (e) { if (e.status !== 404) throw e; }
      await ghFetch(enc, {
        method: "PUT",
        body: JSON.stringify({ message: "publish: " + f.path, content: b64(f.content), ...(sha ? { sha } : {}) }),
      }, token);
      i++; setProgress(10 + (i / files.length) * 60);
      if (i % 3 === 0 || i === files.length) logLine("3/5 ✔ " + i + "/" + files.length + " — " + f.path);
    }

    logLine("4/5 Включение GitHub Pages…");
    try {
      await ghFetch("/repos/" + me.login + "/" + repoName + "/pages", { method: "POST", body: JSON.stringify({ source: { branch: "main", path: "/" } }) }, token);
    } catch (e) {
      if (e.status === 409) await ghFetch("/repos/" + me.login + "/" + repoName + "/pages", { method: "PUT", body: JSON.stringify({ source: { branch: "main", path: "/" } }) }, token);
      else throw e;
    }
    logLine("4/5 ✔ Pages включены");

    setProgress(80);
    logLine("5/5 Ожидание сборки (до 40 c)…");
    let url = "https://" + me.login.toLowerCase() + ".github.io/" + repoName + "/";
    for (let k = 0; k < 20; k++) {
      try {
        const st = await ghFetch("/repos/" + me.login + "/" + repoName + "/pages", {}, token);
        if (st && st.status !== "building" && st.html_url) { url = st.html_url; break; }
      } catch (e) { break; }
      await sleep(2000);
    }
    setProgress(100);
    logLine("5/5 ✔ ГОТОВО! Сайт: " + url);
    return { url, repoUrl: repo.html_url, owner: me.login, repoName };
  }

  /* ---------- привязка кнопки ---------- */
  function bind() {
    const btn = $("#btnPublish");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const saved = localStorage.getItem(LS_TOKEN) || "";
      const sharedT = localStorage.getItem("gh_tools_token") || "";
      modal(`
        <h3 style="margin-top:0">Публикация на GitHub Pages</h3>
        <p class="hint">Нужен <b>только API-ключ</b> — владелец и репозиторий определяются автоматически.</p>
        <label>API-ключ (токен GitHub, права: Contents RW + Administration RW)
          <input id="pubToken" type="password" placeholder="ghp_… или github_pat_…" value="${(saved || sharedT).replace(/"/g, "&quot;")}" autocomplete="off" />
        </label>
        <details><summary class="hint">необязательно: своё имя репозитория</summary>
          <input id="pubRepoName" placeholder="авто: syntheco-console-&lt;дата&gt;" /></details>
        <label class="chk"><input id="pubRemember" type="checkbox" ${saved ? "checked" : ""}/> запомнить ключ в этом браузере</label>
        <div class="pub-track"><div class="pub-fill" id="pubBar"></div></div>
        <ul class="pub-log mono" id="pubLog"></ul>`,
        "▶ Опубликовать").then(async (ok) => {
          if (!ok) return;
          const token = ($("#pubToken").value || "").trim();
          if (!token) { toast("Введите API-ключ", "warn"); return; }
          if ($("#pubRemember").checked) localStorage.setItem(LS_TOKEN, token);
          else localStorage.removeItem(LS_TOKEN);
          try {
            const res = await runPublish(token, $("#pubRepoName").value);
            toast("Опубликовано: " + res.url, "ok", 8000);
            const link = $("#modalLink");
            if (link) { link.href = res.url; link.hidden = false; }
          } catch (e) {
            console.error(e);
            logLine("✖ ОШИБКА: " + e.message);
            toast("Ошибка публикации: " + e.message, "error", 7000);
          }
        });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
`````````

## Файл: js/simulation.js (346 строк)

`````````javascript
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
`````````

## Файл: js/utils.js (178 строк)

`````````javascript
/* ═══════════ utils.js — general helpers, no dependencies ═══════════ */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Seeded PRNG (mulberry32) — deterministic per session seed */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RNG = makeRng(Date.now() % 2147483647);

const rnd = (min, max) => min + RNG() * (max - min);
const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
const pick = (arr) => arr[Math.floor(RNG() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Gaussian noise via Box–Muller */
function gauss(mean = 0, sd = 1) {
  const u = 1 - RNG(), v = RNG();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const fmt = {
  num: (v, d = 1) => Number(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }),
  int: (v) => Math.round(Number(v)).toLocaleString("ru-RU"),
  money: (v) => {
    v = Math.round(v);
    if (Math.abs(v) >= 1e9) return fmt.num(v / 1e9, 2) + " млрд ₽";
    if (Math.abs(v) >= 1e6) return fmt.num(v / 1e6, 2) + " млн ₽";
    if (Math.abs(v) >= 1e3) return fmt.num(v / 1e3, 1) + " тыс ₽";
    return fmt.int(v) + " ₽";
  },
  pct: (v, d = 1) => fmt.num(v, d) + "%",
  time: (ts) => new Date(ts).toLocaleTimeString("ru-RU", { hour12: false }),
  date: (ts) => new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }),
  dt: (ts) => fmt.date(ts) + " " + fmt.time(ts),
  hms: (sec) => {
    sec = Math.floor(sec);
    const h = String(Math.floor(sec / 3600)).padStart(2, "0");
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  },
};

/** Statistics over an array of numbers */
function stats(arr) {
  if (!arr.length) return { min: 0, max: 0, avg: 0, std: 0, n: 0, trend: 0 };
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of arr) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  const avg = sum / arr.length;
  let sq = 0;
  for (const v of arr) sq += (v - avg) ** 2;
  const std = Math.sqrt(sq / arr.length);
  // linear-regression slope over last third vs first third
  const k = Math.max(2, Math.floor(arr.length / 3));
  const head = arr.slice(0, k), tail = arr.slice(-k);
  const hAvg = head.reduce((a, b) => a + b, 0) / k;
  const tAvg = tail.reduce((a, b) => a + b, 0) / k;
  return { min, max, avg, std, n: arr.length, trend: tAvg - hAvg };
}

/** EMA smoothing */
function ema(prev, next, alpha = 0.25) {
  return prev == null ? next : alpha * next + (1 - alpha) * prev;
}

/** localStorage JSON wrapper with safe fallback */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("sintheco:" + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("sintheco:" + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  clearAll() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith("sintheco:")).forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
  },
};

/** Debounce helper */
function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Create toast notification */
function toast(msg, kind = "", ttl = 3800) {
  const host = $("#toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  }, ttl);
  while (host.children.length > 5) host.firstChild.remove();
}

/** Modal confirm dialog; returns Promise<boolean> */
function modal(title, bodyHtml, okLabel = "Подтвердить") {
  return new Promise((resolve) => {
    const back = $("#modalBackdrop");
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHtml;
    $("#modalOk").textContent = okLabel;
    back.hidden = false;
    const close = (val) => {
      back.hidden = true;
      $("#modalOk").onclick = $("#modalCancel").onclick = $("#modalX").onclick = null;
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };
    $("#modalOk").onclick = () => close(true);
    $("#modalCancel").onclick = () => close(false);
    $("#modalX").onclick = () => close(false);
    const onKey = (e) => { if (e.key === "Escape") close(false); };
    document.addEventListener("keydown", onKey);
  });
}

/** Download text content as file */
function download(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Short beep via WebAudio (guarded) */
let _audioCtx = null;
function beep(freq = 880, dur = 0.12, vol = 0.05) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.type = "triangle"; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + dur);
    osc.connect(gain).connect(_audioCtx.destination);
    osc.start(); osc.stop(_audioCtx.currentTime + dur);
  } catch { /* audio unavailable */ }
}

/** HiDPI canvas setup: returns ctx scaled to devicePixelRatio */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width || canvas.width));
  const h = Math.max(1, Math.floor((canvas.getAttribute("height") ? +canvas.getAttribute("height") : rect.height) || canvas.height));
  const useH = rect.height && Math.abs(rect.height - h) > 2 ? rect.height : h;
  canvas.width = w * dpr;
  canvas.height = useH * dpr;
  canvas.style.height = useH + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: useH };
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
`````````

## Файл: studio/css/studio.css (83 строк)

`````````css
/* ══════════ WEBSTUDIO · стили (дополнение к style.css) ══════════ */

.studio-body { min-height: 100vh; }

.screen { display: none; }
.screen.active { display: block; animation: fadeUp .25s ease; }

.studio-main { max-width: 1400px; margin: 0 auto; padding: 1.2rem clamp(.8rem, 3vw, 2rem); }

/* ── кнопка сервера ── */
#btnServer.is-live { border-color: var(--ok); color: var(--ok); box-shadow: 0 0 14px rgba(56,232,150,.25); }
#btnServer:not(.is-live) .pulse-dot { background: #6b7a94; animation: none; }

/* ── экран проектов ── */
.projects-head h1 { margin: .4rem 0 .2rem; font-size: 1.6rem; }
.row-btns { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: .8rem; }

.project-grid {
  display: grid; gap: 1rem; margin: 1.2rem 0;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.proj-card header { display: flex; justify-content: space-between; align-items: baseline; gap: .6rem; }
.proj-card h3 { margin: 0 0 .3rem; font-size: 1.05rem; }
.proj-card .dim { color: var(--muted, #8fa1bd); font-size: .78rem; }
.badge-count { font-size: .72rem; background: rgba(56,232,150,.12); color: var(--ok); border-radius: 20px; padding: .15rem .55rem; }
.proj-card .row-btns { margin-top: .7rem; }

.empty { text-align: center; padding: 2.5rem 1rem; }

.storage-bar { margin-top: 1.4rem; padding: 1rem 1.2rem; }
.storage-bar h3 { margin: 0 0 .4rem; font-size: .95rem; }
#storageInfo { font-size: .8rem; color: var(--muted, #8fa1bd); margin-bottom: .5rem; }

/* ── редактор ── */
.editor-wrap {
  display: grid; gap: 1rem; height: calc(100vh - 150px); min-height: 480px;
  grid-template-columns: 260px minmax(0,1fr) minmax(0,1.1fr);
}
@media (max-width: 1100px) { .editor-wrap { grid-template-columns: 220px minmax(0,1fr); } .preview-pane { grid-column: 1 / -1; height: 340px; } }
@media (max-width: 760px)  { .editor-wrap { grid-template-columns: 1fr; height: auto; } .filetree,.code-pane,.preview-pane { height: auto; } #codeArea { min-height: 320px; } #previewFrame { height: 300px; } }

.filetree, .code-pane, .preview-pane { display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

.tree-tools { display: flex; gap: .4rem; padding: .5rem .7rem; flex-wrap: wrap; }
.tree { list-style: none; margin: 0; padding: 0 .4rem .6rem; overflow-y: auto; flex: 1; }
.tree-item {
  display: flex; align-items: center; gap: .45rem; padding: .32rem .5rem; border-radius: 8px;
  cursor: pointer; font-size: .84rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tree-item:hover { background: rgba(120,160,255,.08); }
.tree-item.active { background: rgba(56,232,150,.12); color: var(--ok); }
.tree-item em.dim { margin-left: auto; font-style: normal; font-size: .7rem; opacity: .6; }
.tree-foot { padding: .5rem .8rem; font-size: .74rem; color: var(--muted,#8fa1bd); border-top: 1px solid rgba(120,160,255,.12); }

#codeArea {
  flex: 1; width: 100%; resize: none; border: none; outline: none;
  background: transparent; color: #dce6f7; padding: .9rem 1rem;
  font-size: .84rem; line-height: 1.55; tab-size: 2;
}
#codeArea::placeholder { color: #55648010; }

#previewFrame { flex: 1; width: 100%; border: none; background: #fff; border-radius: 0 0 14px 14px; }

/* ── модалка публикации ── */
.modal label { display: block; margin: .55rem 0; font-size: .85rem; color: var(--muted,#8fa1bd); }
.input {
  width: 100%; margin-top: .3rem; padding: .55rem .7rem; border-radius: 10px;
  border: 1px solid rgba(120,160,255,.25); background: #0c1424; color: #e8ecf5; font: inherit;
}
.input:focus { outline: none; border-color: var(--ok); }
.pub-adv { display: flex; gap: .5rem; align-items: center; }
.pub-progress { height: 6px; border-radius: 4px; background: rgba(120,160,255,.12); margin: .7rem 0; overflow: hidden; }
.pub-progress i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, var(--ok), #6ee7ff); transition: width .3s ease; }
.pub-log {
  list-style: none; margin: 0; padding: .5rem .6rem; max-height: 150px; overflow-y: auto;
  background: #0a111f; border-radius: 10px; font-size: .72rem; color: #9fb4d8;
}
.pub-log li { padding: .12rem 0; }
.pub-log li:first-child { color: var(--ok); }

.btn:disabled { opacity: .45; cursor: not-allowed; }

@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
`````````

## Файл: studio/index.html (120 строк)

`````````html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#070b12" />
  <title>WebStudio — виртуальный сервер для создания сайтов</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%230b1524'/><path d='M18 22 L8 32 L18 42' stroke='%2338e896' stroke-width='6' fill='none' stroke-linecap='round' stroke-linejoin='round'/><path d='M46 22 L56 32 L46 42' stroke='%23ffb020' stroke-width='6' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Manrope:wght@400;600;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../css/style.css" />
  <link rel="stylesheet" href="./css/studio.css" />
</head>
<body class="studio-body">
  <div class="bg-grid" aria-hidden="true"></div>

  <header class="topbar">
    <div class="brand">
      <svg viewBox="0 0 64 64" class="brand-logo" aria-hidden="true">
        <path d="M18 22 L8 32 L18 42" stroke="var(--ok)" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M46 22 L56 32 L46 42" stroke="var(--warn)" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>
        <b>WEBSTUDIO</b>
        <small>Виртуальный сервер разработки · v1.0</small>
      </div>
    </div>
    <nav class="tabs" role="tablist">
      <button class="tab active" id="tabProjects">📁 Проекты</button>
      <button class="tab" id="tabEditor" disabled>⌨ Редактор</button>
    </nav>
    <div class="top-actions">
      <!-- ГЛАВНАЯ КНОПКА: требует только API-ключ -->
      <button class="btn btn-gh" id="btnPublishTop" title="Опубликовать открытый проект на GitHub Pages — нужен только API-ключ" disabled>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-.99.08-2.07 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.08.16 1.87.08 2.07.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        Опубликовать на GitHub
      </button>
      <!-- Виртуальный сервер: включите, чтобы всё сохранялось в базе данных -->
      <button class="btn btn-live" id="btnServer" title="Включить локальный сервер сохранения (IndexedDB)">
        <span class="pulse-dot"></span><span id="serverLabel">СЕРВЕР ВЫКЛ</span>
      </button>
    </div>
  </header>

  <main class="studio-main">
    <!-- ═══ ЭКРАН: СПИСОК ПРОЕКТОВ ═══ -->
    <section class="screen active" id="screenProjects">
      <div class="projects-head">
        <h1>Ваши проекты</h1>
        <p class="hint" id="dbHint">База данных выключена. Чтобы проекты сохранялись автоматически, включите <b>сервер</b> (кнопка справа вверху).</p>
        <div class="row-btns">
          <button class="btn btn-primary" id="btnNewProject">＋ Создать проект</button>
          <button class="btn btn-ghost" id="btnImportDump">Импорт дампа (.json)</button>
          <input type="file" id="fileImport" accept=".json,application/json" hidden />
        </div>
      </div>
      <div class="project-grid" id="projectGrid"><!-- карточки проектов --></div>
      <div class="storage-bar card">
        <h3>Хранилище</h3>
        <div class="mono" id="storageInfo">—</div>
        <div class="progress"><i id="storageFill" style="width:0%"></i></div>
      </div>
    </section>

    <!-- ═══ ЭКРАН: РЕДАКТОР ═══ -->
    <section class="screen" id="screenEditor">
      <div class="editor-wrap">
        <aside class="filetree card">
          <header class="card-head">
            <h2 id="projTitle" title="">Проект</h2>
          </header>
          <div class="tree-tools">
            <button class="btn btn-small" id="btnNewFile" title="Новый файл (можно путь с папкой: css/main.css)">＋ файл</button>
            <button class="btn btn-small" id="btnZip" title="Скачать весь проект архивом .zip">ZIP ↓</button>
            <button class="btn btn-small" id="btnSaveAll" title="Принудительно сохранить всё в БД">💾</button>
          </div>
          <ul class="tree" id="fileTree"></ul>
          <footer class="tree-foot mono" id="saveState">готово</footer>
        </aside>

        <section class="code-pane card">
          <header class="card-head">
            <h2 class="mono" id="curFileName">— выберите файл —</h2>
          </header>
          <textarea id="codeArea" class="mono" spellcheck="false" placeholder="Выберите файл слева или создайте новый…"></textarea>
        </section>

        <section class="preview-pane card">
          <header class="card-head">
            <h2>Предпросмотр</h2>
            <button class="btn btn-small btn-primary" id="btnRun">▶ Запустить</button>
          </header>
          <iframe id="previewFrame" title="Предпросмотр проекта" sandbox="allow-scripts allow-modals allow-forms"></iframe>
        </section>
      </div>
    </section>
  </main>

  <!-- модалки и тосты — общие с dashboard-стилями -->
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <div class="modal-backdrop" id="modalBackdrop" hidden>
    <div class="modal card" role="dialog" aria-modal="true">
      <header class="card-head"><h2 id="modalTitle">Заголовок</h2>
        <button class="modal-x" id="modalX" aria-label="Закрыть">✕</button></header>
      <div class="modal-body" id="modalBody"></div>
      <footer class="modal-foot">
        <button class="btn btn-ghost" id="modalCancel">Отмена</button>
        <button class="btn btn-primary" id="modalOk">OK</button>
        <a class="btn btn-ghost" id="modalLink" hidden target="_blank" rel="noopener">🔗 Открыть сайт</a>
      </footer>
    </div>
  </div>

  <script src="../js/utils.js"></script>
  <script src="./js/store.js"></script>
  <script src="./js/zip.js"></script>
  <script src="./js/publish.js"></script>
  <script src="./js/studio.js"></script>
</body>
</html>
`````````

## Файл: studio/js/publish.js (117 строк)

`````````javascript
/* ══════════ WEBSTUDIO · GitHub Publisher ══════════
   Публикация проекта на GitHub Pages. Требует ТОЛЬКО API-ключ (токен):
   логин/владелец и имя репозитория определяются автоматически.
     Publisher.token        — localStorage 'ws_gh_token' (только для удобства, не обязателен)
     Publisher.publish(projectObj, opts, onStep) -> {url, repo}
       projectObj = {name, files:[{path,content}]}
       opts = { token?, repoName?, update? }
     Publisher.checkToken(token) -> {login}
*/
(function () {
  'use strict';

  const LS_TOKEN = 'ws_gh_token';

  async function gh(path, token, init = {}) {
    const res = await fetch('https://api.github.com' + path, {
      method: init.method || 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* html error */ }
    if (!res.ok) {
      const msg = (json && json.message) || text.slice(0, 120) || ('HTTP ' + res.status);
      const err = new Error(msg + ' (HTTP ' + res.status + ')');
      err.status = res.status; err.json = json;
      throw err;
    }
    return json;
  }

  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'webstudio-site';
  }

  async function checkToken(token) {
    const u = await gh('/user', token);
    if (!u || !u.login) throw new Error('Некорректный токен');
    return { login: u.login, id: u.id };
  }

  /* основной конвейер */
  async function publish(project, opts, onStep) {
    const step = onStep || (() => {});
    const token = (opts.token || localStorage.getItem(LS_TOKEN) || '').trim();
    if (!token) throw new Error('Нужен API-ключ (GitHub Personal Access Token)');

    step('1/5 Проверка токена…');
    const me = await checkToken(token);
    step('1/5 ✔ владелец: @' + me.login);

    const repoName = (opts.repoName || '').trim() || slugify(project.name);
    step('2/5 Создание репозитория «' + repoName + '»…');
    let repo;
    try {
      repo = await gh('/repos/' + me.login + '/' + repoName, token);
      step('2/5 ✔ репозиторий уже существует — обновляем файлы');
    } catch (e) {
      if (e.status === 404) {
        repo = await gh('/user/repos', token, { method: 'POST', body: { name: repoName, public: true, auto_init: false, description: 'Published from WebStudio' } });
        step('2/5 ✔ создан публичный репозиторий');
      } else if (e.status === 401) { throw new Error('Токен недействителен (401). Выпустите новый с правами Contents: Read/Write.'); }
      else if (e.status === 403) { throw new Error('Отказано в доступе (403). Проверьте scopes токена.'); }
      else throw e;
    }

    step('3/5 Загрузка файлов (' + project.files.length + ')…');
    let done = 0;
    for (const f of project.files) {
      const path = encodeURIComponent(f.path);
      let sha = null;
      try { const cur = await gh('/repos/' + me.login + '/' + repoName + '/contents/' + path, token); sha = cur && cur.sha; } catch (e) { if (e.status !== 404) throw e; }
      await gh('/repos/' + me.login + '/' + repoName + '/contents/' + path, token, {
        method: 'PUT',
        body: { message: 'WebStudio: ' + (sha ? 'update ' : 'add ') + f.path, content: b64(f.content), ...(sha ? { sha } : {}) },
      });
      done++;
      step('3/5 Файлы: ' + done + '/' + project.files.length + ' — ' + f.path);
    }

    step('4/5 Включение GitHub Pages…');
    try {
      await gh('/repos/' + me.login + '/' + repoName + '/pages', token, { method: 'POST', body: { source: { branch: 'main', path: '/' } } });
    } catch (e) {
      if (e.status === 409) { await gh('/repos/' + me.login + '/' + repoName + '/pages', token, { method: 'PUT', body: { source: { branch: 'main', path: '/' } } }); }
      else if (e.status === 404) { /* ещё нет коммита? не должно случиться */ throw e; }
      else throw e;
    }
    step('4/5 ✔ Pages включены');

    step('5/5 Ожидание сборки…');
    let url = 'https://' + me.login.toLowerCase() + '.github.io/' + repoName + '/';
    for (let i = 0; i < 20; i++) {
      try {
        const st = await gh('/repos/' + me.login + '/' + repoName + '/pages', token);
        if (st && st.status && st.status !== 'building' && st.html_url) { url = st.html_url; break; }
      } catch (e) { break; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    step('5/5 ✔ Готово!');
    return { url, repo: repo.html_url, owner: me.login, repoName };
  }

  window.Publisher = { publish, checkToken, slugify, LS_TOKEN };
})();
`````````

## Файл: studio/js/store.js (265 строк)

`````````javascript
/* ══════════ WEBSTUDIO · STORE ══════════
   Виртуальная файловая система проектов поверх IndexedDB (с fallback на localStorage).
   API (все методы возвращают Promise):
     Store.init()                      — открыть БД
     Store.listProjects()              — [{id,name,createdAt,updatedAt,fileCount,sizeBytes}]
     Store.createProject(name)         — {id,...}
     Store.renameProject(id,name)
     Store.deleteProject(id)
     Store.listFiles(pid)              — [{path,size,updatedAt}] отсортированные по папкам
     Store.readFile(pid,path)          — {path,content,updatedAt} | null
     Store.writeFile(pid,path,content)
     Store.deleteFile(pid,path)
     Store.moveFile(pid,from,to)
     Store.exportProject(pid)          — {name, files:[{path,content}]}
     Store.importProject(obj)          — создаёт новый проект из дампа
     Store.stats()                     — {projects,bytes,quota}
     Store.on(event, cb)               — 'changed' при любой мутации
*/
(function () {
  'use strict';

  const DB_NAME = 'webstudio-db';
  const DB_VER = 1;
  const STORE = 'files_vfs'; // {pid, path, content, updatedAt}
  const LS_PREFIX = 'wsproj:';
  let db = null;
  let useIDB = true;
  const listeners = {};

  function emit(ev, data) { (listeners[ev] || []).forEach((cb) => { try { cb(data); } catch (e) { console.warn(e); } }); }

  /* ---------- low-level IDB helpers ---------- */
  function tx(storeName, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let out;
      try { out = fn(store); } catch (e) { t.abort(); return rej(e); }
      if (out && typeof out.then === 'function') { // request-obj with .result filled on complete
        t.oncomplete = () => res(out.result);
      } else {
        t.oncomplete = () => res(out);
      }
      t.onerror = t.onabort = () => rej(t.error || new Error('Транзакция отменена'));
    });
  }

  /* ---------- meta index (всегда в localStorage — маленький) ---------- */
  function getMetaList() {
    try { return JSON.parse(localStorage.getItem(LS_PREFIX + 'index') || '[]'); } catch (e) { return []; }
  }
  function setMetaList(list) {
    localStorage.setItem(LS_PREFIX + 'index', JSON.stringify(list));
  }
  function putMeta(meta) {
    const list = getMetaList().filter((m) => m.id !== meta.id);
    list.push(meta); setMetaList(list);
  }
  function delMeta(id) { setMetaList(getMetaList().filter((m) => m.id !== id)); }

  function normPath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/').trim();
  }
  function projId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- init ---------- */
  async function init() {
    if (db) return true;
    try {
      if (!window.indexedDB) throw new Error('no indexedDB');
      const openReq = indexedDB.open(DB_NAME, DB_VER);
      openReq.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: ['pid', 'path'] });
          s.createIndex('by_pid', 'pid', { unique: false });
        }
      };
      await new Promise((res, rej) => {
        openReq.onsuccess = () => { db = openReq.result; res(); };
        openReq.onerror = () => rej(openReq.error || new Error('Не удалось открыть БД'));
        openReq.onblocked = () => rej(new Error('DB blocked'));
      });
      db.onversionchange = () => { db.close(); db = null; };
      useIDB = true;
    } catch (e) {
      console.warn('IndexedDB недоступен, режим localStorage:', e.message);
      useIDB = false;
    }
    return useIDB;
  }

  /* ---------- ls fallback storage ---------- */
  function lsKey(pid, path) { return LS_PREFIX + pid + ':' + path; }
  function lsList(pid) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX + pid + ':')) {
        const path = k.slice((LS_PREFIX + pid + ':').length);
        const c = localStorage.getItem(k) || '';
        out.push({ path, size: c.length, updatedAt: Date.now() });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /* ---------- projects ---------- */
  async function computeStats(pid) {
    const files = await listFiles(pid);
    return { fileCount: files.length, sizeBytes: files.reduce((s, f) => s + f.size, 0) };
  }

  async function listProjects() {
    const metas = getMetaList().slice().sort((a, b) => b.updatedAt - a.updatedAt);
    for (const m of metas) { Object.assign(m, await computeStats(m.id)); }
    return metas;
  }

  async function createProject(name) {
    name = String(name || '').trim() || 'Новый проект';
    const meta = { id: projId(), name, createdAt: Date.now(), updatedAt: Date.now() };
    putMeta(meta);
    await writeFile(meta.id, 'index.html', DEFAULT_HTML(name));
    await writeFile(meta.id, 'css/style.css', DEFAULT_CSS);
    await writeFile(meta.id, 'js/app.js', DEFAULT_JS);
    await writeFile(meta.id, 'README.md', '# ' + name + '\n\nСоздано в WebStudio.\n');
    emit('changed', { type: 'project-created', id: meta.id });
    return meta;
  }

  async function renameProject(id, name) {
    const list = getMetaList(); const m = list.find((x) => x.id === id);
    if (!m) throw new Error('Проект не найден');
    m.name = String(name || '').trim() || m.name; m.updatedAt = Date.now();
    setMetaList(list); emit('changed', { type: 'project-renamed', id });
    return m;
  }

  async function deleteProject(id) {
    if (useIDB && db) {
      await tx(STORE, 'readwrite', (s) => {
        const range = IDBKeyRange.bound([id, ''], [id, '\uffff']);
        s.delete(range);
      });
    } else {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX + id + ':')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    }
    delMeta(id); emit('changed', { type: 'project-deleted', id });
  }

  async function touchProject(pid) {
    const list = getMetaList(); const m = list.find((x) => x.id === pid);
    if (m) { m.updatedAt = Date.now(); setMetaList(list); }
  }

  /* ---------- files ---------- */
  async function listFiles(pid) {
    if (useIDB && db) {
      const rows = await tx(STORE, 'readonly', (s) => s.index('by_pid').getAll(IDBKeyRange.only(pid)));
      return (rows || []).map((r) => ({ path: r.path, size: (r.content || '').length, updatedAt: r.updatedAt }))
        .sort((a, b) => a.path.localeCompare(b.path));
    }
    return lsList(pid);
  }

  async function readFile(pid, path) {
    path = normPath(path);
    if (useIDB && db) {
      const row = await tx(STORE, 'readonly', (s) => s.get([pid, path]));
      return row ? { path: row.path, content: row.content, updatedAt: row.updatedAt } : null;
    }
    const c = localStorage.getItem(lsKey(pid, path));
    return c === null ? null : { path, content: c, updatedAt: Date.now() };
  }

  async function writeFile(pid, path, content) {
    path = normPath(path);
    if (!path) throw new Error('Пустой путь файла');
    if (/[<>:"|?*]/.test(path.replace(/\//g, ''))) throw new Error('Недопустимые символы в имени файла');
    content = String(content == null ? '' : content);
    const now = Date.now();
    if (useIDB && db) {
      await tx(STORE, 'readwrite', (s) => s.put({ pid, path, content, updatedAt: now }));
    } else {
      try { localStorage.setItem(lsKey(pid, path), content); }
      catch (e) { throw new Error('Хранилище браузера переполнено (localStorage). Удалите лишние файлы/проекты.'); }
    }
    await touchProject(pid);
    emit('changed', { type: 'file-written', pid, path });
  }

  async function deleteFile(pid, path) {
    path = normPath(path);
    if (useIDB && db) {
      await tx(STORE, 'readwrite', (s) => {
        s.delete([pid, path]);
        s.delete(IDBKeyRange.bound([pid, path + '/'], [pid, path + '/\uffff']));
      });
    } else {
      lsList(pid).filter((f) => f.path === path || f.path.startsWith(path + '/'))
        .forEach((f) => localStorage.removeItem(lsKey(pid, f.path)));
    }
    await touchProject(pid);
    emit('changed', { type: 'file-deleted', pid, path });
  }

  async function moveFile(pid, from, to) {
    from = normPath(from); to = normPath(to);
    if (from === to) return;
    const f = await readFile(pid, from);
    if (!f) throw new Error('Источник не найден: ' + from);
    await writeFile(pid, to, f.content);
    await deleteFile(pid, from);
  }

  async function exportProject(pid) {
    const metas = getMetaList(); const m = metas.find((x) => x.id === pid);
    if (!m) throw new Error('Проект не найден');
    const files = [];
    for (const f of await listFiles(pid)) {
      const r = await readFile(pid, f.path);
      if (r) files.push({ path: r.path, content: r.content });
    }
    return { webstudioExport: 1, name: m.name, exportedAt: new Date().toISOString(), files };
  }

  async function importProject(obj) {
    if (!obj || !obj.webstudioExport || !Array.isArray(obj.files)) throw new Error('Неверный формат дампа (.webstudio.json)');
    const meta = await createProject(obj.name || 'Импортированный');
    for (const f of obj.files) await writeFile(meta.id, f.path, f.content);
    return meta;
  }

  async function stats() {
    const metas = getMetaList();
    let bytes = 0;
    for (const m of metas) bytes += (await computeStats(m.id)).sizeBytes;
    let quota = null;
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try { const e = await navigator.storage.estimate(); quota = e.quota; } catch (e) { /* noop */ }
    }
    return { projects: metas.length, bytes, quota, backend: useIDB ? 'IndexedDB' : 'localStorage' };
  }

  /* ---------- templates ---------- */
  function DEFAULT_HTML(name) {
    return '<!doctype html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>' + name.replace(/[<>&]/g, '') + '</title>\n  <link rel="stylesheet" href="css/style.css" />\n</head>\n<body>\n  <main class="hero">\n    <h1>' + name.replace(/[<>&]/g, '') + '</h1>\n    <p>Проект создан в <b>WebStudio</b>. Редактируйте файлы слева, предпросмотр справа.</p>\n    <button id="ping">Нажми меня</button>\n  </main>\n  <script src="js/app.js"><\/script>\n</body>\n</html>\n';
  }
  const DEFAULT_CSS = ':root { color-scheme: dark; }\n* { box-sizing: border-box; }\nbody {\n  margin: 0; min-height: 100vh; display: grid; place-items: center;\n  font-family: system-ui, sans-serif; background: #0b1020; color: #e8ecf5;\n}\n.hero { text-align: center; padding: 2rem; }\nh1 { font-size: clamp(1.8rem, 5vw, 3rem); margin: 0 0 .5rem; }\nbutton {\n  margin-top: 1rem; padding: .6rem 1.4rem; border-radius: 10px; border: 1px solid #3a4c7a;\n  background: #16224a; color: #9fc2ff; font-size: 1rem; cursor: pointer;\n}\nbutton:hover { background: #1d2f66; }\n';
  const DEFAULT_JS = "document.getElementById('ping').addEventListener('click', () => {\n  alert('Работает! Проект живёт в вашем браузере.');\n});\n";

  window.Store = {
    init, listProjects, createProject, renameProject, deleteProject,
    listFiles, readFile, writeFile, deleteFile, moveFile,
    exportProject, importProject, stats,
    on: (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); },
    normPath,
  };
})();
`````````

## Файл: studio/js/studio.js (343 строк)

`````````javascript
/* ══════════ WEBSTUDIO · UI-логика ══════════
   Экраны: список проектов ↔ редактор. Виртуальный сервер = IndexedDB (Store).
   Кнопка «Опубликовать на GitHub» требует только API-ключ: владелец и имя
   репозитория определяются автоматически из токена и названия проекта.
*/
(function () {
  'use strict';

  const LS_SERVER = 'ws_server_on';
  const state = {
    serverOn: localStorage.getItem(LS_SERVER) === '1',
    pid: null,            // открытый проект
    curFile: null,        // текущий путь в редакторе
    dirty: false,
    files: [],            // кэш listFiles текущего проекта
  };

  /* ---------- элементы ---------- */
  const $id = (x) => document.getElementById(x);
  const el = {
    btnServer: $id('btnServer'), serverLabel: $id('serverLabel'), dbHint: $id('dbHint'),
    tabProjects: $id('tabProjects'), tabEditor: $id('tabEditor'),
    screenProjects: $id('screenProjects'), screenEditor: $id('screenEditor'),
    btnPublishTop: $id('btnPublishTop'),
    projectGrid: $id('projectGrid'), storageInfo: $id('storageInfo'), storageFill: $id('storageFill'),
    btnNewProject: $id('btnNewProject'), btnImportDump: $id('btnImportDump'), fileImport: $id('fileImport'),
    projTitle: $id('projTitle'), fileTree: $id('fileTree'), saveState: $id('saveState'),
    btnNewFile: $id('btnNewFile'), btnZip: $id('btnZip'), btnSaveAll: $id('btnSaveAll'),
    curFileName: $id('curFileName'), codeArea: $id('codeArea'),
    btnRun: $id('btnRun'), previewFrame: $id('previewFrame'),
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtBytes(b) {
    if (b < 1024) return b + ' Б';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' КБ';
    return (b / 1048576).toFixed(2) + ' МБ';
  }

  /* ---------- сервер (БД) ---------- */
  async function applyServer(on) {
    state.serverOn = !!on;
    localStorage.setItem(LS_SERVER, on ? '1' : '0');
    el.btnServer.classList.toggle('is-live', on);
    el.serverLabel.textContent = on ? 'СЕРВЕР ВКЛ · БД' : 'СЕРВЕР ВЫКЛ';
    el.dbHint.innerHTML = on
      ? '✅ Сервер сохранения включён: все проекты и файлы автоматически пишутся в локальную базу данных (IndexedDB).'
      : '⛔ База данных выключена. Изменения не сохраняются! Чтобы всё сохранялось, включите <b>сервер</b> (кнопка справа вверху).';
    if (on) await Store.init();
    await refreshProjects();
  }

  /* ---------- экраны ---------- */
  function showScreen(name) {
    const isEd = name === 'editor';
    el.screenProjects.classList.toggle('active', !isEd);
    el.screenEditor.classList.toggle('active', isEd);
    el.tabProjects.classList.toggle('active', !isEd);
    el.tabEditor.classList.toggle('active', isEd);
  }

  /* ---------- список проектов ---------- */
  async function refreshProjects() {
    let metas = [];
    try { metas = await Store.listProjects(); } catch (e) { console.warn(e); }
    if (!metas.length) {
      el.projectGrid.innerHTML = '<div class="empty card"><h3>Пока пусто</h3><p class="hint">Нажмите «＋ Создать проект», чтобы открыть новую виртуальную файловую систему.</p></div>';
    } else {
      el.projectGrid.innerHTML = metas.map((m) => `
        <article class="proj-card card" data-pid="${esc(m.id)}">
          <header><h3>${esc(m.name)}</h3>
            <span class="badge-count mono">${m.fileCount} ф.</span></header>
          <p class="mono dim">изменён ${new Date(m.updatedAt).toLocaleString('ru-RU')} · ${fmtBytes(m.sizeBytes)}</p>
          <div class="row-btns">
            <button class="btn btn-primary btn-small" data-act="open">Открыть</button>
            <button class="btn btn-ghost btn-small" data-act="zip">ZIP ↓</button>
            <button class="btn btn-gh btn-small" data-act="publish">GitHub</button>
            <button class="btn btn-ghost btn-small" data-act="rename">✎</button>
            <button class="btn btn-danger btn-small" data-act="del">🗑</button>
          </div>
        </article>`).join('');
    }
    try {
      const st = await Store.stats();
      el.storageInfo.textContent = `бэкенд: ${st.backend} · проектов: ${st.projects} · занято: ${fmtBytes(st.bytes)}` + (st.quota ? ` · квота: ${fmtBytes(st.quota)}` : '');
      el.storageFill.style.width = st.quota ? Math.min(100, (st.bytes / st.quota) * 100).toFixed(2) + '%' : '0%';
    } catch (e) { /* noop */ }
  }

  async function exportProjectFiles(pid) {
    return Store.exportProject(pid); // {name, files:[{path,content}]}
  }

  async function zipProject(pid) {
    const proj = await exportProjectFiles(pid);
    const z = new ZipWriter();
    for (const f of proj.files) z.add(f.path, f.content);
    const bytes = z.finish();
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = Publisher.slugify(proj.name) + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Архив ' + proj.files.length + ' файлов скачан', 'ok');
  }

  /* ---------- публикация: ТОЛЬКО API-ключ ---------- */
  async function publishProject(pid) {
    if (!state.serverOn) { toast('Сначала включите сервер — нет доступа к базе данных', 'error'); return; }
    const proj = await exportProjectFiles(pid);
    if (!proj.files.length) { toast('Проект пуст — нечего публиковать', 'warn'); return; }

    let savedToken = localStorage.getItem(Publisher.LS_TOKEN) || localStorage.getItem('gh_pub_token') || localStorage.getItem('gh_tools_token') || '';
    const ok = await modal('Опубликовать на GitHub', `
      <p class="hint">Репозиторий и владелец определяются <b>автоматически</b> по ключу. Нужен только API-ключ
      (<a href="https://github.com/settings/tokens" target="_blank" rel="noopener">Fine-grained с Contents:RW или classic scope <code>repo</code></a>).</p>
      <label>API-ключ (токен GitHub)
        <input type="password" id="pubToken" class="input" placeholder="ghp_… / github_pat_…" value="${esc(savedToken)}" autocomplete="off" />
      </label>
      <label class="pub-adv"><input type="checkbox" id="pubRemember" ${savedToken ? 'checked' : ''}/> запомнить ключ в этом браузере</label>
      <details><summary class="hint">необязательно: переименовать репозиторий</summary>
        <input id="pubRepo" class="input" placeholder="${esc(Publisher.slugify(proj.name))}" /></details>
      <div class="pub-progress" id="pubProg"><i></i></div>
      <ul class="pub-log mono" id="pubLog"></ul>`, '▶ Опубликовать');
    if (!ok) return;

    const tokenEl = $id('pubToken');
    const token = (tokenEl && tokenEl.value || '').trim();
    if (!token) { toast('Введите API-ключ', 'error'); return publishProject(pid); }
    if ($id('pubRemember') && $id('pubRemember').checked) localStorage.setItem(Publisher.LS_TOKEN, token);
    else localStorage.removeItem(Publisher.LS_TOKEN);

    const log = $id('pubLog');
    const bar = $id('pubProg');
    const fill = bar ? bar.querySelector('i') : null;
    const stepCb = (msg) => {
      if (!log) return;
      const li = document.createElement('li'); li.textContent = msg; log.appendChild(li);
      log.scrollTop = log.scrollHeight;
      const m = msg.match(/(\d+)\/(\d+)/); if (m) fill.style.width = (m[1] / m[2] * 100) + '%';
      else if (/Готово/.test(msg)) fill.style.width = '100%';
    };

    try {
      const res = await Publisher.publish(proj, { token, repoName: ($id('pubRepo') || {}).value }, stepCb);
      toast('Опубликовано! ' + res.url, 'ok');
      beep(1200, 0.15);
      const link = $id('modalLink');
      await modal('🎉 Сайт опубликован', `
        <p>Репозиторий: <a href="${esc(res.repo)}" target="_blank" rel="noopener">${esc(res.owner + '/' + res.repoName)}</a></p>
        <p class="hint">GitHub Pages собирается ~30–60 сек. Если страница ещё не открылась — подождите минуту.</p>
        <p><a href="${esc(res.url)}" target="_blank" rel="noopener"><code>${esc(res.url)}</code></a></p>`, 'Закрыть');
      if (link) { link.hidden = true; }
    } catch (e) {
      console.error(e);
      toast('Ошибка публикации: ' + e.message, 'error');
      alert('Не удалось опубликовать:\n' + e.message);
    }
  }

  /* ---------- редактор ---------- */
  async function openProject(pid) {
    if (!state.serverOn) { toast('Включите сервер, чтобы редактировать (иначе данные не сохранятся)', 'warn'); return; }
    state.pid = pid;
    await refreshTree();
    const metas = JSON.parse(localStorage.getItem('wsproj:index') || '[]');
    const m = metas.find((x) => x.id === pid);
    el.projTitle.textContent = m ? m.name : 'Проект';
    el.tabEditor.disabled = false;
    el.btnPublishTop.disabled = false;
    showScreen('editor');
    if (state.files.length) await openFile(state.files.some((f) => f.path === state.curFile) ? state.curFile : (pickDefault().path));
  }
  function pickDefault() {
    return state.files.find((f) => f.path === 'index.html') || state.files[0];
  }

  async function refreshTree() {
    state.files = await Store.listFiles(state.pid);
    el.fileTree.innerHTML = state.files.map((f) => `
      <li class="tree-item ${f.path === state.curFile ? 'active' : ''}" data-path="${esc(f.path)}">
        <span class="fi">${fileIcon(f.path)}</span> ${esc(f.path)} <em class="dim">${fmtBytes(f.size)}</em>
      </li>`).join('') || '<li class="dim hint">нет файлов</li>';
  }
  function fileIcon(p) {
    if (/\.html?$/i.test(p)) return '🌐';
    if (/\.css$/i.test(p)) return '🎨';
    if (/\.js$/i.test(p)) return '⚡';
    if (/\.json$/i.test(p)) return '🧾';
    if (/\.md$/i.test(p)) return '📝';
    return '📄';
  }

  async function openFile(path) {
    await flushIfDirty();
    state.curFile = path;
    const f = await Store.readFile(state.pid, path);
    el.curFileName.textContent = path;
    el.codeArea.value = f ? f.content : '';
    el.codeArea.disabled = false;
    state.dirty = false;
    el.saveState.textContent = 'файл загружен';
    refreshTree();
  }

  async function flushIfDirty() {
    if (state.dirty && state.curFile && state.pid) {
      await Store.writeFile(state.pid, state.curFile, el.codeArea.value);
      state.dirty = false;
      el.saveState.textContent = '💾 сохранено в БД ' + new Date().toLocaleTimeString('ru-RU');
    }
  }

  const autoSave = debounce(async () => {
    if (!state.serverOn) { el.saveState.textContent = '⛔ сервер выкл — изменения НЕ сохраняются'; return; }
    if (!state.dirty || !state.curFile) return;
    try { await flushIfDirty(); await refreshTree(); }
    catch (e) { el.saveState.textContent = '⚠ ' + e.message; toast(e.message, 'error'); }
  }, 700);

  /* ---------- предпросмотр: сборка проекта в один HTML ---------- */
  async function buildPreviewHtml(files) {
    const byPath = {}; files.forEach((f) => { byPath[f.path] = f.content; });
    let html = byPath['index.html'] || Object.values(byPath)[0] || '<p>Нет index.html</p>';
    // инлайн CSS
    html = html.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, (m0, href) => {
      const p = normRel(href); const c = byPath[p];
      return c != null ? '<style>\n' + c + '\n</style>' : m0;
    });
    // инлайн JS
    html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m0, pre, src) => {
      const p = normRel(src); const c = byPath[p];
      return c != null ? '<script>\n' + c.replace(/<\/script>/gi, '<\\/script>') + '\n<\/script>' : m0;
    });
    return html;
    function normRel(h) {
      if (/^(https?:|data:|mailto:)/i.test(h)) return h;
      return Store.normPath(h.replace(/^\.\//, ''));
    }
  }

  async function runPreview() {
    if (!state.pid) return;
    await flushIfDirty();
    const dump = await exportProjectFiles(state.pid);
    const html = await buildPreviewHtml(dump.files);
    el.previewFrame.srcdoc = html;
    toast('Предпросмотр обновлён', 'ok', 1800);
  }

  /* ---------- создание/шаблоны ---------- */
  const TEMPLATES = {
    'Пустой сайт': null,
    'Лендинг': { extra: { 'about.html': '<!doctype html>\n<html lang="ru"><head><meta charset="UTF-8"><title>О нас</title><link rel="stylesheet" href="css/style.css"></head><body class="hero"><h1>О нас</h1><p><a href="index.html">← главная</a></p></body></html>', 'js/nav.js': "console.log('nav ok');\n" } },
    'Todo-приложение': { extra: { 'js/todo.js': "const KEY='ws_todo';\nlet items=JSON.parse(localStorage.getItem(KEY)||'[]');\nconst list=document.getElementById('list'),inp=document.getElementById('inp');\nfunction render(){list.innerHTML=items.map((t,i)=>'<li>'+t+' <button data-i='+i+'>✕</button></li>').join('');}\nlist.onclick=e=>{if(e.target.tagName==='BUTTON'){items.splice(+e.target.dataset.i,1);localStorage.setItem(KEY,JSON.stringify(items));render();}};\ninp.closest('form').onsubmit=e=>{e.preventDefault();items.push(inp.value);localStorage.setItem(KEY,JSON.stringify(items));inp.value='';render();};\nrender();\n", 'todo.html': '<!doctype html>\n<html lang="ru"><head><meta charset="UTF-8"><title>Todo</title><link rel="stylesheet" href="css/style.css"></head><body class="hero"><h1>Задачи</h1><form><input id="inp" placeholder="новая задача"/></form><ul id="list"></ul><p><a href="index.html">← главная</a></p><script src="js/todo.js"><\/script></body></html>' } },
  };

  async function createProjectFlow() {
    if (!state.serverOn) { toast('Включите сервер: без базы данных создавать проекты нет смысла', 'warn'); return; }
    const ok = await modal('Новый проект', `
      <label>Название проекта<input id="npName" class="input" placeholder="Мой сайт" autofocus /></label>
      <label>Шаблон<select id="npTpl" class="select">
        <option>Пустой сайт</option><option>Лендинг</option><option>Todo-приложение</option></select></label>
      <p class="hint">Будет создана виртуальная ФС: index.html, css/style.css, js/app.js, README.md.</p>`, 'Создать');
    if (!ok) return;
    const name = ($id('npName').value || '').trim() || 'Мой сайт';
    const meta = await Store.createProject(name);
    const tpl = TEMPLATES[$id('npTpl').value];
    if (tpl && tpl.extra) for (const [p, c] of Object.entries(tpl.extra)) await Store.writeFile(meta.id, p, c);
    toast('Проект «' + name + '» создан', 'ok');
    await refreshProjects();
    openProject(meta.id);
  }

  /* ---------- обработчики ---------- */
  el.btnServer.addEventListener('click', () => applyServer(!state.serverOn));
  el.tabProjects.addEventListener('click', async () => { await flushIfDirty(); showScreen('projects'); await refreshProjects(); });
  el.tabEditor.addEventListener('click', () => { if (state.pid) showScreen('editor'); });
  el.btnNewProject.addEventListener('click', createProjectFlow);
  el.btnImportDump.addEventListener('click', () => el.fileImport.click());
  el.fileImport.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const meta = await Store.importProject(obj);
      toast('Импортирован проект «' + meta.name + '»', 'ok');
      await refreshProjects();
    } catch (err) { toast('Ошибка импорта: ' + err.message, 'error'); }
    e.target.value = '';
  });

  el.projectGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); const card = e.target.closest('[data-pid]');
    if (!card) return;
    const pid = card.dataset.pid; const act = btn && btn.dataset.act;
    if (!act) return;
    if (act === 'open') return openProject(pid);
    if (act === 'zip') return zipProject(pid);
    if (act === 'publish') return publishProject(pid);
    if (act === 'rename') {
      const name = prompt('Новое название проекта:'); if (name) { await Store.renameProject(pid, name); refreshProjects(); if (state.pid === pid) el.projTitle.textContent = name; }
    }
    if (act === 'del') {
      if (await modal('Удалить проект?', '<p class="hint">Все файлы будут стёрты из базы данных безвозвратно. Сначала сделайте ZIP-экспорт, если нужно.</p>', 'Удалить')) {
        await Store.deleteProject(pid);
        if (state.pid === pid) { state.pid = null; state.curFile = null; el.tabEditor.disabled = true; el.btnPublishTop.disabled = true; showScreen('projects'); }
        toast('Проект удалён', 'ok'); refreshProjects();
      }
    }
  });

  el.fileTree.addEventListener('click', (e) => {
    const li = e.target.closest('.tree-item'); if (li) openFile(li.dataset.path);
  });
  el.btnNewFile.addEventListener('click', async () => {
    const path = prompt('Путь нового файла (можно с папкой):', 'pages/new.html');
    if (!path) return;
    await Store.writeFile(state.pid, Store.normPath(path), '');
    await openFile(Store.normPath(path));
    toast('Файл создан', 'ok');
  });
  el.btnSaveAll.addEventListener('click', async () => { await flushIfDirty(); toast('Сохранено в базу данных', 'ok'); });
  el.btnZip.addEventListener('click', () => state.pid && zipProject(state.pid));
  el.btnRun.addEventListener('click', runPreview);
  el.btnPublishTop.addEventListener('click', () => state.pid && publishProject(state.pid));

  el.codeArea.addEventListener('input', () => { state.dirty = true; el.saveState.textContent = '… печать, автосохранение через мгновение'; autoSave(); });
  el.codeArea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flushIfDirty().then(() => toast('💾 сохранено', 'ok')); }
    if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = s + 2; state.dirty = true; autoSave(); }
  });
  window.addEventListener('beforeunload', () => { if (state.dirty && state.serverOn) flushIfDirty(); });

  /* ---------- старт ---------- */
  (async function boot() {
    el.btnServer.classList.toggle('is-live', state.serverOn);
    if (state.serverOn) { try { await Store.init(); } catch (e) { console.warn(e); } }
    el.serverLabel.textContent = state.serverOn ? 'СЕРВЕР ВКЛ · БД' : 'СЕРВЕР ВЫКЛ';
    if (!state.serverOn) el.dbHint.innerHTML = 'База данных выключена. Чтобы проекты сохранялись автоматически, включите <b>сервер</b> (кнопка справа вверху).';
    await refreshProjects();
  })();
})();
`````````

## Файл: studio/js/zip.js (83 строк)

`````````javascript
/* ══════════ WEBSTUDIO · ZIP (store-метод, CRC32) ══════════
   ZipWriter.add(path, stringOrUint8); ZipWriter.finish() -> Uint8Array (.zip)
   Без внешних зависимостей. Store (без сжатия) — совместимо со всеми архиваторами.
*/
(function () {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(v) { return [v & 255, (v >> 8) & 255]; }
  function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }

  class ZipWriter {
    constructor() { this.entries = []; this.offset = 0; this.chunks = []; }

    add(path, data) {
      path = String(path).replace(/\\/g, '/');
      const bytes = (data instanceof Uint8Array) ? data : new TextEncoder().encode(String(data));
      const nameBytes = new TextEncoder().encode(path);
      const now = new Date();
      const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
      const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
      const crc = crc32(bytes);

      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), // version, flags(UTF-8), method=store
        u16(dosTime), u16(dosDate), u32(crc), u32(bytes.length), u32(bytes.length),
        u16(nameBytes.length), u16(0)
      );
      const localHeader = new Uint8Array(local);
      const rec = new Uint8Array(localHeader.length + nameBytes.length + bytes.length);
      rec.set(localHeader, 0); rec.set(nameBytes, localHeader.length); rec.set(bytes, localHeader.length + nameBytes.length);

      this.entries.push({ path: nameBytes, crc, size: bytes.length, offset: this.offset, dosTime, dosDate });
      this.offset += rec.length;
      this.chunks = this.chunks || [];
      this.chunks.push(rec);
    }

    finish() {
      let cdSize = 0;
      const cdChunks = [];
      for (const e of this.entries) {
        const head = new Uint8Array([].concat(
          u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
          u16(e.dosTime), u16(e.dosDate), u32(e.crc), u32(e.size), u32(e.size),
          u16(e.path.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset)
        ));
        const rec = new Uint8Array(head.length + e.path.length);
        rec.set(head, 0); rec.set(e.path, head.length);
        cdChunks.push(rec); cdSize += rec.length;
      }
      const eocd = new Uint8Array([].concat(
        u32(0x06054b50), u16(0), u16(0),
        u16(this.entries.length), u16(this.entries.length),
        u32(cdSize), u32(this.offset), u16(0)
      ));
      const total = this.offset + cdSize + eocd.length;
      const out = new Uint8Array(total);
      let p = 0;
      for (const c of (this.chunks || [])) { out.set(c, p); p += c.length; }
      for (const c of cdChunks) { out.set(c, p); p += c.length; }
      out.set(eocd, p);
      return out;
    }
  }

  window.ZipWriter = ZipWriter;
})();
`````````

---

## 📦 Архив одним файлом (SHAR)

Сохраните блок ниже как `syntheco-project.sh` и выполните `bash syntheco-project.sh`:

````sh
#!/bin/bash
# Синтеко Лаб · WebStudio — full project unpacker
set -e
cd "$(dirname "$0")"
TMP=$(mktemp -d); Z="$TMP/proj.zip"
awk '/^__ZIP_B64__$/,/^__END_ZIP__$/ {if (!/^__/) print}' "$0" | base64 -d > "$Z"
python3 - "$Z" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall('.')
    print("Развёрнуто файлов:", len(z.namelist()))
PY
rm -rf "$TMP"
echo "Готово! Откройте index.html"
exit 0
__ZIP_B64__
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
EAAQAMkDAACv/AAAAAA=
__END_ZIP__
````
