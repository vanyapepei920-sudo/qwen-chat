/* ===== страница Мониторинга: uptime-проверки, subnet-калькулятор, конвертер ===== */
(function(){
const K=window.NPK,$=K.$,nf=K.nf;

async function api(url,opt){const r=await fetch(url,{credentials:'include',...opt});return r.json();}

/* --- monitors --- */
async function loadMonitors(){
  const el=$('#mList'); if(!el)return;
  const j=await api('/api/monitors');
  if(!j.ok){el.innerHTML='<small style="opacity:.6">Не удалось загрузить</small>';return;}
  $('#mCount').textContent=j.monitors.length+' '+K.plural(j.monitors.length,'сайт','сайта','сайтов');
  if(!j.monitors.length){el.innerHTML='<div class="empty">Добавьте первый сайт для мониторинга</div>';return;}
  el.innerHTML=j.monitors.map(m=>{
    const last=m.last, ok=last&&last.ok, st=!last?'—':(ok?'UP':'DOWN');
    const up=m.uptime_24h==null?'—':nf(m.uptime_24h,1)+'%';
    return '<div class="mon-row'+(ok===false?' down':'')+'">'+
      '<span class="mon-dot '+(ok===null?'idle':ok?'on':'off')+'"></span>'+
      '<div class="mon-main"><b>'+(m.name||m.url).replace(/</g,'&lt;')+'</b>'+
      '<a href="'+m.url+'" target="_blank" rel="noopener">'+m.url.replace(/</g,'&lt;')+'</a>'+
      '<small>каждые '+Math.round(m.interval_sec/60)+' мин · статус '+(last&&last.status!=null?last.status:'—')+
      (last&&last.latency_ms!=null?' · '+nf(last.latency_ms,0)+' мс':'')+(last&&last.error?' · '+last.error.slice(0,60):'')+'</small></div>'+
      '<div class="mon-side"><span class="badge '+(ok?'good':'bad')+'">'+st+'</span>'+
      '<span class="tag">24ч: '+up+' ('+(m.checks_24h||0)+')</span></div>'+
      '<div class="mon-acts">'+
        '<button class="btn sm ghost" data-run="'+m.id+'" title="Проверить сейчас">⟳</button>'+
        '<button class="btn sm ghost" data-toggle="'+m.id+'" title="Вкл/выкл">'+(m.enabled?'⏸':'▶')+'</button>'+
        '<button class="btn sm ghost danger" data-del="'+m.id+'" title="Удалить">✕</button>'+
      '</div></div>';
  }).join('');
}
$('#mForm').onsubmit=async e=>{
  e.preventDefault();
  const url=$('#mUrl').value.trim(); if(!url)return;
  K.setLoader(true,'Проверяем…',url);
  const j=await api('/api/monitors',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url,name:$('#mName').value.trim(),interval_sec:Number($('#mInterval').value)})});
  K.setLoader(false);
  if(!j.ok){K.toast('Ошибка: '+(j.error||'неизвестно'),'err');return;}
  K.toast(j.result.ok?'Сайт добавлен и доступен ✅':'Сайт добавлен, но не отвечает ⚠️', j.result.ok?'ok':'warn');
  $('#mUrl').value='';$('#mName').value='';loadMonitors();
};
$('#mList').onclick=async e=>{
  const b=e.target.closest('button'); if(!b)return;
  if(b.dataset.run){b.disabled=true;const j=await api('/api/monitors/'+b.dataset.run+'/run',{method:'POST'});b.disabled=false;
    if(j.ok){K.toast(j.result.ok?'Доступен ('+j.result.status+', '+nf(j.result.latency_ms,0)+' мс)':'Недоступен: '+(j.result.error||j.result.status),j.result.ok?'ok':'err');loadMonitors();}}
  if(b.dataset.toggle){await api('/api/monitors/'+b.dataset.toggle+'/toggle',{method:'POST'});loadMonitors();}
  if(b.dataset.del){if(!confirm('Удалить монитор?'))return;await api('/api/monitors/'+b.dataset.del,{method:'DELETE'});loadMonitors();}
};
loadMonitors(); setInterval(loadMonitors,30000);

