/* Бот-помощник + мобильное меню */
(function(){const K=window.NPK,$=K.$,nf=K.nf;

  /* --- мобильная полоса вкладок: скролл свайпом + автопрокрутка к активной --- */
  function initTabs(){
    const tabs=document.getElementById('tabs'); if(!tabs)return;
    // перетаскивание вкладки пальцем/мышью горизонтально не мешает клику — браузер сам делает scroll по touch
    // доводим активную вкладку в центр полосы при загрузке
    const act=tabs.querySelector('a.active');
    if(act){ try{ tabs.scrollLeft=act.offsetLeft-(tabs.clientWidth-act.offsetWidth)/2; }catch(e){} }
    // плавный скролл колесом мыши (вертикальное колесо -> горизонтальная полоса)
    tabs.addEventListener('wheel',e=>{ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){ tabs.scrollLeft+=e.deltaY; e.preventDefault(); } },{passive:false});
  }
  function syncMobMenu(){} /* legacy: больше не используется */
  initTabs(); /* автозапуск на всех страницах, где есть .tabs */

  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* --- Markdown-lite рендер для ответов бота: **жирный**, *курсив*, `код`, ```блоки кода``` --- */
  function copyCode(btn){
    const pre=btn.parentElement, code=pre.querySelector('code');
    try{ navigator.clipboard.writeText(code.textContent); btn.textContent='Скопировано ✓';
      setTimeout(()=>btn.textContent='Копировать',1500);}catch(e){btn.textContent='Не удалось';}
  }
  window.copyCode=copyCode;
  function renderMd(src){
    const blocks=[];
    // вырезаем fenced-блоки кода ```...``` (с опциональным языком)
    let s=String(src||'').replace(/```(\w*)\n?([\s\S]*?)```/g,(m,lang,code)=>{
      blocks.push({lang:(lang||'').trim(),code}); return '\u0000B'+(blocks.length-1)+'\u0000';});
    // инлайн-код `...`
    const inlines=[];
    s=s.replace(/`([^`\n]+)`/g,(m,c)=>{inlines.push(c); return '\u0000I'+(inlines.length-1)+'\u0000';});
    s=esc(s);
    s=s.replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>');           // **жирный**
    s=s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<i>$2</i>'); // *курсив*
    s=s.replace(/^### (.+)$/gm,'<b style="font-size:14px">$1</b>');
    s=s.replace(/^## (.+)$/gm,'<b style="font-size:14.5px">$1</b>');
    s=s.replace(/^[-•*] (.+)$/gm,'• $1');
    s=s.replace(/\n/g,'<br>');
    s=s.replace(/\u0000I(\d+)\u0000/g,(m,i)=>'<code>'+esc(inlines[+i])+'</code>');
    s=s.replace(/\u0000B(\d+)\u0000/g,(m,i)=>{const b=blocks[+i];
      return '<pre class="code-block">'+(b.lang?'<span class="code-lang">'+esc(b.lang)+'</span>':'')+
        '<button class="code-copy" type="button" onclick="copyCode(this)">Копировать</button>'+
        '<code>'+esc(b.code.replace(/\n$/,''))+'</code></pre>';});
    return s;
  }
  function addMsg(role,text){
    const d=document.createElement('div'); d.className='msg '+role;
    const html=role==='assistant'?renderMd(text):esc(text).replace(/\n/g,'<br>');
    d.innerHTML='<div class="bubble">'+html+'</div>';
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
    const msgEl=addMsg('assistant',''); const bubble=msgEl.querySelector('.bubble');
    bubble.classList.add('typing'); bubble.textContent='▍';
    let acc='', got=false, okEnd=false, streamed=false;
    function paint(){ bubble.innerHTML=renderMd(acc)+'<span class="cursor">▍</span>'; $('#chatLog').scrollTop=1e9; }
    try{
      const r=await fetch('/api/chat/stream',{method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      if(r.ok && (r.headers.get('Content-Type')||'').includes('event-stream')){
        streamed=true;
        const rd=r.body.getReader(), dec=new TextDecoder(); let buf='';
        while(true){
          const {done,value}=await rd.read(); if(done)break;
          buf+=dec.decode(value,{stream:true});
          let i;
          while((i=buf.indexOf('\n'))>=0){
            const line=buf.slice(0,i).trim(); buf=buf.slice(i+1);
            if(!line)continue;
            if(line[0]==='d'){ try{ acc+=(JSON.parse(line.slice(1)).t||''); got=true; paint(); }catch(e){} }
            else if(line[0]==='e'){ try{ okEnd=JSON.parse(line.slice(1)).ok!==false; }catch(e){} }
          }
        }
      } else {
        // fallback: обычный JSON-ответ (старый эндпоинт)
        const j=await r.json().catch(()=>({}));
        acc=j.reply||'⚠ Сеть недоступна'; got=true;
      }
    }catch(e){ acc=acc||'⚠ Сеть недоступна'; got=true; }
    bubble.classList.remove('typing');
    bubble.innerHTML=renderMd(got?acc.trim():'⚠ Пустой ответ, попробуйте ещё раз.');
    btn.disabled=false; $('#chatText').focus();
  }

  if(document.body.dataset.page==='assistant'){
    initTabs(); loadHistory();
    $('#chatForm').onsubmit=e=>{e.preventDefault();send($('#chatText').value);};
    $('#quickList').onclick=e=>{const q=e.target.closest('.q-btn');if(q)send(q.textContent);};
    $('#asClear').onclick=async()=>{if(!confirm('Очистить историю диалога?'))return;
      await fetch('/api/chat',{method:'DELETE',credentials:'include'});loadHistory();};
  } else {
    // на всех страницах: полоса вкладок со скроллом
    initTabs();
  }
})();
