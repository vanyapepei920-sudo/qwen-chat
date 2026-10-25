/* v8.1: поддержка пользовательского API-ключа.
   Ключ НЕ хардкодится: ввод в Настройках → localStorage (np_api_key) →
   подставляется в каждый запрос к /api/v1/* как заголовок X-NetPulse-Key. */
(function(){
  const KEY='np_api_key';
  window.NPKey={
    get(){try{return localStorage.getItem(KEY)||'';}catch(e){return '';}},
    set(v){try{v?(localStorage.setItem(KEY,v),v=(v||'').trim()):localStorage.removeItem(KEY);}catch(e){}},
    clear(){try{localStorage.removeItem(KEY);}catch(e){}},
    /* единая точка выхода в API: добавляет заголовок с ключом, если он сохранён */
    fetch(url,opts){opts=opts||{};
      if(typeof url==='string'&&url.indexOf('/api/v1')!==-1){
        const k=this.get();
        if(k){opts.headers=Object.assign({},opts.headers||{},{'X-NetPulse-Key':k});}
      }
      return fetch(url,opts);}
  };
  /* обёртка над нативным fetch: любое обращение к /api/v1 автоматически с ключом */
  const _f=window.fetch;
  window.fetch=function(u,o){
    try{const s=(typeof u==='string')?u:(u&&u.url)||'';
      if(s.indexOf('/api/v1')!==-1){const k=NPKey.get();
        if(k){o=o||{};if(u instanceof Request){o.headers=new Headers(u.headers);o.headers.set('X-NetPulse-Key',k);return _f.call(window,u,o);}
          o.headers=Object.assign({},o.headers||{},{'X-NetPulse-Key':k});}}
    }catch(e){}
    return _f.call(this,u,o);};
})();
