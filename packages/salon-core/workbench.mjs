import {mapRows,serverId} from './api-client.mjs';
import {createSalonSession} from './session-controller.mjs';
import {instantToStoreInput,storeTimeToInstant} from './store-time.mjs';
const $=id=>document.getElementById(id);
let client,customers=[],items=[],cancelRequests=[],rescheduleRequests=[],orderId=null,retry=null,viewRevision=0,signingOut=false;
const status=text=>{$('status').textContent=text;};
function options(id,rows,label){
 if(id==='changeRequest')$('changeDetails').textContent='选择申请后查看原时间、新时间与申请原因。';
 const select=$(id);select.replaceChildren(new Option('请选择',''));
 for(const row of rows)select.add(new Option(label(row),String(row.id)));
}
function clear(){options('changeRequest',[],()=>{});$('changeReason').value='';customers=[];items=[];cancelRequests=[];rescheduleRequests=[];orderId=null;retry=null;options('customer',[],()=>{});options('item',[],()=>{});options('cancelRequest',[],()=>{});options('rescheduleRequest',[],()=>{});$('rescheduleStart').value='';$('rescheduleReason').value='';$('cancelReason').value='';$('order').textContent='尚未创建订单';$('saveLines').disabled=true;}
async function refresh(){
 const changes=await client.read('reschedule_requests',{status:'submitted'});
 options('changeRequest',changes.data,row=>`申请 ${row.id} · 预约 ${row.booking_request_id} · ${row.expected_starts_at} → ${row.new_starts_at} · ${row.request_reason}`);
 const [customerResult,itemResult,cancelResult,rescheduleResult]=await Promise.all([client.read('customers'),client.read('catalog',{status:'active'}),client.read('booking_requests',{status:'cancel_requested'}),client.read('booking_requests',{status:'confirmed'})]);
 customers=mapRows('customers',customerResult.data,client.scope);items=mapRows('catalog',itemResult.data,client.scope);
 options('customer',customers,row=>row.displayName);options('item',items,row=>`${row.name} · ¥${(row.listPriceCents/100).toFixed(2)}`);
 cancelRequests=cancelResult.data.map(row=>({id:serverId(row.id),startsAt:row.starts_at}));
 options('cancelRequest',cancelRequests,row=>`申请 ${row.id} · ${row.startsAt}`);
 rescheduleRequests=rescheduleResult.data.map(row=>({id:serverId(row.id),startsAt:row.starts_at,endsAt:row.ends_at,version:row.reschedule_version}));
 options('rescheduleRequest',rescheduleRequests,row=>`申请 ${row.id} · ${row.startsAt}`);$('rescheduleStart').value='';
}
async function run(action){
 const epoch=viewRevision;
 $('panel').disabled=true;$('connect').disabled=true;$('retry').disabled=true;
 try{await action();}
 catch(error){if(epoch===viewRevision)status(`${error.message}${error.requestId?'\n追踪号：'+error.requestId:''}${retry?'\n当前原请求保留；请先重试核对，不要另建业务。':''}`);}
 finally{if(epoch===viewRevision){$('panel').disabled=!client?.scope||Boolean(retry);$('connect').disabled=Boolean(retry);$('retry').disabled=!retry;$('logout').disabled=!client?.scope;}}
}
async function mutate(operation,fields,onSuccess){
 const ticket=client.prepare(operation,fields);
 retry=async()=>{
  let result;
  try{result=await client.submit(ticket);}catch(error){
   // Confirmed validation/auth rejections did not commit; an unknown outcome remains locked.
   if(error.code==='API_REJECTED'&&error.httpStatus>=400&&error.httpStatus<500)retry=null;
   throw error;
  }
  retry=null;
  status(`已保存 · 请求号 ${result.requestId}`);
  try{await onSuccess(result.data);}catch(error){throw Error(`写入已经成功，请勿重复创建。后续回读失败：${error.message}；追踪号 ${result.requestId}`);}
 };
 await retry();
}
$('connect').onclick=()=>run(async()=>{
 if(location.protocol!=='http:'||location.hostname!=='127.0.0.1')throw Error('仅允许专用本机测试服务，不能连接线上或直接打开文件');
 clear();client?.dispose();
 const response=await fetch('/__salon_test_session',{method:'POST',cache:'no-store',redirect:'error'});
 const session=await response.json();if(!response.ok||session.environment!=='synthetic-local-only')throw Error('不是合成测试环境');
 // Synthetic provider with the same four auth methods; never a production SDK login.
 let localSession={access_token:session.token,user:session.user,expires_at:session.expires_at},listener=()=>{};
 const auth={
  getSession:async()=>({data:{session:localSession}}),
  getUser:async token=>{
   const response=await fetch('/__salon_test_user',{method:'POST',headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error'});
   return response.ok?response.json():{error:true};
  },
  onAuthStateChange:callback=>{listener=callback;return {data:{subscription:{unsubscribe:()=>{listener=()=>{};}}}};},
  signOut:async()=>{
   const response=await fetch('/__salon_test_logout',{method:'POST',headers:{Authorization:`Bearer ${localSession?.access_token}`},redirect:'error'});
   if(!response.ok)return {error:true};localSession=null;listener('SIGNED_OUT',null);return {error:null};
  },
 };
 client=createSalonSession({auth,endpoint:location.origin+'/api/salon',onReset:reason=>{
  if(reason==='DISPOSED')return;
  viewRevision++;clear();$('name').value='';options('store',[],()=>{});$('panel').disabled=true;$('retry').disabled=true;$('connect').disabled=signingOut;
  status('会话已锁定，旧业务选择已清除；请重新连接。');
 }});
 await client.connect();
 const result=await client.read('stores');options('store',result.data.map(row=>({id:serverId(row.store_id),name:row.name})),row=>row.name);
 $('store').value=String(client.scope.storeId);await refresh();status('已连接临时数据库；所有操作只影响本次合成数据。');
});
$('store').onchange=()=>run(async()=>{const id=$('store').value;clear();if(!id){client.disconnect();return;}await client.connect(serverId(id));await refresh();status('已切换门店，旧选择已清除。');});
$('createCustomer').onclick=()=>run(async()=>{
 const displayName=$('name').value.trim();if(!displayName)throw Error('请输入合成顾客姓名');
 await mutate('customer_create',{displayName,source:'other'},async data=>{await refresh();$('customer').value=String(serverId(data.customerId));});
});
$('createOrder').onclick=()=>run(async()=>{
 if(orderId)throw Error('已有订单草稿，请先处理原订单');
 const selected=customers.find(row=>row.id===Number($('customer').value));if(!selected)throw Error('请选择本店顾客');
 await mutate('order_create',{customerId:selected.id,notes:'本机合成接口联调'},async data=>{
  orderId=serverId(data.orderId);$('order').textContent=`订单 ${data.orderNo} · ${data.status}`;$('saveLines').disabled=false;
 });
});
$('saveLines').onclick=()=>run(async()=>{
 const selected=items.find(row=>row.id===Number($('item').value));if(!selected||!orderId)throw Error('请选择本店商品并先创建草稿');
 await mutate('order_lines',{orderId,lines:[{catalogItemId:selected.id,quantity:1,unitPrice:selected.listPriceCents/100,discountAmount:0}]},async()=>{
  const result=await client.read('order_detail',{orderId});
  if(serverId(result.data?.order?.id)!==orderId||!result.data.lines?.some(line=>serverId(line.catalog_item_id)===selected.id))throw Error('订单回读与保存对象不一致，请核对原订单');
  $('order').textContent=`订单 ${orderId} · 明细已从数据库读取确认`;
  status(`明细已保存并读取验证 · 追踪号 ${result.requestId}`);
 });
});
$('retry').onclick=()=>run(async()=>{if(retry)await retry();});
$('refresh').onclick=()=>run(async()=>{await refresh();status('已刷新本店数据。');});
$('changeRequest').onchange=()=>{$('changeDetails').textContent=$('changeRequest').value?$('changeRequest').selectedOptions[0].textContent:'请选择申请';};
for(const [id,decision] of [['approveChange','approved'],['rejectChange','rejected']])$(id).onclick=()=>run(async()=>{
 const changeRequestId=serverId($('changeRequest').value),reason=$('changeReason').value.trim();
 if(!reason)throw Error('请填写改期复核原因');
 await mutate('reschedule_review',{changeRequestId,decision,reason},async()=>{
  await refresh();$('changeReason').value='';status(decision==='approved'?'改期申请已批准，预约已更新。':'改期申请已拒绝，原预约保留。');
 });
});
$('rescheduleRequest').onchange=()=>{
 const selected=rescheduleRequests.find(row=>row.id===Number($('rescheduleRequest').value));
 $('rescheduleStart').value=selected?instantToStoreInput(selected.startsAt,'UTC'):'';
};
$('rescheduleBooking').onclick=()=>run(async()=>{
 const selected=rescheduleRequests.find(row=>row.id===Number($('rescheduleRequest').value)),reason=$('rescheduleReason').value.trim(),value=$('rescheduleStart').value;
 if(!selected||!reason||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('请选择本店预约，填写 UTC 新时间与原因');
 await mutate('booking_reschedule',{bookingRequestId:selected.id,expectedStartsAt:selected.startsAt,expectedEndsAt:selected.endsAt,expectedVersion:selected.version,newStartsAt:storeTimeToInstant(value,'UTC'),reason},async()=>{
  await refresh();$('rescheduleReason').value='';status('改期成功，原预约与档期已同步更新。');
 });
});
for(const [id,decision] of [['approveCancel','approved'],['rejectCancel','rejected']])$(id).onclick=()=>run(async()=>{
 const selected=cancelRequests.find(row=>row.id===Number($('cancelRequest').value)),reason=$('cancelReason').value.trim();
 if(!selected||!reason)throw Error('请选择本店待复核申请并填写处理原因');
 await mutate('booking_cancel_review',{bookingRequestId:selected.id,decision,reason},async data=>{
  await refresh();$('cancelReason').value='';status(data.status==='cancelled'?'取消已批准，档期已释放。':'取消已拒绝，原预约和档期保留。');
 });
});
$('logout').onclick=async()=>{
 signingOut=true;let completed=false;$('logout').disabled=true;$('connect').disabled=true;
 try{await client.signOut();completed=true;$('logout').disabled=true;status('已退出本次测试会话；旧请求不能继续提交。');}
 catch(error){status(error.message);$('logout').disabled=false;}
 finally{signingOut=false;$('connect').disabled=!completed;}
};
window.addEventListener('beforeunload',event=>{if(retry){event.preventDefault();event.returnValue='';}});
