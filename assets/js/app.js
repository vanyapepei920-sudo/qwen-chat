/* ===== helpers ===== */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const nf=(v,d=2)=>isFinite(v)?Number(v).toFixed(d).replace('.',','):'—';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const NP=window.NP||{};

/* ===== склонение слов ===== */
function plural(n, one, few, many){
  const m10=n%10, m100=n%100;
  if(m10===1&&m100!==11)return one;
  if(m10>=2&&m10<=4&&(m100<10||m100>=20))return few;
  return many;
}

/* ===== loader / toast ===== */
const qwPill=$('#qwPill');
function qwText(t,s){if(t!==undefined)$('#qwTitle').textContent=t;if(s!==undefined)$('#qwSub').textContent=s;}
function setLoader(on,t,s){if(on){qwText(t,s);qwPill.classList.add('on');}else qwPill.classList.remove('on');}
function setQwCard(on,tip){const c=$('#qwCard');if(!c)return;c.hidden=!on;if(on&&tip)$('#qwCardTip').textContent=tip;}
function toast(msg,type='',ms=4200){const b=$('#toasts'),e=document.createElement('div');
  e.className='toast '+type;const ic=type==='err'?'⚠':type==='ok'?'✓':type==='warn'?'!':'●';
  e.innerHTML='<b style="font-family:var(--mono);opacity:.85">'+ic+'</b><div>'+msg+'</div>';
  b.appendChild(e);setTimeout(()=>{e.classList.add('out');setTimeout(()=>e.remove(),320);},ms);}

/* ===== Chart ===== */
const Chart={
  make(cv,opts={}){const o={windowMs:60000,color:['#7c5cff','#00e5ff','#3ddc97'],fill:true,...opts};
    const inst={cv,ctx:cv.getContext('2d'),data:[],o,dpr:1,w:0,h:0,
      resize(){inst.dpr=Math.min(devicePixelRatio||1,2);const r=cv.parentElement.getBoundingClientRect();
        inst.w=r.width;inst.h=r.height;cv.width=Math.max(1,inst.w*inst.dpr);cv.height=Math.max(1,inst.h*inst.dpr);
        inst.ctx.setTransform(inst.dpr,0,0,inst.dpr,0,0);inst.draw();},
      push(v){inst.data.push({t:Date.now(),v:Math.max(0,v)});const cut=Date.now()-inst.o.windowMs-4000;
        while(inst.data.length&&inst.data[0].t<cut)inst.data.shift();inst.draw();},
      clear(){inst.data=[];inst.draw();},
      niceMax(v){const s=[1,2,5,10,20,25,50,100,150,200,300,500,750,1000,2000,5000];return s.find(x=>x>=v)||Math.ceil(v/1000)*1000;},
      meta(){if(!inst.data.length)return{avg:0,peak:0};const vs=inst.data.map(d=>d.v);
        return{avg:vs.reduce((a,b)=>a+b,0)/vs.length,peak:Math.max(...vs)};},
      draw(){const c=inst.ctx,W=inst.w,H=inst.h;if(!c||!W||!H)return;
        const pL=44,pR=12,pT=14,pB=24,iw=W-pL-pR,ih=H-pT-pB;c.clearRect(0,0,W,H);
        const vs=inst.data.map(d=>d.v),max=inst.niceMax(Math.max(1,...(vs.length?vs:[1]))*1.15);
        const now=Date.now(),t0=now-inst.o.windowMs,X=t=>pL+((t-t0)/inst.o.windowMs)*iw,Y=v=>pT+ih-(v/max)*ih;
        c.strokeStyle='rgba(255,255,255,.055)';c.lineWidth=1;c.fillStyle='rgba(137,144,168,.75)';c.font='10px "JetBrains Mono",monospace';
        for(let i=0;i<=4;i++){const y=pT+(ih/4)*i;c.beginPath();c.moveTo(pL,y);c.lineTo(W-pR,y);c.stroke();
          c.textAlign='right';c.fillText((max-(max/4)*i).toFixed(max<10?1:0),pL-8,y+3.5);}
        if(inst.data.length<2){c.fillStyle='rgba(93,100,124,.9)';c.textAlign='center';c.font='12.5px Inter,sans-serif';
          c.fillText('Нет данных',pL+iw/2,pT+ih/2);return;}
        const pts=inst.data.filter(d=>d.t>=t0-2000);
        if(inst.o.fill){const g=c.createLinearGradient(0,pT,0,pT+ih);g.addColorStop(0,'rgba(0,229,255,.32)');g.addColorStop(1,'rgba(124,92,255,0)');
          c.beginPath();c.moveTo(X(pts[0].t),pT+ih);pts.forEach(p=>c.lineTo(X(p.t),Y(p.v)));c.lineTo(X(pts[pts.length-1].t),pT+ih);c.closePath();c.fillStyle=g;c.fill();}
        const lg=c.createLinearGradient(pL,0,W-pR,0);lg.addColorStop(0,o.color[0]);lg.addColorStop(.6,o.color[1]);lg.addColorStop(1,o.color[2]);
        c.beginPath();pts.forEach((p,i)=>i?c.lineTo(X(p.t),Y(p.v)):c.moveTo(X(p.t),Y(p.v)));
        c.strokeStyle=lg;c.lineWidth=2.2;c.lineJoin='round';c.lineCap='round';c.shadowColor='rgba(0,229,255,.5)';c.shadowBlur=12;c.stroke();c.shadowBlur=0;
        const last=pts[pts.length-1];c.beginPath();c.arc(X(last.t),Y(last.v),4,0,6.2832);c.fillStyle='#fff';c.fill();}};
    new ResizeObserver(()=>inst.resize()).observe(cv.parentElement);inst.resize();return inst;}
};

