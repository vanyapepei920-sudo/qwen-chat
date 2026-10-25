/* Бот-помощник + мобильное меню */
(function(){const K=window.NPK,$=K.$,nf=K.nf;

  /* --- мобильный бургер: переносим вкладки в выпадающее меню --- */
  function buildBurger(){
    const nav=document.querySelector('.topnav'); if(!nav||$('#burgerBtn'))return;
    const b=document.createElement('button'); b.className='icon-btn burger'; b.id='burgerBtn'; b.textContent='☰';
    const menu=document.createElement('div'); menu.className='mob-menu glass'; menu.id='mobMenu'; menu.hidden=true;
    nav.insertBefore(b, nav.querySelector('.tabs'));
    nav.appendChild(menu);
    b.onclick=()=>{menu.hidden=!menu.hidden;};
    document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&e.target!==b)menu.hidden=true;});
  }
  function syncMobMenu(){
    const menu=$('#mobMenu'); if(!menu)return;
    const links=[...document.querySelectorAll('.tabs a')];
    menu.innerHTML=links.map(a=>'<a href="'+a.getAttribute('href')+'" class="'+(a.classList.contains('active')?'active':'')+'">'+a.textContent+'</a>').join('');
  }

  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  function addMsg(role,text){
    const d=document.createElement('div'); d.className='msg '+role;
    d.innerHTML='<div class="bubble">'+esc(text).replace(/\n/g,'<br>')+'</div>';
    $('#chatLog').appendChild(d); $('#chatLog').scrollTop=1e9; return d;
  }

  async function loadHistory(){
    try{
      const j=await fetch('/api/chat',{credentials:'include'}).then(r=>r.json());
      if(!j.ok)return;
      $('#asStatus').textContent=j.assistant_ready?'Помощник готов ✅':'Помощник не подключён ⚠';
      if(j.messages.length){const log=$('#chatLog');log.innerHTML='';
        j.messages.forEach(m=>addMsg(m.role==='user'?'user':'assistant',m.text));}
    }catch(e){$('#asStatus').textContent='сервер недоступен';}
  }

  async function send(text){
    text=(text||'').trim(); if(!text)return;
    addMsg('user',text); $('#chatText').value='';
    const btn=$('#chatSend'); btn.disabled=true;
    const typing=addMsg('assistant','печатает…'); typing.querySelector('.bubble').classList.add('typing');
    try{
      const r=await fetch('/api/chat',{method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      const j=await r.json();
      typing.querySelector('.bubble').classList.remove('typing');
      typing.querySelector('.bubble').innerHTML=esc(j.reply||'…').replace(/\n/g,'<br>');
    }catch(e){typing.querySelector('.bubble').textContent='⚠ Сеть недоступна';}
    btn.disabled=false; $('#chatText').focus();
  }

  if(document.body.dataset.page==='assistant'){
    buildBurger(); syncMobMenu(); loadHistory();
    $('#chatForm').onsubmit=e=>{e.preventDefault();send($('#chatText').value);};
    $('#quickList').onclick=e=>{const q=e.target.closest('.q-btn');if(q)send(q.textContent);};
    $('#asClear').onclick=async()=>{if(!confirm('Очистить историю диалога?'))return;
      await fetch('/api/chat',{method:'DELETE',credentials:'include'});loadHistory();};
  } else {
    // на всех страницах: гарантируем бургер для узких экранов
    buildBurger(); syncMobMenu();
  }
})();
