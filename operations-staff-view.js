(function(global){
  'use strict';
  var enabled=new URLSearchParams(location.search).get('entry')==='staff-shareholder';
  var READ_TIMEOUT_MS=45000;
  var phase='loading';
  function token(){try{return (JSON.parse(localStorage.getItem('booking-session')||'null')||{}).session_token||''}catch(_){return ''}}
  function notice(message){
    if(!document.body)return null;
    var note=document.getElementById('staff-report-message');if(!note){note=document.createElement('section');note.id='staff-report-message';note.style.cssText='padding:32px;font-size:16px;line-height:1.7';note.setAttribute('role','status');document.body.appendChild(note)}
    note.textContent=message;return note;
  }
  function loading(){phase='loading';document.documentElement.classList.add('staff-report-loading');notice('正在打开已授权门店报表…');}
  function blocked(message){
    phase='blocked';document.documentElement.classList.remove('staff-report-loading');
    var app=document.getElementById('app'),login=document.getElementById('login');if(app)app.classList.add('hidden');if(login)login.classList.add('hidden');
    var note=notice(message||'请从自由手艺人 App 登录后打开股东报表。');
    if(note){var retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='重新读取报表';retry.style.cssText='display:block;margin-top:16px';retry.onclick=function(){if(typeof global.restoreSession==='function'){loading();global.restoreSession()}};note.appendChild(retry);}
  }
  global.StaffReportView={enabled:enabled,loading:loading,blocked:blocked,ready:function(){phase='ready';document.documentElement.classList.remove('staff-report-loading');var note=document.getElementById('staff-report-message');if(note)note.remove()},request:async function(endpoint,key,operation,payload){
    var session=token();if(!session)throw new Error('员工登录已失效，请返回 App 重新登录');
    var controller=typeof AbortController==='function'?new AbortController():null;
    var timer=controller?setTimeout(function(){controller.abort()},READ_TIMEOUT_MS):null;
    try{
      var r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify(Object.assign({},payload||{},{operation:operation,employee_session_token:session})),...(controller?{signal:controller.signal}:{})});
      var data;try{data=await r.json()}catch(error){if(controller&&controller.signal.aborted)throw error;throw new Error('报表服务暂时无法读取，请重试')}
      if(token()!==session){blocked('员工登录已变化，请返回工作台重新打开报表。');throw new Error('员工登录已变化')}
      if(!r.ok){var e=new Error(data.error||'报表读取失败');e.status=r.status;e.code=data.code||'';if(r.status===401||r.status===403)blocked(e.message);throw e}return data;
    }catch(error){
      if(controller&&controller.signal.aborted){var timeout=new Error('股东报表读取超时，未提交任何修改；请点击重新读取报表');timeout.code='STAFF_REPORT_READ_TIMEOUT';throw timeout}
      throw error;
    }finally{if(timer)clearTimeout(timer)}
  }};
  if(enabled){
    var style=document.createElement('style');
    // This script runs in <head>, before the finance login can ever paint.
    style.textContent='#login,#daily-detail-save,#daily-detail-save-top,#daily-detail-confirm,#daily-detail-confirm-top,#daily-detail-confirm-help,#daily-detail-candidates,.daily-more-options,.daily-confirm-bar,.monthly-action-help{display:none!important}.staff-report-loading #app{display:none!important}';
    document.head.appendChild(style);
    loading();document.addEventListener('DOMContentLoaded',function(){if(phase==='loading')notice('正在打开已授权门店报表…')},{once:true});
    global.addEventListener('storage',function(e){if(e.key==='booking-session')blocked('员工登录已变化，请返回工作台重新打开报表。')});
  }
})(window);
