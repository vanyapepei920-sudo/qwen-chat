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
    "js/utils.js", "js/charts.js", "js/dashboard.js", "js/publish.js", "js/netmonitor.js", "js/websearch.js", "js/netlab.js",
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

  // Этап 3 (fallback для file://): сериализация текущего DOM + подгрузка <script src>/<link href>
  async function collectFromDom() {
    const root = document.documentElement;
    const out = {};
    const refs = [];
    root.querySelectorAll("script[src], link[href]").forEach((n) => refs.push(n.getAttribute("src") || n.getAttribute("href")));
    for (const r of refs) {
      if (!r || /^(https?:|data:)/i.test(r)) continue;
      try {
        const res = await fetch("./" + r.replace(/^\.\//, ""), { cache: "no-store" });
        if (res.ok) out[r.replace(/^\.\//, "")] = await res.text();
      } catch (e) { /* ignore */ }
    }
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script[type='text/plain']").forEach((n) => n.remove());
    out["index.html"] = "<!doctype html>\n" + clone.outerHTML;
    return out;
  }

  async function collectFiles(onStep) {
    let files = collectStage1();
    if (Object.keys(files).length < 3) files = await collectViaFetch();
    if (Object.keys(files).length < 3) files = await collectFromDom();
    const list = Object.entries(files).map(([path, content]) => ({ path, content }));
    if (!list.length) throw new Error("Не удалось собрать файлы сайта");
    onStep("Файлов к публикации: " + list.length);
    return list;
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
        repo = await ghFetch("/user/repos", { method: "POST", body: JSON.stringify({ name: repoName, public: !pubPrivate, private: pubPrivate, auto_init: false, description: "Published from Syntheco Console / WebStudio" }) }, token);
        logLine("2/5 ✔ создан " + (pubPrivate ? "приватный" : "публичный") + " репозиторий");
      } else if (e.status === 401) throw new Error("Ключ недействителен (401). Выпустите новый с правами Contents: Read and Write.");
      else if (e.status === 403) throw new Error("Доступ запрещён (403). Проверьте права ключа.");
      else throw e;
    }

    const files = await collectFiles(logLine);
    logLine("3/5 Загрузка " + files.length + " файлов (пакетный коммит через Trees API)…");
    try {
      // один коммит со всеми файлами — быстрее и без rate-limit на файл
      let ref;
      try { ref = await ghFetch("/repos/" + me.login + "/" + repoName + "/git/ref/heads/main", {}, token); }
      catch (e) { ref = null; }
      let baseSha = ref && ref.object && ref.object.sha;
      if (!baseSha) {
        // пустой репо — создаём initial commit из README
        const r0 = await ghFetch("/repos/" + me.login + "/" + repoName + "/contents/README.md", {
          method: "PUT", body: JSON.stringify({ message: "init", content: b64("# " + repoName + "\n") }),
        }, token);
        baseSha = r0.commit.sha;
      }
      const tree = [];
      for (const f of files) tree.push({ path: f.path, mode: "100644", type: "blob", content: f.content });
      const tr = await ghFetch("/repos/" + me.login + "/" + repoName + "/git/trees", {
        method: "POST", body: JSON.stringify({ base_tree: baseSha, tree }),
      }, token);
      const cm = await ghFetch("/repos/" + me.login + "/" + repoName + "/git/commits", {
        method: "POST", body: JSON.stringify({ message: "WebStudio publish " + new Date().toISOString(), parents: [baseSha], tree: tr.sha }),
      }, token);
      try { await ghFetch("/repos/" + me.login + "/" + repoName + "/git/refs/heads/main", { method: "PATCH", body: JSON.stringify({ sha: cm.sha, force: true }) }, token); }
      catch (e) { await ghFetch("/repos/" + me.login + "/" + repoName + "/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/main", sha: cm.sha }) }, token); }
      setProgress(70);
      logLine("3/5 ✔ все файлы запушены одним коммитом " + cm.sha.slice(0, 7));
    } catch (err) {
      logLine("3/5 пакетный режим не удался (" + err.message + ") — грузим файлы по одному…");
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
    logLine("5/5 Проверка статуса Pages…");
    let url = "https://" + me.login.toLowerCase() + ".github.io/" + repoName + "/";
    for (let k = 0; k < 4; k++) {
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

  /* ---------- автозапуск при наличии сохранённого ключа ---------- */
  let autoRunning = false;
  async function autoPublish() {
    if (autoRunning) return;
    autoRunning = true;
    const token = localStorage.getItem(LS_TOKEN) || localStorage.getItem("gh_tools_token") || "";
    if (!token) { autoRunning = false; return; }
    const btn = $("#btnPublish");
    if (btn) btn.textContent = "⏳ Публикация…";
    // ключ уже сохранён — публикуем вообще без модалки
    logLine("Автопубликация: используется сохранённый API-ключ…");
    try {
      const res = await runPublish(token, "");
      toast("Опубликовано: " + res.url, "ok", 9000);
      const link = $("#modalLink");
      if (link) { link.href = res.url; link.hidden = false; }
      if (btn) btn.textContent = "✔ Опубликовано";
    } catch (e) {
      console.error(e);
      logLine("✖ " + e.message + " — нажмите кнопку снова, чтобы ввести новый ключ.");
      toast("Автопубликация не удалась: " + e.message, "error", 7000);
      if (btn) btn.textContent = "Опубликовать на GitHub";
      localStorage.removeItem(LS_TOKEN); // ключ битый — просим новый вручную
    } finally { autoRunning = false; }
  }

  let pubRepoOverride = "";
  let pubPrivate = false;

  /* ---------- модалка: ТОЛЬКО поле API-ключа ---------- */
  function openModal(prefill) {
    const saved = prefill != null ? prefill : (localStorage.getItem(LS_TOKEN) || localStorage.getItem("gh_tools_token") || "");
    modal(`
      <h3 style="margin-top:0">Публикация на GitHub Pages</h3>
      <p class="hint">Достаточно <b>API-ключа</b>: владелец определяется автоматически, имя репо генерируется, Pages включается сам. Ниже — доп. параметры при желании.</p>
      <label>API-ключ (GitHub token, Fine-grained с Contents:RW + Administration:RW или classic scope repo)
        <input id="pubToken" type="password" placeholder="ghp_… или github_pat_…" value="${String(saved).replace(/"/g, "&quot;")}" autocomplete="off" autofocus />
      </label>
      <details style="margin:6px 0">
        <summary class="hint" style="cursor:pointer">⚙ дополнительные параметры публикации</summary>
        <label>Имя репозитория (пусто = авто)
          <input id="pubRepo" placeholder="syntheco-console-…" /></label>
        <label class="chk"><input id="pubPrivate" type="checkbox"/> приватный репозиторий (Pages недоступен для free-аккаунтов)</label>
        <label class="chk"><input id="pubAutoAfter" type="checkbox" checked/> после этой публикации обновлять сайт автоматически (по ключу)</label>
      </details>
      <label class="chk"><input id="pubRemember" type="checkbox" ${saved ? "checked" : ""}/> запомнить ключ — следующие публикации будут автоматическими</label>
      <div class="pub-track"><div class="pub-fill" id="pubBar"></div></div>
      <ul class="pub-log mono" id="pubLog"></ul>`,
      "▶ Опубликовать").then(async (ok) => {
        if (!ok) return; // пользователь закрыл окно — тихо выходим
        const token = ($("#pubToken").value || "").trim();
        if (!token) { toast("Введите API-ключ", "warn"); return; }
        if ($("#pubRemember").checked) { localStorage.setItem(LS_TOKEN, token); localStorage.setItem("gh_tools_token", token); }
        else localStorage.removeItem(LS_TOKEN);
        pubRepoOverride = ($("#pubRepo") && $("#pubRepo").value.trim()) || "";
        pubPrivate = !!($("#pubPrivate") && $("#pubPrivate").checked);
        if ($("#pubAutoAfter") && !$("#pubAutoAfter").checked) sessionStorage.setItem("gh_pub_autorun", "9");
        const btn = $("#btnPublish");
        if (btn) btn.textContent = "⏳ Публикация…";
        try {
          const res = await runPublish(token, pubRepoOverride);
          toast("Опубликовано: " + res.url, "ok", 9000);
          const link = $("#modalLink");
          if (link) { link.href = res.url; link.hidden = false; }
          if (btn) btn.textContent = "✔ Опубликовано";
        } catch (e) {
          console.error(e);
          logLine("✖ ОШИБКА: " + e.message);
          toast("Ошибка публикации: " + e.message, "error", 7000);
          if (btn) btn.textContent = "Опубликовать на GitHub";
        }
      });
  }

  /* ---------- привязка кнопки ---------- */
  function bind() {
    const btn = $("#btnPublish");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const token = localStorage.getItem(LS_TOKEN) || localStorage.getItem("gh_tools_token") || "";
      // если ключ уже есть — публикуем сразу, без единого вопроса
      if (token && !autoRunning) { autoPublish(); return; }
      openModal();
    });
  }

  function init() {
    bind();
    // автопубликация при заходе: если браузер уже знает ключ — просто обновляем сайт
    if ((localStorage.getItem(LS_TOKEN) || localStorage.getItem("gh_tools_token")) && sessionStorage.getItem("gh_pub_autorun") !== "1") {
      sessionStorage.setItem("gh_pub_autorun", "1");
      setTimeout(autoPublish, 1500);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
