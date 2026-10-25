(function(){const K=window.NPK,$=K.$,esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let mode='web', start=1, lastQ='';
  function skeletons(){let h='';for(let i=0;i<5;i++)h+= mode==='image'
    ? '<div class="s-img"><div class="qw-shimmer" style="width:100%;height:120px;border-radius:12px"></div></div>'
    : '<div class="s-row"><div style="flex:1"><div class="qw-shimmer skel-line" style="width:40%;height:12px;margin-bottom:8px"></div><div class="qw-shimmer" style="width:90%;height:9px;margin:4px 0"></div><div class="qw-shimmer" style="width:70%;height:9px"></div></div></div>';
    $('#sResults').innerHTML=h;$('#sEmpty').style.display='none';}
  function render(d){
    $('#sMeta').textContent=(d.total||'—')+' рез. · '+(d.time||'—')+' с';
    if(!d.items||!d.items.length){$('#sResults').innerHTML='';$('#sEmpty').style.display='block';$('#sEmpty').textContent='Ничего не найдено по запросу «'+d.query+'»';$('#sPager').hidden=true;return;}
    if(mode==='image'){
      $('#sResults').innerHTML='<div class="s-grid">'+d.items.map(it=>
        '<a class="s-card-img" href="'+esc(it.link)+'" target="_blank" rel="noopener">'+
        '<img loading="lazy" src="'+esc(it.thumb||it.link)+'" alt="">'+
        '<span>'+esc(it.display||'')+'</span></a>').join('')+'</div>';
    }else{
      $('#sResults').innerHTML=d.items.map(it=>
        '<a class="s-row" href="'+esc(it.link)+'" target="_blank" rel="noopener">'+
        (it.thumb?'<img class="s-thumb" loading="lazy" src="'+esc(it.thumb)+'" alt="">':'')+
        '<div style="flex:1;min-width:0">'+
        '<div class="s-title">'+esc(it.title)+'</div>'+
        '<div class="s-url">'+esc(it.display||it.link)+'</div>'+
        '<div class="s-snip">'+esc(it.snippet)+'</div></div></a>').join('');
    }
    $('#sEmpty').style.display='none';
    const pages=Math.ceil(start/10);$('#sPageInfo').textContent='стр. '+pages;
    $('#sPrev').disabled=start<=1;$('#sNext').disabled=!d.next;$('#sPager').hidden=false;
  }
  async function run(q,st){
    if(!q){K.toast('Введите запрос','warn',2000);return;}
    lastQ=q;start=st||1;skeletons();K.setLoader(true,'Поиск в Google','«'+q+'» · '+(mode==='image'?'картинки':'веб'));
    try{
      const r=await fetch('/api/search?q='+encodeURIComponent(q)+'&mode='+mode+'&start='+start,{credentials:'include'});
      const j=await r.json();K.setLoader(false);
      if(!r.ok||!j.ok){
        $('#sResults').innerHTML='';$('#sEmpty').style.display='block';
        $('#sEmpty').innerHTML = j.error==='search_not_configured'
          ? '⚠ Поиск Google пока не подключён. Спросите бота-помощника «как включить поиск», чтобы активировать его.'
          : 'Ошибка поиска: '+esc(j.message||j.error||'unknown');
        $('#sPager').hidden=true;return;
      }
      render(j);
    }catch(e){K.setLoader(false);$('#sResults').innerHTML='';$('#sEmpty').style.display='block';$('#sEmpty').textContent='Сервер недоступен: '+e.message;}
  }
  $('#sForm').onsubmit=e=>{e.preventDefault();run($('#sQuery').value.trim(),1);};
  K.$$('#sMode button').forEach(b=>b.onclick=()=>{K.$$('#sMode button').forEach(x=>x.classList.remove('active'));b.classList.add('active');mode=b.dataset.mode;if(lastQ)run(lastQ,1);});
  $('#sPrev').onclick=()=>{if(start>1)run(lastQ,Math.max(1,start-10));};
  $('#sNext').onclick=()=>run(lastQ,start+10);
  K.renderUser(window.NP.user);
})();
