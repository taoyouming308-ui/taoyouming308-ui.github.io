const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const extract=(file,name)=>{const src=fs.readFileSync(file,'utf8'),start=src.indexOf(`async function ${name}(`),end=src.indexOf('\n}',start)+2;assert(start>=0&&end>start);return src.slice(start,end);};
const calls=[];let response={available:false,shop:'向里造型',date:'2026-01-01'};
const base={Date,Number,Array,JSON,Error,AbortSignal,cleanText:(v,n)=>String(v??'').trim().slice(0,n),projectBusinessDay:value=>value,
 rest:async(path,init)=>{calls.push({path,init});return {ok:true,json:async()=>response};}};
const front=vm.createContext({...base,selectedStore:(s,p)=>s.role==='admin'?p.store:s.store,availableStores:async s=>s.role==='admin'?['向里造型','自由手艺人']:[s.store]});
vm.runInContext(stripTypeScriptTypes(extract('supabase/functions/frontdesk-api/index.ts','businessDetails')),front);
const finance=vm.createContext({...base,requireFinanceCapability:s=>{if(s.role!=='finance')throw new Error('denied');},selectedStoreInfo:async s=>({name:s.store,company_id:s.company||'02463a53-dfdb-4291-b04d-dd1d85f9d998',id:'8d057980-ff8f-4b2c-9c7f-4dd23a568f35'})});
vm.runInContext(stripTypeScriptTypes(extract('supabase/functions/operations-api/index.ts','dailyBusinessDetails')),finance);
(async()=>{
 await front.businessDetails({date:'2026-01-01',store:'自由手艺人'},{role:'staff',store:'向里造型'});
 assert.equal(JSON.parse(calls[0].init.body).p_shop,'向里造型');
 await assert.rejects(front.businessDetails({date:'2026-02-30'},{role:'staff',store:'向里造型'}));
 await assert.rejects(finance.dailyBusinessDetails({date:'2026-01-01'},{role:'staff',store:'向里造型'}),/denied/);
 const value=await finance.dailyBusinessDetails({date:'2026-01-01',store:'自由手艺人'},{role:'finance',store:'向里造型'});
 assert.equal(value.automatic_posting_enabled,false);assert.equal(value.readonly,true);
 await assert.rejects(finance.dailyBusinessDetails({date:'2026-01-01'},{role:'finance',store:'向里造型',company:'other-company'}));
 response={...response,shop:'自由手艺人'};
 await assert.rejects(front.businessDetails({date:'2026-01-01'},{role:'staff',store:'向里造型'}));
 assert(calls.every(call=>call.path==='rpc/mgj_read_business_details'));
 console.log('Shared business reader: frontdesk assigned store, financial capability, wrong scope rejection and read-only RPC passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
