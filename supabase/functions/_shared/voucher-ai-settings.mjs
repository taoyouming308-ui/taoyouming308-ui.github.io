import {PETTY_VOUCHER_OPENAI_MODEL} from './petty-voucher-openai.mjs';
export const DEFAULT_VOUCHER_API_URL='https://api.openai.com/v1';
const allowedHosts=new Set(['api.openai.com','openrouter.ai','api.siliconflow.cn','api.siliconflow.com','api.deepseek.com','api.groq.com','dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','ark.cn-beijing.volces.com']);
export function voucherAPIURL(value){
  if(/[%\\\s]/.test(String(value||DEFAULT_VOUCHER_API_URL)))throw Error('API地址含有不支持的字符');
  let url;try{url=new URL(value||DEFAULT_VOUCHER_API_URL);}catch{throw Error('API地址无效');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(url.port&&url.port!=='443')||!allowedHosts.has(url.hostname)||!/^\/[a-zA-Z0-9/_-]*$/.test(url.pathname))throw Error('请使用已支持服务商的公开HTTPS API地址');
  return url.origin+url.pathname.replace(/\/+$/,'');
}
export function voucherAPIProtocol(value){if(!['responses','chat_completions'].includes(value||'responses'))throw Error('API协议无效');return value||'responses';}
const binding=(company,store)=>new TextEncoder().encode('voucher-ai-v1|'+company+'|'+store);
async function encryptionKey(secret){
  if(!/^[A-Za-z0-9+/]{43}=$/.test(secret||''))throw Error('VOUCHER_SETTINGS_ENCRYPTION_NOT_CONFIGURED');
  return crypto.subtle.importKey('raw',Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
export async function sealVoucherKey(value,secret,company,store){
  const iv=crypto.getRandomValues(new Uint8Array(12)),key=await encryptionKey(secret);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:binding(company,store)},key,new TextEncoder().encode(value));
  return {v:1,iv:encode(iv),data:encode(cipher)};
}
export async function openVoucherKey(cipher,secret,company,store){
  try{
    if(cipher?.v!==1)throw Error();
    const key=await encryptionKey(secret),iv=Uint8Array.from(atob(cipher.iv),c=>c.charCodeAt(0)),data=Uint8Array.from(atob(cipher.data),c=>c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:binding(company,store)},key,data));
  }catch{throw Error('VOUCHER_SETTINGS_KEY_UNREADABLE');}
}
export async function resolveVoucherAI({row,company,store,secret,serverKey='',serverModel=PETTY_VOUCHER_OPENAI_MODEL}){
  const baseURL=voucherAPIURL(row?.base_url),protocol=voucherAPIProtocol(row?.protocol);
  const key=row?.encrypted_key?await openVoucherKey(row.encrypted_key,secret,company,store):(baseURL===DEFAULT_VOUCHER_API_URL?serverKey:'');
  return {key,model:row?.model||serverModel,baseURL,protocol,revision:Number(row?.revision||0),key_source:row?.encrypted_key?'store':'server'};
}
export function publicVoucherAI(settings){return {provider:settings.baseURL===DEFAULT_VOUCHER_API_URL?'openai':'openai_compatible',base_url:settings.baseURL,protocol:settings.protocol,model:settings.model,key_configured:Boolean(settings.key),key_source:settings.key_source,revision:settings.revision};}
export function validateVoucherAIInput(model,key){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,99}$/.test(model||''))throw Error('请输入有效的OpenAI模型名称');
  if(key&&(!/^\S{16,500}$/.test(key)||/[\r\n]/.test(key)))throw Error('API密钥格式无效');
}
export async function checkVoucherModelAccess({key,model,baseURL=DEFAULT_VOUCHER_API_URL,protocol='responses',fetcher=fetch}){
  if(!key)throw Error('尚未配置OpenAI API密钥');
  baseURL=voucherAPIURL(baseURL);voucherAPIProtocol(protocol);
  if(baseURL!==DEFAULT_VOUCHER_API_URL)return true;
  const response=await fetcher(baseURL+'/models/'+encodeURIComponent(model),{redirect:'error',headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('OpenAI模型连接测试失败（HTTP '+response.status+'），配置未保存');
  return true;
}
