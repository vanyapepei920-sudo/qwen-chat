(function(){const K=window.NPK,$=K.$,nf=K.nf,Net=K.Net,page=document.body.dataset.page;
  K.renderUser(window.NP.user);

  if(page==='traceroute'){
    const HOPS=[
      {name:'Cloudflare Edge',loc:'ближайший POP',url:'https://cloudflare.com/cdn-cgi/trace'},
      {name:'CF Speed',loc:'speed.cloudflare.com',url:'https://speed.cloudflare.com/__down?bytes=0'},
      {name:'Google',loc:'google.com',url:'https://www.google.com/generate_204'},
      {name:'Cloudflare DNS',loc:'1.1.1.1',url:'https://1.1.1.1/dns-query?name=example.com&type=A'},
      {name:'GitHub',loc:'github.com',url:'https://github.com'},
      {name:'Яндекс',loc:'yandex.ru',url:'https://yandex.ru/favicon.ico'}];
    let running=false;
    async function hop(h,i){const t0=performance.now();let status='—',ip='—',loc=h.loc;
      try{const ac=new AbortController();const g=setTimeout(()=>{try{ac.abort();}catch(e){}},5000);
        const r=await fetch(h.url,{cache:'no-store',mode:'no-cors',signal:ac.signal});clearTimeout(g);
        status=r.type==='opaque'?'ok (opaque)':(r.ok?'ok':'HTTP '+r.status);
        if(h.url.includes('cdn-cgi/trace')){try{const txt=await r.clone().text();const m=txt.match(/ip=([0-9a-f:.]+)/);if(m)ip=m[1];const c=txt.match(/colo=([A-Z0-9]+)/);if(c)loc=c[1]+' · '+loc;}catch(e){}}
      }catch(e){status=e.name==='AbortError'?'timeout':'fail';}
      const rt=performance.now()-t0;return{i,name:h.name,loc,ip,rt,status};}
    async function run(){if(running)return;running=true;$('#trStart').disabled=true;K.setLoader(true,'Трассировка','hop 1/'+HOPS.length);
      $('#trBody').innerHTML='';let total=0,best={rt:1e9,name:'—'};
      for(let i=0;i<HOPS.length;i++){K.qwText('Трассировка','hop '+(i+1)+'/'+HOPS.length);const h=await hop(HOPS[i],i);total+=h.rt;if(h.rt<best.rt&&h.status.startsWith('ok'))best={rt:h.rt,name:h.name};
        $('#trBody').insertAdjacentHTML('beforeend','<tr><td>'+(i+1)+'</td><td>'+h.name+'</td><td>'+h.loc+'</td><td>'+(h.ip||'—')+'</td><td style="color:'+(h.rt<50?'#8affc8':h.rt<150?'#ffd28a':'#ff9db0')+'">'+nf(h.rt,1)+' мс</td><td><span class="badge '+(h.status.startsWith('ok')?'good':'bad')+'">'+h.status+'</span></td></tr>');}
      $('#trHops').textContent=HOPS.length;$('#trTotal').innerHTML=nf(total,0)+'<span class="u">мс</span>';$('#trBest').textContent=best.name;$('#trSum').hidden=false;
      K.setLoader(false);$('#trStart').disabled=false;running=false;K.toast('Трассировка завершена','ok',2600);}
    $('#trStart').onclick=run;
  }

  if(page==='dns'){
    const PROV=[{n:'Google DNS',u:'https://dns.google/resolve'},{n:'Cloudflare',u:'https://cloudflare-dns.com/dns-query'},{n:'Quad9',u:'https://dns.quad9.net/dns-query'}];
    async function resolve(p,host,type){const t0=performance.now();try{
      const r=await fetch(p.u+'?name='+encodeURIComponent(host)+'&type='+type,{headers:{accept:'application/dns-json'},cache:'no-store'});
      const j=await r.json();return{p,ms:performance.now()-t0,j,status:j.Status};}catch(e){return{p,ms:performance.now()-t0,j:null,status:-1};}}
    async function run(){const host=$('#dnsHost').value.trim()||'example.com';K.setLoader(true,'DNS','запрос к '+host);
      $('#dnsBody').innerHTML='<tr><td colspan="5" class="empty">Запрос…</td></tr>';const res=await Promise.all(PROV.map(p=>resolve(p,host,'A')));
      $('#dnsBody').innerHTML=res.map(r=>{const ips=r.j&&r.j.Answer?r.j.Answer.filter(a=>a.type===1).map(a=>a.data).join(', '):'—';
        const cn=r.j&&r.j.Answer?r.j.Answer.filter(a=>a.type===5).map(a=>a.data).join(', '):'—';
        return '<tr><td>'+r.p.n+'</td><td style="font-size:11.5px">'+ips+'</td><td style="font-size:11.5px">'+cn+'</td><td>'+nf(r.ms,0)+' мс</td><td><span class="badge '+(r.status===0?'good':r.status<0?'bad':'mid')+'">'+(r.status===0?'OK':r.status===3?'NXDOMAIN':'код '+r.status)+'</span></td></tr>';}).join('');
      $('#dnsStats').innerHTML=res.map(r=>'<div class="stat ping"><div class="k">'+r.p.n+'</div><div class="v">'+nf(r.ms,0)+'<span class="u">мс</span></div></div>').join('');
      K.setLoader(false);K.toast('DNS проверен','ok',2200);}
    $('#dnsRun').onclick=run;$('#dnsHost').addEventListener('keydown',e=>{if(e.key==='Enter')run();});
  }

  if(page==='wifi'){
    const chart=K.Chart.make($('#wChart'),{windowMs:30000,color:['#3ddc97','#00e5ff','#7c5cff'],fill:true});
    function info(){const c=Net.conn,el=id=>$('#'+id);const b=K.estimateBand();
      $('#wBand').textContent=b.band;$('#wWhy').textContent=b.why;$('#wConf').style.width=b.conf+'%';
      if(!c){['wType','wEff','wDown','wRtt','wWidth','wSave'].forEach(i=>el(i).textContent='—');}
      else{el('wType').textContent=c.type||'не указан';el('wEff').textContent=(c.effectiveType||'—').toUpperCase();
        el('wDown').innerHTML=(c.downlink!=null?c.downlink:'—')+' Мбит/с';el('wRtt').innerHTML=(c.rtt!=null?c.rtt:'—')+' мс';
        el('wWidth').textContent=b.w;el('wSave').textContent=c.saveData?'включена':'выключена';}}
    async function scan(){K.setLoader(true,'Оценка канала','быстрые замеры RTT/скорость');
      for(let i=0;i<6;i++){const ac=new AbortController();const g=setTimeout(()=>{try{ac.abort();}catch(e){}},3000);
        const t0=performance.now();let v=0;try{const buf=await(await fetch(Net.DOWN+'200000&r='+Math.random(),{cache:'no-store',signal:ac.signal})).arrayBuffer();v=buf.byteLength*8/((performance.now()-t0)/1000)/1e6;}catch(e){}
        clearTimeout(g);chart.push(v);await K.sleep(250);}
      info();K.setLoader(false);K.toast('Оценка обновлена','ok',2000);}
    $('#wScan').onclick=scan;info();K.fetchMeta(false).then(info);if(Net.conn)Net.conn.onchange=info;scan();
  }
})();
