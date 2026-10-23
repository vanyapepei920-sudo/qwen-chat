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
