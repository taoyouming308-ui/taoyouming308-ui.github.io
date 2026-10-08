// Real production functions, synthetic transport/DOM only; no business API access.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('operations-daily-review.js','utf8');
const take=(a,b)=>{const start=src.indexOf(a),end=src.indexOf(b,start);assert(start>=0&&end>start);return src.slice(start,end)};
const code=take('  function sheetVersion(','  function sourceBusy(')+take('  async function checkBeforeWrite(','  async function syncDailySheet(')+take('  function saveGuard(','  async function refreshCalendar(');
function fixture(edits,{lostReply=false,wrongValue=false,changedScope=false}={}){
 const prior={draft:{id:'fixture',report_date:'2026-01-01',edit_revision:3,status:'draft'},permissions:{write:true},cells:[],attachments:[]};
 const fresh=structuredClone(prior);fresh.draft.edit_revision=4;
 fresh.cells=edits.map((e,i)=>({id:String(i),section_code:'summary',row_key:'company',column_code:e.role,cell_role:e.role,manual_override:true,corrected_numeric:e.role==='grand_total'?e.value:null,manual_text:e.role==='grand_total'?null:e.value}));
 if(wrongValue)fresh.cells[0].manual_text='other user text';if(changedScope)fresh.permissions.write=false;
 const changes=edits.map((e,i)=>({id:String(i),section_code:'summary',row_key:'company',column_code:e.role,cell_role:e.role,value:e.value}));
 const ctx={id:'fixture',date:'2026-01-01',store:'synthetic',revision:3};let saves=0,reads=0,dirty=true;
 const scope={state:{imports:{sheet:prior}},isCurrent:()=>scope.state.imports.sheet.draft.edit_revision===ctx.revision,dailySheetDirtyCount:()=>dirty?changes.length:0,reviewedValues:()=> 'reviewed synthetic form',collectDailySheetCells:()=>changes,grid:()=>({}),verifySavedValues:()=>{},notice:()=>{},api:async(op)=>{assert(['daily_sheet_save','daily_sheet_read'].includes(op));if(op==='daily_sheet_save'){saves++;if(lostReply)throw Error('synthetic lost reply')}else reads++;return fresh},applySheet:(_ctx,s)=>{scope.state.imports.sheet=s;ctx.revision=s.draft.edit_revision;dirty=false}};
 vm.createContext(scope);vm.runInContext(code,scope);return{scope,ctx,fresh,counts:()=>({saves,reads})};
}
async function success(label,edits,options={}){const f=fixture(edits,options);await f.scope.persistDraft(f.ctx,'synthetic',true);assert.equal(f.ctx.revision,4,label);await f.scope.persistDraft(f.ctx,'duplicate',true);assert.equal(f.counts().saves,1,'no repeat write after accepted result');await f.scope.checkBeforeWrite(f.ctx);const reopened={...f.ctx,revision:f.fresh.draft.edit_revision};await f.scope.checkBeforeWrite(reopened);console.log(label+' passed')}
(async()=>{
 for(const role of ['signature','note','unclosed_order']){await success(role,[{role,value:'reviewed '+role}]);await success(role+' clear',[{role,value:null}]);}
 await success('numeric',[{role:'grand_total',value:'4208'}]);
 await success('mixed',[{role:'signature',value:'finance fixture'},{role:'grand_total',value:'4208'}]);
 await success('lost reply readback',[{role:'note',value:'reviewed note'}],{lostReply:true});
 for(const opt of [{wrongValue:true},{changedScope:true}]){const f=fixture([{role:'note',value:'my edit'}],opt);await assert.rejects(f.scope.persistDraft(f.ctx,'synthetic',true));assert.equal(f.ctx.revision,3);await assert.rejects(f.scope.checkBeforeWrite(f.ctx),/后台日报已有更新/);assert.equal(f.counts().saves,1);console.log('genuine conflict retained')}
 console.log('11 synthetic cases passed; real save/preflight functions; no live data');
})().catch(e=>{console.error(e);process.exitCode=1});
