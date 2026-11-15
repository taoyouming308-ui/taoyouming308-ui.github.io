import {resolveVoucherAI} from '../supabase/functions/_shared/voucher-ai-settings.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { recognizePettyVoucherOpenAI, PETTY_VOUCHER_OPENAI_MODEL, PETTY_VOUCHER_PROMPT_VERSION } from '../supabase/functions/_shared/petty-voucher-openai.mjs';
import { candidates } from '../supabase/functions/_shared/zysyr-ocr-candidates.mjs';
import { voucherCodexCandidates } from '../supabase/functions/_shared/zysyr-voucher-codex.mjs';
import { parsePettyCashBatchNote } from '../supabase/functions/_shared/petty-cash-batch.mjs';
const source = stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/voucher-ocr-worker/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''));
async function run({batch=true, auth=true, configured=true, reviewed=false, reviewOnly=false,snapshot=null,providerError=0,openai=false,networkError=false}={}) {
  let handler, jobs=[], calls=[], completed=[],claims=0;
  const env={OPENAI_API_KEY:openai?'openai-synthetic':'',SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'service-test',ZYSYR_WORKER_SECRET:'worker-test',SILICONFLOW_API_KEY:'ocr-test',
    ZYSYR_DAILY_CODEX_BRIDGE_URL:configured?'https://bridge.invalid/recognize':'',ZYSYR_DAILY_CODEX_BRIDGE_TOKEN:'bridge-test'};
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const fetch=async(url,opts={})=>{
    const body=opts.body?JSON.parse(opts.body):{}; calls.push({url,body,headers:opts.headers});
    if(url.includes('zysyr_claim_voucher_ocr_task'))return reply([{task_id:'task-'+(++claims),lease_token:'lease',company_id:'company',store_id:'store',voucher_id:'voucher',mime_type:'image/jpeg',object_path:'test/a.jpg'}]);
    if(url.includes('zysyr_voucher_attachments?'))return reply([{audit_status:reviewed?'approved':'pending',note:batch?'petty_cash_batch|2026-07|11111111-1111-4111-8111-111111111111|test.jpg':''}]);
    if(url.includes('zysyr_voucher_ai_settings?')){assert(url.includes('company_id=eq.company&store_id=eq.store'));return reply([]);}
    if(url.includes('zysyr_report_uploads?')){assert(url.includes('company_id=eq.company&store_id=eq.store'));return reply([{id:'report'}]);}
    if(url.includes('zysyr_report_cells?'))return reply([{label:'水电煤 / 电话/宽带 / Nov.'}]);
    if(url.includes('zysyr_voucher_ocr_tasks?')){assert.ok(url.includes('lease_token=eq.lease'));return reply([{id:'task',review_only:reviewOnly,ai_settings_snapshot:snapshot}]);}
    if(url.includes('/object/sign/'))return reply({signedURL:'/object/sign/zysyr-vouchers/test/a.jpg?token=test'});
    if(url==='https://api.openai.com/v1/responses') {
      assert.equal(opts.headers.Authorization,'Bearer openai-synthetic');assert.equal(body.store,false);assert.equal(body.model,'gpt-5.6-sol');assert.equal(body.reasoning.effort,'medium');assert.equal(body.max_output_tokens,10000);
      return reply({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({document_kind:'receipt',document_date:'2026-07-01',amount:236.8,counterparty:null,document_number:null,evidence:{document_date:'2026-07-01',amount:'236.80'},confidence:{document_date:.99,amount:.99},warnings:[]})}]}]});
    }
    if(url.startsWith('https://bridge.invalid')){
      if(networkError)throw new TypeError('Synthetic transport failed');
      assert.equal(body.task_type,'expense_voucher'); assert.equal(body.month,'2026-07');
      assert.equal(opts.headers.Authorization,'Bearer bridge-test');
      if(providerError)return reply({},providerError);
      return reply({provider:'codex-local',candidate_only:true,human_review_required:true,document_kind:'receipt',
        fields:{document_date:'2026-07-01',amount:236.8},evidence:{document_date:'2026-07-01',amount:'236.80'},confidences:{document_date:.99,amount:.99}});
    }
    if(url.includes('/object/zysyr-vouchers/'))return new Response(new Uint8Array([255,216,255]));
    if(url.includes('/chat/completions'))return reply({choices:[{message:{content:'{"amount":12,"document_date":"2026-07-02"}'}}]});
    if(url.includes('zysyr_complete_voucher_ocr_task')){completed.push(body);return reply({});}
    throw Error('unexpected '+url);
  };
  vm.runInNewContext(source,{Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},EdgeRuntime:{waitUntil:job=>jobs.push(job)},fetch,Response,Request,AbortSignal,URL,Uint8Array,btoa,console,setTimeout,resolveVoucherAI,PETTY_VOUCHER_OPENAI_MODEL,PETTY_VOUCHER_PROMPT_VERSION,recognizePettyVoucherOpenAI:args=>recognizePettyVoucherOpenAI({...args,fetcher:fetch}),candidates,voucherCodexCandidates,parsePettyCashBatchNote});
  const result=await handler(new Request('https://worker.invalid',{method:'POST',headers:{'Content-Type':'application/json','x-worker-secret':auth?'worker-test':'bad'},body:JSON.stringify({limit:5,follow_up_depth:0})}));
  await Promise.all(jobs);
  return {result:await result.json(),status:result.status,calls,completed};
}
let r=await run(); assert.equal(r.result.accepted,true);assert.equal(r.completed.length,3);assert.equal(r.completed[0].p_succeeded,true);assert.equal(r.completed[0].p_candidate_fields.amount,'236.80');assert.ok(!r.calls.some(c=>c.url.includes('chat/completions')));
assert.equal(new Set(r.completed.map(c=>c.p_task_id)).size,3,'parallel claims must use distinct leased tasks');
r=await run({networkError:true});assert(r.completed.every(c=>c.p_retryable===true));
r=await run({auth:false});assert.equal(r.status,403);assert.equal(r.calls.length,0);
r=await run({configured:false});assert.equal(r.completed[0].p_succeeded,false);assert.equal(r.completed[0].p_error_message,'CODEX_VOUCHER_NOT_CONFIGURED');
r=await run({providerError:429});assert.equal(r.completed[0].p_retryable,true);assert.equal(r.completed[0].p_succeeded,false);
r=await run({reviewed:true});assert.ok(!r.calls.some(c=>c.url.includes('bridge.invalid')));
r=await run({batch:false});assert.equal(r.completed[0].p_candidate_fields.amount,'12.00');assert.ok(r.calls.some(c=>c.url.includes('chat/completions')));
assert.ok(r.calls.every(c=>!c.url.includes('zysyr_review_voucher')&&!c.url.includes('daily_sheet')));
r=await run({openai:true,snapshot:{model:'gpt-5.6-sol',base_url:'https://api.openai.com/v1',protocol:'responses',revision:1}});assert(r.completed.every(c=>c.p_succeeded));assert(!r.calls.some(c=>c.url.includes('zysyr_voucher_ai_settings?')),'queued images use their captured provider configuration');
r=await run({openai:true,reviewed:true,reviewOnly:true});assert(r.completed.every(c=>c.p_succeeded),'explicit separate reanalysis can read reviewed originals without changing human confirmation');
r=await run({openai:true,configured:false});assert.equal(r.completed[0].p_candidate_fields.recognition_provider,'openai-api');assert.ok(!r.calls.some(c=>c.url.includes('bridge.invalid')));
console.log('Voucher worker: authenticated bounded async claim, Codex batch routing, leased candidates, reviewed protection, failure and legacy OCR passed.');
