// Local-only customer lab. No production endpoint/SDK, storage, or client-selected identity.
import {instantToStoreInput,storeTimeToInstant,formatStoreInstant,storeTimeContext} from './store-time.mjs';
import {withRequestDeadline} from './request-deadline.mjs';
let timeZone=null,timeVersion=null;
const $=id=>document.getElementById(id);
let token=null,rows=[],pending=null,busy=false,epoch=0,logoutPending=false;
const status=value=>{$('status').textContent=value;};
function clear(){timeZone=null;$('timeZone').textContent='门店时区未加载';rows=[];$('booking').replaceChildren(new Option('请选择',''));$('results').replaceChildren();$('starts').value='';$('reason').value='';}
function render(){ $('panel').disabled=busy||!token||!!pending||logoutPending;$('connect').disabled=busy||!!token||!!pending||logoutPending;$('retry').disabled=busy||!pending||logoutPending;$('logout').disabled=busy||!token;for(const id of ['booking','starts','submit'])$(id).disabled=!timeZone; }
function lock(){token=null;pending=null;epoch++;clear();}
async function api(body){
 const revision=epoch;let response,result;
 try{result=await withRequestDeadline(async signal=>{response=await fetch('/api/salon-customer',{method:'POST',redirect:'error',cache:'no-store',signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json();});}
 catch{throw Error('结果未知，请按原请求重试，不要重复新建。');}
 if(revision!==epoch)throw Error('会话已改变，请重新读取。');
 if(!response.ok||result.error){
  const error=Error(result.error||'接口拒绝请求');error.definitive=response.status>=400&&response.status<500;
  if(['AUTH_REQUIRED','CUSTOMER_INACTIVE'].includes(result.code)){lock();error.message+='；会话已锁定，请重新连接。';}
  throw error;
 }
 if(!Object.hasOwn(result,'data'))throw Error('响应格式不完整，请核对原请求。');
 return result.data;
}
const read=operation=>api({operation,organizationId:1,storeId:1});
async function refresh(){
 timeZone=null;$('timeZone').textContent='正在读取门店时区';
 const config=await read('store_time'),zone=storeTimeContext(config,1,1);
 const [bookings,changes]=await Promise.all([read('bookings'),read('reschedule_requests')]);
 if(!Array.isArray(bookings)||!Array.isArray(changes))throw Error('本人列表格式无效');
 clear();timeZone=zone;timeVersion=config.timeVersion;$('timeZone').textContent=`当前门店时区：${zone}（不使用设备时区）`;rows=bookings.filter(r=>r.status==='confirmed');
 for(const row of rows)$('booking').add(new Option(`预约 ${row.id} · ${formatStoreInstant(row.starts_at,timeZone)}`,String(row.id)));
 const labels={submitted:'待门店确认',approved:'已批准',rejected:'已拒绝'};
 for(const row of changes){const li=document.createElement('li');li.textContent=`申请 ${row.id} · 预约 ${row.booking_request_id} · ${labels[row.status]||row.status} · ${formatStoreInstant(row.expected_starts_at,timeZone)} → ${formatStoreInstant(row.new_starts_at,timeZone)} · ${row.decision_reason||row.request_reason}`;$('results').append(li);}
 if(!changes.length){const li=document.createElement('li');li.textContent='暂无改期申请';$('results').append(li);}
}
async function run(action){if(busy)return;busy=true;render();try{await action();}catch(e){status(e.message);}finally{busy=false;render();}}
async function submitPending(){
 let data;try{data=await api(pending);}catch(e){if(e.definitive)pending=null;throw e;}
 if(!Number.isSafeInteger(data?.changeRequestId)||data.status!=='submitted')throw Error('结果格式异常，请按原请求重试核对。');
 pending=null;status('申请已提交，原档期保留，等待门店确认。');
 try{await refresh();}catch(e){throw Error('申请已提交，请勿重复提交；回读失败：'+e.message);}
}
$('connect').onclick=()=>run(async()=>{
 if(location.protocol!=='http:'||location.hostname!=='127.0.0.1')throw Error('仅允许专用本机合成测试服务');
 const response=await fetch('/__salon_test_customer_session',{method:'POST',redirect:'error',cache:'no-store'}),session=await response.json();
 if(!response.ok||session.environment!=='synthetic-local-only'||typeof session.token!=='string')throw Error('不是合成测试环境');
 token=session.token;epoch++;await read('context');await refresh();status('已连接合成顾客，仅显示本人数据。');
});
$('booking').onchange=()=>{const row=rows.find(r=>String(r.id)===$('booking').value);$('starts').value=row?instantToStoreInput(row.starts_at,timeZone):'';};
$('submit').onclick=()=>run(async()=>{
 const row=rows.find(r=>String(r.id)===$('booking').value),value=$('starts').value,reason=$('reason').value.trim();
 if(!row||!reason||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('请选择预约并填写门店时间和原因');
 const config=await read('store_time');if(!timeZone||storeTimeContext(config,1,1)!==timeZone||config.timeVersion!==timeVersion)throw Error('门店时区已变化或未加载，请刷新本人数据后重新填写');
 pending=Object.freeze({operation:'reschedule_request',organizationId:1,storeId:1,bookingRequestId:row.id,expectedStartsAt:row.starts_at,expectedEndsAt:row.ends_at,expectedVersion:row.reschedule_version,newStartsAt:storeTimeToInstant(value,timeZone),reason,requestKey:crypto.randomUUID(),expectedTimeZone:timeZone,expectedTimeVersion:timeVersion});
 await submitPending();
});
$('retry').onclick=()=>run(async()=>{if(pending)await submitPending();});
$('refresh').onclick=()=>run(async()=>{await refresh();status('已刷新本人数据。');});
$('logout').onclick=()=>run(async()=>{
 logoutPending=true;clear();pending=null;
 const response=await fetch('/__salon_test_customer_logout',{method:'POST',headers:{Authorization:`Bearer ${token}`},redirect:'error'});
 if(!response.ok)throw Error('退出未确认，请重试退出；禁止继续业务。');
 lock();logoutPending=false;status('顾客会话已退出，旧令牌已撤销。');
});
window.addEventListener('beforeunload',e=>{if(pending||logoutPending){e.preventDefault();e.returnValue='';}});
render();