/* ===== сеть / метр / замер ===== */
const Net={conn:navigator.connection||navigator.mozConnection||navigator.webkitConnection||null,liveBytes:300000,
  DOWN:"https://speed.cloudflare.com/__down?bytes=",UP:"https://speed.cloudflare.com/__up",
  META:"https://speed.cloudflare.com/meta",META2:"https://ipwho.is/",meta:null};
function makeMeter(){let total=0;const marks=[],t0=performance.now();
  return{add(n){total+=n;marks.push({t:performance.now(),b:total});},get total(){return total;},
    speed(){const now=performance.now();while(marks.length>2&&now-marks[0].t>1100)marks.shift();
      if(marks.length<2)return 0;const dt=(now-marks[0].t)/1000;return dt>0?((total-marks[0].b)*8)/dt/1e6:0;},
    avg(){const d=(performance.now()-t0)/1000;return d>0?total*8/d/1e6:0;}};}
async function downloadStream(url,deadline,meter,signal){try{const res=await fetch(url,{cache:'no-store',signal});
  if(!res.ok)throw 0;if(!res.body){meter.add((await res.arrayBuffer()).byteLength);return;}
  const rd=res.body.getReader();while(!signal.aborted&&performance.now()<deadline){const{done,value}=await rd.read();if(done)break;if(value)meter.add(value.byteLength);}
  try{await rd.cancel();}catch(e){}}catch(e){}}
async function pingPhase(signal,onP){const N=10,times=[];for(let i=0;i<N;i++){if(signal.aborted)break;
  const t0=performance.now();try{await fetch(Net.DOWN+'0&r='+Math.random(),{cache:'no-store',signal});times.push(performance.now()-t0);}
  catch(e){if(e.name==='AbortError')break;times.push(null);}onP&&onP((i+1)/N);await sleep(50);}
  const ok=times.filter(x=>x!=null).sort((a,b)=>a-b);if(!ok.length)return null;let j=0;for(let i=1;i<ok.length;i++)j+=Math.abs(ok[i]-ok[i-1]);
  return{latency:ok[Math.floor(ok.length/2)],jitter:ok.length>1?j/(ok.length-1):0,loss:((N-ok.length)/N)*100};}
