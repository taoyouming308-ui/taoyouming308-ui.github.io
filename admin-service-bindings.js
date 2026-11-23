import {createAdminServiceBindingClient} from './packages/design-prepared-ui/admin-service-binding-client.mjs';
let active;
export function openAdminServiceBinding({profileId,getSession,document:doc=globalThis.document}={}){
 const session=getSession?.();if(session?.role!=='admin'||!session.staffToken||!/^[1-9][0-9]{0,15}$/.test(profileId))throw Error('DESIGN_SERVICE_DENIED');
 if(active&&!active.canClose())return active;
 active?.close();
 const owner=session.staffToken,modal=doc.createElement('dialog');modal.setAttribute('aria-label','确认服务负责员工');
 modal.style.cssText='width:min(520px,92vw);max-height:90vh;overflow:auto;background:#171719;color:#eee;border:1px solid #555;border-radius:12px;padding:20px;box-sizing:border-box;';
 modal.innerHTML='<h2 style="margin-top:0;font-size:18px;">确认服务负责员工</h2><p data-profile></p><p style="font-size:13px;color:#bbb;">请人工核对本次服务、顾客和员工账号。此操作不修改预约；管理员不会因此获得照片查看权。</p><label>服务日期 <input data-date type="date"></label> <button data-load type="button">查询服务</button><p><label>本次服务 <select data-visit style="max-width:100%;"><option value="">请先查询</option></select></label></p><p><label>负责员工账号 <select data-staff><option value="">请先查询</option></select></label></p><button data-inspect type="button" disabled>核对绑定</button><p data-review style="white-space:pre-wrap;"></p><label style="display:block;font-size:13px;"><input data-attest type="checkbox" disabled> 我已核实顾客、本次服务与负责员工账号对应</label><p><label>确认或撤销说明<br><textarea data-reason maxlength="500" rows="2" style="width:100%;box-sizing:border-box;"></textarea></label></p><p data-status role="status" aria-live="polite"></p><div style="display:flex;gap:8px;flex-wrap:wrap;"><button data-confirm type="button" disabled>确认负责员工</button><button data-revoke type="button" disabled>撤销绑定</button><button data-lookup type="button" hidden>查询保存结果</button><button data-close type="button">关闭</button></div>';
 const el=name=>modal.querySelector('[data-'+name+']'),notice=text=>{el('status').textContent=text;};
 let closed=false,busy=false,generation=0,review=null,pending=null;
 const current=()=>!closed&&getSession?.()?.role==='admin'&&getSession()?.staffToken===owner;
 const client=createAdminServiceBindingClient({getCredential:()=>current()?getSession().staffToken:null});
 const lock=()=>{
  for(const n of ['date','load','visit','staff','reason','inspect','confirm','revoke','attest','close','lookup'])el(n).disabled=busy;
  if(pending)for(const n of ['date','load','visit','staff','reason'])el(n).disabled=true;
  el('inspect').disabled=busy||!el('visit').value||!el('staff').value||!!pending;
  el('attest').disabled=busy||!review||!!pending;
  el('confirm').disabled=busy||!review||!el('attest').checked||!!pending;
  el('revoke').disabled=busy||review?.state!=='active'||!!pending;
  el('lookup').hidden=!pending;
 };
 const invalidate=()=>{generation++;review=null;el('review').textContent='';el('attest').checked=false;lock();};
 const close=()=>{if(busy)return;closed=true;generation++;modal.remove();if(active?.modal===modal)active=null;};
 async function perform(task,done){
  if(busy||!current()){if(!current())close();return;}
  const epoch=generation;busy=true;lock();
  try{const result=await task();if(current()&&epoch===generation)done(result);}
  catch(e){if(current()&&epoch===generation){
   if(e.outcome==='uncertain')notice('保存结果尚未确认。请查询原操作结果，系统不会自动重提。');
   else{pending=null;invalidate();notice(({DESIGN_SERVICE_DENIED:'没有当前操作权限，或服务、顾客、员工资料已变化。请重新登录或核对。',DESIGN_SERVICE_STALE:'资料或绑定版本已变化，请重新核对后再确认。',DESIGN_SERVICE_CONFLICT:'该操作编号已有不同记录，请重新核对。',DESIGN_SERVICE_BUSY:'另一个绑定操作正在进行，请稍后重新核对。',DESIGN_SERVICE_TOO_MANY:'当日服务过多，暂不能完整加载，请联系管理员处理。'})[e.code]||'暂时无法连接绑定服务，请稍后重试。');}
  }}finally{busy=false;if(!current())close();else lock();}
 }
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 el('date').value=['year','month','day'].map(t=>parts.find(x=>x.type===t).value).join('-');
 el('profile').textContent='正在为选中的顾客核对服务绑定。';
 function options(select,items,format,key){select.replaceChildren(new Option('请选择',''));for(const item of items)select.add(new Option(format(item),item[key]));}
 el('load').onclick=()=>{invalidate();el('visit').replaceChildren(new Option('请先查询',''));el('staff').replaceChildren(new Option('请先查询',''));perform(()=>client.request({action:'choices',profileId,date:el('date').value}),r=>{
  el('profile').textContent=[r.profile.label,r.profile.store,'手机号尾号 '+r.profile.phoneTail].join(' · ');
  options(el('visit'),r.visits,x=>[x.kind,x.time||'',x.label,'尾号 '+x.phoneTail,'预约标注 '+x.barberLabel].join(' · '),'visitKey');
  options(el('staff'),r.staff,x=>x.label,'staffId');notice(r.visits.length?'请明确选择本次服务和负责员工账号，不会自动匹配。':'当日没有可核对的服务。');
 });};
 for(const n of ['visit','staff'])el(n).onchange=invalidate;
 el('date').onchange=()=>{invalidate();el('visit').replaceChildren(new Option('请先查询',''));el('staff').replaceChildren(new Option('请先查询',''));notice('日期已更换，请重新查询服务。');lock();};
 el('attest').onchange=lock;
 el('inspect').onclick=()=>{invalidate();perform(()=>client.request({action:'inspect',visitKey:el('visit').value,profileId,staffId:el('staff').value}),r=>{
  review=r;const bound=r.boundStaffId&&[...el('staff').options].find(x=>x.value===r.boundStaffId)?.textContent;
  el('review').textContent='顾客档案：'+r.target.profileLabel+' · 尾号 '+r.target.profilePhoneTail+'\n服务记录：'+r.source.customerLabel+' · 尾号 '+r.source.phoneTail+'\n门店与日期：'+r.source.store+' · '+r.source.date+'\n选择负责员工：'+r.target.staffLabel+'\n当前绑定：'+(r.state==='active'?'有效'+(bound?' · '+bound:''):r.state==='revoked'?'已撤销':'未建立')+(r.bindingMatches?'（与本次核对一致）':'');
  notice('请核实上述对应关系并填写说明，再主动确认。');
 });};
 async function mutate(action){
  if(!review||busy||pending||!current())return;
  const reason=el('reason').value.trim();if(!reason){notice('请填写本次确认或撤销说明。');return;}
  if(action==='confirm'&&!el('attest').checked)return;
  if(action==='revoke'&&!globalThis.confirm('撤销本次服务绑定？负责员工将不能再通过这项绑定核验。'))return;
  const input={action,visitKey:el('visit').value,profileId,expectedRevision:review.revision,requestId:crypto.randomUUID(),reason,...(action==='confirm'?{staffId:el('staff').value,sourceSha:review.source.sourceSha,profileSha:review.target.profileSha,staffSha:review.target.staffSha}:{})};
  pending=input;await perform(()=>client.request(input),r=>{pending=null;invalidate();notice(r.state==='revoked'?'绑定已撤销。':'服务绑定已保存。');});
 }
 el('confirm').onclick=()=>mutate('confirm');el('revoke').onclick=()=>mutate('revoke');
 el('lookup').onclick=()=>{if(!pending)return;perform(()=>client.request({action:'status',visitKey:pending.visitKey,profileId,requestId:pending.requestId}),r=>{
  if(!r.committed){notice('尚未查到原操作回执，请稍后再次查询；系统不会自动重提。');return;}
  pending=null;invalidate();notice('已查到原操作回执，当前绑定'+(r.state==='revoked'?'已撤销':'已保存')+'。如需修改，请重新核对。');
 });};
 el('close').onclick=close;modal.addEventListener('cancel',e=>{e.preventDefault();close();});
 doc.body.append(modal);modal.showModal();active={modal,close,canClose:()=>!busy};lock();
 return active;
}
