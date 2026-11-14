import {pettyVoucherSchema,pettyVoucherPrompt} from '../../../packages/prompts/petty-voucher.mjs';
export async function recognizePettyVoucherOpenAI({key,model,imageURL,month,fetcher=fetch}) {
  const response=await fetcher('https://api.openai.com/v1/responses',{
    method:'POST',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({model,store:false,max_output_tokens:4500,input:[{role:'user',content:[{type:'input_text',text:pettyVoucherPrompt(month)},{type:'input_image',image_url:imageURL,detail:'high'}]}],text:{format:{type:'json_schema',name:'petty_voucher',strict:true,schema:pettyVoucherSchema}}})
  });
  if(!response.ok)throw Object.assign(new Error(`OPENAI_VOUCHER_${response.status}`),{retryable:response.status===429||response.status>=500});
  const data=await response.json();
  if(data.status!=='completed')throw Object.assign(new Error('OPENAI_VOUCHER_INCOMPLETE'),{retryable:false});
  const text=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
  let raw;try{raw=JSON.parse(text);}catch{throw new Error('OPENAI_VOUCHER_INVALID_JSON');}
  return {provider:'openai-api',schema_version:'expense-voucher-v2',candidate_only:true,human_review_required:true,document_kind:raw.document_kind,document_type:raw.document_type,transactions:raw.transactions,monthly_summary:raw.monthly_summary,
    fields:Object.fromEntries(['document_date','amount','counterparty','document_number','summary','expense_category'].map(f=>[f,raw[f]])),evidence:raw.evidence,confidences:raw.confidence,warnings:raw.warnings};
}
