import {pettyVoucherSchema,pettyVoucherPrompt,pettyVoucherPromptVersion} from '../../../packages/prompts/petty-voucher.mjs';
export {pettyVoucherPromptVersion as PETTY_VOUCHER_PROMPT_VERSION};
export const PETTY_VOUCHER_OPENAI_MODEL='gpt-5.6-sol';
export async function recognizePettyVoucherOpenAI({key,model=PETTY_VOUCHER_OPENAI_MODEL,imageURL,month,categories=/** @type {string[]} */([]),baseURL='https://api.openai.com/v1',protocol='responses',fetcher=fetch}) {
  const reasoning=/^gpt-5(?:\.|$)/.test(model);
  const prompt=pettyVoucherPrompt(month,categories);
  const body=protocol==='chat_completions'?{model,stream:false,...(reasoning?{reasoning_effort:'medium',max_completion_tokens:10000}:{max_tokens:4500}),messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:imageURL,detail:'high'}}]}],response_format:{type:'json_schema',json_schema:{name:'petty_voucher',strict:true,schema:pettyVoucherSchema}}}:null;
  const response=await fetcher(baseURL+(protocol==='chat_completions'?'/chat/completions':'/responses'),{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(reasoning?90000:45000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify(body||{model,store:false,...(reasoning?{reasoning:{effort:'medium'}}:{}),max_output_tokens:reasoning?10000:4500,input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:imageURL,detail:/^gpt-5\.6(?:-|$)/.test(model)?'original':'high'}]}],text:{format:{type:'json_schema',name:'petty_voucher',strict:true,schema:pettyVoucherSchema}}})
  });
  if(!response.ok)throw Object.assign(new Error(`OPENAI_VOUCHER_${response.status}`),{retryable:response.status===429||response.status>=500});
  const data=await response.json();
  if(protocol==='chat_completions'?data.choices?.[0]?.finish_reason!=='stop':data.status!=='completed')throw Object.assign(new Error('OPENAI_VOUCHER_INCOMPLETE'),{retryable:false});
  const text=protocol==='chat_completions'?data.choices?.[0]?.message?.content:(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
  let raw;try{raw=JSON.parse(text);}catch{throw new Error('OPENAI_VOUCHER_INVALID_JSON');}
  return {provider:new URL(baseURL).hostname==='api.openai.com'?'openai-api':'openai-compatible',api_host:new URL(baseURL).hostname,api_protocol:protocol,model:data.model||model,requested_model:model,schema_version:'expense-voucher-v2',prompt_version:pettyVoucherPromptVersion,candidate_only:true,human_review_required:true,document_kind:raw.document_kind,document_type:raw.document_type,transactions:raw.transactions,monthly_summary:raw.monthly_summary,date_role:raw.date_role,date_candidates:raw.date_candidates,
    fields:Object.fromEntries(['document_date','amount','counterparty','document_number','summary','expense_category'].map(f=>[f,raw[f]])),evidence:raw.evidence,confidences:raw.confidence,warnings:raw.warnings};
}
