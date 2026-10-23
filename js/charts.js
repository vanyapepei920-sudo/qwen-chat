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
