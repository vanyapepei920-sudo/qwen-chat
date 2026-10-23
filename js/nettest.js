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
