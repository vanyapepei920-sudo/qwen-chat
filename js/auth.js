/* ═══════════ auth.js — вход через Google (Firebase Auth), без бэкенда ═══════════
   Один index.html + js/ + css/ работают где угодно: GitHub Pages, Termux `python -m http.server`,
   локальный файл. Аккаунты Google проверяются на лету через Firebase Authentication.

   КУДА ВСТАВИТЬ GOOGLE API KEY (нужно один раз) — три способа:
     1) Прямо в этом файле: ниже в DEFAULTS замените заглушку "AIzaXXXX..."
        на ваш ключ (AIzaSy...) и clientId ("числа.apps.googleusercontent.com").
     2) Без правки файлов: откройте сайт с адресом
        index.html?key=AIzaSy...&client=XXXX.apps.googleusercontent.com
        — ключи сохранятся в localStorage браузера автоматически.
     3) На сайте: вкладка «Настройки» → блок «🔑 Google Sign-In».
   Значения из Firebase Console: Project settings → Your apps (Web) → API key / Client ID.
   Для продакшена добавьте домен сайта в Firebase Auth → Settings → Authorized domains. */
"use strict";

var AUTH = (() => {
  const LS_KEY = "sn_auth_v1";
  const $ = (s) => document.querySelector(s);

  /* ═══ КУДА ВСТАВИТЬ GOOGLE API KEY (один раз, вместо XXXXXXX...) ═══
     Это Firebase/Google Cloud API-ключ (начинается с AIza...).
     Как получить: https://console.cloud.google.com/apis/credentials →
     «Create credentials» → «API key». Ключ публичный (виден в коде сайта),
     поэтому ОБЯЗАТЕЛЬНО ограничьте его в Google Cloud Console:
       Applications → HTTP referrers → домен вашего сайта;
       APIs → разрешите только «Firebase Authentication API» / «Google Identity».

     Три способа задать ключ — любой:
       1) Впишите сюда вместо заглушки: apiKey: "AIzaSy..." и clientId: "...".
       2) Откройте сайт с параметрами: index.html?key=AIzaSy...&client=XXXX.apps.googleusercontent.com
          (сохранится в localStorage браузера, адресная строка очистится).
       3) На сайте: вкладка «Настройки» → блок «🔑 Google Sign-In».
     Приоритет: сохранённые значения (2/3) > ключи из этого файла. */
  const DEFAULTS = {
    apiKey: "AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", // ← ваш Google API key сюда
    clientId: "",    // ← сюда же можно вписать OAuth Client ID (…apps.googleusercontent.com)
    appId: "",       // ← номер проекта Firebase (необязательно)
  };

  // Перехват ключей из URL (?key=...&client=...&app=...) — сохраняем и чистим адресную строку
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("key") || q.has("client")) {
      const cur = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      if (q.get("key")) cur.apiKey = q.get("key").trim();
      if (q.get("client")) cur.clientId = q.get("client").trim();
      if (q.get("app")) cur.appId = q.get("app").trim();
      localStorage.setItem(LS_KEY, JSON.stringify(cur));
      history.replaceState(null, "", location.pathname);
    }
  } catch (e) {}

  function cfg() {
    try {
      const c = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || "{}"));
      // заглушка-ключ из файла не считается настоящим ключом
      if (!/^AIza[0-9A-Za-z_\-]{20,}$/.test(c.apiKey || "")) c.apiKey = "";
      return c;
    }
    catch (e) { return Object.assign({}, DEFAULTS, { apiKey: "" }); }
  }
  function saveCfg(o) { localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(cfg(), o))); }

  let user = null;
  const listeners = [];
  function emit() { listeners.forEach((f) => { try { f(user); } catch (e) {} }); }

  /* ───────── статус-чип в топбаре ───────── */
  function renderChip() {
    const chip = $("#userChip"); if (!chip) return;
    const name = $("#ucName"), av = $("#ucAvatar"), out = $("#ucOut");
    if (user) {
      name.textContent = (user.displayName || user.email || "user").split(" ")[0];
      if (av && user.photoURL) { av.src = user.photoURL; av.hidden = false; }
      if (out) { out.href = "#"; out.textContent = "⎋"; out.onclick = (e) => { e.preventDefault(); signOut(); }; }
      chip.title = "Вы вошли через Google: " + (user.email || "");
      chip.classList.remove("auth-off");
    } else {
      name.textContent = "Войти через Google";
      if (av) av.hidden = true;
      if (out) { out.textContent = "→"; out.onclick = (e) => { e.preventDefault(); signIn(); }; }
      chip.title = "Нажмите, чтобы войти через аккаунт Google";
      chip.classList.add("auth-off");
    }
  }

  /* ───────── оверлей «нужен вход» ───────── */
  function showGate() {
    if ($("#authGate")) return;
    const div = document.createElement("div");
    div.id = "authGate";
    div.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(4,8,16,.92);backdrop-filter:blur(10px);padding:1rem;text-align:center;color:#e8ecf5;font-family:inherit";
    div.innerHTML = `<div style="max-width:460px;background:#0c1424;border:1px solid rgba(120,160,255,.25);border-radius:20px;padding:2rem 1.6rem;box-shadow:0 30px 80px rgba(0,0,0,.6)">
      <div style="font-size:2.6rem">🔐</div>
      <h2 style="margin:.6rem 0 .3rem">SpeedNet — только для вошедших</h2>
      <p style="color:#9fb4d8;font-size:.9rem;margin:.3rem 0 1.2rem">Сайт работает без сервера (один index.html), но вход обязателен — через настоящий аккаунт Google.</p>
      <button id="gateSignin" style="display:inline-flex;gap:.6rem;align-items:center;background:#fff;color:#1f1f1f;border:0;border-radius:10px;padding:.75rem 1.4rem;font-weight:700;font-size:1rem;cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.7 1.22 9.2 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.55-4.2 7.09-10.39 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.78 24c0-1.6.28-3.14.75-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.44-5.01 2.33-8.16 2.33-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        Войти через Google</button>
      <p id="gateHint" style="color:#6f86ad;font-size:.75rem;margin-top:1rem"></p>
    </div>`;
    document.body.appendChild(div);
    div.querySelector("#gateSignin").onclick = () => signIn();
    if (!cfg().apiKey || !cfg().clientId) {
      div.querySelector("#gateHint").innerHTML = "⚠ Сначала впишите ваши Google-ключи: они хранятся в localStorage.<br>Если вы уже залогинены в другом месте этого браузера — ключи подтянутся автоматически.";
    }
  }
  function hideGate() { const g = $("#authGate"); if (g) g.remove(); }

  /* ───────── Firebase (SDK грузится с CDN, если есть ключи) ───────── */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("не удалось загрузить " + src));
      document.head.appendChild(s);
    });
  }

  async function initFirebase() {
    const c = cfg();
    if (!c.apiKey || !c.clientId) return false;
    if (!window.firebase) {
      await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js");
    }
    if (!firebase.apps.length) firebase.initializeApp({ apiKey: c.apiKey, authDomain: location.hostname || "localhost" });
    return true;
  }

  /* ───────── вход ───────── */
  async function signIn() {
    const c = cfg();
    if (c.apiKey && c.clientId) {
      try {
        await initFirebase();
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        // popup надёжнее редиректа на статическом хостинге / в Termux
        const res = await firebase.auth().signInWithPopup(provider);
        onSignedIn(res.user);
        return;
      } catch (e) {
        console.warn("popup-вход не удался, пробую redirect:", e.message);
        try { await firebase.auth().signInWithRedirect(new firebase.auth.GoogleAuthProvider()); return; }
        catch (e2) { toast("✖ Вход через Google: " + e2.message, "err"); return; }
      }
    }
    // нет ключей Firebase → гостевой режим с именем (для локальной разработки)
    const nm = prompt("Google-ключи ещё не настроены (см. Настройки → Google Sign-In).\nВведите имя для гостевого входа (demo-режим):", "Гость");
    if (!nm) return;
    user = { displayName: nm.trim(), email: nm.trim().toLowerCase().replace(/\s+/g, ".") + "@guest.local", photoURL: "", guest: true };
    sessionStorage.setItem("sn_guest", JSON.stringify(user));
    afterAuth();
  }

  function onSignedIn(u) {
    user = {
      displayName: u.displayName, email: u.email, uid: u.uid,
      photoURL: u.photoURL || "", provider: "google",
    };
    sessionStorage.setItem("sn_fb_user", JSON.stringify(user));
    afterAuth();
  }

  /* ───────── выход ───────── */
  async function signOut() {
    try { if (window.firebase && firebase.auth().currentUser) await firebase.auth().signOut(); } catch (e) {}
    sessionStorage.removeItem("sn_fb_user"); sessionStorage.removeItem("sn_guest");
    user = null; afterAuth();
    toast("Вы вышли из аккаунта", "ok");
  }

  /* ───────── восстановление сессии при загрузке ───────── */
  async function boot() {
    try {
      const fb = JSON.parse(sessionStorage.getItem("sn_fb_user") || "null");
      const gu = JSON.parse(sessionStorage.getItem("sn_guest") || "null");
      if (fb) { user = fb; }
      else if (gu) { user = gu; }
      else if (window.firebase === undefined && cfg().apiKey && cfg().clientId) {
        // дождаться возможного redirect-колбэка от Firebase
        try {
          await initFirebase();
          await new Promise((res) => {
            const off = firebase.auth().onAuthStateChanged((u) => { off(); if (u) onSignedIn(u); res(); });
            setTimeout(() => { off(); res(); }, 4000);
          });
        } catch (e) { /* ключи битые — покажем gate */ }
      }
    } catch (e) {}
    afterAuth(false);
  }

  function afterAuth(scrollToSettings = true) {
    renderChip();
    if (user) hideGate(); else showGate();
    listeners.forEach((f) => { try { f(user); } catch (e) {} });
    if (!user && scrollToSettings) {
      // подсказать, где вставить ключи
      const tab = document.querySelector('[data-tab="settings"]');
      if (tab && !cfg().apiKey) setTimeout(() => tab.click(), 300);
    }
  }

  /* ───────── панель настроек (ключи Google) ───────── */
  function injectSettings() {
    const panel = document.getElementById("panel-settings");
    if (!panel || document.getElementById("authKeysBox")) return;
    const box = document.createElement("div");
    box.id = "authKeysBox";
    box.className = "card";
    box.style.marginTop = "1rem";
    box.innerHTML = `<h3>🔑 Google Sign-In (ключи для входа)</h3>
      <p class="hint">Работает без app.py: вход идёт напрямую в Firebase Authentication. Получите значения в <a href="https://console.firebase.google.com" target="_blank" style="color:var(--accent)">console.firebase.google.com</a> → Project settings → Your apps (Web). Клиент ID берётся там же в Auth → Sign-in method → Google.</p>
      <label>Firebase API key <input id="akApiKey" type="password" placeholder="AIza..." autocomplete="off"></label>
      <label>OAuth Client ID <input id="akClientId" type="text" placeholder="123456789-xxxx.apps.googleusercontent.com"></label>
      <label>App ID (номер проекта, необязательно) <input id="akAppId" type="text" placeholder="1:1234567890:web:..."></label>
      <div style="display:flex;gap:.6rem;margin-top:.8rem;flex-wrap:wrap">
        <button class="btn btn-primary" id="akSave">💾 Сохранить ключи</button>
        <button class="btn btn-ghost" id="akTest">▶ Попробовать вход сейчас</button>
        <button class="btn btn-ghost" id="akWipe">✖ Забыть ключи</button>
      </div>
      <p class="hint" id="akStatus" style="margin-top:.6rem"></p>`;
    panel.appendChild(box);
    const c = cfg();
    box.querySelector("#akApiKey").value = c.apiKey || "";
    box.querySelector("#akClientId").value = c.clientId || "";
    box.querySelector("#akAppId").value = c.appId || "";
    box.querySelector("#akStatus").textContent = c.apiKey && c.clientId ? "✔ Ключи сохранены — вход через Google активен." : "⚠ Ключей нет — сайт пустит только в demo-гостевой режим.";
    box.querySelector("#akSave").onclick = () => {
      saveCfg({
        apiKey: box.querySelector("#akApiKey").value.trim(),
        clientId: box.querySelector("#akClientId").value.trim(),
        appId: box.querySelector("#akAppId").value.trim(),
      });
      box.querySelector("#akStatus").textContent = "✔ Сохранено в этом браузере. Перезагрузите страницу для инициализации Firebase.";
      toast("Ключи Google сохранены", "ok");
    };
    box.querySelector("#akTest").onclick = () => signIn();
    box.querySelector("#akWipe").onclick = () => { localStorage.removeItem(LS_KEY); location.reload(); };
  }

  /* ───────── публичный API ───────── */
  function getUser() { return user; }
  function isAuthed() { return !!user; }
  function onChange(fn) { listeners.push(fn); fn(user); }

  document.addEventListener("DOMContentLoaded", () => { boot(); setTimeout(injectSettings, 100); });

  window.AUTH = { getUser, isAuthed, onChange, signIn, signOut, cfg };
  return { getUser, isAuthed, onChange, signIn, signOut, cfg };
})();
