/* ===== Scuarfy Store: главная страница (поиск, карточки, лайки, скачивание) ===== */
(function(){
  if(!document.body.dataset.page.match(/^store(?!-admin)/)) return;
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=window.escHTML;

  let state={q:(window.SEED_Q||''),sort:'popular'};
  let timer=null;

  function starsHTML(rating,votes){
    const r=Math.round(rating||0);
    let s='';for(let i=1;i<=5;i++)s+='<span'+(i<=r?'':' class="dim"')+'>★</span>';
    return '<span class="stars" title="'+(rating?rating.toFixed(1):'нет оценок')+'">'+s+
           (votes?' <b style="color:var(--ink-2);font-weight:500">('+votes+')</b>':'')+'</span>';
  }
  function iconHTML(a){
    if(a.icon_path) return '<div class="st-icon"><img src="'+esc(a.icon_path)+'" alt=""></div>';
    return '<div class="st-icon">'+esc(a.category_emoji||'📦')+'</div>';
  }
  function cardHTML(a){
    return '<div class="app-card glass" data-pid="'+esc(a.public_id)+'">'+
      '<div class="row1">'+iconHTML(a)+
        '<div style="min-width:0"><div class="ttl">'+esc(a.title)+'</div>'+
        '<div class="pub">'+esc(a.publisher||'Неизвестный издатель')+'</div></div></div>'+
      '<div class="tagline">'+esc((a.tagline||a.description||'').slice(0,140))+'</div>'+
      '<div class="meta">'+starsHTML(a.rating,a.votes)+
        '<span class="like-n'+(a.liked?' on':'')+'" title="Лайки">♥ '+a.likes+'</span>'+
        '<span>⬇ '+a.downloads+'</span><span>'+esc(a.size_h||'—')+'</span></div>'+
      (a.filename
        ? '<a class="btn sm primary dl-btn" href="/api/store/apps/'+encodeURIComponent(a.public_id)+'/download">⬇ Скачать</a>'
        : '<button class="btn sm dl-btn" disabled>Нет файла</button>')+
    '</div>';
  }

  async function load(){
    const p=new URLSearchParams({q:state.q,sort:state.sort});
    const grid=$('#stGrid');
    grid.innerHTML='<div class="st-loading">Загрузка…</div>';
    try{
      const j=await fetch('/api/store/apps?'+p,{credentials:'include'}).then(r=>r.json());
      if(!j.ok)throw new Error(j.error||'error');
      const items=j.items||[];
      $('#stEmpty').hidden=items.length>0;
      grid.innerHTML=items.map(cardHTML).join('');
      $('#stListTitle').textContent = state.q ? ('🔎 Результаты: «'+state.q+'»') : '📦 Все приложения';
    }catch(e){grid.innerHTML='<div class="st-loading">Не удалось загрузить: '+esc(e.message)+'</div>';}
  }

  /* первичная отрисовка из серверных данных */
  if(window.STORE_SEED && window.STORE_SEED.length && !state.q){
    $('#stGrid').innerHTML=window.STORE_SEED.map(cardHTML).join('');
    if(window.STORE_SEED.length) load(); // добираем флаг liked и т.д.
  } else load();

  /* глобальный поиск в шапке — живой поиск на странице магазина */
  const gq=$('#gq');
  if(gq){
    gq.addEventListener('input',e=>{
      state.q=e.target.value.trim();
      clearTimeout(timer);timer=setTimeout(load,300);
    });
    $('#globalSearch').addEventListener('submit',e=>{e.preventDefault();state.q=gq.value.trim();load();});
    if(state.q) gq.value=state.q;
  }

  document.addEventListener('click',async e=>{
    /* кнопка скачивания — качаем файл без перехода на страницу */
    const dlA=e.target.closest('a.dl-btn');
    if(dlA){e.preventDefault();e.stopPropagation();
      const old=dlA.textContent; dlA.textContent='⬇ Скачивание…';
      const fr=document.createElement('iframe'); fr.style.display='none'; fr.src=dlA.href;
      document.body.appendChild(fr);
      try{ toast('Скачивание началось','ok'); }catch(_){}
      setTimeout(()=>{fr.remove();dlA.textContent=old;},2500);
      return;}
    /* клик по карточке/герою → страница приложения (по публичному ID) */
    const card=e.target.closest('.app-card,.hero-card');
    if(card&&card.dataset.pid){location.href='/store/app/'+card.dataset.pid;return;}
    /* сортировка */
    const sb=e.target.closest('#stSort button');
    if(sb){$$('#stSort button').forEach(b=>b.classList.toggle('on',b===sb));
      state.sort=sb.dataset.sort;load();}
  });
})();