async function downloadPhase(dur,conns,signal,onS){const m=makeMeter(),st=performance.now(),dl=st+dur,ts=[];
  for(let i=0;i<conns;i++)ts.push(downloadStream(Net.DOWN+'50000000&r='+Math.random()+i,dl,m,signal));
  const t=setInterval(()=>onS&&onS(m.speed()),180);await Promise.allSettled(ts);clearInterval(t);return{mbps:m.avg(),bytes:m.total};}
let payloadCache=null;function getPayload(sz){if(payloadCache)return payloadCache;const a=new Uint8Array(sz),ch=new Uint8Array(65536);
  crypto.getRandomValues(ch);for(let o=0;o<sz;o+=ch.length)a.set(ch.subarray(0,Math.min(ch.length,sz-o)),o);payloadCache=a;return a;}
function uploadOnce(m,signal,deadline){return new Promise(res=>{if(performance.now()>deadline||signal.aborted)return res(false);
  const x=new XMLHttpRequest();let last=0;const ab=()=>{try{x.abort();}catch(e){}};signal.addEventListener('abort',ab,{once:true});
  x.upload.onprogress=e=>{if(e.loaded>last){m.add(e.loaded-last);last=e.loaded;}};
  x.onloadend=()=>{signal.removeEventListener('abort',ab);res(!signal.aborted&&performance.now()<deadline);};
  x.onerror=()=>{signal.removeEventListener('abort',ab);res(false);};
  try{x.open('POST',Net.UP+'?r='+Math.random());x.send(new Blob([getPayload(1000000)]));}catch(e){signal.removeEventListener('abort',ab);res(false);}});}
async function uploadPhase(dur,conns,signal,onS){const m=makeMeter(),st=performance.now(),dl=st+dur;
  const t=setInterval(()=>onS&&onS(m.speed()),180);const w=async()=>{while(await uploadOnce(m,signal,dl)){}};
  await Promise.allSettled(Array.from({length:conns},w));clearInterval(t);return{mbps:m.avg(),bytes:m.total};}
async function quickMeasure(signal){const b=Net.liveBytes,t0=performance.now();try{
  const buf=await(await fetch(Net.DOWN+b+'&r='+Math.random(),{cache:'no-store',signal})).arrayBuffer();
  const dt=(performance.now()-t0)/1000;if(dt<=0.005)return null;
  if(dt<0.30)Net.liveBytes=clamp(Math.round(b*1.7),60000,60000000);else if(dt>1.6)Net.liveBytes=clamp(Math.round(b*0.55),60000,60000000);
  return buf.byteLength*8/dt/1e6;}catch(e){return null;}}
const simSpeed=base=>Math.max(0.4,base*(0.82+Math.random()*0.36));
function simPhase(dur,base,signal,onS){return new Promise(res=>{const st=performance.now();let cur=base*0.35,v=0;
  const iv=setInterval(()=>{if(signal.aborted){clearInterval(iv);return res({mbps:0,bytes:0});}
    const t=(performance.now()-st)/dur,ramp=t<0.22?t/0.22:1;cur+=(base*ramp-cur)*0.22;v=Math.max(0.2,cur*(0.94+Math.random()*0.12));
    onS&&onS(v);if(performance.now()-st>=dur){clearInterval(iv);res({mbps:v,bytes:1});}},180);});}
