(function(global){
  'use strict';
  var enabled=new URLSearchParams(location.search).get('entry')==='staff-shareholder';
  function token(){try{return (JSON.parse(localStorage.getItem('booking-session')||'null')||{}).session_token||''}catch(_){return ''}}
  function blocked(message){
    var app=document.getElementById('app'),login=document.getElementById('login');if(app)app.classList.add('hidden');if(login)login.classList.add('hidden');
    var note=document.getElementById('staff-report-message');if(!note){note=document.createElement('p');note.id='staff-report-message';note.style.cssText='padding:32px;font-size:16px';document.body.appendChild(note)}
    note.textContent=message||'请从自由手艺人 App 登录后打开股东报表。';
  }
  global.StaffReportView={enabled:enabled,blocked:blocked,ready:function(){var note=document.getElementById('staff-report-message');if(note)note.remove()},request:async function(endpoint,key,operation,payload){
    var session=token();if(!session)throw new Error('员工登录已失效，请返回 App 重新登录');
    var r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify(Object.assign({},payload||{},{operation:operation,employee_session_token:session}))});
    var data=await r.json();if(token()!==session){blocked('员工登录已变化，请返回工作台重新打开报表。');throw new Error('员工登录已变化')}
    if(!r.ok){var e=new Error(data.error||'报表读取失败');e.status=r.status;if(r.status===401||r.status===403)blocked(e.message);throw e}return data;
  }};
  if(enabled){
    var style=document.createElement('style');
    style.textContent='#daily-detail-save,#daily-detail-save-top,#daily-detail-confirm,#daily-detail-confirm-top,#daily-detail-confirm-help,#daily-detail-candidates,.daily-more-options,.daily-confirm-bar,.monthly-action-help{display:none!important}';
    document.head.appendChild(style);
    global.addEventListener('storage',function(e){if(e.key==='booking-session')blocked('员工登录已变化，请返回工作台重新打开报表。')});
  }
})(window);
