/* Local synthetic acceptance client only. Never loaded by the production app. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const phases = ['before_analysis','proposal','execution','completed_review','archive'];
  let session = null, busy = false, generation = 0;
  const actor = () => el('actor').value;
  const scope = () => {
    const suffix = actor() === 'demo-stylist-a' ? 'a' : 'b';
    return {customerId:'demo-customer-'+suffix,visitId:'demo-visit-'+suffix,sessionId:'demo-ui-session-'+suffix};
  };
  const controls = () => {
    el('actor').disabled = busy;
    el('open').disabled = busy;
    for (const id of ['source','groups','phase','archive','revision','reload']) el(id).disabled = busy || !session;
    if (session) {
      el('source').disabled ||= session.phase === 'archive';
      el('groups').disabled ||= session.phase !== 'proposal';
      el('revision').disabled ||= session.phase !== 'archive';
      el('phase').disabled ||= session.phase === 'archive';
      el('archive').disabled ||= session.phase !== 'archive';
    }
  };
  const show = value => { el('result').textContent = JSON.stringify(value,null,2); };
  async function api(path, body) {
    if (location.hostname !== '127.0.0.1' || location.protocol !== 'http:') throw new Error('此页仅允许本机合成测试服务。');
    const response = await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'X-Design-Pilot-Actor':actor(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store',redirect:'error'});
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error((data.error?.code||response.status)+': '+(data.error?.message||'请求未完成'));
    return data;
  }
  async function run(fn) {
    if (busy) return;
    const current = generation;
    busy = true; controls();
    try { await fn(); if (current === generation) el('status').textContent='合成测试请求已完成，仅写入本机测试目录。'; }
    catch(error) { if (current === generation) el('status').textContent='未完成：'+error.message+'。可重新读取核对，不会自动重发写入。'; }
    finally { busy=false; controls(); }
  }
  async function read() {
    const id = scope().sessionId;
    const state = await api('sessions/'+encodeURIComponent(id));
    const history = await api('sessions/'+encodeURIComponent(id)+'/archives');
    session=state.session; show({session,archives:history.archives});
  }
  el('actor').addEventListener('change',()=>{generation++;session=null;show({});el('status').textContent='已切换模拟身份，请重新读取对应测试会话。';controls();});
  el('open').addEventListener('click',()=>run(async()=>{
    const selected=scope();
    await api('sessions',{requestId:'ui-create-'+selected.sessionId,...selected});
    await read();
  }));
  el('reload').addEventListener('click',()=>run(read));
  async function event(value) {
    await api('sessions/'+encodeURIComponent(session.scope.sessionId)+'/events',{requestId:crypto.randomUUID(),expectedRevision:session.revision,scope:session.scope,event:value});
    await read();
  }
  el('source').addEventListener('click',()=>run(()=>event({type:'source_recorded',source:{messageId:crypto.randomUUID(),kind:'text',actor:'employee',text:'【合成测试】顶区左侧计划使用18毫米杠；实际操作尚未确认。'}})));
  el('groups').addEventListener('click',()=>run(async()=>{
    const messageId=crypto.randomUUID(), batch=crypto.randomUUID();
    const text='【合成测试】顶区烫发第一组左侧计划18毫米；第一组右侧计划20毫米；第二组左侧计划22毫米。均待确认，实际未知。';
    await event({type:'source_recorded',source:{messageId,kind:'text',actor:'employee',text}});
    for (const [group,side,value,quote] of [['first','left',18,'第一组左侧计划18毫米'],['first','right',20,'第一组右侧计划20毫米'],['second','left',22,'第二组左侧计划22毫米']]) {
      await event({type:'entry_recorded',entry:{id:crypto.randomUUID(),category:'technique',field:'rod_size_mm',zone:'top',groupId:batch+'-'+group,service:'perm',side,track:'planned',origin:'extraction',basis:'said',value,status:'not_confirmed',sources:[{messageId,quote}],replacesEntryId:null}});
    }
  }));
  el('revision').addEventListener('click',()=>run(async()=>{
    await api('sessions/'+encodeURIComponent(session.scope.sessionId)+'/revisions',{requestId:crypto.randomUUID(),expectedRevision:session.revision,scope:session.scope,resumePhase:'completed_review',reasonSource:{messageId:crypto.randomUUID(),kind:'text',actor:'employee',text:'【合成测试】补充完成后复盘，原归档保留不变。'}});
    await read();
  }));
  el('phase').addEventListener('click',()=>run(()=>event({type:'phase_advanced',phase:phases[phases.indexOf(session.phase)+1]})));
  el('archive').addEventListener('click',()=>run(async()=>{
    await api('sessions/'+encodeURIComponent(session.scope.sessionId)+'/archive',{requestId:'ui-archive-'+session.scope.sessionId+'-'+session.revision,expectedRevision:session.revision,scope:session.scope});
    await read();
  }));
  run(async()=>{const data=await api('demo');show({mode:'仅本机合成测试',available:data});});
}());