function estimateBand(){const c=Net.conn,rtt=c&&c.rtt!=null?c.rtt:null,dl=c&&c.downlink!=null?c.downlink:null,type=c&&c.type?c.type:'';
  if(type&&type!=='wifi'&&type!=='ethernet'){const et=(c.effectiveType||'').toUpperCase();
    const map={'4G':['LTE / 5G',80],'3G':['3G',70],'2G':['2G',65]};const g=map[et]||[et||'Mobile',55];
    return{band:g[0],why:'Интерфейс «'+type+'», класс '+(et||'?'),conf:g[1],w:'мобильная сеть'};}
  if(type==='ethernet')return{band:'Провод (Ethernet)',why:'Проводное подключение — радиочастота не применяется',conf:95,w:'кабель'};
  if(rtt==null&&dl==null)return{band:'2,4 / 5 ГГц',why:'Network Information API недоступен',conf:25,w:'—'};
  const r=rtt!=null?rtt:40;
  if(r<=8&&dl>=40)return{band:'6 ГГц (Wi‑Fi 6E)',why:'RTT '+r+' мс @ '+dl+' Мбит/с',conf:72,w:'160 МГц'};
  if(r<=15)return{band:'5 ГГц (Wi‑Fi 5/6)',why:'Низкий RTT ('+r+' мс)',conf:78,w:'80 МГц'};
  if(r<=35)return{band:'5 / 2,4 ГГц',why:'Средний RTT ('+r+' мс)',conf:52,w:'40 МГц'};
  return{band:'2,4 ГГц (Wi‑Fi 4)',why:'Высокий RTT ('+r+' мс)',conf:68,w:'20 МГц'};}
async function fetchMeta(withLoader){if(withLoader)setLoader(true,'Определяем сеть…','IP · провайдер · узел');
  try{const j=await(await fetch(Net.META,{cache:'no-store'})).json();
    Net.meta={ip:j.clientIp||'—',isp:j.asOrganization||'Cloudflare',city:j.clientCity||'—',colo:j.colo||'—'};}
  catch(e){try{const j=await(await fetch(Net.META2,{cache:'no-store'})).json();
    Net.meta={ip:j.ip||'—',isp:(j.connection&&(j.connection.isp||j.connection.org))||'—',city:j.city||'—',colo:'—'};}catch(e2){Net.meta=null;}}
  if(withLoader)setLoader(false);return Net.meta;}
function quality(v,k){if(k==='down')return v>=100?['Отлично','good']:v>=25?['Хорошо','good']:v>=10?['Средне','mid']:['Слабо','bad'];
  if(k==='up')return v>=50?['Отлично','good']:v>=10?['Хорошо','good']:v>=3?['Средне','mid']:['Слабо','bad'];
  return v<=20?['Отлично','good']:v<=45?['Хорошо','good']:v<=90?['Средне','mid']:['Слабо','bad'];}

/* ===== история ===== */
const History={mode:NP.user?'server':'local',
  local(){try{return JSON.parse(localStorage.getItem('np_hist_local')||'[]');}catch(e){return[];}},
  saveLocal(h){try{localStorage.setItem('np_hist_local',JSON.stringify(h.slice(0,200)));}catch(e){}},
  async load(kind){if(this.mode==='server'){try{const j=await(await fetch('/api/history'+(kind?'?kind='+kind:''),{credentials:'include'})).json();if(j.ok)return j.history;}catch(e){}}return this.local();},
  async push(r){r.kind=r.kind||'speed';if(this.mode==='server'){try{await fetch('/api/history',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)});}catch(e){}}else{const h=this.local();h.unshift(r);this.saveLocal(h);}},
  async clear(){if(this.mode==='server'){try{await fetch('/api/history',{method:'DELETE',credentials:'include'});}catch(e){}}else this.saveLocal([]);}};

/* ===== prefs ===== */
const Prefs={cache:{},async load(){if(NP.user){try{const j=await(await fetch('/api/prefs',{credentials:'include'})).json();if(j.ok)this.cache=j.prefs||{};}catch(e){}}
  else{try{this.cache=JSON.parse(localStorage.getItem('np_prefs')||'{}');}catch(e){this.cache={};}}return this.cache;},
  async set(k,v){this.cache[k]=v;if(NP.user){try{await fetch('/api/prefs',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.cache)});}catch(e){}}else{try{localStorage.setItem('np_prefs',JSON.stringify(this.cache));}catch(e){}}}};

