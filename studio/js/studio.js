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
