/* ===== Админ-панель магазина приложений ===== */
(function(){
  if(document.body.dataset.page!=='store-admin') return;
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const D=window.SA_DATA||{apps:[],cats:[]};
  const jpost=(u,body)=>fetch(u,{method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());

  /* --- вкладки --- */
  $('#saTabs').addEventListener('click',e=>{
    const t=e.target.closest('.sa-tab');if(!t)return;
    $$('.sa-tab').forEach(b=>b.classList.toggle('on',b===t));
    $$('.sa-panel').forEach(p=>p.hidden=(p.id!=='p-'+t.dataset.p));
  });

  /* --- file-drop подсветка --- */
  function bindDrop(drop,input){
    input.addEventListener('change',()=>{
      const n=input.files[0]?input.files[0].name:'';
      drop.classList.toggle('has',!!n);
      if(n)drop.firstChild.textContent='✅ '+n+' ';
    });
  }
  bindDrop($('#fdFile'),$('#inFile')); bindDrop($('#fdIcon'),$('#inIcon'));

  /* --- загрузка нового приложения --- */
  $('#upForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=$('#upBtn');btn.disabled=true;btn.textContent='⬆ Загрузка…';
    try{
      const fd=new FormData(e.target);
      const r=await fetch('/api/store/admin/apps',{method:'POST',credentials:'include',body:fd});
      const j=await r.json();
      if(j.ok){toast('Приложение опубликовано в магазине 🎉','ok');setTimeout(()=>location.reload(),800);}
      else toast('Ошибка: '+(j.error==='no_file'?'не выбран файл':(j.error||'?')),'err');
    }catch(err){toast('Загрузка не удалась (файл больше лимита?)','err');}
    btn.disabled=false;btn.textContent='⬆ Загрузить в магазин';
  });

  /* --- редактирование приложений --- */
  let edId=null,fbId=null;
  $('#appsRows').addEventListener('click',async e=>{
    const tr=e.target.closest('tr[data-id]');if(!tr)return;
    const act=e.target.closest('[data-act]');if(!act)return;
    const id=+tr.dataset.id, a=D.apps.find(x=>x.id===id)||{};
    if(act.dataset.act==='edit'){
      edId=id;$('#edTitle').textContent=a.title||'';
      $('#edName').value=a.title||'';$('#edPub').value=a.publisher||'';
      $('#edVer').value=a.version||'';$('#edTag').value=a.tagline||'';
      $('#edDesc').value=a.description||'';$('#edFeat').checked=!!a.featured;
      $('#edCat').value=a.category_id||'';
      $('#editBox').hidden=false;$('#fileBox').hidden=true;
      $('#editBox').scrollIntoView({behavior:'smooth'});
    }
    if(act.dataset.act==='file'){
      fbId=id;$('#fbTitle').textContent=a.title||'';$('#fbFile').value='';
      $('#fileBox').hidden=false;$('#editBox').hidden=true;
      $('#fileBox').scrollIntoView({behavior:'smooth'});
    }
    if(act.dataset.act==='del'){
      if(!confirm('Удалить «'+(a.title||'')+'» вместе с файлом и отзывами?'))return;
      const j=await fetch('/api/store/admin/apps/'+id,{method:'DELETE',credentials:'include'}).then(r=>r.json());
      if(j.ok){toast('Удалено','ok');setTimeout(()=>location.reload(),600);}else toast('Ошибка','err');
    }
  });
  $('#edCancel').onclick=()=>{$('#editBox').hidden=true;};
  $('#edSave').onclick=async()=>{
    if(!edId)return;
    const body={title:$('#edName').value.trim(),publisher:$('#edPub').value.trim(),
      version:$('#edVer').value.trim(),tagline:$('#edTag').value.trim(),
      description:$('#edDesc').value,featured:$('#edFeat').checked,
      category_id:$('#edCat').value||null};
    if(!body.title){toast('Название не может быть пустым','warn');return;}
    const j=await jpost('/api/store/admin/apps/'+edId,body);
    if(j.ok){toast('Сохранено ✓','ok');setTimeout(()=>location.reload(),600);}
    else toast('Ошибка: '+(j.error||'?'),'err');
  };
  $('#fbSend').onclick=async()=>{
    if(!fbId)return;
    const f=$('#fbFile').files[0];
    if(!f){toast('Выберите файл','warn');return;}
    const btn=$('#fbSend');btn.disabled=true;btn.textContent='Загрузка…';
    try{
      const fd=new FormData();fd.append('file',f);
      const j=await fetch('/api/store/admin/apps/'+fbId+'/file',{method:'POST',credentials:'include',body:fd}).then(r=>r.json());
      if(j.ok){toast('Файл обновлён ✓','ok');setTimeout(()=>location.reload(),600);}
      else toast('Ошибка: '+(j.error||'?'),'err');
    }finally{btn.disabled=false;btn.textContent='📦 Загрузить новый файл';}
  };

  /* --- категории --- */
  $('#catAdd').onclick=async()=>{
    const name=$('#catName').value.trim();
    if(!name){toast('Введите название','warn');return;}
    const j=await jpost('/api/store/categories',{name,emoji:$('#catEmoji').value.trim()||'📦'});
    if(j.ok){toast('Категория добавлена','ok');setTimeout(()=>location.reload(),600);}
    else toast(j.error==='already_exists'?'Такая категория уже есть':'Ошибка','err');
  };
  $('#catsRows').addEventListener('click',async e=>{
    const tr=e.target.closest('tr[data-id]');if(!tr)return;
    const act=e.target.closest('[data-act]');if(!act)return;
    const id=tr.dataset.id;
    if(act.dataset.act==='rename'){
      const name=prompt('Новое название:',tr.dataset.name);if(!name)return;
      const emoji=prompt('Эмодзи (например 🎮):',tr.dataset.emoji)||'📦';
      const j=await fetch('/api/store/categories/'+id,{method:'PUT',credentials:'include',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({name,emoji})}).then(r=>r.json());
      if(j.ok){toast('Обновлено','ok');setTimeout(()=>location.reload(),500);}
      else toast(j.error==='already_exists'?'Такое название занято':'Ошибка','err');
    }
    if(act.dataset.act==='del'){
      if(!confirm('Удалить категорию «'+tr.dataset.name+'»? Приложения останутся без категории.'))return;
      const j=await fetch('/api/store/categories/'+id,{method:'DELETE',credentials:'include'}).then(r=>r.json());
      if(j.ok){toast('Удалено','ok');setTimeout(()=>location.reload(),500);}
    }
  });

  /* --- администраторы --- */
  $('#admAdd').onclick=async()=>{
    const email=$('#admEmail').value.trim().toLowerCase();
    if(!email){toast('Введите email','warn');return;}
    const j=await jpost('/api/store/admin/admins',{email});
    if(j.ok){toast('Права выданы 👑','ok');setTimeout(()=>location.reload(),600);}
    else toast(j.error==='user_not_found'?'Пользователь с таким email ещё не входил в систему':'Ошибка','err');
  };
  $('#admRows').addEventListener('click',async e=>{
    const tr=e.target.closest('tr[data-id]');if(!tr)return;
    if(!e.target.closest('[data-act="revoke"]'))return;
    if(!confirm('Отозвать права у '+tr.dataset.email+'?'))return;
    const j=await fetch('/api/store/admin/admins/'+tr.dataset.id,{method:'DELETE',credentials:'include'}).then(r=>r.json());
    if(j.ok){toast('Права отозваны','ok');setTimeout(()=>location.reload(),600);}
    else toast(j.error==='cannot_revoke_self'?'Нельзя отозвать права у самого себя':'Ошибка','err');
  });
})();
