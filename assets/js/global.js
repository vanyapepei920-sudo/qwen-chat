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
  if(!resp || !resp.credential){ toast('Google не вернул токен, попробуйте ещё раз','err'); return; }
  let j;
  try{
    const r = await fetch('/api/auth/google',{method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:resp.credential})});
    j = await r.json();
  }catch(e){ toast('Не удалось связаться с сервером','err'); return; }
  if(j.ok){
    const p=new URLSearchParams(location.search);
    let next=p.get('next')||'/store';
    if(!next.startsWith('/')||next.startsWith('//')) next='/store';
    location.href=next;
  } else {
    let msg = 'Не удалось войти через Google';
    if(j.error==='missing_credential') msg='Сессия Google недействительна — попробуйте ещё раз';
    else if(j.error==='invalid_token') msg='Google-токен отклонён сервером. '+(j.hint||'Проверьте настройку GOOGLE_CLIENT_ID.');
    else if(j.error==='server_not_configured') msg='На сервере не задан GOOGLE_CLIENT_ID (см. .env.example)';
    toast(msg,'err');
    console.error('Google sign-in error:', j);
  }
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
