/* ═══════════════════════════════════════════════════════════════
   publish.js — кнопка «Опубликовать на GitHub»
   Публикует сайт из локального git-репозитория в публичный
   репозиторий GitHub + включает GitHub Pages. Работает через
   GitHub REST API (нужен Personal Access Token с scope repo).
   Токен НЕ хранится: запрашивается при каждом запуске, живёт
   только в памяти вкладки до закрытия модалки.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const API = "https://api.github.com";

  /* ---------- helpers ---------- */
  async function ghFetch(path, opts = {}, token) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.headers || {}),
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

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function setProgress(steps, done) {
    const bar = $("#pubBar");
    if (bar) bar.style.width = Math.round((done / steps) * 100) + "%";
  }

  /* ---------- file collection (two-stage, no page reload) ---------- */
  const SRC_FILES = [
    "index.html", "README.md", ".gitignore",
    "css/style.css",
    "js/utils.js", "js/simulation.js", "js/charts.js", "js/dashboard.js", "js/publish.js",
    ".github/workflows/pages.yml",
  ];

  // Stage 1: читаем текстовые файлы как <script type="text/plain"> блоки.
  function collectStage1() {
    const out = {};
    for (const f of SRC_FILES) {
      const el = document.getElementById("src:" + f);
      if (el) out[f] = el.textContent;
    }
    return out;
  }

  // Собираем все исходники страницы. index.html сериализуем из DOM,
  // предварительно удалив временные блоки-источники (иначе они
  // переехали бы в опубликованную копию). Остальные файлы — из блоков,
  // загруженных через fetch (для file:// это заблокирован, см. ошибку ниже).
  async function gatherFiles() {
    const holder = document.getElementById("pubSrcHolder");
    const inline = collectStage1();
    let indexHtml = null;
    if (holder) holder.remove();
    try {
      indexHtml = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    } finally {
      if (holder) document.body.appendChild(holder); // на всякий случай вернём
    }
    if (!indexHtml || !/<title>/i.test(indexHtml)) {
      throw new Error("Не удалось сериализовать страницу.");
    }
    const out = { ...inline, "index.html": indexHtml };
    const missing = SRC_FILES.filter((f) => !(f in out));
    if (missing.length) {
      throw new Error(
        "Браузер запретил чтение файлов со страницы (протокол file://). " +
        "Откройте сайт через локальный сервер, например: python3 -m http.server 8000 → http://localhost:8000"
      );
    }
    return out;
  }

  /* ---------- upload pipeline ---------- */
  async function publish(token, owner, repoName, files, uiCb) {
    const total = 4 + Object.keys(files).length + 2;
    let step = 0;

    uiCb("Проверяю токен…");
    const me = await ghFetch("/user", {}, token);
    if (token.startsWith("ghp_") || token.startsWith("github_pat_")) {
      // fine-grained токены не дают /user/scopes; classic — можно проверить
    }
    step++; setProgress(total, step);

    uiCb(`Ищу репозиторий ${owner}/${repoName}…`);
    let created = false;
    try {
      await ghFetch(`/repos/${owner}/${repoName}`, {}, token);
    } catch (e) {
      if (e.status === 404) {
        uiCb("Создаю публичный репозиторий…");
        await ghFetch("/user/repos", {
          method: "POST",
          body: JSON.stringify({ name: repoName, public: true, auto_init: false }),
        }, token);
        created = true;
      } else throw e;
    }
    step++; setProgress(total, step);

    uiCb("Загружаю файлы (" + Object.keys(files).length + ")…");
    for (const [path, content] of Object.entries(files)) {
      const b64 = btoa(unescape(encodeURIComponent(content)));
      let sha = null;
      try {
        const info = await ghFetch(
          `/repos/${owner}/${repoName}/contents/${encodeURIComponent(path)}?ref=main`, {}, token);
        sha = info.sha;
      } catch (e) { /* файл отсутствует */ }
      await ghFetch(`/repos/${owner}/${repoName}/contents/${encodeURIComponent(path)}`, {
        method: "PUT",
        body: JSON.stringify({
          message: (sha ? "update" : "add") + " " + path + " via Синтеко Лаб",
          content: b64, branch: "main", ...(sha ? { sha } : {}),
        }),
      }, token);
      step++; setProgress(total, step);
      uiCb(`Файл готов: ${path}`);
    }

    if (created) { await sleep(1500); } // даём репо инициализироваться

    uiCb("Включаю GitHub Pages (branch main /)…");
    try {
      await ghFetch(`/repos/${owner}/${repoName}/pages`, {
        method: "POST",
        body: JSON.stringify({ source: { branch: "main", path: "/" } }),
      }, token);
    } catch (e) {
      if (e.status === 409) { // уже включены — обновляем
        await ghFetch(`/repos/${owner}/${repoName}/pages`, {
          method: "PUT", body: JSON.stringify({ source: { branch: "main", path: "/" } }),
        }, token);
      } else throw e;
    }
    step++; setProgress(total, step);

    uiCb("Жду сборки Pages…");
    let url = `https://${owner.toLowerCase()}.github.io/${repoName}/`;
    for (let i = 0; i < 20; i++) {
      await sleep(3000);
      try {
        const p = await ghFetch(`/repos/${owner}/${repoName}/pages`, {}, token);
        if (p.status && p.status !== "built" && p.status !== "built_pending") continue;
        if (p.status === "built") { url = p.url || url; break; }
      } catch (e) { /* ещё нет билда */ }
      if (i === 19) uiCb("Билд ещё идёт — ссылка появится через минуту.");
    }
    step++; setProgress(total, step);
    return { url, repo: `https://github.com/${owner}/${repoName}` };
  }

  /* ---------- modal UI ---------- */
  function buildModalHtml(prefill) {
    return `
      <p class="pub-note">Кнопка реально публикует этот сайт: читает все исходники страницы,
      создаёт публичный репозиторий через GitHub&nbsp;API, загружает файлы и включает GitHub&nbsp;Pages.</p>
      <label class="pub-label">GitHub Personal Access Token
        <input class="inp mono" id="pubToken" type="password" autocomplete="off"
               placeholder="ghp_… или github_pat_… (scope: repo + workflow)">
      </label>
      <div class="pub-row">
        <label class="pub-label">Владелец (логин)
          <input class="inp" id="pubOwner" value="${prefill.owner}" placeholder="ваш-логин"></label>
        <label class="pub-label">Имя репозитория
          <input class="inp mono" id="pubRepo" value="${prefill.repo}" placeholder="syntheco-lab"></label>
      </div>
      <div class="pub-track"><div class="pub-fill" id="pubBar" style="width:0%"></div></div>
      <pre class="pub-log mono" id="pubLog">Готово к публикации. Токен не сохраняется — он живёт только до закрытия окна.</pre>
      <p class="pub-hint">Как получить токен: github.com → Settings → Developer settings →
      Personal access tokens → Tokens (classic) → Generate new token → чекбокс <b>repo</b> (+ <b>workflow</b>).
      После публикации отзовите токен.</p>`;
  }

  function openPublishDialog() {
    const backdrop = $("#modalBackdrop");
    const body = $("#modalBody");
    const title = $("#modalTitle");
    const okBtn = $("#modalOk");
    const cancelBtn = $("#modalCancel");

    title.textContent = "Публикация на GitHub";
    const prefill = {
      owner: localStorage.getItem("pub.owner") || "",
      repo: localStorage.getItem("pub.repo") || "syntheco-lab",
    };
    body.innerHTML = buildModalHtml(prefill);
    backdrop.hidden = false;

    const log = (m) => { const el = $("#pubLog"); if (el) el.textContent += "\n› " + m; };
    okBtn.textContent = "▶ Опубликовать";
    cancelBtn.textContent = "Закрыть";
    okBtn.disabled = false;
    const linkBtn = $("#modalLink");
    if (linkBtn) linkBtn.hidden = true;

    const restore = () => {
      okBtn.textContent = "▶ Опубликовать";
      okBtn.disabled = false;
      bindOk();
      cancelBtn.onclick = close;
    };
    const close = () => {
      backdrop.hidden = true; body.innerHTML = "";
      if (linkBtn) linkBtn.hidden = true;
      // снять вешалки, чтобы utils.modal() работал как раньше
      okBtn.onclick = null; cancelBtn.onclick = null; $("#modalX").onclick = null;
    };
    cancelBtn.onclick = close;
    $("#modalX").onclick = close;

    const doPublish = async () => {
      const token = ($("#pubToken").value || "").trim();
      const owner = ($("#pubOwner").value || "").trim();
      const repo = ($("#pubRepo").value || "").trim();
      if (!token || !owner || !repo) { log("❌ Заполните токен, владельца и имя репозитория."); return; }
      if (!/^[a-zA-Z0-9_.-]+$/.test(repo)) { log("❌ Некорректное имя репозитория."); return; }
      localStorage.setItem("pub.owner", owner);
      localStorage.setItem("pub.repo", repo);

      okBtn.disabled = true; okBtn.textContent = "Публикую…";
      $("#pubBar").style.width = "0%";
      try {
        const files = await gatherFiles();
        if (!files["index.html"]) throw new Error("Не удалось прочитать index.html страницы.");
        log(`Прочитано файлов: ${Object.keys(files).length}.`);
        const res = await publish(token, owner, repo, files, log);
        log("✅ ГОТОВО! Сайт: " + res.url);
        log("   Репозиторий: " + res.repo);
        okBtn.textContent = "✓ Готово";
        okBtn.disabled = false;
        okBtn.onclick = close;
        if (linkBtn) { linkBtn.hidden = false; linkBtn.href = res.url; }
        cancelBtn.textContent = "Закрыть";
      } catch (e) {
        console.error(e);
        const hint = e.status === 401 ? " — проверьте, что токен живой и имеет scope repo."
          : e.status === 403 ? " — недостаточно прав (или лимит API)."
          : e.status === 422 ? " — репозиторий существует, но пуст/конфликт имён." : "";
        log("❌ Ошибка: " + (e.message || e) + hint);
        restore();
      }
    };
    const bindOk = () => { okBtn.onclick = doPublish; };
    bindOk();
  }

  /* ---------- inject self-source + all sources as hidden blocks ---------- */
  // publish.js тоже читается через fetch — в опубликованном index.html
  // содержимое файлов лежит во временных скрытых блоках <script type="text/plain">.
  function injectSourceBlocks() {
    const old = document.getElementById("pubSrcHolder");
    if (old) old.remove();
    const holder = document.createElement("div");
    holder.id = "pubSrcHolder";
    holder.hidden = true;
    document.body.appendChild(holder);
    const add = (f, text) => {
      const s = document.createElement("script");
      s.type = "text/plain";
      s.id = "src:" + f;
      s.textContent = text;
      holder.appendChild(s);
    };
    const staticFiles = ["README.md", ".gitignore", "css/style.css",
      "js/utils.js", "js/simulation.js", "js/charts.js", "js/dashboard.js",
      "js/publish.js", ".github/workflows/pages.yml"];
    return Promise.allSettled(staticFiles.map(async (f) => {
      const r = await fetch("./" + f, { cache: "no-store" });
      if (!r.ok) throw new Error(f + ": HTTP " + r.status);
      add(f, await r.text());
    }));
  }

  /* ---------- wire up ---------- */
  function init() {
    const btn = $("#btnPublish");
    if (!btn) return;
    btn.classList.remove("is-dead");
    btn.addEventListener("click", () => {
      // гарантируем наличие блоков-источников (idempotent)
      injectSourceBlocks().finally(openPublishDialog);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else init();
})();
