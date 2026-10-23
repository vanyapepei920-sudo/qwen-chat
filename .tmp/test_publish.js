const fs = require('fs'), vm = require('vm');
const els = {};
function mkEl(id) {
  return els[id] || (els[id] = {
    id, textContent: '', value: 'tok123', innerHTML: '', checked: true, hidden: false,
    style: {}, dataset: {}, children: [], scrollTop: 0, scrollHeight: 0,
    appendChild(c) { this.children.push(c); },
    addEventListener(t, fn) { (this._h ||= {})[t] = fn; },
    querySelector() { return { style: {} }; },
  });
}
const doc = {
  readyState: 'complete',
  querySelector: (s) => mkEl(s.replace('#', '')),
  getElementById: (s) => mkEl(s),
  createElement: () => mkEl('li' + Math.random()),
  documentElement: { cloneNode: () => ({ querySelectorAll: () => [], outerHTML: '<html/>' }) },
  querySelectorAll: (sel) => sel.includes('script[src]') ? [{ getAttribute: () => './js/utils.js' }, { getAttribute: () => './css/style.css' }] : [],
  addEventListener: () => {}, removeEventListener: () => {},
};
let store = { gh_pub_token: 'tok123', gh_tools_token: 'tok123' };
const toasts = []; const modalCalls = []; let ssSeen = null; const fetchLog = [];
const sandbox = {
  document: doc,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v), removeItem: k => delete store[k] },
  sessionStorage: { getItem: () => ssSeen, setItem: (k, v) => { ssSeen = v; }, removeItem: () => {} },
  console, setTimeout, Promise, TextEncoder,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  fetch: async (url, opt) => {
    fetchLog.push((opt && opt.method || 'GET') + ' ' + url);
    if (url === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => ({ login: 'testowner' }) };
    if (/\/repos\/testowner\/[^/]+$/.test(url)) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    if (opt && opt.method === 'POST' && url.endsWith('/user/repos')) return { ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/testowner/auto' }) };
    if (opt && opt.method === 'PUT') return { ok: true, status: 201, json: async () => ({ content: { sha: 's' } }) };
    if (url.includes('/pages')) return { ok: true, status: 200, json: async () => ({ status: 'built', html_url: 'https://testowner.github.io/auto/' }) };
    if (url.startsWith('./')) return { ok: true, status: 200, text: async () => 'mock' };
    return { ok: false, status: 404, json: async () => ({}) };
  },
  window: {}, toast: m => toasts.push(m), beep: () => {},
  modal: (title, body) => { modalCalls.push(body); return Promise.resolve(true); },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('/workspace/js/publish.js', 'utf8'), sandbox);

(async () => {
  await new Promise(r => setTimeout(r, 9000)); // автопубликация стартует через 1.5с + ~6с конвейер
  const logTxt = els['pubLog'].children.map(c => c.textContent).join('\n');
  const checks = [
    ['АВТОпубликация без клика и БЕЗ модалки (ключ сохранён)', modalCalls.length === 0 && /Автопубликация/.test(logTxt)],
    ['владелец определён автоматически из токена', /владелец определён автоматически: @testowner/.test(logTxt)],
    ['репозиторий создан авто-именем', fetchLog.some(l => l.startsWith('POST https://api.github.com/user/repos'))],
    ['файлы загружены (PUT contents)', fetchLog.some(l => l.startsWith('PUT https://api.github.com/repos'))],
    ['Pages включены', fetchLog.some(l => l.includes('/pages'))],
    ['тост со ссылкой на сайт', toasts.some(t => t.includes('testowner.github.io'))],
    ['кнопка показала успех', els['btnPublish'].textContent.includes('Опубликовано')],
    ['ключ переиспользован в gh_tools_token', store.gh_tools_token === 'tok123'],
  ];
  // сценарий 2: нового пользователя (без ключа) — клик открывает модалку ТОЛЬКО с полем API-ключа
  store = {}; ssSeen = 'x'; // отключаем автозапуск при повторной загрузке
  vm.runInContext(fs.readFileSync('/workspace/js/publish.js', 'utf8'), sandbox);
  await new Promise(r => setTimeout(r, 100));
  els['btnPublish']._h.click();
  await new Promise(r => setTimeout(r, 100));
  const body = modalCalls[0] || '';
  checks.push(
    ['новый юзер: клик открыл модалку', modalCalls.length > 0],
    ['в модалке ЕДИНСТВЕННОЕ поле ввода — pubToken', body.includes('id="pubToken"') && !body.includes('pubOwner') && !body.includes('pubRepoName') && !body.includes('id="pubRepo "') && !/<input[^>]+id="pubRepo">/.test(body)],
  );
  // сценарий 3: пустой токен -> тост, без рекурсии
  const before = modalCalls.length;
  els['pubToken'].value = '';
  sandbox.modal = () => Promise.resolve(true);
  let fail = 0;
  for (const [name, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name); if (!ok) fail++; }
  console.log(fail ? 'FAILS=' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