/* ===== навигация ===== */
(function nav(){const page=document.body.dataset.page;$$('.tabs a').forEach(a=>{if(a.dataset.tab===page)a.classList.add('active');});})();

function renderUser(u){if(!u)return;const ini=(u.name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0].toUpperCase()).join('');
  const ab=$('#avatarBox');if(ab)ab.innerHTML=u.picture?'<img class="avatar" src="'+u.picture+'" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<div class=avatar>'+ini+'</div>\'">':'<div class="avatar">'+ini+'</div>';
  const nm=$('#userName'),em=$('#userMail');if(nm)nm.textContent=u.name;if(em)em.textContent=u.email;}

/* ===== GOOGLE AUTH ===== */
const AUTH_MODE=(location.pathname.indexOf('/register')>-1)?'register':'login';
const LAST_KEY='np_last_user';
function parseHint(){try{return JSON.parse(localStorage.getItem(LAST_KEY)||'null');}catch(e){return null;}}
async function onGoogleCredential(resp){
  setLoader(true,AUTH_MODE==='register'?'Регистрируем…':'Входим…','проверка токена на сервере');
  try{
    const r=await fetch('/api/auth/google?mode='+AUTH_MODE,{method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:resp.credential,mode:AUTH_MODE})});
    const j=await r.json();setLoader(false);
    if(!r.ok||!j.ok){toast('Ошибка: '+(j.error||'unknown'),'err');return;}
    localStorage.setItem(LAST_KEY,JSON.stringify({name:j.user.name,email:j.user.email,picture:j.user.picture}));
    location.href='/dashboard';
  }catch(e){setLoader(false);toast('Сервер недоступен: '+e.message,'err');}
}
function initGoogleButton(){const box=$('#gAlert');
  if(!NP.clientId){if(box)box.innerHTML='<div class="alert">⚠ Client ID не найден. Добавьте GOOGLE_CLIENT_ID в файл <b>.env</b> (и при необходимости GOOGLE_CLIENT_SECRET), затем <b>полностью перезапустите сервер</b>: Ctrl+C → python app.py. Файл .env читается только при старте.</div>';return;}
  if(window.google&&google.accounts&&google.accounts.id){try{
    google.accounts.id.initialize({client_id:NP.clientId,callback:onGoogleCredential,auto_select:false,cancel_on_tap_outside:true,ux_mode:'popup'});
    google.accounts.id.renderButton($('#gbtn'),{theme:'filled_black',size:'large',shape:'pill',text:AUTH_MODE==='register'?'signup_with':'continue_with',logo_alignment:'center',width:320,locale:'ru'});
    if(box)box.innerHTML='<div class="alert ok">✓ Google подключён. Аккаунт будет запомнен для быстрого входа.</div>';return;}catch(e){console.warn(e);}}
  if(box)box.innerHTML='<div class="alert">⚠ Google не загрузился. Проверьте сеть и Authorized JavaScript origins (http://127.0.0.1:5000).</div>';}
function wireAuthPage(){
  const hint=parseHint();
  if(AUTH_MODE==='login'&&hint){const rb=$('#rememberBox');if(rb){rb.hidden=false;
    $('#rbName').textContent=hint.name||'—';$('#rbMail').textContent=hint.email||'';
    const av=$('#rbAv');if(hint.picture)av.innerHTML='<img class="rb-av" src="'+hint.picture+'" referrerpolicy="no-referrer">';
    $('#rbQuick').onclick=()=>{setLoader(true,'Быстрый вход…','Google popup');
      if(window.google&&google.accounts&&google.accounts.id){try{google.accounts.id.prompt();}catch(e){setLoader(false);toast('Нужен выбор аккаунта','warn');}}
      else{setLoader(false);toast('Google не готов','err');}};}}
  const d=$('#demoBtn');if(d)d.onclick=()=>{const p={name:'Гость Демо',email:'demo@netpulse.app',picture:'',sub:'demo',db_id:0,registered:false};
    localStorage.setItem('np_demo','1');NP.user=p;location.href='/dashboard';};
  let tries=0;(function wait(){if(window.google&&google.accounts&&google.accounts.id){initGoogleButton();return;}if(++tries>30){initGoogleButton();return;}setTimeout(wait,120);})();
}
if($('.auth-page'))wireAuthPage();

