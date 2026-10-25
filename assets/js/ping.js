(function(){const K=window.NPK,$=K.$,nf=K.nf;
  const chart=K.Chart.make($('#pingChart'),{windowMs:60000,color:['#00e5ff','#22d3ee','#7c5cff'],fill:true});
  const TARGETS={cloudflare:['Cloudflare 1.1.1.1','https://1.1.1.1/cdn-cgi/trace'],
    google:['Google 8.8.8.8','https://www.gstatic.com/generate_204'],
    yandex:['Яндекс','https://yandex.com/favicon.ico'],
    'cloudflare-speed':['CF Speed','https://speed.cloudflare.com/__down?bytes=0']};
  let on=false,timer=null,sent=0,ok=0,fails=0,times=[],last=null,startT=0;
  function reset(){sent=ok=fails=0;times=[];last=null;['pCur','pMin','pMax','pAvg','pJit','pLoss'].forEach(i=>$('#'+i).innerHTML='—<span class="u">мс</span>');$('#pSent').textContent='0';$('#pTime').innerHTML='0<span class="u">с</span>';chart.clear();}
  function stat(){if(!times.length)return;const s=[...times].sort((a,b)=>a-b),avg=times.reduce((a,b)=>a+b,0)/times.length;
    let j=0;for(let i=1;i<times.length;i++)j+=Math.abs(times[i]-times[i-1]);j=times.length>1?j/(times.length-1):0;
    $('#pCur').innerHTML=nf(last,1)+'<span class="u">мс</span>';$('#pMin').innerHTML=nf(s[0],1)+'<span class="u">мс</span>';
    $('#pMax').innerHTML=nf(s[s.length-1],1)+'<span class="u">мс</span>';$('#pAvg').innerHTML=nf(avg,1)+'<span class="u">мс</span>';
    $('#pJit').innerHTML=nf(j,1)+'<span class="u">мс</span>';$('#pLoss').innerHTML=nf(sent?fails/sent*100:0,1)+'<span class="u">%</span>';
    $('#pSent').textContent=sent;$('#pTime').innerHTML=Math.round((Date.now()-startT)/1000)+'<span class="u">с</span>';}
  async function one(){if(!on)return;const [,url]=TARGETS[$('#pingTarget').value];const t0=performance.now();sent++;
    try{const ac=new AbortController();const g=setTimeout(()=>{try{ac.abort();}catch(e){}},3000);
      await fetch(url+(url.includes('?')?'&':'?')+'r='+Math.random(),{cache:'no-store',mode:'no-cors',signal:ac.signal});clearTimeout(g);
      const rt=performance.now()-t0;times.push(rt);ok++;last=rt;chart.push(rt);}
    catch(e){fails++;last=null;chart.push(0);}stat();}
  function loop(){if(!on)return;timer=setTimeout(async()=>{await one();loop();},1000);}
  $('#pingStart').onclick=()=>{if(on)return;on=true;reset();startT=Date.now();$('#pingStart').disabled=true;$('#pingStop').disabled=false;K.setLoader(true,'Пинг запущен',$('#pingTarget').selectedOptions[0].text);loop();one();};
  $('#pingStop').onclick=()=>{on=false;clearTimeout(timer);K.setLoader(false);$('#pingStart').disabled=false;$('#pingStop').disabled=true;K.toast('Пинг остановлен','ok',2200);};
  $('#pingTarget').onchange=()=>{if(on)reset();};
  K.renderUser(window.NP.user);
})();
