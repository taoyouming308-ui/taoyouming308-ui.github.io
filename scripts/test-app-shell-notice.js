// Synthetic lifecycle regressions. No browser profile, production backend or business writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2] || 'app-shell-client.js', 'utf8');
class Element {
  constructor(tag) { this.tagName=tag;this.children=[];this.style={};this.attrs={};this.ownText=''; }
  set textContent(text) { this.ownText=text;this.children.forEach(c=>c.parentNode=null);this.children=[]; }
  get textContent() { return this.ownText+this.children.map(c=>c.textContent).join(''); }
  appendChild(child) { child.parentNode=this;this.children.push(child);return child; }
  remove() { if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null; }
  setAttribute(key,value) { this.attrs[key]=String(value); }
  getAttribute(key) { return this.attrs[key] || null; }
}
function events(object={}) {
  const listeners={};object.addEventListener=(name,fn)=>(listeners[name]||=([])).push(fn);
  object.emit=name=>(listeners[name]||[]).forEach(fn=>fn());return object;
}
function scenario({waiting=null,installing=null,active={},controller={},version=668,storage=new Map(),blockedStorage=false,registerError=false,update}={}) {
  let updates=0,registers=0,nextTimer=0;
  const body=new Element('body'),banner=body.appendChild(new Element('div'));banner.id='update-banner';banner.style.display='block';
  const draft=body.appendChild(new Element('input'));draft.value='unsaved synthetic';
  const timers=new Map(),reg=events({waiting,installing,active,update(){updates++;return update?update(reg):Promise.resolve(reg);}});
  const window=events({isSecureContext:true});
  const find=(node,id)=>node.id===id?node:node.children.map(c=>find(c,id)).find(Boolean);
  const document={readyState:'loading',documentElement:{getAttribute:()=>String(version)},body,getElementById:id=>find(body,id),createElement:tag=>new Element(tag)};
  const context={window,document,navigator:{serviceWorker:{controller,register(){registers++;return registerError?Promise.reject(Error('synthetic offline')):Promise.resolve(reg);}}},sessionStorage:{getItem:key=>{if(blockedStorage)throw Error('blocked');return storage.get(key)||null;},setItem:(key,value)=>{if(blockedStorage)throw Error('blocked');storage.set(key,value);},removeItem:key=>{if(blockedStorage)throw Error('blocked');storage.delete(key);}},setTimeout(fn,delay){timers.set(++nextTimer,{fn,delay});return nextTimer;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,context);
  const tick=async()=>{for(let i=0;i<8;i++){await new Promise(setImmediate);for(const [id,t] of [...timers])if(t.delay===0){timers.delete(id);t.fn();}}};
  return {window,reg,banner,draft,storage,tick,notice:()=>document.getElementById('app-shell-notice'),async boot(){window.emit('load');await tick();},button(label){return this.notice()?.children.find(c=>c.tagName==='button'&&c.textContent===label);},runTimeout(delay){for(const [id,t] of [...timers])if(t.delay===delay){timers.delete(id);t.fn();}},counts:()=>({updates,registers})};
}
(async()=>{
  const unchanged=scenario();await unchanged.boot();unchanged.window.ZysyrAppShell.requestUpdate();await unchanged.tick();
  assert.match(unchanged.notice().textContent,/未发现/,'a completed no-change check must not remain preparing');
  assert.equal(unchanged.notice().getAttribute('data-state'),'checked');assert.equal(unchanged.banner.style.display,'none');
  unchanged.runTimeout(6000);assert.equal(unchanged.notice(),undefined);
  const waiting=scenario({waiting:{}});await waiting.boot();assert.equal(waiting.notice().getAttribute('data-state'),'waiting');
  assert.match(waiting.notice().textContent,/关闭本站所有页面及主屏幕窗口/);assert.equal(waiting.banner.style.display,'none');
  waiting.button('稍后').onclick();assert.equal(waiting.notice(),undefined);assert.equal(waiting.draft.value,'unsaved synthetic');assert.equal(waiting.counts().updates,0);
  const nextPage=scenario({waiting:{},storage:waiting.storage});await nextPage.boot();assert.equal(nextPage.notice(),undefined,'same-version navigation must honor dismissal');assert(nextPage.window.ZysyrAppShell.hasUpdatePrompt());
  nextPage.window.ZysyrAppShell.requestUpdate();assert.equal(nextPage.notice().getAttribute('data-state'),'waiting','explicit checks can reopen a dismissed notice');
  nextPage.button('稍后').onclick();
  const nextVersion=scenario({waiting:{},storage:waiting.storage,version:669});await nextVersion.boot();assert(nextVersion.notice(),'a newly loaded version must not inherit the old version dismissal');
  const passiveWaiting=scenario({waiting:{}});await passiveWaiting.boot();
  passiveWaiting.runTimeout(12000);assert.equal(passiveWaiting.notice(),undefined,'a waiting worker must not leave a permanent banner');
  assert.equal(passiveWaiting.banner.style.display,'none','automatic dismissal must not restore a second prompt');
  passiveWaiting.window.emit('online');await passiveWaiting.tick();assert.equal(passiveWaiting.notice(),undefined,'reconnect must leave a naturally waiting update dismissed');
  const passiveNextPage=scenario({waiting:{},storage:passiveWaiting.storage});await passiveNextPage.boot();
  assert.equal(passiveNextPage.notice(),undefined,'same-tab navigation must honor automatic dismissal');
  passiveNextPage.window.ZysyrAppShell.requestUpdate();assert.equal(passiveNextPage.notice().getAttribute('data-state'),'waiting','an explicit check can reopen an automatically dismissed reminder');
  const worker=events({state:'installing'}),installing=scenario({installing:worker});await installing.boot();
  installing.window.ZysyrAppShell.requestUpdate();installing.window.ZysyrAppShell.requestUpdate();installing.window.emit('online');assert.equal(installing.counts().updates,0);
  assert.equal(installing.notice().getAttribute('data-state'),'installing');
  installing.reg.installing=null;worker.state='redundant';worker.emit('statechange');await installing.tick();assert.equal(installing.notice().getAttribute('data-state'),'error','failed download must exit preparation');
  installing.reg.update=()=>{installing.reg.waiting={};return Promise.resolve(installing.reg);};installing.button('重试').onclick();await installing.tick();assert.equal(installing.notice().getAttribute('data-state'),'waiting');
  const dismissedWorker=events({state:'installing'}),dismissed=scenario({installing:dismissedWorker});await dismissed.boot();dismissed.button('稍后').onclick();
  dismissed.reg.waiting=dismissedWorker;dismissed.reg.installing=null;dismissedWorker.state='installed';dismissedWorker.emit('statechange');await dismissed.tick();assert.equal(dismissed.notice(),undefined,'automatic completion must not reopen a snoozed prompt');
  let resolveCheck;const slow=scenario({update:()=>new Promise(resolve=>resolveCheck=resolve)});await slow.boot();slow.window.ZysyrAppShell.requestUpdate();slow.window.ZysyrAppShell.requestUpdate();assert.equal(slow.counts().updates,1);
  slow.runTimeout(30000);assert.equal(slow.notice().getAttribute('data-state'),'delayed','a stalled check must not leave a permanent spinner');assert.equal(slow.counts().updates,1);resolveCheck();await slow.tick();assert.equal(slow.notice().getAttribute('data-state'),'checked');
  const bad=scenario({update:()=>Promise.reject(Error('offline'))});await bad.boot();bad.window.ZysyrAppShell.requestUpdate();await bad.tick();assert.equal(bad.notice().getAttribute('data-state'),'error');assert(bad.button('重试'));
  bad.runTimeout(12000);assert.equal(bad.notice(),undefined,'failed update notices must also clear');
  const stalled=scenario({update:()=>new Promise(()=>{})});await stalled.boot();stalled.window.ZysyrAppShell.requestUpdate();
  stalled.runTimeout(30000);assert.equal(stalled.notice().getAttribute('data-state'),'delayed');stalled.runTimeout(12000);assert.equal(stalled.notice(),undefined,'a delayed update notice must also clear');
  const coldWorker=events({state:'installing'}),cold=scenario({installing:coldWorker,active:null,controller:null});await cold.boot();assert.equal(cold.notice(),undefined,'first installation is not a newer-version alert');
  cold.window.ZysyrAppShell.requestUpdate();cold.reg.installing=null;cold.reg.active=coldWorker;coldWorker.state='activated';coldWorker.emit('statechange');await cold.tick();assert.equal(cold.notice().getAttribute('data-state'),'checked');
  const fallback=scenario({registerError:true,active:null,controller:null});await fallback.boot();assert.equal(fallback.window.ZysyrAppShell.requestUpdate(),false,'uncontrolled registration failure retains verified document fallback');await fallback.tick();
  const blocked=scenario({waiting:{},blockedStorage:true});await blocked.boot();blocked.button('稍后').onclick();assert.equal(blocked.notice(),undefined,'storage policy must not prevent dismissal');
  for(const c of [unchanged,waiting,nextPage,nextVersion,passiveWaiting,passiveNextPage,installing,dismissed,slow,bad,stalled,cold,fallback,blocked])assert.equal(c.draft.value,'unsaved synthetic');
  console.log('Shell notice: no-change completion, bounded waiting/error/delay, dismissal and reopen, navigation/reconnect/version scope, failed download/retry, single-flight, first install and unavailable storage passed; drafts preserved.');
})().catch(error=>{console.error(error);process.exitCode=1;});
