'use strict';
let me = null;

const TABS = [
  ['home', '🏠 Главная'],
  ['projects', '📦 Проекты'],
  ['publish', '🚀 Публикация'],
  ['snippets', '✂️ Сниппеты'],
];

function switchTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
}

function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(([n, l]) =>
    `<button data-tab="${n}" onclick="switchTab('${n}')">${l}</button>`).join('');
}

function refreshTokenStatus() {
  const has = !!getToken();
  const el = document.getElementById('tokenStatus');
  el.textContent = has ? (me ? me.login : 'задан ✓') : 'не задан';
  el.className = has ? 'ok' : 'bad';
  if (has && !me) whoami();
}

async function whoami() {
  try {
    me = await gh('/user');
    document.getElementById('tokenStatus').textContent = me.login + ' ✓';
    loadProjects(); loadGists(); updateStats();
  } catch (e) { toast('Ключ недействителен: ' + e.message, false); }
}

function openSettings() {
  modal('Настройки GitHub-ключа',
    `<p class="hint">Вставьте классический PAT со scope <b>repo, workflow, gist</b>.</p>
     <input id="mToken" class="input grow" type="password" placeholder="ghp_..." value="${esc(getToken())}">`).then(body => {
      if (!body) return;
      setToken(body.querySelector('#mToken').value);
      me = null; refreshTokenStatus();
      toast(getToken() ? 'Ключ сохранён' : 'Ключ удалён');
    });
}

function saveToken() {
  const v = document.getElementById('pubToken').value.trim();
  if (!v) return toast('Введите ключ', false);
  setToken(v); me = null; refreshTokenStatus();
  toast('Ключ сохранён ✓');
}

/* ---- ПРОЕКТЫ ---- */
async function loadProjects() {
  const ul = document.getElementById('repoList');
  if (!getToken()) { ul.innerHTML = '<li class="muted">Сначала сохраните GitHub-ключ.</li>'; return; }
  try {
    const repos = await gh('/user/repos?per_page=100&sort=updated');
    ul.innerHTML = repos.map(r => `
      <li class="item">
        <div><b>${esc(r.name)}</b> ${r.homepage ? `<a href="${esc(r.homepage)}" target="_blank" class="link">🌍 сайт</a>` : ''}
          <div class="muted sm">${esc(r.description || 'без описания')} · ${r.stargazers_count}★</div></div>
        <div class="row end">
          ${r.has_pages ? `<a class="btn sm primary" href="${esc(pagesUrl(r))}" target="_blank">Pages</a>` : `<button class="btn sm" onclick="enablePagesFor('${esc(r.name)}')">Включить Pages</button>`}
          <button class="btn sm ghost" onclick="delProject('${esc(r.name)}')">🗑</button>
        </div>
      </li>`).join('') || '<li class="muted">Нет репозиториев.</li>';
    window._repos = repos;
    updateStats();
  } catch (e) { ul.innerHTML = `<li class="bad">Ошибка: ${esc(e.message)}</li>`; }
}

function pagesUrl(r) { return r.homepage || `https://${r.owner.login}.github.io/${r.name}/`; }

async function createProject() {
  const name = document.getElementById('newRepoName').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!name) return toast('Введите имя репозитория', false);
  try {
    await gh('/user/repos', { method: 'POST', body: { name, description: 'Syntheco project', auto_init: true, homepage: '' } });
    toast('Проект «' + name + '» создан ✓');
    document.getElementById('newRepoName').value = '';
    loadProjects();
  } catch (e) { toast(e.message.includes('already exists') ? 'Репозиторий уже существует' : e.message, false); }
}

async function delProject(name) {
  if (!(await modal('Удалить репозиторий?', `<p>«${esc(name)}» будет удалён безвозвратно. Продолжить?</p>`).then(b => !!b))) return;
  try { await gh('/repos/' + me.login + '/' + name, { method: 'DELETE' }); toast('Удалён'); loadProjects(); }
  catch (e) { toast(e.message, false); }
}

async function enablePagesFor(repo) {
  try {
    await gh(`/repos/${me.login}/${repo}/pages`, { method: 'POST', body: { source: { branch: 'main', path: '/' } } });
    toast('Pages включены для ' + repo + ' ✓'); loadProjects();
  } catch (e) { toast('Pages: ' + e.message, false); }
}