/* --- subnet calc --- */
$('#subForm').onsubmit=async e=>{
  e.preventDefault();
  const v=$('#subIp').value.trim(); if(!v)return;
  let ip=v,pref='';
  if(v.includes('/')){[ip,pref]=v.split('/');}else{pref=prompt('Префикс маски (например 24):','24')||'24';}
  const j=await api('/api/tools/subnet?ip='+encodeURIComponent(ip)+'&prefix='+encodeURIComponent(pref));
  const out=$('#subOut');
  if(!j.ok){out.innerHTML='<div class="k">Ошибка</div><div class="v">'+(j.error||'')+'</div>';return;}
  out.innerHTML=[['CIDR',j.cidr],['Сеть',j.network],['Маска',j.netmask],['Wildcard',j.wildcard],
    ['Broadcast',j.broadcast],['Первый хост',j.first_host],['Последний хост',j.last_host],
    ['Всего адресов',j.total.toLocaleString('ru-RU')],['Доступно хостов',j.usable.toLocaleString('ru-RU')]]
    .map(([k,v])=>'<div class="k">'+k+'</div><div class="v">'+(v??'—')+'</div>').join('');
};

/* --- hash + base64 (через публичный API с автоподстановкой ключа из localStorage) --- */
$('#hashForm').onsubmit=async e=>{
  e.preventDefault();
  const t=$('#hashText').value.trim(); if(!t)return;
  const out=$('#hashOut'); out.innerHTML='<small style="opacity:.6">Считаю…</small>';
  try{
    const j=await api('/api/v1/hash?text='+encodeURIComponent(t)+'&algo=all',{credentials:'omit'});
    const b=await api('/api/v1/encode?text='+encodeURIComponent(t)+'&mode=base64&op=encode',{credentials:'omit'});
    if(!j.ok){out.innerHTML='<div class="k">Ошибка</div><div class="v">'+(j.hint||j.error||'')+'</div>';return;}
    out.innerHTML=Object.entries(j.hashes).map(([k,v])=>'<div class="k">'+k+'</div><div class="v" style="word-break:break-all;font-family:var(--mono);font-size:11.5px">'+v+'</div>').join('')+
      '<div class="k">base64</div><div class="v" style="word-break:break-all;font-family:var(--mono);font-size:11.5px">'+(b.result||'—')+'</div>';
  }catch(err){out.innerHTML='<div class="k">Сбой</div><div class="v">'+err+'</div>';}
};

/* --- uuid generator + qr --- */
$('#uuidForm').onsubmit=async e=>{
  e.preventDefault();
  const j=await api('/api/v1/uuid?n='+($('#uuidN').value||3)+'&kind='+$('#uuidKind').value,{credentials:'omit'});
  $('#uuidOut').innerHTML=j.ok?j.values.map(v=>'<div style="padding:2px 0">'+v+'</div>').join(''):('<small>'+(j.hint||j.error||'ошибка')+'</small>');
};
$('#qrForm').onsubmit=async e=>{
  e.preventDefault();
  const t=$('#qrText').value.trim(); if(!t)return;
  const r=await fetch('/api/v1/qrcode?text='+encodeURIComponent(t),{credentials:'omit'});
  const ct=r.headers.get('Content-Type')||'';
  if(r.ok&&ct.includes('svg')){$('#qrOut').innerHTML=await r.text();$('#qrOut').firstChild&&( $('#qrOut').querySelector('svg').style.cssText='width:150px;height:150px;background:#fff;border-radius:8px;padding:6px');}
  else{const j=await r.json().catch(()=>({}));$('#qrOut').innerHTML='<small>'+(j.hint||j.error||'не удалось')+'</small>';}
};

/* --- units converter --- */
$('#unitForm').onsubmit=async e=>{
  e.preventDefault();
  const j=await api('/api/tools/units?value='+encodeURIComponent($('#unitVal').value)+'&from='+encodeURIComponent($('#unitFrom').value));
  const out=$('#unitOut');
  if(!j.ok){out.innerHTML='<div class="k">Ошибка</div><div class="v">'+(j.error||'')+'</div>';return;}
  out.innerHTML=Object.entries(j.results).map(([k,v])=>'<div class="k">'+k+'</div><div class="v">'+Number(v).toLocaleString('ru-RU',{maximumFractionDigits:4})+'</div>').join('');
};
})();
