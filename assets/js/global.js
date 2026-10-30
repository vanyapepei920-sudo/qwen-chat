/* Scuarfy Store — общий JS: тосты, выход, Google-кнопка, глобальный поиск */
window.toast = function(msg, kind){
  const box = document.getElementById('toasts'); if(!box) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' '+kind : '');
  el.textContent = msg; box.appendChild(el);
  setTimeout(()=>{el.style.opacity='0'; el.style.transition='.3s'; setTimeout(()=>el.remove(),320);}, 3200);
};

document.addEventListener('DOMContentLoaded', ()=>{
  // выход
  const out = document.getElementById('signOutBtn');
  if(out) out.onclick = async ()=>{
    await fetch('/api/auth/logout',{method:'POST',credentials:'include'});
    location.href='/login';
  };
  // очистка поиска
  const q=document.getElementById('gq'), clr=document.getElementById('gqClr');
  if(q&&clr){
    const upd=()=>clr.style.display=q.value?'block':'none';
    q.addEventListener('input',upd); upd();
    clr.onclick=()=>{q.value='';upd();q.focus();};
  }
  // кнопка Google на страницах входа/регистрации
  if(window.gsi && window.SF && SF.clientId){
    try{ google.accounts.id.initialize({client_id:SF.clientId, callback:sfGoogleResponse});
         google.accounts.id.renderButton(document.getElementById('gbtn'),{theme:'outline',size:'large',width:320});
    }catch(e){}
  }
});
async function sfGoogleResponse(resp){
  const r = await fetch('/api/auth/google',{method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:resp.credential})});
  const j = await r.json();
  if(j.ok) location.href='/store';
  else toast('Не удалось войти через Google','err');
}
window.sfDemoLogin = async function(btn){
  if(btn){btn.disabled=true;btn.textContent='Вход…';}
  const r = await fetch('/api/auth/demo',{method:'POST',credentials:'include'}).then(x=>x.json()).catch(()=>({ok:false}));
  if(r.ok) location.href='/store';
  else { toast('Демо-вход отключён','err'); if(btn){btn.disabled=false;btn.textContent='Войти в демо‑режим';} }
};
/* утилита экранирования для остальных скриптов */
window.escHTML = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