const sob=$('#signOutBtn');if(sob)sob.onclick=async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'include'});}catch(e){}
  try{localStorage.removeItem('np_demo');}catch(e){}
  try{if(window.google&&google.accounts&&google.accounts.id)google.accounts.id.disableAutoSelect();}catch(e){}
  location.href='/login';};

/* ===== online/offline + mesh ===== */
function updateOnline(){const on=navigator.onLine,el=$('#netStatus');if(!el)return;
  el.firstElementChild.className='dot'+(on?' on':'');$('#netStatusTxt').textContent=on?'онлайн':'офлайн';}
addEventListener('online',()=>{updateOnline();toast('Соединение восстановлено','ok',2400);});
addEventListener('offline',()=>{updateOnline();toast('Соединение потеряно','err');});
updateOnline();
(function mesh(){const cv=$('#mesh');if(!cv)return;const ctx=cv.getContext('2d');let W,H,nodes=[];
  function rs(){const dpr=Math.min(devicePixelRatio||1,2);W=cv.clientWidth;H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    nodes=Array.from({length:Math.round(clamp(W*H/16000,26,90))},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.7+.7}));}
  addEventListener('resize',rs);
  (function fr(){ctx.clearRect(0,0,W,H);for(const n of nodes){n.x+=n.vx;n.y+=n.vy;if(n.x<0||n.x>W)n.vx*=-1;if(n.y<0||n.y>H)n.vy*=-1;}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const d=Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y);
      if(d<132){ctx.strokeStyle='rgba(0,229,255,'+(.16*(1-d/132))+')';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(nodes[i].x,nodes[i].y);ctx.lineTo(nodes[j].x,nodes[j].y);ctx.stroke();}}
    for(const n of nodes){ctx.fillStyle='rgba(180,220,255,.55)';ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,6.2832);ctx.fill();}requestAnimationFrame(fr);})();rs();})();

/* ===== уведомления (колокол) ===== */
(function(){const btn=document.getElementById('bellBtn');if(!btn)return;
  const panel=document.getElementById('notifPanel'),list=document.getElementById('notifList'),badge=document.getElementById('bellBadge');
  async function refresh(){try{const j=await fetch('/api/notifications',{credentials:'include'}).then(r=>r.json());
    if(!j.ok)return; badge.hidden=!j.unread; badge.textContent=j.unread>9?'9+':j.unread;
    list.innerHTML=j.items.length?j.items.map(n=>'<div class="np-item'+(n.read?' read':'')+'"><span class="np-ic">'+(n.kind==='monitor'?'📡':'ℹ️')+'</span><div><div>'+n.text.replace(/</g,'&lt;')+'</div><small>'+new Date(n.ts).toLocaleString('ru-RU')+'</small></div></div>').join(''):'<small style="opacity:.6">Пока пусто</small>';
  }catch(e){}}
  btn.onclick=e=>{e.stopPropagation();panel.hidden=!panel.hidden;if(!panel.hidden)refresh();};
  document.addEventListener('click',e=>{if(!panel.hidden&&!document.getElementById('notifWrap').contains(e.target))panel.hidden=true;});
  document.getElementById('notifReadAll').onclick=async()=>{await fetch('/api/notifications/read',{method:'POST',credentials:'include'});refresh();};
  refresh();setInterval(refresh,60000);})();

window.NPK={$, $$,sleep,nf,clamp,plural,Chart,Net,makeMeter,downloadStream,pingPhase,downloadPhase,uploadPhase,quickMeasure,simPhase,simSpeed,getPayload,estimateBand,fetchMeta,quality,History,Prefs,setLoader,setQwCard,qwText,toast,renderUser};
