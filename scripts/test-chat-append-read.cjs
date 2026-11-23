'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const page=fs.readFileSync('perm-app.html','utf8'),s=page.indexOf('function addAestheticChatMessage('),e=page.indexOf('function updateAestheticConversationChrome(',s);
assert(s>0&&e>s);
let saves=0,rebuilds=0,appends=0,markup='';
const box={scrollTop:0,clientHeight:20,get scrollHeight(){return this.childElementCount*10;},get childElementCount(){return (markup.match(/class="ae-chat-row/g)||[]).length;},
  set innerHTML(v){markup=v;rebuilds++;},insertAdjacentHTML(pos,v){assert.equal(pos,'beforeend');markup+=v;appends++;}};
const c={document:{getElementById:()=>box},AESTHETIC_GOAL_LABELS:{},aestheticTrainingState:{messages:[],growthPlan:{}},
  saveAestheticSession(){saves++;},aestheticEscape:s=>String(s).replaceAll('<','&lt;')};
vm.runInNewContext(page.slice(s,e),c);
for(let i=0;i<200;i++)c.addAestheticChatMessage('assistant','<fixture'+i);
assert.equal(saves,200);assert.equal(rebuilds,1);assert.equal(appends,199);assert.equal(box.childElementCount,200);
assert(!markup.includes('<fixture'));box.scrollTop=10;c.addAestheticChatMessage('assistant','new');assert.equal(box.scrollTop,10);
c.aestheticTrainingState.messages[0].content='Revised opening';c.renderAestheticChatMessages();assert(markup.includes('Revised opening'));assert(!markup.includes('&lt;fixture0'));
c.aestheticTrainingState.messages=[];c.addAestheticChatMessage('user','new session');assert.equal(box.childElementCount,1);assert(!markup.includes('Revised opening'));
console.log('PASS: 200 messages retained with 1 rebuild + 199 appends; escaping, scroll position, restore/edit/replace and the original save path preserved.');
