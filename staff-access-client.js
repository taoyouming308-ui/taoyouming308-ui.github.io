(function (global) {
  'use strict';
  global.StaffAccessClient = {
    request: async function (base, key, operation, payload) {
      var response = await fetch(base + '/functions/v1/staff-access-api', {
        method: 'POST', headers: {'Content-Type':'application/json',apikey:key},
        body: JSON.stringify(Object.assign({}, payload || {}, {operation:operation}))
      });
      var data = await response.json();
      if (!response.ok) { var e = new Error(data.error || '员工权限请求失败'); e.status = response.status; throw e; }
      return data;
    },
    mountGrants: async function (box, id, request) {
      var section=document.createElement('fieldset');section.id='staff-report-access';section.style.cssText='margin:16px 0;padding:12px;border:1px solid #777;border-radius:8px';
      var legend=document.createElement('legend');legend.textContent='股东报表权限';section.appendChild(legend);
      var note=document.createElement('p');note.textContent='正在读取授权…';section.appendChild(note);box.appendChild(section);
      try {
        var data=await request(id?'staff_access':'stores',id?{staff_id:id}:{});
        if(!section.isConnected)return;
        note.textContent=data.can_manage?'仅可查看勾选门店的报表，不能修改或入账。取消全部勾选即关闭权限。':'只有总管理员可设置股东报表权限。';
        (data.stores||[]).forEach(function(store){
          var label=document.createElement('label');label.style.cssText='display:flex;gap:8px;align-items:center;margin:10px 0;font-size:14px;line-height:1.5';
          var cb=document.createElement('input');cb.type='checkbox';cb.style.cssText='width:18px;height:18px;flex:none;margin:0';cb.value=store.id;cb.checked=(data.report_store_ids||[]).indexOf(store.id)>=0;cb.disabled=!data.can_manage;
          label.appendChild(cb);label.appendChild(document.createTextNode('股东 · '+store.name));section.appendChild(label);
        });
        section.dataset.ready='true';section.dataset.manage=String(data.can_manage);
      } catch(e) {note.textContent='权限读取失败：'+e.message+'。请关闭后重试，当前授权未改动。';}
    },
    grants: function () {
      var box=document.getElementById('staff-report-access');
      if(!box || box.dataset.ready!=='true')throw new Error('股东权限尚未读取完成，请稍后重试');
      if(box.dataset.manage!=='true')return undefined;
      return Array.from(box.querySelectorAll('input:checked')).map(function(cb){return cb.value});
    }
  };
})(window);
