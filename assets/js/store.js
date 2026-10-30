/* ===== Магазин приложений: главная страница (стиль Microsoft Store) ===== */
(function(){
  if(!document.body.dataset.page.match(/^store(?!-admin)/)) return;
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let state={q:'',cat:'all',sort:'popular'};
  let timer=null;

  function starsHTML(rating,votes){
    const r=Math.round(rating||0);
    let s='';for(let i=1;i<=5;i++)s+='<span'+(i<=r?'':' class="dim"')+'>★</span>';
    return '<span class="stars" title="'+(rating?rating.toFixed(1):'нет оценок')+'">'+s+
           (votes?' <b style="color:var(--muted-2);font-weight:500">('+votes+')</b>':'')+'</span>';
  }
  function iconHTML(a,cls){
    if(a.icon_path) return '<div class="st-icon '+(cls||'')+'"><img src="'+esc(a.icon_path)+'" alt=""></div>';
    const em=(a.category_emoji||'📦');
    return '<div class="st-icon '+(cls||'')+'">'+em+'</div>';
  }
  function cardHTML(a){
    return '<div class="app-card glass" data-id="'+a.id+'">'+
      '<div class="row1">'+iconHTML(a)+
        '<div style="min-width:0"><div class="ttl">'+esc(a.title)+'</div>'+
        '<div class="pub">'+esc(a.publisher||'Неизвестный издатель')+'</div></div></div>'+
      '<div class="tagline">'+esc(a.tagline||a.description||'').slice(0,140)+'</div>'+
      '<div class="meta">'+starsHTML(a.rating,a.votes)+
        '<span>⬇ '+a.downloads+'</span><span>'+esc(a.size_h||'—')+'</span></div>'+
      '<button class="btn sm primary dl-btn" data-dl="'+a.id+'">⬇ Получить</button>'+
    '</div>';
  }
  function heroHTML(a){
    return '<div class="hero-card" data-id="'+a.id+'"><div class="hc-body">'+
      iconHTML(a)+'<div class="hc-title">'+esc(a.title)+'</div>'+
      '<div class="hc-sub">'+esc(a.tagline||a.publisher||'')+'</div>'+
      '<div class="hc-sub">'+starsHTML(a.rating,a.votes)+' · ⬇ '+a.downloads+'</div>'+
    '</div></div>';
  }

  async function load(){
    const p=new URLSearchParams({q:state.q,category:state.cat,sort:state.sort});
    const grid=$('#stGrid');
    grid.innerHTML='<div style="grid-column:1/-1" class="qw-shimmer" ></div>'.repeat(0)+
      '<small style="opacity:.6;grid-column:1/-1">Загрузка…</small>';
    try{
      const j=await fetch('/api/store/apps?'+p,{credentials:'include'}).then(r=>r.json());
      if(!j.ok)throw new Error(j.error||'error');
      const items=j.items||[];
      $('#stEmpty').hidden=items.length>0;
      grid.innerHTML=items.map(cardHTML).join('');
      // рекомендованные — только на «всё» без поиска
      const feat=items.filter(a=>a.featured).slice(0,8);
      $('#stFeaturedWrap').hidden=!feat.length;
      $('#stFeatured').innerHTML=feat.map(heroHTML).join('');
      $('#stListTitle').textContent = state.cat==='all' ? '📦 Все приложения'
        : (state.cat+' ('+items.length+')');
    }catch(e){grid.innerHTML='<small style="opacity:.6">Не удалось загрузить: '+esc(e.message)+'</small>';}
  }

  /* первичная отрисовка из серверных данных (без мигания) */
  if(window.STORE_SEED && window.STORE_SEED.length){
    const items=window.STORE_SEED;
    $('#stGrid').innerHTML=items.map(cardHTML).join('');
    const feat=items.filter(a=>a.featured).slice(0,8);
    $('#stFeaturedWrap').hidden=!feat.length;
    $('#stFeatured').innerHTML=feat.map(heroHTML).join('');
  } else load();

  /* события */
  document.addEventListener('click',async e=>{
    const dl=e.target.closest('[data-dl]');
    if(dl){e.stopPropagation();dl.disabled=true;dl.textContent='⬇ Скачивание…';
      try{
        const r=await fetch('/api/store/apps/'+dl.dataset.dl+'/download',{method:'POST',credentials:'include'});
        if(!r.ok)throw new Error('Ошибка скачивания');
        const blob=await r.blob();
        const cd=r.headers.get('Content-Disposition')||'';
        let name='download';const m=cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
        if(m)name=decodeURIComponent(m[1].replace(/"/g,''));
        const url=URL.createObjectURL(blob);const a=document.createElement('a');
        a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);
        toast('Файл «'+name+'» скачан','ok');
      }catch(err){toast(err.message,'err');}
      dl.disabled=false;dl.textContent='⬇ Получить';return;}
    const card=e.target.closest('.app-card,.hero-card');
    if(card){location.href='/store/app/'+card.dataset.id;return;}
    const chip=e.target.closest('.st-chip');
    if(chip){$$('.st-chip').forEach(c=>c.classList.remove('on'));chip.classList.add('on');
      state.cat=chip.dataset.cat;load();return;}
    const sb=e.target.closest('#stSort button');
    if(sb)$$('#stSort button').forEach(b=>{b.classList.toggle('on',b===sb);});
    if(sb){state.sort=sb.dataset.sort;load();}
  });
  $('#stQ').addEventListener('input',e=>{state.q=e.target.value.trim();
    clearTimeout(timer);timer=setTimeout(load,300);});
})();
