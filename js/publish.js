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
