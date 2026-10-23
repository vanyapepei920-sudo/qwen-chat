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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
