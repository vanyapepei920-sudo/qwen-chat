(function(){const K=window.NPK,$=K.$,clamp=K.clamp,nf=K.nf,Net=K.Net;
  const SCALES=[10,25,50,100,250,500,1000,2500];
  const TICKS={10:[0,2,5,10],25:[0,5,10,25],50:[0,10,25,50],100:[0,25,50,100],250:[0,50,100,250],500:[0,100,250,500],1000:[0,250,500,1000],2500:[0,500,1000,2500]};
  const ARC=Math.PI*100;let curScale=100,shown=0,target=0;
  const gf=$('#gaugeFill');gf.style.strokeDasharray=ARC;gf.style.strokeDashoffset=ARC;
  const frac=v=>clamp(Math.log10(1+Math.max(0,v))/Math.log10(1+curScale),0,1);
  const polar=f=>{const a=Math.PI*(1-f);return{x:130+100*Math.cos(a),y:140-100*Math.sin(a)};};
  function ticks(){const g=$('#gaugeTicks');g.innerHTML='';TICKS[curScale].forEach(t=>{const f=frac(t),c=Math.PI*(1-f);
    const p1={x:130+86*Math.cos(c),y:140-86*Math.sin(c)},p2={x:130+95*Math.cos(c),y:140-95*Math.sin(c)},p3={x:130+118*Math.cos(c),y:140-118*Math.sin(c)};
    g.insertAdjacentHTML('beforeend','<g class="tick"><line x1="'+p1.x.toFixed(1)+'" y1="'+p1.y.toFixed(1)+'" x2="'+p2.x.toFixed(1)+'" y2="'+p2.y.toFixed(1)+'"/><text x="'+p3.x.toFixed(1)+'" y="'+(p3.y+3).toFixed(1)+'" text-anchor="middle">'+t+'</text></g>');});
    $('#scaleTag').textContent='шкала 0–'+curScale;}
  function setSpeed(v,mode,cls){target=Math.max(0,v||0);if(mode!==undefined){const m=$('#gaugeMode');m.textContent=mode;m.className='gauge-mode '+(cls||'');}}
  (function anim(){shown+=(target-shown)*0.16;if(Math.abs(target-shown)<0.005)shown=target;
    const want=SCALES.find(s=>s>=shown)||SCALES[SCALES.length-1];if(want!==curScale){curScale=want;ticks();}
    const f=frac(shown);gf.style.strokeDashoffset=ARC*(1-f);$('#speedVal').textContent=shown<10?shown.toFixed(2):shown.toFixed(1);
    const p=polar(f),d=$('#gaugeDot');d.setAttribute('cx',p.x.toFixed(1));d.setAttribute('cy',p.y.toFixed(1));d.setAttribute('opacity',f>0.01?'1':'0');requestAnimationFrame(anim);})();
  ticks();

  const chart=K.Chart.make($('#liveChart'),{windowMs:60000});
  let testCtrl=null,testing=false,liveOn=false,liveHz=1,liveTimer=null,liveCtrl=null,liveBusy=false,liveFails=0,liveSim=false;
  function phaseSet(id,st,pr){const el=$('#ph-'+id);el.classList.toggle('active',st==='active');el.classList.toggle('done',st==='done');el.querySelector('.prog').style.width=(pr==null?(st==='done'?100:0):pr*100)+'%';}
  function phaseReset(){['ping','down','up'].forEach(id=>{phaseSet(id,'',0);$('#ph-'+id+'-v').innerHTML='—<span>'+(id==='ping'?'мс':'Мбит/с')+'</span>';});
    $('#resultBody').innerHTML='<tr><td colspan="3" class="empty">Запустите тест</td></tr>';K.setQwCard(false);}
  function results(r){const rows=[['Загрузка',nf(r.down)+' Мбит/с',K.quality(r.down,'down')],['Отдача',nf(r.up)+' Мбит/с',K.quality(r.up,'up')],
    ['Пинг',nf(r.ping,1)+' мс',K.quality(r.ping,'ping')],['Джиттер',nf(r.jitter,1)+' мс',r.jitter<=8?['Стабильно','good']:r.jitter<=25?['Умеренно','mid']:['Нестабильно','bad']],
    ['Потери',nf(r.loss,1)+' %',r.loss<=1?['Норма','good']:r.loss<=5?['Внимание','mid']:['Проблема','bad']]];
    if(r.sim)rows.push(['Режим','симуляция',['sim','sim']]);
    $('#resultBody').innerHTML=rows.map(x=>'<tr><td>'+x[0]+'</td><td><b>'+x[1]+'</b></td><td><span class="badge '+x[2][1]+'">'+x[2][0]+'</span></td></tr>').join('');
    $('#sDown').innerHTML=nf(r.down)+'<span class="u">Мбит/с</span>';$('#sUp').innerHTML=nf(r.up)+'<span class="u">Мбит/с</span>';
    $('#sPing').innerHTML=nf(r.ping,0)+'<span class="u">мс</span>';$('#sJit').innerHTML=nf(r.jitter,1)+'<span class="u">мс</span>';$('#sLoss').innerHTML=nf(r.loss,0)+'<span class="u">%</span>';
    $('#bDown').style.width=clamp(r.down/3,3,100)+'%';$('#bUp').style.width=clamp(r.up/3,3,100)+'%';$('#bPing').style.width=clamp(100-r.ping,3,100)+'%';$('#bJit').style.width=clamp(100-r.jitter*3,3,100)+'%';$('#bLoss').style.width=clamp(100-r.loss*10,3,100)+'%';}
  async function run(){if(testing)return;testing=true;testCtrl=new AbortController();const sig=testCtrl.signal;
    $('#startBtn').disabled=true;$('#stopBtn').disabled=false;phaseReset();chart.clear();
    K.setLoader(true,'Speedtest запущен','этап 1/3 · задержка');K.setQwCard(true,'Выполняется замер…');let sim=false;const res={down:0,up:0,ping:0,jitter:0,loss:0};
    try{
      phaseSet('ping','active',0);setSpeed(0,'замер задержки…','');
      let p=await K.pingPhase(sig,pr=>{phaseSet('ping','active',pr);K.qwText('Speedtest: задержка','запрос '+Math.round(pr*10)+'/10');});
      if(!p||sig.aborted){if(sig.aborted)throw new Error('ABORT');sim=true;p={latency:8+Math.random()*40,jitter:1+Math.random()*6,loss:Math.random()*2};}
      Object.assign(res,{ping:p.latency,jitter:p.jitter,loss:p.loss});$('#ph-ping-v').innerHTML=nf(p.latency,0)+'<span>мс</span>';phaseSet('ping','done',1);if(sig.aborted)throw new Error('ABORT');
      phaseSet('down','active',0);setSpeed(0,'загрузка ↓','');K.setLoader(true,'Speedtest: загрузка ↓','этап 2/3');
      const dS=performance.now(),dD=8000;let d;
      if(sim)d=await K.simPhase(dD,40+Math.random()*400,sig,v=>{setSpeed(v,'загрузка ↓ (sim)','');chart.push(v);phaseSet('down','active',clamp((performance.now()-dS)/dD,0,1));});
      else{d=await K.downloadPhase(dD,4,sig,v=>{setSpeed(v,'загрузка ↓','');chart.push(v);phaseSet('down','active',clamp((performance.now()-dS)/dD,0,1));K.qwText('Speedtest: загрузка ↓',nf(v,1)+' Мбит/с · 4 потока');});
        if(d.bytes<10000){sim=true;K.toast('Сервер недоступен — симуляция','warn');d=await K.simPhase(3000,60+Math.random()*300,sig,v=>{setSpeed(v,'загрузка ↓ (sim)','');chart.push(v);});}}
      res.down=d.mbps;$('#ph-down-v').innerHTML=nf(d.mbps,1)+'<span>Мбит/с</span>';phaseSet('down','done',1);if(sig.aborted)throw new Error('ABORT');await K.sleep(350);
      phaseSet('up','active',0);setSpeed(0,'отдача ↑','');K.setLoader(true,'Speedtest: отдача ↑','этап 3/3');
      const uS=performance.now(),uD=6000;let u;
      if(sim)u=await K.simPhase(uD,Math.max(4,res.down*(0.18+Math.random()*0.35)),sig,v=>{setSpeed(v,'отдача ↑ (sim)','');chart.push(v);phaseSet('up','active',clamp((performance.now()-uS)/uD,0,1));});
      else{u=await K.uploadPhase(uD,3,sig,v=>{setSpeed(v,'отдача ↑','');chart.push(v);phaseSet('up','active',clamp((performance.now()-uS)/uD,0,1));K.qwText('Speedtest: отдача ↑',nf(v,1)+' Мбит/с · 3 потока');});
        if(u.bytes<5000){sim=true;u=await K.simPhase(2500,Math.max(4,res.down*0.25),sig,v=>{setSpeed(v,'отдача ↑ (sim)','');chart.push(v);});}}
      res.up=u.mbps;$('#ph-up-v').innerHTML=nf(u.mbps,1)+'<span>Мбит/с</span>';phaseSet('up','done',1);if(sig.aborted)throw new Error('ABORT');
      res.sim=sim;res.ts=Date.now();setSpeed(res.down,'результат: загрузка','');results(res);K.History.push(res);
      K.toast('Готово · ↓'+nf(res.down,1)+' / ↑'+nf(res.up,1)+(sim?' (sim)':''),sim?'warn':'ok');
    }catch(e){if(e&&e.message==='ABORT'){setSpeed(0,'остановлен','idle');K.toast('Тест прерван','warn');}else{K.toast('Ошибка: '+(e.message||e),'err');setSpeed(0,'ошибка','idle');}}
    finally{testing=false;testCtrl=null;$('#startBtn').disabled=false;$('#stopBtn').disabled=true;K.setLoader(false);K.setQwCard(false);
      if(!liveOn)setTimeout(()=>{if(!testing&&!liveOn)setSpeed(0,'ожидание','idle');},5000);}}
  $('#startBtn').onclick=run;$('#stopBtn').onclick=()=>{if(testCtrl)try{testCtrl.abort();}catch(e){}};

  function setLiveUI(){const ld=$('#liveDot');if(ld)ld.className='dot'+(liveOn?' rec':'');const lt=$('#liveTxt');if(lt)lt.textContent=liveOn?('live · '+liveHz+' гц'):'мониторинг выкл';$('#liveBtnTxt').textContent=liveOn?'Выключить':'Включить';}
  async function tick(){if(!liveOn||liveBusy)return;liveBusy=true;liveCtrl=new AbortController();const guard=setTimeout(()=>{try{liveCtrl.abort();}catch(e){}},4000);let v=null;
    if(!liveSim){v=await K.quickMeasure(liveCtrl.signal);if(v==null&&++liveFails>=3){liveSim=true;K.toast('Live в режиме симуляции','warn');}else if(v!=null)liveFails=0;}
    clearTimeout(guard);if(v==null)v=K.simSpeed(liveSim?120:80);if(liveOn){chart.push(v);if(!testing)setSpeed(v,liveSim?'live (sim)':'live мониторинг','');
      const m=chart.meta();$('#avgTxt').textContent=nf(m.avg)+' Мбит/с';$('#peakTxt').textContent=nf(m.peak)+' Мбит/с';}liveBusy=false;}
  function sched(){if(!liveOn)return;liveTimer=setTimeout(async()=>{await tick();sched();},Math.max(120,1000/liveHz+Math.random()*60-30));}
  $('#liveBtn').onclick=()=>{if(liveOn){liveOn=false;clearTimeout(liveTimer);if(liveCtrl)try{liveCtrl.abort();}catch(e){}setLiveUI();if(!testing)setSpeed(0,'ожидание','idle');}
    else{liveOn=true;liveSim=false;liveFails=0;setLiveUI();sched();tick();K.toast('Мониторинг · '+liveHz+' Гц','ok',2600);}};
  K.$$('#freqSeg button').forEach(b=>b.onclick=()=>{K.$$('#freqSeg button').forEach(x=>x.classList.remove('active'));b.classList.add('active');liveHz=+b.dataset.hz;setLiveUI();if(liveOn){clearTimeout(liveTimer);sched();}});

  function connInfo(){const c=Net.conn,el=id=>$('#'+id);if(!c){el('kvType').textContent='не определяется';el('kvEff').textContent=navigator.onLine?'online':'offline';el('kvDown').innerHTML='—';el('kvRtt').innerHTML='—';}
    else{el('kvType').textContent=c.type||'не указан';el('kvEff').textContent=(c.effectiveType||'—').toUpperCase();el('kvDown').innerHTML=(c.downlink!=null?c.downlink:'—')+' <small>Мбит/с</small>';el('kvRtt').innerHTML=(c.rtt!=null?c.rtt:'—')+' <small>мс</small>';
      $('#sRtt').innerHTML=(c.rtt!=null?c.rtt:'—')+'<span class="u">мс</span>';$('#bRtt').style.width=clamp((c.rtt!=null?100-c.rtt:0),4,100)+'%';}
    const b=K.estimateBand();$('#bandVal').textContent=b.band;$('#bandWhy').textContent=b.why;$('#bandConf').style.width=b.conf+'%';}
  K.fetchMeta(false).then(()=>{const m=Net.meta,st=$('#srvTag');if(st)st.textContent=m?('сервер: '+(m.colo!=='—'?m.colo:'Cloudflare')+' · '+m.city):'сервер: sim';connInfo();});
  if(Net.conn)Net.conn.onchange=connInfo;
  if(localStorage.getItem('np_demo'))K.toast('Демо‑режим: история локально','warn',3600);
  K.renderUser(window.NP.user);
})();
