(function(){const K=window.NPK,$=K.$,nf=K.nf,page=document.body.dataset.page;
  K.renderUser(window.NP.user);

  if(page==='history'){
    const chart=K.Chart.make($('#hChart'),{fill:false,color:['#00e5ff','#3ddc97','#c9b6ff']});
    function drawTrend(rows){const c=chart.ctx,W=chart.w,H=chart.h;if(!c||!W||!H||!rows.length)return;
      const pL=44,pR=12,pT=14,pB=24,iw=W-pL-pR,ih=H-pT-pB;c.clearRect(0,0,W,H);
      const max=Math.max(10,...rows.map(r=>Math.max(r.down||0,(r.up||0))))*1.15;
      const X=i=>pL+(rows.length>1?i/(rows.length-1):0.5)*iw,Y=v=>pT+ih-(v/max)*ih;
      c.strokeStyle='rgba(255,255,255,.055)';c.fillStyle='rgba(137,144,168,.75)';c.font='10px "JetBrains Mono",monospace';
      for(let i=0;i<=4;i++){const y=pT+(ih/4)*i;c.beginPath();c.moveTo(pL,y);c.lineTo(W-pR,y);c.stroke();c.textAlign='right';c.fillText((max-(max/4)*i).toFixed(0),pL-8,y+3.5);}
      const line=(key,col,div)=>{c.beginPath();rows.forEach((r,i)=>{const v=(r[key]||0)/div;i?c.lineTo(X(i),Y(v)):c.moveTo(X(i),Y(v));});c.strokeStyle=col;c.lineWidth=2;c.stroke();};
      line('down','#00e5ff',1);line('up','#3ddc97',1);line('ping','#c9b6ff',10);}
    function badge(v,k){const q=K.quality(v,k);return '<span class="badge '+q[1]+'">'+q[0]+'</span>';}
    async function load(){const rows=(await K.History.load()).slice().reverse();
      const m10=rows.length%10,m100=rows.length%100;const word=(m10===1&&m100!==11)?'запись':(m10>=2&&m10<=4&&(m100<10||m100>=20))?'записи':'записей';
      $('#hCount').textContent=rows.length+' '+word;
      if(!rows.length){$('#hBody').innerHTML='<tr><td colspan="8" class="empty">Пока пусто</td></tr>';return;}
      $('#hBody').innerHTML=rows.slice().reverse().map(x=>{const d=new Date(x.ts);
        return '<tr><td>'+d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+'</td><td>'+(x.kind||'speed')+'</td><td style="color:#8ce9ff">'+nf(x.down,1)+'</td><td style="color:#8affc8">'+nf(x.up,1)+'</td><td>'+nf(x.ping,0)+'</td><td>'+nf(x.jitter,1)+'</td><td>'+nf(x.loss,0)+'%</td><td>'+badge(x.down,'down')+(x.sim?' <span class="badge sim">sim</span>':'')+'</td></tr>';}).join('');
      drawTrend(rows);}
    $('#hClear').onclick=async()=>{if(!confirm('Удалить всю историю?'))return;await K.History.clear();load();K.toast('История очищена','ok',2200);};
    $('#hExport').onclick=async()=>{const rows=await K.History.load();const blob=new Blob([JSON.stringify(rows,null,1)],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='netpulse-history.json';a.click();K.toast('Экспорт готов','ok',2200);};
    load();
  }

  if(page==='settings'){
    const u=window.NP.user||{};$('#setName').textContent=u.name||'—';$('#setMail').textContent=u.email||'—';
    $('#setSub').textContent=u.sub||'—';$('#setReg').innerHTML=u.registered?'<span class="badge good">зарегистрирован</span>':'<span class="badge mid">гость/демо</span>';
    $('#setUA').textContent=navigator.userAgent.slice(0,90)+'…';$('#setScreen').textContent=screen.width+'×'+screen.height;
    $('#setLang').textContent=navigator.language+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone;
    K.Prefs.load().then(p=>{$('#setUnits').value=p.units||'mbps';$('#setWindow').value=String(p.windowMs||60000);
      $('#setAutoLive').checked=!!p.autoLive;$('#setHz').value=String(p.hz||1);});
    const bind=(id,key,cast)=>{const el=$(id);el.onchange=()=>K.Prefs.set(key,cast?cast(el.value):el.value).then(()=>K.toast('Сохранено','ok',1500));};
    bind('#setUnits','units');bind('#setWindow','windowMs',Number);bind('#setHz','hz',Number);
    $('#setAutoLive').onchange=e=>K.Prefs.set('autoLive',e.target.checked).then(()=>K.toast('Сохранено','ok',1500));
    $('#setReauth').onclick=()=>{try{if(window.google&&google.accounts&&google.accounts.id)google.accounts.id.disableAutoSelect();}catch(e){}localStorage.removeItem('np_last_user');location.href='/login';};
    $('#setWipeLocal').onclick=()=>{['np_hist_local','np_prefs','np_demo','np_last_user'].forEach(k=>localStorage.removeItem(k));K.toast('Локальный кеш очищен','ok',2200);};
    $('#setWipeServer').onclick=async()=>{if(!confirm('Удалить историю с сервера?'))return;await K.History.clear();K.toast('Серверная история удалена','ok',2200);};
    fetch('/api/health').then(r=>r.json()).then(j=>{$('#setHealth').innerHTML='ok · google-auth:'+(j.google_auth?'yes':'fallback')+' · search:'+(j.search?'yes':'no');}).catch(()=>$('#setHealth').textContent='недоступен');
  }
})();
