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
  const gbtn = document.getElementById('gbtn');
  if(gbtn && window.SF && SF.clientId){
    const render = () => {
      try{
        google.accounts.id.initialize({client_id:SF.clientId, callback:sfGoogleResponse});
        google.accounts.id.renderButton(gbtn,{theme:'outline',size:'large',text:'signin_with',shape:'pill'});
      }catch(e){ if(gbtn) gbtn.innerHTML='<button class="btn" style="width:100%" onclick="sfGoogleFallback()">Войти через Google</button>'; }
    };
    if(window.google && google.accounts) render();
    else window.addEventListener('load', ()=> setTimeout(render, 300));
  }
});
async function sfGoogleResponse(resp){
  const r = await fetch('/api/auth/google',{method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:resp.credential})});
  const j = await r.json();
  if(j.ok){
    const p=new URLSearchParams(location.search);
    let next=p.get('next')||'/store';
    if(!next.startsWith('/')||next.startsWith('//')) next='/store';
    location.href=next;
  } else toast(j.error==='invalid_token'||j.error==='missing_credential'?'Сессия Google недействительна, попробуйте ещё раз':'Не удалось войти через Google (сервер не настроен)','err');
}
window.sfDemoLogin = async function(btn){
  if(btn){btn.disabled=true;btn.textContent='Вход…';}
  const r = await fetch('/api/auth/demo',{method:'POST',credentials:'include'}).then(x=>x.json()).catch(()=>({ok:false}));
  if(r.ok){ const p=new URLSearchParams(location.search); let nx=p.get('next')||'/store'; if(!nx.startsWith('/')||nx.startsWith('//')) nx='/store'; location.href=nx; }
  else { toast('Демо-вход отключён','err'); if(btn){btn.disabled=false;btn.textContent='Войти в демо‑режим';} }
};
/* утилита экранирования для остальных скриптов */
window.escHTML = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* Фолбэк-кнопка, если gsi не отрисовался */
window.sfGoogleFallback = function(){
  if(!(window.google && google.accounts && google.accounts.id)){
    toast('Кнопка Google ещё загружается, попробуйте через секунду','err'); return;
  }
  try{
    google.accounts.id.prompt((n)=>{ if(n.isNotDisplayed()||n.isSkippedMoment()) toast('Google открыл окно входа в другой форме',''); });
  }catch(e){ toast('Не удалось открыть окно Google','err'); }
};
