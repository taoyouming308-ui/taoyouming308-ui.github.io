/** Existing App extension. Activation is trusted configuration, never URL/storage/DOM state. */
import {mountPreparedHttpDesign} from './composition.mjs';
import {createPreparedHttpClient} from './http-client.mjs';
import {renderArchiveVersions} from './archive-view.mjs';
import {createPreparedAppSession,bindPreparedHttpIdentity,checkedVisitList,validVisitDate} from './app-session.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const fail=code=>{throw Object.assign(new Error(code),{code});};
const safeError=e=>/^[A-Z][A-Z0-9_]{0,79}$/.test(e?.code||'')?e.code:'DESIGN_ENTRY_UNAVAILABLE';
export function archiveLocator(context={}){
 const booking=String(context.bookingId??'');
 if(/^[1-9]\d{0,15}$/.test(booking)&&Number.isSafeInteger(Number(booking)))return {assignmentSource:'appointment',visitId:'booking:'+booking};
 const frontdesk=String(context.frontdeskVisitId??'');
 if(/^frontdesk:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(frontdesk))return {assignmentSource:'frontdesk',visitId:frontdesk};
 return null;
}
export function createPreparedAppBridge({enabled=false,http={},resolveCustomers,dateProvider,host=globalThis.PreparedDesignHost,recording={},previews={},confirmDiscard=message=>globalThis.confirm(message)}={}){
 let destroyed=false,modal=null,modalApp=null,modalEpoch=0,opener=null,identityLocked=false,lockedUnsaved=false,pickerSuspended=false,lastDate='';
 const readers=new Set(),events=new AbortController();
 // No readSession/readDate invocation occurs while disabled. The host is function-only.
 const session=enabled===true&&typeof http.credentialProvider!=='function'&&typeof host?.readSession==='function'
  ?createPreparedAppSession({readSession:()=>host.readSession(),readDate:()=>host.readDate?.(),eventTarget:globalThis}):null;
 const baseHttp=session?{...http,credentialProvider:session.credential}:{...http};
 const ready=()=>enabled===true;
 const getDate=()=>{try{const value=typeof dateProvider==='function'?dateProvider():session?session.date():host?.readDate?.();return validVisitDate(value)?value:'';}catch{return '';}};
 const mountPoint=()=>modal?.querySelector('[data-prepared-app-mount]');
 function hasUnsaved(){const v=modalApp?.controller.view();return lockedUnsaved||Boolean(v&&(v.pending||v.busy||v.archivePending||v.archiveBusy||v.speechPending||v.uploadPending||v.managed?.busy||v.managed?.pending||v.managed?.selection||v.managedModel?.busy||v.managedModel?.pending||v.managedViews?.busy||v.managedViews?.pending||v.normalizedSynthetic?.busy||v.normalizedSynthetic?.pending||v.modelPending||v.modelBusy))||Boolean(modal&&Array.from(modal.querySelectorAll('textarea[data-draft],input[data-draft]')).some(n=>n.value));}
 function discardAllowed(){return !hasUnsaved()||confirmDiscard('离开会清除未发送的本页输入。进行中的请求可能已完成，请重新核查，勿盲目重复收费请求。确定离开？');}
 function close(force=false){if(!modal)return true;if(!force&&!discardAllowed())return false;modalEpoch++;modalApp?.destroy();modalApp=null;modal.remove();modal=null;identityLocked=false;lockedUnsaved=false;pickerSuspended=false;opener?.focus?.();opener=null;return true;}
 function invalidateIdentity(){for(const reader of readers)reader.clear();modalEpoch++;if(!modal)return;lockedUnsaved=hasUnsaved();identityLocked=true;pickerSuspended=false;modalApp?.controller.suspend();mountPoint().replaceChildren(element('p','员工身份已变化，旧列表和记录已隐藏。请关闭后重新打开并核权；原进行中请求可能已完成，不能据此认定已取消。'));}
 const unsubscribe=session?.subscribe(invalidateIdentity);
 if(!session)globalThis.addEventListener?.('staff-identity-changed',()=>{if(ready())invalidateIdentity();},{signal:events.signal});
 async function resolved(visit,scopedHttp,expectedBindingRevision){
  // A legacy explicit-visit callback is retained for compatibility. Homepage selection always uses the server resolver.
  if(typeof resolveCustomers==='function'&&expectedBindingRevision===undefined){const rows=await resolveCustomers(clone(visit));if(!Array.isArray(rows)||rows.length!==1||!rows[0]?.scope||rows[0].scope.visitId!==visit.visitId||rows[0].scope.assignmentSource!==visit.assignmentSource)fail('EXACT_VISIT_REQUIRED');return clone(rows);}
  const result=await createPreparedHttpClient({...scopedHttp,enabled:true}).resolveVisit(visit,expectedBindingRevision);
  if(!result?.scope||result.scope.visitId!==visit.visitId||result.scope.assignmentSource!==visit.assignmentSource)fail('VISIT_SCOPE_INVALID');
  return [{id:visit.visitId,title:`已重新核权的${visit.assignmentSource==='appointment'?'预约':'到店'}服务 · ${visit.visitId}`,scope:clone(result.scope)}];
 }
 function showWorkflow(mount,customers,scopedHttp,epoch){if(destroyed||epoch!==modalEpoch||identityLocked||!modal)return;
  const hostNode=element('div'),back=element('button','返回服务列表，重新核权');back.type='button';back.dataset.preparedListBack='';
  mount.replaceChildren(back,hostNode);modalApp=mountPreparedHttpDesign(hostNode,{enabled:true,http:scopedHttp,customers,recording,previews});
  back.addEventListener('click',()=>{if(identityLocked||!discardAllowed())return;modalApp?.destroy();modalApp=null;lockedUnsaved=false;showPicker(mount,lastDate||getDate());});
 }
 function showPicker(mount,initialDate){
  const epoch=++modalEpoch;pickerSuspended=false;let requestSeq=0,busy=false,selecting=false;
  const panel=element('section');panel.className='apw-visit-picker';panel.dataset.preparedVisitPicker='';
  const title=element('h2','选择本次服务'),note=element('p','列表由服务器按当前员工核权。预约与到店分别保留；选中时再次核验绑定，列表不是长期访问许可。同名时请核对预约 / 到店编号，无法确认就不要打开。');
  const label=element('label','营业日期'),date=element('input');date.type='date';date.dataset.preparedVisitDate='';date.value=validVisitDate(initialDate)?initialDate:'';label.append(date);
  const refresh=element('button','读取 / 刷新授权服务列表');refresh.type='button';refresh.dataset.preparedVisitRefresh='';
  const status=element('p',date.value?'正在读取授权列表…':'请选择明确营业日期后读取；不自动猜测日期。');status.setAttribute('role','status');status.dataset.preparedListStatus='';
  const rows=element('div');rows.className='apw-visit-rows';panel.append(title,note,label,refresh,status,rows);mount.replaceChildren(panel);
  const live=seq=>!destroyed&&modal&&epoch===modalEpoch&&!identityLocked&&seq===requestSeq;
  date.addEventListener('change',()=>{requestSeq++;busy=false;selecting=false;refresh.disabled=false;rows.replaceChildren();status.textContent='日期已改变，请重新读取授权列表。';lastDate=date.value;});
  async function read(){if(busy||selecting)return;const requestedDate=date.value,seq=++requestSeq;rows.replaceChildren();if(!validVisitDate(requestedDate)){status.textContent='请选择有效的明确营业日期。';return;}busy=true;refresh.disabled=true;lastDate=requestedDate;status.textContent='正在重新核权读取…';
   try{const scopedHttp=await bindPreparedHttpIdentity(baseHttp);if(!live(seq))return;const result=checkedVisitList(await createPreparedHttpClient({...scopedHttp,enabled:true}).listVisits(requestedDate),requestedDate);if(!live(seq)||date.value!==requestedDate)return;
    status.textContent=result.visits.length?`本次授权候选 ${result.visits.length} 项；请明确选择，不自动打开第一项。`:'本日期没有可用的已绑定服务。未绑定或无权访问的服务不会展示。';
    for(const row of result.visits){const button=element('button');button.type='button';button.dataset.preparedVisit=row.id;const name=element('strong',row.displayName),meta=element('span',`${row.visit.assignmentSource==='appointment'?'预约':'到店散客'} · ${row.visit.visitId}`);button.append(name,meta);rows.append(button);
     button.addEventListener('click',async()=>{if(selecting||busy||!live(seq))return;selecting=true;refresh.disabled=true;date.disabled=true;rows.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='正在核验选中的本次服务与原绑定版本…';try{const customers=await resolved(row.visit,scopedHttp,row.bindingRevision);if(!live(seq))return;showWorkflow(mount,customers,scopedHttp,epoch);}catch(e){if(live(seq)){rows.replaceChildren();status.textContent=safeError(e)+'：未打开记录。服务分配或绑定可能已变化，请显式刷新列表后重新选择。';}}finally{if(live(seq)){selecting=false;refresh.disabled=false;date.disabled=false;}}});
    }
   }catch(e){if(live(seq))status.textContent=safeError(e)+(e?.code==='VISIT_LIST_LIMIT_EXCEEDED'?'：该日期候选超过安全上限，未展示部分列表，请人工核查。':'：未交付列表，请确认当前登录与日期后再明确重读。');}
   finally{if(live(seq)){busy=false;refresh.disabled=false;}}
  }
  refresh.addEventListener('click',read);if(date.value)void read();
 }
 async function openHome(locator=null){
  if(destroyed)return;if(modal){modal.focus();return;}const epoch=++modalEpoch;identityLocked=false;lockedUnsaved=false;opener=document.activeElement;
  modal=element('section');modal.className='apw-app-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','统一设计记录');modal.tabIndex=-1;
  const box=element('div');box.className='apw-app-box';const button=element('button','关闭，返回原页面');button.type='button';button.dataset.preparedClose='';button.addEventListener('click',()=>close());const mount=element('div');mount.dataset.preparedAppMount='';box.append(button,mount);modal.append(box);document.body.append(modal);modal.focus();
  modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const nodes=Array.from(modal.querySelectorAll('button,a,input,textarea,select,[tabindex]')).filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
  if(!ready()){modalApp=mountPreparedHttpDesign(mount);return;}
  if(!locator){showPicker(mount,getDate());return;}
  mount.textContent='正在核查当前员工的服务范围…';try{const scopedHttp=await bindPreparedHttpIdentity(baseHttp);if(destroyed||epoch!==modalEpoch||identityLocked)return;const customers=await resolved(clone(locator),scopedHttp);showWorkflow(mount,customers,scopedHttp,epoch);}catch(e){if(!destroyed&&epoch===modalEpoch&&modal&&!identityLocked)mount.textContent=safeError(e)+'：服务范围未确认，未打开记录。';}
 }
 function attachArchive(container,context,legacy){
  const holder=element('section');holder.className='apw-app-archive';holder.append(element('h3','完整设计版本 · 只读'),element('p',ready()?'与上方旧格式档案分别保存，不转换或覆盖。需重新核验当前本次服务。':'新版完整档案服务尚未启用。上方旧格式档案保留原有功能；不会自动连接新后端。'));container.append(holder);
  let alive=true,epoch=0,busy=false;const locator=archiveLocator(context),body=element('div');holder.append(body);const reader={clear(){epoch++;busy=false;body.replaceChildren();}};readers.add(reader);
  if(ready()&&locator){const read=element('button','核权并查看完整版本');read.type='button';read.dataset.preparedArchiveRead='';const open=element('button','用统一设计界面打开本次服务');open.type='button';open.addEventListener('click',()=>openHome(locator));holder.insertBefore(read,body);holder.insertBefore(open,body);
   read.addEventListener('click',async()=>{if(busy)return;const token=++epoch;busy=true;read.disabled=true;body.textContent='正在重新核权读取…';try{const scopedHttp=await bindPreparedHttpIdentity(baseHttp);if(!alive||token!==epoch)return;const list=await resolved(locator,scopedHttp);if(!alive||token!==epoch)return;const history=await createPreparedHttpClient({...scopedHttp,enabled:true}).history(list[0].scope);if(!alive||token!==epoch)return;renderArchiveVersions(body,{scope:list[0].scope,history});}catch(e){if(alive&&token===epoch)body.textContent=safeError(e)+'：未交付档案内容。';}finally{if(alive&&token===epoch){busy=false;read.disabled=false;}}});reader.clear=()=>{epoch++;busy=false;read.disabled=false;body.replaceChildren();};
  }else if(ready())holder.append(element('p','当前入口没有唯一预约标识。请从本次预约打开；不会以顾客姓名或手机号猜测旧 / 新档案关联。'));
  reader.destroy=()=>{alive=false;reader.clear();holder.remove();};return Object.freeze({hasUnsavedChanges:()=>legacy?.hasUnsavedChanges?.()||false,destroy(){reader.destroy();readers.delete(reader);legacy?.destroy?.();}});
 }
 globalThis.addEventListener?.('pagehide',()=>{for(const reader of readers)reader.clear();modalApp?.controller.suspend();if(modal&&!modalApp){modalEpoch++;pickerSuspended=true;mountPoint().textContent='页面已挂起，旧服务列表已清除。返回后需重新核权。';}},{signal:events.signal});
 globalThis.addEventListener?.('pageshow',event=>{if(event.persisted&&modal&&pickerSuspended&&!identityLocked)showPicker(mountPoint(),lastDate||getDate());},{signal:events.signal});
 return Object.freeze({openHome,attachArchive,close,destroy(){destroyed=true;events.abort();unsubscribe?.();session?.destroy();for(const reader of readers)reader.destroy();readers.clear();close(true);}});
}
let installed=null;
export function installPreparedAppBridge(options={}){installed?.destroy();const bridge=createPreparedAppBridge(options);installed=bridge;window.PreparedDesignApp=bridge;return bridge;}
if(typeof document!=='undefined'&&document.getElementById('ai-design-prepared-entry')){installPreparedAppBridge();document.getElementById('ai-design-prepared-entry').addEventListener('click',event=>{event.preventDefault();window.PreparedDesignApp.openHome();});}
