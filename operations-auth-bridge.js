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

    async function verify(accessToken){
      var scope=await request(base+'/functions/v1/operations-auth',{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+clean(accessToken)}});
      var companyRole=Array.isArray(scope.roles)&&scope.roles.some(function(role){return role&&role.code==='shareholder'&&role.scope&&role.scope.type==='company'});
      var groupRead=Array.isArray(scope.capabilities)&&scope.capabilities.some(function(capability){return capability&&capability.code==='dashboard.group.read'&&Array.isArray(capability.scopes)&&capability.scopes.some(function(item){return item&&item.type==='company'})});
      if(scope.auth_boundary!=='supabase_auth_rls'||!companyRole||!groupRead)throw new Error('Supabase Auth 股东公司范围校验失败');
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

    return{login:login,restore:restore,signOut:signOut,clear:clear,read:read};
  }

  global.ZysyrAuthBridge={create:create,storageKey:STORAGE_KEY};
})(window);
