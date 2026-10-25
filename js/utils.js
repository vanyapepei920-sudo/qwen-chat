'use strict';
const API = 'https://api.github.com';
const TKEY = 'syntheco_token';

function getToken() { return localStorage.getItem(TKEY) || ''; }
function setToken(t) { t ? localStorage.setItem(TKEY, t.trim()) : localStorage.removeItem(TKEY); }

async function gh(url, opts = {}) {
  const headers = Object.assign({ 'Accept': 'application/vnd.github+json', 'User-Agent': 'syntheco' }, opts.headers || {});
  const tok = getToken();
  if (tok) headers['Authorization'] = 'Bearer ' + tok;
  if (opts.body && typeof opts.body === 'object') { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
  const r = await fetch(API + url, { ...opts, headers });
  if (!r.ok) {
    let msg = r.status + '';
    try { const j = await r.json(); msg = j.message || msg; } catch (e) {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}

function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? '' : ' err');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

let _modalResolve = null;
function modal(title, bodyHTML) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modalBack').hidden = false;
  return new Promise(res => { _modalResolve = res; });
}
function closeModal() { document.getElementById('modalBack').hidden = true; if (_modalResolve) { _modalResolve(false); _modalResolve = null; } }
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modalOk').onclick = () => {
    document.getElementById('modalBack').hidden = true;
    if (_modalResolve) { _modalResolve(document.getElementById('modalBody')); _modalResolve = null; }
  };
});

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function logLine(id, txt, cls = '') {
  const ul = document.getElementById(id);
  if (ul.firstElementChild && ul.firstElementChild.classList.contains('muted')) ul.innerHTML = '';
  const li = document.createElement('li');
  li.className = cls; li.textContent = txt;
  ul.prepend(li);
}
