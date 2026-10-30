/* ===== Scuarfy Store: админ-панель ===== */
(function(){
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=window.escHTML;
  const J=(url,opt)=>fetch(url,Object.assign({credentials:'include'},opt||{})).then(r=>r.json());

  /* вкладки */
  $('#saTabs').addEventListener('click',e=>{
    const b=e.target.closest('.sa-tab'); if(!b||!b.dataset.p)return;
    $$('#saTabs .sa-tab').forEach(x=>x.classList.toggle('on',x===b));
    ['upload','apps','cats','orgs','admins'].forEach(p=>$('#p-'+p).hidden=(p!==b.dataset.p));
    $('#editBox').hidden=true; $('#fileBox').hidden=true;
  });

  /* превью выбранных файлов */
  function bindDrop(inputId, dropId, label){
    const i=$('#'+inputId);
    i.addEventListener('change',()=>{
      const d=$('#'+dropId);
      d.classList.toggle('has', !!i.files.length);
      d.firstChild.textContent = i.files.length ? ('✅ '+label+': '+i.files[0].name) : d.getAttribute('data-orig');
    });
    const d=$('#'+dropId); d.setAttribute('data-orig', d.firstChild.textContent);
  }
  bindDrop('inFile','fdFile','файл'); bindDrop('inIcon','fdIcon','иконка'); bindDrop('inBrand','fdBrand','логотип');

  /* загрузка приложения (без кнопки «рекомендовать» — ID и рекомендации автоматические) */
  $('#upForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=$('#upBtn'); btn.disabled=true; btn.textContent='⬆ Загрузка…';
    try{
      const fd=new FormData(e.target);
      const j=await J('/api/store/admin/apps',{method:'POST',body:fd});
      if(j.ok){toast('Приложение опубликовано! ID: '+j.public_id,'ok');setTimeout(()=>location.reload(),900);}
      else toast('Ошибка: '+(j.error||'?'),'err');
    }catch(err){toast('Ошибка загрузки: '+err.message,'err');}
    btn.disabled=false; btn.textContent='⬆ Загрузить в магазин';
  });

  /* таблица приложений: редактирование / замена файла / удаление */
  let edId=null, fbId=null;
  $('#appsRows').addEventListener('click',async e=>{
    const b=e.target.closest('[data-act]'); if(!b)return;
    const tr=b.closest('tr'), id=+tr.dataset.id;
    const app=(window.SA_DATA.apps||[]).find(a=>a.id===id)||{};
    if(b.dataset.act==='edit'){
      edId=id; $('#editBox').hidden=false; $('#fileBox').hidden=true;
      $('#edTitle').textContent=app.title||'';
      $('#edName').value=app.title||''; $('#edPub').value=app.publisher||'';
      $('#edVer').value=app.version||'1.0'; $('#edTag').value=app.tagline||'';
      $('#edDesc').value=app.description||''; $('#edCat').value=app.category_id||'';
      $('#editBox').scrollIntoView({behavior:'smooth'});
    }
    if(b.dataset.act==='file'){
      fbId=id; $('#fileBox').hidden=false; $('#editBox').hidden=true;
      $('#fbTitle').textContent=app.title||''; $('#fbFile').value='';
      $('#fileBox').scrollIntoView({behavior:'smooth'});
    }
    if(b.dataset.act==='del'){
      if(!confirm('Удалить приложение «'+(app.title||'')+'»? Действие необратимо.'))return;
      const j=await J('/api/store/admin/apps/'+id,{method:'DELETE'});
      if(j.ok){toast('Удалено','ok');setTimeout(()=>location.reload(),600);}else toast('Ошибка','err');
    }
  });
  $('#edCancel').onclick=()=>{$('#editBox').hidden=true;};
  $('#edSave').onclick=async()=>{
    if(!edId)return;
    const j=await J('/api/store/admin/apps/'+edId,{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title:$('#edName').value.trim(),publisher:$('#edPub').value.trim(),
        version:$('#edVer').value.trim(),tagline:$('#edTag').value.trim(),
        description:$('#edDesc').value,category_id:$('#edCat').value||null})});
    if(j.ok){toast('Сохранено','ok');setTimeout(()=>location.reload(),600);}else toast('Ошибка','err');
  };
  $('#fbSend').onclick=async()=>{
    if(!fbId)return;
    const f=$('#fbFile').files[0];
    if(!f){toast('Выберите файл','warn');return;}
    const fd=new FormData(); fd.append('file',f);
    const j=await J('/api/store/admin/apps/'+fbId+'/file',{method:'POST',body:fd});
    if(j.ok){toast('Файл обновлён','ok');setTimeout(()=>location.reload(),600);}else toast('Ошибка','err');
  };

  /* категории */
  $('#catAdd').onclick=async()=>{
    const name=$('#catName').value.trim(); if(!name){toast('Введите название','warn');return;}
    const j=await J('/api/store/categories',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,emoji:$('#catEmoji').value.trim()||'📦'})});
    if(j.ok){toast('Категория добавлена','ok');setTimeout(()=>location.reload(),600);}
    else toast(j.error==='already_exists'?'Такая категория уже есть':'Ошибка','err');
  };
  $('#catsRows').addEventListener('click',async e=>{
    const b=e.target.closest('[data-act]'); if(!b)return;
    const tr=b.closest('tr'), id=+tr.dataset.id;
    if(b.dataset.act==='rename'){
      const name=prompt('Новое название:',tr.dataset.name); if(!name)return;
      const emoji=prompt('Новый эмодзи:',tr.dataset.emoji)||'📦';
      const j=await J('/api/store/categories/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:name.trim(),emoji})});
      if(j.ok){toast('Обновлено','ok');setTimeout(()=>location.reload(),600);}else toast('Ошибка','err');
    }
    if(b.dataset.act==='del'){
      if(!confirm('Удалить категорию «'+tr.dataset.name+'»? Приложения останутся без категории.'))return;
      const j=await J('/api/store/categories/'+id,{method:'DELETE'});
      if(j.ok){toast('Удалено','ok');setTimeout(()=>location.reload(),600);}
    }
  });

  /* администраторы */
  $('#admAdd').onclick=async()=>{
    const email=$('#admEmail').value.trim().toLowerCase(); if(!email){toast('Введите email','warn');return;}
    const j=await J('/api/store/admin/admins',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email})});
    if(j.ok){toast('Права выданы','ok');setTimeout(()=>location.reload(),600);}
    else toast(j.error==='user_not_found'?'Пользователь с таким email ещё не входил в систему':'Ошибка','err');
  };
  $('#admRows').addEventListener('click',async e=>{
    const b=e.target.closest('[data-act=revoke]'); if(!b)return;
    const tr=b.closest('tr');
    if(!confirm('Отозвать права у '+tr.dataset.email+'?'))return;
    const j=await J('/api/store/admin/admins/'+tr.dataset.id,{method:'DELETE'});
    if(j.ok){toast('Права отозваны','ok');setTimeout(()=>location.reload(),600);}
    else toast(j.error==='cannot_revoke_self'?'Нельзя отозвать собственные права':'Ошибка','err');
  });
})();

/* заявки организаций: принять / отклонить */
(function(){
  const list=document.getElementById('orgList'); if(!list) return;
  list.addEventListener('click', async e=>{
    const b=e.target.closest('[data-dec]'); if(!b) return;
    const item=b.closest('.org-item'); const uuid=item.dataset.uuid;
    const note=(item.querySelector('.org-note-inp')||{}).value||'';
    if(b.dataset.dec==='rejected' && !confirm('Отклонить заявку?')) return;
    b.disabled=true;
    const r=await fetch('/api/store/admin/org-requests/'+uuid+'/decision',{
      method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({decision:b.dataset.dec,note:note.trim()})});
    const j=await r.json();
    if(j.ok){toast(b.dataset.dec==='approved'?'Заявка одобрена — выданы права администратора':'Заявка отклонена','ok');
      setTimeout(()=>location.reload(),700);}
    else {toast('Ошибка: '+(j.error||'?'),'err'); b.disabled=false;}
  });
})();
