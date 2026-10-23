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
    const isPrivate = !!opts.private;
    step('2/5 Создание репозитория «' + repoName + '»…');
    let repo;
    try {
      repo = await gh('/repos/' + me.login + '/' + repoName, token);
      step('2/5 ✔ репозиторий уже существует — обновляем файлы');
    } catch (e) {
      if (e.status === 404) {
        repo = await gh('/user/repos', token, { method: 'POST', body: { name: repoName, public: !isPrivate, private: isPrivate, auto_init: false, description: opts.readme ? String(opts.readme).slice(0, 100) : 'Published from WebStudio' } });
        step('2/5 ✔ создан ' + (isPrivate ? 'приватный' : 'публичный') + ' репозиторий');
      } else if (e.status === 401) { throw new Error('Токен недействителен (401). Выпустите новый с правами Contents: Read/Write.'); }
      else if (e.status === 403) { throw new Error('Отказано в доступе (403). Проверьте scopes токена.'); }
      else throw e;
    }

    const files = project.files.slice();
    if (opts.addReadme && !files.some((f) => /^readme\.md$/i.test(f.path))) {
      files.push({ path: 'README.md', content: opts.readme || ('# ' + project.name + '\n') });
    }
    step('3/5 Пакетная загрузка ' + files.length + ' файлов через Trees API…');
    try {
      let ref = null;
      try { ref = await gh('/repos/' + me.login + '/' + repoName + '/git/ref/heads/main', token); } catch (e) { if (e.status !== 404) throw e; }
      let baseSha = ref && ref.object && ref.object.sha;
      if (!baseSha) {
        const r0 = await gh('/repos/' + me.login + '/' + repoName + '/contents/README.md', token, { method: 'PUT', body: { message: 'init', content: b64('# ' + project.name + '\n') } });
        baseSha = r0.commit.sha;
      }
      const tree = files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }));
      const tr = await gh('/repos/' + me.login + '/' + repoName + '/git/trees', token, { method: 'POST', body: { base_tree: baseSha, tree } });
      const cm = await gh('/repos/' + me.login + '/' + repoName + '/git/commits', token, { method: 'POST', body: { message: 'WebStudio publish ' + new Date().toISOString(), parents: [baseSha], tree: tr.sha } });
      try { await gh('/repos/' + me.login + '/' + repoName + '/git/refs/heads/main', token, { method: 'PATCH', body: { sha: cm.sha, force: true } }); }
      catch (e) { await gh('/repos/' + me.login + '/' + repoName + '/git/refs', token, { method: 'POST', body: { ref: 'refs/heads/main', sha: cm.sha } }); }
      step('3/5 ✔ все файлы в одном коммите ' + cm.sha.slice(0, 7));
    } catch (batchErr) {
      step('3/5 пакет не удался (' + batchErr.message + ') — поштучно…');
      await uploadOneByOne(me.login, repoName, files, token, step);
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
    const tries = opts.watchBuild === false ? 2 : 20;
    for (let i = 0; i < tries; i++) {
      try {
        const st = await gh('/repos/' + me.login + '/' + repoName + '/pages', token);
        if (st && st.status && st.status !== 'building' && st.html_url) { url = st.html_url; break; }
      } catch (e) { break; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    step('5/5 ✔ Готово!');
    return { url, repo: repo.html_url, owner: me.login, repoName };
  }

  async function uploadOneByOne(login, repoName, files, token, step) {
    let done = 0;
    for (const f of files) {
      const path = encodeURIComponent(f.path).replace(/%2F/g, '/');
      let sha = null;
      try { const cur = await gh('/repos/' + login + '/' + repoName + '/contents/' + path, token); sha = cur && cur.sha; } catch (e) { if (e.status !== 404) throw e; }
      await gh('/repos/' + login + '/' + repoName + '/contents/' + path, token, {
        method: 'PUT', body: { message: 'WebStudio: ' + (sha ? 'update ' : 'add ') + f.path, content: b64(f.content), ...(sha ? { sha } : {}) },
      });
      done++;
      if (done % 3 === 0 || done === files.length) step('3/5 Файлы: ' + done + '/' + files.length + ' — ' + f.path);
    }
  }

  window.Publisher = { publish, checkToken, slugify, LS_TOKEN };
})();
