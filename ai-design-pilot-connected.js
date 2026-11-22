/* Explicit loopback-only synthetic UI adapter. Never loaded by the offline page. */
(function(global){
  'use strict';
  const ACTOR='demo-ui-owner';
  const SCHEMA='design-pilot-ui-draft-v1';
  let mounted=null,booting=false,bootEpoch=0;
  const root=()=>document.getElementById('ai-design-pilot-connected-root');
  function problem(code,message,status){const error=new Error(message);error.code=code;error.status=status;return error;}
  function localOnly(){if(global.location.protocol!=='http:'||global.location.hostname!=='127.0.0.1')throw problem('LOCAL_ONLY','只允许通过明确启动的 127.0.0.1 合成测试服务打开。');}
  async function api(path,body){
    localOnly();
    const controller=new AbortController(),timeout=global.setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'X-Design-Pilot-Actor':ACTOR,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      let data;try{data=await response.json();}catch{throw problem('INVALID_RESPONSE','本机服务没有返回有效 JSON；请读取核对。',response.status);}
      if(!response.ok||data?.ok!==true)throw problem(data?.error?.code||'REQUEST_FAILED',(data?.error?.code||response.status)+'：'+(data?.error?.message||'本机请求失败'),response.status);
      return data;
    }catch(error){if(error.name==='AbortError')throw problem('TIMEOUT','本机请求超时，写入结果尚未确定；请重试同一请求或重新读取。');throw error;}
    finally{global.clearTimeout(timeout);}
  }
  function sameScope(a,b){return a&&b&&['customerId','visitId','sessionId'].every(key=>a[key]===b[key])&&Object.keys(a).length===3;}
  function validScope(value){return value&&['customerId','visitId','sessionId'].every(key=>typeof value[key]==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value[key]));}
  function normalize(data,scope){
    const state=data.uiDraft;
    if(!state||state.schemaVersion!=='design-pilot-ui-state-v1'||!sameScope(state.scope,scope)||!Number.isSafeInteger(state.revision)||state.revision<0||!['draft','archived'].includes(state.status)||state.draft?.schemaVersion!==SCHEMA||state.draft.synthetic!==true||!Array.isArray(data.archives))throw problem('INVALID_RESPONSE','返回记录与当前模拟顾客范围不一致，未应用。');
    const archives=data.archives.map((row,index)=>{
      const archive=row.archive||row,draft=row.draft||archive.snapshot?.draft;
      if((archive.scope&&!sameScope(archive.scope,scope))||draft?.schemaVersion!==SCHEMA||draft.synthetic!==true||!Number.isSafeInteger(archive.revision)||archive.revision>state.revision)throw problem('INVALID_RESPONSE','返回归档与当前模拟顾客范围不一致，未应用。');
      return {number:row.number||index+1,createdAt:row.createdAt||'本机 revision '+archive.revision,draft};
    });
    return {revision:state.revision,status:state.status,draft:state.draft,archives};
  }
  function makeAdapter(catalog){
    if(catalog.schemaVersion!==SCHEMA||!Array.isArray(catalog.customers)||!catalog.customers.length||!catalog.fieldOptions||!catalog.fixtureText)throw problem('INVALID_CATALOG','本机合成目录不可用。');
    const customers=catalog.customers;
    const seen=new Set();for(const customer of customers){if(!customer||typeof customer.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(customer.id)||seen.has(customer.id)||!validScope(customer.scope)||typeof customer.title!=='string')throw problem('INVALID_CATALOG','合成顾客目录格式不正确。');seen.add(customer.id);}
    function scopeFor(id){const customer=customers.find(item=>item.id===id);if(!customer)throw problem('FORBIDDEN','此模拟顾客不在当前服务白名单。');return customer.scope;}
    function valuesFor(path){
      const parts=path.split('.'),group=parts[0],field=parts[parts.length-1],options=catalog.fieldOptions;
      const values=['proposal','care'].includes(path)?options[path]:group==='zoneProcesses'?options[parts[2]]?.[field]:group==='zones'?options.zones?.[field]:options[group]?.[field];
      if(!Array.isArray(values)||!values.every(item=>typeof item==='string'))throw problem('INVALID_CATALOG','合成字段选项缺失：'+path);
      return values;
    }
    async function load(id){
      const scope=scopeFor(id);let data;
      try{data=await api('ui-drafts/'+scope.sessionId);}
      catch(error){
        if(error.status!==404)throw error;
        const requestId='connected-create-'+scope.sessionId;
        if(requestId.length>80)throw problem('INVALID_CATALOG','合成会话标识过长。');
        data=await api('ui-drafts',{requestId,scope});
      }
      return normalize(data,scope);
    }
    async function write(operation,id,expectedRevision,requestId,draft){
      const scope=scopeFor(id),body={requestId,expectedRevision,scope};
      if(operation==='save')body.draft=draft;
      if(operation==='reopen')body.reason=catalog.fixtureText.revisionReason;
      return normalize(await api('ui-drafts/'+scope.sessionId+'/'+operation,body),scope);
    }
    return Object.freeze({customers,valuesFor,transcriptText:catalog.fixtureText.transcript,load,save:(id,revision,requestId,draft)=>write('save',id,revision,requestId,draft),archive:(id,revision,requestId)=>write('archive',id,revision,requestId),reopen:(id,revision,requestId)=>write('reopen',id,revision,requestId)});
  }
  function showBootError(error){
    const container=root();if(!container)return;
    container.replaceChildren();const panel=document.createElement('section');panel.className='adp';const shell=document.createElement('div');shell.className='adp-shell';const message=document.createElement('p');message.className='adp-connected-error';message.textContent='本机连接尚未建立：'+error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='重试读取合成目录';retry.addEventListener('click',boot);shell.append(message,retry);panel.append(shell);container.append(panel);
  }
  async function boot(){
    if(booting||mounted||!root())return;booting=true;const epoch=++bootEpoch;
    try{localOnly();const catalog=await api('ui-catalog');if(epoch!==bootEpoch)return;const adapter=makeAdapter(catalog);root().replaceChildren();mounted=global.AIDesignPilot.mount(root(),{connectedAdapter:adapter});}
    catch(error){if(epoch===bootEpoch)showBootError(error);}
    finally{if(epoch===bootEpoch)booting=false;}
  }
  global.addEventListener('pagehide',()=>{bootEpoch++;booting=false;if(mounted){mounted.destroy();mounted=null;}});
  global.addEventListener('pageshow',boot);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
