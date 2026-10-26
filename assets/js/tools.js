/* ===== страница «Интернет-инструменты» (v10) ===== */
(function(){
const K = window.NPK, $ = K.$;
K.renderUser(window.NP.user);

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
async function api(url,opt){const r=await fetch(url,{credentials:'include',...opt});return r.json();}
function kv(el,pairs){el.innerHTML=pairs.map(([k,v])=>'<div class="k">'+esc(k)+'</div><div class="v" style="word-break:break-all">'+(v==null?'—':esc(v))+'</div>').join('');}
function busy(el){el.innerHTML='<small style="opacity:.6">Выполняется…</small>';}

/* --- TCP-пинг --- */
$('#tcpForm').onsubmit=async e=>{
  e.preventDefault();busy($('#tcpOut'));
  const j=await api('/api/tools/ping-tcp?host='+encodeURIComponent($('#tcpHost').value.trim()));
  if(!j.ok){kv($('#tcpOut'),[['Ошибка',j.error||'сбой']]);return;}
  kv($('#tcpOut'),[['Хост',j.host+' → '+j.ip+':'+j.port],['DNS',j.dns_ms+' мс'],
    ['TCP avg',j.tcp_avg_ms!=null?j.tcp_avg_ms+' мс':'недоступен'],['min/max',(j.tcp_min_ms??'—')+' / '+(j.tcp_max_ms??'—')+' мс'],
    ['TLS handshake',j.tls_ms!=null?j.tls_ms+' мс':'—'],['Потери',j.loss_pct+'%'],
    ['Замеры',(j.samples||[]).map(s=>s==null?'×':s+'мс').join(' ')]].map(x=>x));
};

/* --- Полный DNS --- */
$('#dnsFForm').onsubmit=async e=>{
  e.preventDefault();busy($('#dnsFOut'));
  const j=await api('/api/tools/dns-full?host='+encodeURIComponent($('#dnsFHost').value.trim()));
  if(!j.ok){$('#dnsFOut').innerHTML='<small>'+esc(j.error||'ошибка')+'</small>';return;}
  $('#dnsFOut').innerHTML=Object.entries(j.records).map(([t,r])=>{
    const a=(r.answers||[]).map(x=>esc(x.data)+' <span style="opacity:.5">(TTL '+x.ttl+')</span>').join('<br>')||(r.status===3?'NXDOMAIN':r.status===0?'пусто':'код '+r.status);
    return '<div style="margin-bottom:6px"><b>'+t+'</b>: <span style="font-family:var(--mono);font-size:11px">'+a+'</span></div>';}).join('');
};

/* --- HTTP-заголовки/редиректы --- */
$('#hdrForm').onsubmit=async e=>{
  e.preventDefault();busy($('#hdrOut'));
  const j=await api('/api/tools/headers?url='+encodeURIComponent($('#hdrUrl').value.trim()));
  if(!j.ok){$('#hdrOut').innerHTML='<small>'+esc(j.error||'ошибка')+'</small>';return;}
  $('#hdrOut').innerHTML=(j.chain||[]).map(c=>
    '<div style="margin-bottom:8px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.04)">'+
    '<b>'+c.status+'</b> · '+esc(c.url)+'<br><span style="opacity:.7">Server: '+esc(c.server||'—')+' · '+esc(c.content_type||'—')+'</span>'+
    (Object.keys(c.security_headers||{}).length?'<br><span style="color:#8affc8">🔒 '+Object.keys(c.security_headers).map(esc).join(', ')+'</span>':'')+
    '</div>').join('')+'<small>Редиректов: '+j.redirects+' · финальный код: '+j.final_status+'</small>';
};

/* --- Скан портов --- */
$('#portForm').onsubmit=async e=>{
  e.preventDefault();busy($('#portOut'));
  $('#portOut').innerHTML='<small style="opacity:.6">Сканирование 22 портов (до ~30 сек)…</small>';
  const j=await api('/api/tools/ports?host='+encodeURIComponent($('#portHost').value.trim()));
  if(!j.ok){$('#portOut').innerHTML='<small>'+esc(j.error||'ошибка')+'</small>';return;}
  $('#portOut').innerHTML='<div style="display:flex;flex-wrap:wrap;gap:5px">'+(j.ports||[]).map(p=>{
    const cls=p.state==='open'?'good':p.state==='filtered'?'mid':'bad';
    return '<span class="badge '+cls+'" title="'+esc(p.service)+'">'+p.port+' · '+p.state+'</span>';}).join('')+'</div>'+
    '<small style="opacity:.7">'+esc(j.host)+' → '+esc(j.ip)+' · открытых: '+j.open_count+'</small>';
};

/* --- CIDR провайдеров --- */
$('#cidrForm').onsubmit=async e=>{
  e.preventDefault();busy($('#cidrOut'));
  const j=await api('/api/tools/cidr?country='+$('#cidrCountry').value+'&isp='+encodeURIComponent($('#cidrIsp').value.trim()));
  if(!j.ok){$('#cidrOut').innerHTML='<small>'+esc(j.error||'ошибка')+'</small>';return;}
  if(!j.count){$('#cidrOut').innerHTML='<small>Ничего не найдено по запросу «'+esc(j.query)+'»</small>';return;}
  $('#cidrOut').innerHTML=j.ranges.map(r=>'<div style="padding:2px 0;font-family:var(--mono)">'+esc(r.cidr)+' <span style="opacity:.6;font-family:inherit">'+esc(r.isp)+'</span></div>').join('');
};

/* --- Бейджи --- */
$('#badgeForm').onsubmit=async e=>{
  e.preventDefault();
  const j=await api('/api/tools/badges?subject='+encodeURIComponent($('#badgeSubj').value.trim()||'netpulse')+
    '&status='+encodeURIComponent($('#badgeStat').value.trim()||'online')+'&color='+encodeURIComponent($('#badgeColor').value));
  if(!j.ok){$('#badgeOut').textContent=j.error||'ошибка';return;}
  $('#badgePreview').innerHTML='<img src="'+esc(j.url)+'" alt="badge">';
  $('#badgeOut').innerHTML='Markdown: <code>'+esc(j.markdown)+'</code><br>HTML: <code>'+esc(j.html)+'</code>';
};

/* --- Разбор URL --- */
$('#urlForm').onsubmit=async e=>{
  e.preventDefault();busy($('#urlOut'));
  const j=await api('/api/tools/url-parse?url='+encodeURIComponent($('#urlIn').value.trim()));
  if(!j.ok){kv($('#urlOut'),[['Ошибка',j.error]]);return;}
  const params=Object.entries(j.params||{}).map(([k,v])=>k+'='+v.join(',')).join(' & ');
  kv($('#urlOut'),[['Протокол',j.scheme],['Хост',j.host+(j.port?':'+j.port:'')],['Поддомен',j.subdomain||'—'],
    ['Домен+TLD',j.domain_tld],['Путь',j.path||'/'],['Query',j.query||'—'],['Параметры',params||'—'],
    ['Фрагмент',j.fragment||'—'],['Авторизация в URL',j.username||'нет']]);
};

/* --- User-Agent --- */
(async function(){const j=await api('/api/tools/useragent');if(!j.ok)return;
  kv($('#uaOut'),[['Браузер',j.browser+' ('+j.engine+')'],['ОС',j.os],['IP',j.ip],
    ['Гео',[j.geo.city,j.geo.region,j.geo.country].filter(Boolean).join(', ')||'—'],['ISP',j.geo.isp||'—'],
    ['Accept-Language',j.accept_lang||'—'],['UA',j.user_agent]]);})();

/* --- HTTP-коды --- */
async function showCode(c){busy($('#codeOut'));
  const j=await api('/api/tools/http-status?code='+c);
  if(j.ok)kv($('#codeOut'),[['Код',j.code],['Название',j.name],['Класс',Math.floor(j.class_of)+'xx']]);
  else kv($('#codeOut'),[['Ошибка',j.error||'']]);}
$('#codeForm').onsubmit=e=>{e.preventDefault();showCode($('#codeIn').value);};
showCode(429);

/* --- MIME --- */
$('#mimeForm').onsubmit=async e=>{
  e.preventDefault();busy($('#mimeOut'));
  const v=$('#mimeIn').value.trim().toLowerCase();
  const j=await api('/api/tools/mime?ext='+encodeURIComponent(v));
  if(j.ok&&j.mime){kv($('#mimeOut'),[['.'+j.ext,j.mime]]);return;}
  const q=await api('/api/tools/mime?q='+encodeURIComponent(v));
  kv($('#mimeOut'),(q.results||[]).slice(0,8).map(r=>['.'+r.ext,r.mime]));
};

/* --- Анализ текста --- */
$('#txtRun').onclick=async()=>{
  const t=$('#txtIn').value;if(!t.trim())return;
  busy($('#txtStats'));
  const j=await fetch('/api/tools/text',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})}).then(r=>r.json());
  if(!j.ok){$('#txtStats').innerHTML='<small>'+esc(j.error)+'</small>';return;}
  kv($('#txtStats'),[['Символов',j.chars],['Без пробелов',j.chars_no_space],['Слов',j.words],
    ['Уникальных слов',j.unique_words],['Строк',j.lines],['Предложений',j.sentences],
    ['Чтение',j.read_min+' мин'],['Озвучка',j.speak_min+' мин'],
    ['Топ слов',(j.top_words||[]).map(w=>w[0]+' ('+w[1]+')').join(', ')]]);
  const V=[['UPPER',j.upper],['lower',j.lower],['swapCase',j.swapcase],['reversed',j.reversed],
    ['snake_case',j.snake],['kebab-case',j.kebab],['camelCase',j.camel],['slug',j.slug],
    ['rot13',j.rot13],['base64',j.base64]];
  $('#txtVariants').innerHTML=V.map(([n,val])=>'<div style="margin-bottom:6px"><b>'+n+'</b>: <span style="font-family:var(--mono);font-size:11px;word-break:break-all">'+esc(String(val).slice(0,300))+'</span></div>').join('');
};
})();
