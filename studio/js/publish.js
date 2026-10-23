/* ══════════ WEBSTUDIO · GitHub Publisher ══════════
   Публикация проекта на GitHub Pages. Требует ТОЛЬКО API-ключ (токен):
   логин/владелец и имя репозитория определяются автоматически.
     Publisher.token        — localStorage 'ws_gh_token' (только для удобства, не обязателен)
     Publisher.publish(projectObj, opts, onStep) -> {url, repo}
       projectObj = {name, files:[{path,content}]}
       opts = { token?, repoName?, update? }
     Publisher.checkToken(token) -> {login}
*/
(function () {
  'use strict';

  const LS_TOKEN = 'ws_gh_token';

  async function gh(path, token, init = {}) {
    const res = await fetch('https://api.github.com' + path, {
      method: init.method || 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* html error */ }
    if (!res.ok) {
      const msg = (json && json.message) || text.slice(0, 120) || ('HTTP ' + res.status);
      const err = new Error(msg + ' (HTTP ' + res.status + ')');
      err.status = res.status; err.json = json;
      throw err;
    }
    return json;
  }

  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'webstudio-site';
  }

  async function checkToken(token) {
    const u = await gh('/user', token);
    if (!u || !u.login) throw new Error('Некорректный токен');
    return { login: u.login, id: u.id };
  }

  /* основной конвейер */
  async function publish(project, opts, onStep) {
    const step = onStep || (() => {});
    const token = (opts.token || localStorage.getItem(LS_TOKEN) || '').trim();
    if (!token) throw new Error('Нужен API-ключ (GitHub Personal Access Token)');

    step('1/5 Проверка токена…');
    const me = await checkToken(token);
    step('1/5 ✔ владелец: @' + me.login);

    const repoName = (opts.repoName || '').trim() || slugify(project.name);
    step('2/5 Создание репозитория «' + repoName + '»…');
    let repo;
    try {
      repo = await gh('/repos/' + me.login + '/' + repoName, token);
      step('2/5 ✔ репозиторий уже существует — обновляем файлы');
    } catch (e) {
      if (e.status === 404) {
        repo = await gh('/user/repos', token, { method: 'POST', body: { name: repoName, public: true, auto_init: false, description: 'Published from WebStudio' } });
        step('2/5 ✔ создан публичный репозиторий');
      } else if (e.status === 401) { throw new Error('Токен недействителен (401). Выпустите новый с правами Contents: Read/Write.'); }
      else if (e.status === 403) { throw new Error('Отказано в доступе (403). Проверьте scopes токена.'); }
      else throw e;
    }

    step('3/5 Загрузка файлов (' + project.files.length + ')…');
    let done = 0;
    for (const f of project.files) {
      const path = encodeURIComponent(f.path);
      let sha = null;
      try { const cur = await gh('/repos/' + me.login + '/' + repoName + '/contents/' + path, token); sha = cur && cur.sha; } catch (e) { if (e.status !== 404) throw e; }
      await gh('/repos/' + me.login + '/' + repoName + '/contents/' + path, token, {
        method: 'PUT',
        body: { message: 'WebStudio: ' + (sha ? 'update ' : 'add ') + f.path, content: b64(f.content), ...(sha ? { sha } : {}) },
      });
      done++;
      step('3/5 Файлы: ' + done + '/' + project.files.length + ' — ' + f.path);
    }

    step('4/5 Включение GitHub Pages…');
    try {
      await gh('/repos/' + me.login + '/' + repoName + '/pages', token, { method: 'POST', body: { source: { branch: 'main', path: '/' } } });
    } catch (e) {
      if (e.status === 409) { await gh('/repos/' + me.login + '/' + repoName + '/pages', token, { method: 'PUT', body: { source: { branch: 'main', path: '/' } } }); }
      else if (e.status === 404) { /* ещё нет коммита? не должно случиться */ throw e; }
      else throw e;
    }
    step('4/5 ✔ Pages включены');

    step('5/5 Ожидание сборки…');
    let url = 'https://' + me.login.toLowerCase() + '.github.io/' + repoName + '/';
    for (let i = 0; i < 20; i++) {
      try {
        const st = await gh('/repos/' + me.login + '/' + repoName + '/pages', token);
        if (st && st.status && st.status !== 'building' && st.html_url) { url = st.html_url; break; }
      } catch (e) { break; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    step('5/5 ✔ Готово!');
    return { url, repo: repo.html_url, owner: me.login, repoName };
  }

  window.Publisher = { publish, checkToken, slugify, LS_TOKEN };
})();