/* ---- ПУБЛИКАЦИЯ ---- */
async function publishFile() {
  const f = document.getElementById('pubFile').files[0];
  if (!f) return toast('Выберите файл', false);
  let repo = document.getElementById('pubRepo').value.trim().toLowerCase() || ('site-' + Date.now().toString(36));
  const path = document.getElementById('pubPath').value.trim() || f.name;
  logLine('pubLog', `→ файл ${f.name} (${f.size} Б), репо ${repo}, путь ${path}`);
  try {
    // 1. владелец
    if (!me) me = await gh('/user');
    logLine('pubLog', '✓ владелец: ' + me.login);
    // 2. репозиторий (создать если нет)
    try { await gh(`/repos/${me.login}/${repo}`); logLine('pubLog', '✓ репозиторий найден'); }
    catch (e) {
      await gh('/user/repos', { method: 'POST', body: { name: repo, auto_init: true, description: 'Published by Syntheco' } });
      logLine('pubLog', '✓ репозиторий создан');
    }
    // 3. content (base64)
    const buf = await f.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    let sha = null;
    try { const cur = await gh(`/repos/${me.login}/${repo}/contents/${encodeURIComponent(path)}`); sha = cur.sha; } catch (e) {}
    await gh(`/repos/${me.login}/${repo}/contents/${encodeURIComponent(path)}`,
      { method: 'PUT', body: { message: 'Publish ' + path, content: b64, sha } });
    logLine('pubLog', '✓ файл загружен');
    // 4. .nojekyll
    try { await gh(`/repos/${me.login}/${repo}/contents/.nojekyll`, { method: 'PUT', body: { message: 'nojekyll', content: '' } }); } catch (e) {}
    // 5. Pages
    if (document.getElementById('pubPages').checked) {
      try { await gh(`/repos/${me.login}/${repo}/pages`, { method: 'POST', body: { source: { branch: 'main', path: '/' } } }); }
      catch (e) { await gh(`/repos/${me.login}/${repo}/pages`, { method: 'PUT', body: { source: { branch: 'main', path: '/' } } }); }
      logLine('pubLog', '✓ Pages включены');
    }
    const url = `https://${me.login}.github.io/${repo}/`;
    logLine('pubLog', '🌍 ' + url, 'ok');
    toast('Опубликовано! Сайт: ' + url);
    addActivity(`Опубликован ${path} → ${url}`);
    document.getElementById('pubRepo').value = repo;
    updateStats();
  } catch (e) { logLine('pubLog', '✗ ' + e.message, 'bad'); toast('Ошибка: ' + e.message, false); }
}

/* ---- SNIPPETS ---- */
async function createGist() {
  const name = document.getElementById('snipName').value.trim() || 'snippet.txt';
  const code = document.getElementById('snipCode').value;
  if (!code) return toast('Пустой код', false);
  try {
    const g = await gh('/gists', {
      method: 'POST',
      body: { description: 'Syntheco snippet', public: !document.getElementById('snipSecret').checked, files: { [name]: { content: code } } },
    });
    toast('Gist создан: ' + g.html_url);
    addActivity('Gist ' + name);
    loadGists();
  } catch (e) { toast(e.message, false); }
}

async function loadGists() {
  const ul = document.getElementById('gistList');
  if (!getToken()) { ul.innerHTML = '<li class="muted">Нет ключа.</li>'; return; }
  try {
    const gs = await gh('/gists?per_page=50');
    ul.innerHTML = gs.map(g => {
      const fn = Object.keys(g.files)[0];
      return `<li class="item"><div><b>${esc(fn)}</b> <span class="muted sm">${g.public ? 'публичный' : 'секретный'} · ${g.created_at.slice(0, 10)}</span></div>
        <a class="btn sm" href="${esc(g.html_url)}" target="_blank">Открыть</a></li>`;
    }).join('') || '<li class="muted">Пока нет gist.</li>';
    window._gists = gs; updateStats();
  } catch (e) { ul.innerHTML = `<li class="bad">${esc(e.message)}</li>`; }
}

/* ---- ГЛАВНАЯ ---- */
function addActivity(txt) {
  const acts = JSON.parse(localStorage.getItem('syntheco_activity') || '[]');
  acts.unshift({ t: new Date().toLocaleString('ru'), txt });
  localStorage.setItem('syntheco_activity', JSON.stringify(acts.slice(0, 20)));
  renderActivity();
}
function renderActivity() {
  const acts = JSON.parse(localStorage.getItem('syntheco_activity') || '[]');
  document.getElementById('activityList').innerHTML =
    acts.map(a => `<li class="item"><span>${esc(a.txt)}</span><span class="muted sm">${a.t}</span></li>`).join('')
    || '<li class="muted">Действий ещё не было.</li>';
}
function updateStats() {
  document.getElementById('stProjects').textContent = window._repos ? window._repos.length : '—';
  document.getElementById('stPublished').textContent = window._repos ? window._repos.filter(r => r.has_pages).length : '—';
  document.getElementById('stGists').textContent = window._gists ? window._gists.length : '—';
}

document.addEventListener('DOMContentLoaded', () => {
  renderTabs(); renderActivity(); refreshTokenStatus();
  document.getElementById('pubToken').value = getToken();
});
