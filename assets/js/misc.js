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
    const exCsv=$('#hExportCsv');if(exCsv)exCsv.onclick=()=>{location.href='/api/history/export?format=csv';K.toast('Скачиваем CSV…','ok',2200);};
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
    $('#setWipeServer').onclick=async()=>{if(!confirm('Удалить всю историю измерений?'))return;await K.History.clear();K.toast('История удалена','ok',2200);};
    fetch('/api/health').then(r=>r.json()).then(j=>{$('#setHealth').innerHTML='ok · google-auth:'+(j.google_auth?'yes':'fallback')+' · search:'+(j.search?'yes':'no');}).catch(()=>$('#setHealth').textContent='недоступен');

    /* --- Developer API ключи (sp-test-… / sp-live-…) --- */
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let KEYS=[];
    function statusBadge(k){
      if(k.revoked) return ' <span class="badge bad">отозван</span>';
      if(!k.active) return ' <span class="badge mid">выключен</span>';
      if(k.expires_at && new Date(k.expires_at) < new Date()) return ' <span class="badge bad">истёк</span>';
      return ' <span class="badge good">активен</span>';
    }
    async function loadKeys(){const j=await fetch('/api/devkeys',{credentials:'include'}).then(r=>r.json());
      if(!j.ok)return; KEYS=j.keys;
      $('#dkBody').innerHTML=j.keys.length?j.keys.map(k=>'<tr><td>'+esc(k.name)+statusBadge(k)+
        (k.note?'<br><small style="color:var(--muted-2)">'+esc(k.note)+'</small>':'')+'</td>'+
        '<td style="font-family:var(--mono);font-size:12px">'+esc(k.key_prefix||'')+
        '<br><span class="badge '+(k.env==='live'?'good':'mid')+'">'+esc(k.env||'test')+'</span></td>'+
        '<td>'+(k.scopes||'basic').split(',').map(s=>'<span class="badge mid">'+esc(s)+'</span>').join(' ')+
        ((k.allowed_origins&&k.allowed_origins!=='*')?'<br><small style="color:var(--muted-2)">'+esc(k.allowed_origins)+'</small>':'')+'</td>'+
        '<td>'+k.rate_limit+'/мин'+(k.quota_day?'<br><small style="color:var(--muted-2)">'+k.quota_day+'/сут</small>':'')+'</td>'+
        '<td>'+(k.calls||0)+'</td><td>'+esc(k.last_used||'никогда')+'</td>'+
        '<td style="text-align:right;white-space:nowrap">'+
        '<button class="btn sm ghost" data-edit="'+k.id+'">⚙ Изменить</button> '+
        '<button class="btn sm ghost" data-tog="'+k.id+'" data-on="'+(k.active?1:0)+'"'+(k.revoked?' disabled':'')+'>'+(k.active?'⏸ Выкл':'▶ Вкл')+'</button> '+
        (k.revoked
          ?'<button class="btn sm ghost" data-unrev="'+k.id+'">↩ Вернуть</button> '
          :'<button class="btn sm ghost warn" data-rev="'+k.id+'">🚫 Отозвать</button> ')+
        '<button class="btn sm ghost" data-rot="'+k.id+'">🔄 Ротация</button> '+
        '<button class="btn sm ghost danger" data-del="'+k.id+'">✕</button></td></tr>').join('')
        :'<tr><td colspan="7" class="empty">Ключей пока нет — создайте первый</td></tr>';
    }
    function showNewKey(raw,label){const box=$('#dkNew');box.hidden=false;
      box.innerHTML='<div class="kv"><div class="k">'+label+' <b>(показан один раз!)</b></div>'+        '<div class="v" style="font-family:var(--mono);word-break:break-all">'+esc(raw)+        ' <button class="btn sm" id="dkCopyNew">Копировать</button></div></div>';      $('#dkCopyNew').onclick=()=>{navigator.clipboard.writeText(raw);K.toast('Скопировано','ok',1500);};}
    $('#dkForm').onsubmit=async e=>{e.preventDefault();
      let scopes=[...document.querySelectorAll('#dkForm input.chk[value]:checked')].map(i=>i.value);
      if($('#dkAll').checked) scopes=['all'];   // all = доступ ко всем сервисам сразу
      if(!scopes.length) scopes=['basic'];
      const body={name:$('#dkName').value||'api key',env:$('#dkEnv').value,scopes,
        rate_limit:Number($('#dkRate').value),quota_day:Number($('#dkQuota').value||0),
        allowed_origins:$('#dkOrigins').value.trim()||'*',expires_days:Number($('#dkExpires').value),
        note:$('#dkNote').value.trim()};
      const j=await fetch('/api/devkeys',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)}).then(r=>r.json());
      if(j.ok){showNewKey(j.key,'Новый ключ');
        const sb=$('#dkNew .kv');if(sb&&j.secret){const d=document.createElement('div');d.className='k';d.textContent='Webhook secret';
        const v=document.createElement('div');v.className='v';v.style.fontFamily='var(--mono)';v.textContent=j.secret;sb.append(d,v);}
        $('#dkName').value='';$('#dkQuota').value='';$('#dkOrigins').value='';$('#dkNote').value='';loadKeys();}
    };
    /* --- панель редактирования ключа --- */
    function editPanel(k){
      return '<div class="dk-edit"><b style="font-size:13px">⚙ Настройки ключа «'+esc(k.name)+'» <span class="badge '+(k.env==='live'?'good':'mid')+'">'+esc(k.env)+'</span></b>'+      '<div class="dk-grid">'+      '<label>Название<input class="inp" id="edName" value="'+esc(k.name)+'"></label>'+      '<label>Лимит зап./мин<select class="sel" id="edRate">'+[30,60,120,300,600].concat([1000000]).map(v=>'<option value="'+v+'"'+(v==k.rate_limit?' selected':'')+'>'+(v===1000000?'∞ без лимита':v)+'</option>').join('')+'</select></label>'+      '<label>Дневная квота (0=∞)<input class="inp" id="edQuota" type="number" min="0" value="'+(k.quota_day||0)+'"></label>'+      '<label>Scopes<span style="display:flex;gap:8px;flex-wrap:wrap">'+['basic','net','search','all'].map(s=>'<label style="display:flex;gap:4px;align-items:center;font-size:12px"><input type="checkbox" class="chk edScope" value="'+s+'"'+((k.scopes||'').split(',').includes(s)?' checked':'')+'>'+s+'</label>').join('')+'</span></label>'+      '<label>Разрешённые домены (через запятую)<input class="inp" id="edOrigins" value="'+esc(k.allowed_origins||'*')+'"></label>'+      '<label>Срок действия<select class="sel" id="edExp"><option value="0">Бессрочно</option><option value="7">+7 дней</option><option value="30">+30 дней</option><option value="90">+90 дней</option><option value="365">+1 год</option></select></label>'+      '<label>Заметка<input class="inp" id="edNote" value="'+esc(k.note||'')+'"></label>'+      '<label>Статус<select class="sel" id="edActive"><option value="1"'+(k.active&&!k.revoked?' selected':'')+'>Активен</option><option value="0"'+(!k.active?' selected':'')+'>Выключен</option></select></label>'+      '</div><div style="display:flex;gap:8px;margin-top:4px"><button class="btn sm primary" id="edSave" data-id="'+k.id+'">💾 Сохранить</button>'+      '<button class="btn sm ghost" id="edClose">Отмена</button></div></div>';
    }
    $('#dkBody').onclick=async e=>{
      const b=e.target.closest('button'); if(!b)return;
      const id=b.dataset.edit||b.dataset.tog||b.dataset.del||b.dataset.rev||b.dataset.unrev||b.dataset.rot;
      if(b.dataset.edit){const k=KEYS.find(x=>x.id==id);$('#dkEditBox').innerHTML=k?editPanel(k):'';
        if(k)$('#edClose').onclick=()=>$('#dkEditBox').innerHTML='';
        if(k)$('#edSave').onclick=async()=>{
          const body={name:$('#edName').value,rate_limit:Number($('#edRate').value),quota_day:Number($('#edQuota').value||0),
            scopes:[...document.querySelectorAll('.edScope:checked')].map(i=>i.value),
            allowed_origins:$('#edOrigins').value.trim()||'*',note:$('#edNote').value.trim(),
            active:$('#edActive').value==='1'};
          const exp=Number($('#edExp').value); if(exp)body.expires_days=exp;
          const r=await fetch('/api/devkeys/'+id,{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json());
          if(r.ok){$('#dkEditBox').innerHTML='';K.toast('Настройки сохранены','ok',1800);loadKeys();}
          else K.toast(r.hint||r.error||'Ошибка','err',2500);};
        return;}
      if(b.dataset.tog&&!b.disabled){await fetch('/api/devkeys/'+id+'/toggle',{method:'POST',credentials:'include'});loadKeys();}
      if(b.dataset.rev){if(!confirm('Отозвать ключ? Он мгновенно перестанет работать на всех сайтах.'))return;
        await fetch('/api/devkeys/'+id+'/revoke',{method:'POST',credentials:'include'});K.toast('Ключ отозван 🚫','warn',2200);loadKeys();}
      if(b.dataset.unrev){await fetch('/api/devkeys/'+id+'/unrevoke',{method:'POST',credentials:'include'});K.toast('Ключ возвращён','ok',1800);loadKeys();}
      if(b.dataset.rot){if(!confirm('Перевыпустить ключ? Старый значение сразу перестанет работать.'))return;
        const j=await fetch('/api/devkeys/'+id+'/rotate',{method:'POST',credentials:'include'}).then(r=>r.json());
        if(j.ok){showNewKey(j.key,'Перевыпущенный ключ');loadKeys();}}
      if(b.dataset.del){if(!confirm('Удалить ключ навсегда?'))return;
        await fetch('/api/devkeys/'+id,{method:'DELETE',credentials:'include'});loadKeys();}
    };
    loadKeys();

    /* --- API-токены --- */
    async function loadTokens(){const j=await fetch('/api/tokens',{credentials:'include'}).then(r=>r.json());
      if(!j.ok)return;
      $('#tokBody').innerHTML=j.tokens.length?j.tokens.map(t=>'<tr><td>'+t.label.replace(/</g,'&lt;')+'</td><td>'+(t.created_at||'—')+'</td><td>'+(t.last_used||'никогда')+'</td><td style="text-align:right"><button class="btn sm ghost danger" data-rev="'+t.id+'">Отозвать</button></td></tr>').join('')
        :'<tr><td colspan="4" class="empty">Токенов пока нет</td></tr>';
    }
    $('#tokForm').onsubmit=async e=>{e.preventDefault();
      const j=await fetch('/api/tokens',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({label:$('#tokLabel').value||'token'})}).then(r=>r.json());
      if(j.ok){const box=$('#tokNew');box.hidden=false;
        box.innerHTML='<div class="kv"><div class="k">Новый токен <b>(показан один раз!)</b></div><div class="v" style="font-family:var(--mono);word-break:break-all">'+j.token+
        ' <button class="btn sm" id="tokCopy">Копировать</button></div></div>';
        $('#tokCopy').onclick=()=>{navigator.clipboard.writeText(j.token);K.toast('Скопировано','ok',1500);};
        $('#tokLabel').value='';loadTokens();}
    };
    $('#tokBody').onclick=async e=>{const b=e.target.closest('[data-rev]');if(!b)return;
      if(!confirm('Отозвать токен?'))return;
      await fetch('/api/tokens/'+b.dataset.rev,{method:'DELETE',credentials:'include'});loadTokens();};
    loadTokens();
  }
})();
