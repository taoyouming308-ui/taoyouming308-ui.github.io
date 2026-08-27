(function(global){
  'use strict';

  var STORAGE_KEY='zysyr-operations-auth-v1';

  function clean(value,max){return String(value==null?'':value).trim().slice(0,max||9000)}
  function safeParse(value){try{return JSON.parse(value)}catch(_){return null}}

  function create(config){
    var base=clean(config&&config.supabaseUrl,500).replace(/\/$/,'');
    var key=clean(config&&config.publishableKey,1000);
    if(!/^https:\/\//.test(base)||!key)throw new Error('Supabase Auth 配置不完整');

    function read(){
      var value=null;try{value=safeParse(global.localStorage.getItem(STORAGE_KEY)||'')}catch(_){}
      if(!value||!value.session||!clean(value.session.access_token)||!clean(value.session.refresh_token))return null;
      return value;
    }

    function persist(session,scope){
      var value={session:{
        access_token:clean(session.access_token),
        refresh_token:clean(session.refresh_token),
        expires_at:Number(session.expires_at)||0,
        expires_in:Number(session.expires_in)||0,
        token_type:clean(session.token_type,40)||'bearer'
      },scope:scope||null,updated_at:new Date().toISOString()};
      if(!value.session.access_token||!value.session.refresh_token)throw new Error('Supabase Auth 会话无效');
      global.localStorage.setItem(STORAGE_KEY,JSON.stringify(value));
      return value;
    }

    function clear(){try{global.localStorage.removeItem(STORAGE_KEY)}catch(_){}}

    async function request(url,options){
      var response=await global.fetch(url,options||{});
      var body=await response.json().catch(function(){return{error:'认证服务响应无效'}});
      if(!response.ok){var error=new Error(clean(body.error||body.message,300)||'认证请求失败');error.status=response.status;throw error}
      return body;
    }

    function roleScope(scope,code){
      if(!Array.isArray(scope.roles))return null;
      var role=scope.roles.find(function(item){return item&&item.code===code&&item.scope&&(item.scope.type==='company'||item.scope.type==='store')});
      return role&&role.scope||null;
    }

    function capabilityAt(scope,code,roleScopeValue){
      return Array.isArray(scope.capabilities)&&scope.capabilities.some(function(capability){return capability&&capability.code===code&&Array.isArray(capability.scopes)&&capability.scopes.some(function(item){return item&&roleScopeValue&&item.type===roleScopeValue.type&&(item.type==='company'||item.store_id===roleScopeValue.store_id)})});
    }

    async function verify(accessToken){
      var scope=await request(base+'/functions/v1/operations-auth',{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+clean(accessToken)}});
      var shareholderScope=roleScope(scope,'shareholder');
      var financeScope=roleScope(scope,'finance');
      var managerScope=roleScope(scope,'store_manager');
      var employeeScope=roleScope(scope,'employee');
      var shareholderOk=shareholderScope&&shareholderScope.type==='company'&&capabilityAt(scope,'dashboard.group.read',shareholderScope);
      var financeOk=financeScope&&capabilityAt(scope,'dashboard.store.read',financeScope)&&capabilityAt(scope,'daily_report.write',financeScope);
      var managerOk=managerScope&&managerScope.type==='store'&&capabilityAt(scope,'dashboard.store.read',managerScope);
      var employeeId=scope.user&&clean(scope.user.employee_id,40);
      var employeeOk=employeeScope&&employeeScope.type==='store'&&capabilityAt(scope,'employee.self.read',employeeScope)&&/^[0-9a-f-]{36}$/i.test(employeeId);
      if(scope.auth_boundary!=='supabase_auth_rls'||(!shareholderOk&&!financeOk&&!managerOk&&!employeeOk))throw new Error('Supabase Auth 经营角色与范围校验失败');
      return scope;
    }

    async function refresh(value){
      var body=await request(base+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json','apikey':key},body:JSON.stringify({refresh_token:value.session.refresh_token})});
      return persist(body,value.scope);
    }

    async function restore(){
      var value=read();if(!value)return null;
      try{
        if(!value.session.expires_at||value.session.expires_at<=Math.floor(Date.now()/1000)+60)value=await refresh(value);
        try{value.scope=await verify(value.session.access_token)}catch(error){if(error.status!==401)throw error;value=await refresh(value);value.scope=await verify(value.session.access_token)}
        return persist(value.session,value.scope);
      }catch(_){clear();return null}
    }

    async function login(username,password){
      var session=await request(base+'/functions/v1/operations-auth-migrate',{method:'POST',headers:{'Content-Type':'application/json','apikey':key},body:JSON.stringify({action:'password_login',username:clean(username,80),password:String(password==null?'':password)})});
      var scope=await verify(session.access_token);
      return persist(session,scope);
    }

    async function signOut(){
      var value=read();
      clear();
      if(value)await global.fetch(base+'/auth/v1/logout?scope=local',{method:'POST',headers:{'apikey':key,'Authorization':'Bearer '+value.session.access_token}});
    }

    async function createFinanceAccount(payload){
      var value=read();
      if(!value)value=await restore();
      if(!value)throw new Error('请重新登录后创建财务账号');
      return request(base+'/functions/v1/operations-auth-admin',{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+value.session.access_token},body:JSON.stringify({
        action:'create_finance_account',
        login_name:clean(payload&&payload.login_name,80),
        display_name:clean(payload&&payload.display_name,80),
        password:String(payload&&payload.password==null?'':payload.password),
        scope_type:clean(payload&&payload.scope_type,20),
        store_id:clean(payload&&payload.store_id,40)||null
      })});
    }

    async function createWorkforceAccount(payload){
      var value=read();
      if(!value)value=await restore();
      if(!value)throw new Error('请重新登录后创建经营账号');
      return request(base+'/functions/v1/operations-auth-admin',{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+value.session.access_token},body:JSON.stringify({
        action:'create_workforce_account',
        login_name:clean(payload&&payload.login_name,80),
        display_name:clean(payload&&payload.display_name,80),
        password:String(payload&&payload.password==null?'':payload.password),
        role_code:clean(payload&&payload.role_code,30),
        store_id:clean(payload&&payload.store_id,40),
        employee_id:clean(payload&&payload.employee_id,40)
      })});
    }

    async function createShareholderAccount(payload){
      var value=read();
      if(!value)value=await restore();
      if(!value)throw new Error('请重新登录后创建股东账号');
      return request(base+'/functions/v1/operations-auth-admin',{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+value.session.access_token},body:JSON.stringify({
        action:'create_shareholder_account',
        login_name:clean(payload&&payload.login_name,80),
        display_name:clean(payload&&payload.display_name,80),
        password:String(payload&&payload.password==null?'':payload.password),
        scope_type:clean(payload&&payload.scope_type,20),
        store_id:clean(payload&&payload.store_id,40)||null
      })});
    }

    return{login:login,restore:restore,signOut:signOut,createFinanceAccount:createFinanceAccount,createWorkforceAccount:createWorkforceAccount,createShareholderAccount:createShareholderAccount,clear:clear,read:read};
  }

  global.ZysyrAuthBridge={create:create,storageKey:STORAGE_KEY};
})(window);
