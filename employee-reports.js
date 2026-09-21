(function(global){
  'use strict';
  var generation=0,button,config;
  function visible(show){button.hidden=!show;button.style.display=show?'':'none';if(!show)close()}
  function session(){try{return JSON.parse(localStorage.getItem('booking-session')||'null')}catch(_){return null}}
  function close(){var panel=document.getElementById('employee-report-panel');if(panel)panel.remove();}
  async function refresh(){
    var run=++generation,s=session();if(!button)return;
    if(!s||!s.session_token){visible(false);return}
    try{var data=await StaffAccessClient.request(config.url,config.key,'report_access',{session_token:s.session_token});if(run===generation)visible(!!data.enabled)}catch(_){if(run===generation)visible(false)}
  }
  async function open(){
    var s=session();if(!s)return;
    button.disabled=true;
    try{
      var access=await StaffAccessClient.request(config.url,config.key,'report_access',{session_token:s.session_token});
      if((session()||{}).session_token!==s.session_token)return;
      if(!access.enabled)throw new Error('尚未开通股东报表权限，请联系管理员');
      close();if(global.closeHomeDrawer)global.closeHomeDrawer();
      var panel=document.createElement('section');panel.id='employee-report-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','股东报表');panel.style.cssText='position:fixed;inset:0;z-index:11000;background:#f6f3ec;display:flex;flex-direction:column';
      var bar=document.createElement('div');bar.style.cssText='padding:10px;padding-top:max(10px,env(safe-area-inset-top));display:flex;gap:16px;align-items:center;color:#173a2a';
      var back=document.createElement('button');back.textContent='← 返回工作台';back.onclick=close;bar.appendChild(back);bar.appendChild(document.createTextNode('股东报表 · 只读'));
      var version=document.documentElement.getAttribute('data-version')||'';
      var frame=document.createElement('iframe');frame.title='授权门店报表';frame.src='operations.html?entry=staff-shareholder'+(/^\d+$/.test(version)?'&v='+version:'');frame.style.cssText='border:0;flex:1;width:100%;min-height:0';
      panel.appendChild(bar);panel.appendChild(frame);document.body.appendChild(panel);
    }catch(e){alert(e.message)}finally{button.disabled=false}
  }
  global.EmployeeReports={init:function(options){config=options;button=document.getElementById('employee-report-entry');visible(false);button.onclick=open;refresh()},refresh:refresh,close:close};
  global.addEventListener('staff-identity-changed',function(){close();refresh()});
  global.addEventListener('storage',function(e){if(e.key==='booking-session'){close();refresh()}});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&config)refresh()});
})(window);
