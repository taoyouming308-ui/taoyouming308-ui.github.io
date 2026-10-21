(function(global){
  'use strict';
  var generation=0,button,config,pendingButton,dot,timer;
  function hidePending(){if(pendingButton)pendingButton.hidden=true;if(dot)dot.hidden=true}
  function visible(show){button.hidden=!show;button.style.display=show?'':'none';if(!show){hidePending();close();var choices=document.getElementById('employee-review-choices');if(choices)choices.remove()}}
  function session(){if(config&&typeof config.session==='function')return config.session();try{return JSON.parse(localStorage.getItem('booking-session')||'null')}catch(_){return null}}
  function close(){var panel=document.getElementById('employee-report-panel');if(panel)panel.remove();}
  async function inbox(token){
    var controller=new AbortController(),timeout=setTimeout(function(){controller.abort()},15000);
    try{var r=await fetch(config.url+'/functions/v1/operations-api',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.key},body:JSON.stringify({operation:'monthly_review_inbox',employee_session_token:token}),signal:controller.signal});var data=await r.json();if(!r.ok){var error=new Error(data.error||'月报待办读取失败');error.status=r.status;throw error}return data}finally{clearTimeout(timeout)}
  }
  function showPending(data){
    var pending=data.pending||[];dot.hidden=!pending.length;pendingButton.hidden=!pending.length;
    if(!pending.length)return;
    dot.textContent='● '+pending.length;pendingButton.textContent='月报待确认 · '+pending.length;
    pendingButton.onclick=function(){if(pending.length===1){open(pending[0]);return}choose(pending)};
  }
  function choose(pending){
    var old=document.getElementById('employee-review-choices');if(old)old.remove();
    var panel=document.createElement('section');panel.id='employee-review-choices';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','月报待确认');panel.style.cssText='position:fixed;right:16px;bottom:140px;z-index:11001;background:white;border:1px solid #ccc;border-radius:12px;padding:16px;max-height:60vh;max-width:calc(100vw - 32px);overflow:auto;box-shadow:0 5px 20px #0002';
    var closeButton=document.createElement('button');closeButton.textContent='关闭待办';closeButton.onclick=function(){panel.remove()};panel.appendChild(closeButton);
    pending.forEach(function(item){var b=document.createElement('button');b.textContent=item.store+' · '+item.period_month.slice(0,7)+' · 待确认 v'+item.version;b.style.cssText='display:block;width:100%;padding:14px;margin-top:8px;color:#111;background:#f4f4ef;border:1px solid #ddd;border-radius:8px';b.onclick=function(){panel.remove();open(item)};panel.appendChild(b)});document.body.appendChild(panel);
  }
  async function refresh(){
    var run=++generation,s=session();if(!button)return;
    if(!s||!s.session_token){visible(false);return}
    try{var data=await StaffAccessClient.request(config.url,config.key,'report_access',{session_token:s.session_token});if(run!==generation||(session()||{}).session_token!==s.session_token)return;visible(!!data.enabled);if(!data.enabled)return;
      try{var tasks=await inbox(s.session_token);if(run===generation&&(session()||{}).session_token===s.session_token)showPending(tasks)}catch(error){if(run!==generation)return;hidePending();if(error.status===401||error.status===403){visible(false);return}pendingButton.hidden=false;pendingButton.textContent='月报待办暂未读取 · 重试';pendingButton.onclick=refresh}
    }catch(_){if(run===generation)visible(false)}
  }
  async function open(item){
    var s=session();if(!s)return;
    button.disabled=true;
    try{
      var access=await StaffAccessClient.request(config.url,config.key,'report_access',{session_token:s.session_token});
      if((session()||{}).session_token!==s.session_token)return;
      if(!access.enabled)throw new Error('尚未开通股东报表权限，请联系管理员');
      close();if(global.closeHomeDrawer)global.closeHomeDrawer();
      var panel=document.createElement('section');panel.id='employee-report-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','股东报表');panel.style.cssText='position:fixed;inset:0;z-index:11000;background:#f6f3ec;display:flex;flex-direction:column';
      var bar=document.createElement('div');bar.style.cssText='padding:10px;padding-top:max(10px,env(safe-area-inset-top));display:flex;gap:16px;align-items:center;color:#173a2a';
      var back=document.createElement('button');back.textContent='← 返回工作台';back.onclick=function(){close();refresh()};bar.appendChild(back);bar.appendChild(document.createTextNode('股东报表 · 只读核对'));
      var version=document.documentElement.getAttribute('data-version')||'';
      var frame=document.createElement('iframe');frame.title='授权门店报表';frame.src='operations.html?entry=staff-shareholder'+(/^\d+$/.test(version)?'&v='+version:'')+(item&&item.store?'&review_store='+encodeURIComponent(item.store)+'&review_month='+encodeURIComponent(item.period_month.slice(0,7)):'');frame.style.cssText='border:0;flex:1;width:100%;min-height:0';
      panel.appendChild(bar);panel.appendChild(frame);document.body.appendChild(panel);
    }catch(e){alert(e.message)}finally{button.disabled=false}
  }
  function clearIdentity(){hidePending();close();var panel=document.getElementById('employee-review-choices');if(panel)panel.remove()}
  global.EmployeeReports={init:function(options){config=options;button=document.getElementById('employee-report-entry');dot=document.createElement('span');dot.id='employee-review-dot';dot.style.cssText='color:#b5352e;font-size:12px';dot.setAttribute('aria-label','待确认月报数');button.appendChild(dot);pendingButton=document.createElement('button');pendingButton.id='employee-review-pending';pendingButton.type='button';pendingButton.style.cssText='position:fixed;right:16px;bottom:max(88px,calc(env(safe-area-inset-bottom) + 76px));z-index:10990;padding:12px 18px;border-radius:24px;border:1px solid #ddd;background:#191d19;color:white;font-size:14px;box-shadow:0 3px 12px #0002';document.body.appendChild(pendingButton);visible(false);button.onclick=function(){open()};refresh();clearInterval(timer);timer=setInterval(function(){if(!document.hidden)refresh()},60000)},refresh:refresh,close:close};
  global.addEventListener('staff-identity-changed',function(){clearIdentity();refresh()});
  global.addEventListener('storage',function(e){if(e.key==='booking-session'){clearIdentity();refresh()}});
  global.addEventListener('message',function(e){var frame=document.querySelector('#employee-report-panel iframe');if(e.origin===location.origin&&frame&&e.source===frame.contentWindow&&e.data&&e.data.type==='zysyr-monthly-review-updated')refresh()});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&config)refresh()});
})(window);
