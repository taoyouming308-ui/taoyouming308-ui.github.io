import {createSalonClient,mapRows,serverId} from './api-client.mjs';
const $=id=>document.getElementById(id);
let client,token,customers=[],items=[],orderId=null,retry=null;
const status=text=>{$('status').textContent=text;};
function options(id,rows,label){
 const select=$(id);select.replaceChildren(new Option('请选择',''));
 for(const row of rows)select.add(new Option(label(row),String(row.id)));
}
function clear(){customers=[];items=[];orderId=null;retry=null;options('customer',[],()=>{});options('item',[],()=>{});$('order').textContent='尚未创建订单';$('saveLines').disabled=true;}
async function refresh(){
 const [customerResult,itemResult]=await Promise.all([client.read('customers'),client.read('catalog',{status:'active'})]);
 customers=mapRows('customers',customerResult.data,client.scope);items=mapRows('catalog',itemResult.data,client.scope);
 options('customer',customers,row=>row.displayName);options('item',items,row=>`${row.name} · ¥${(row.listPriceCents/100).toFixed(2)}`);
}
async function run(action){
 $('panel').disabled=true;$('connect').disabled=true;$('retry').disabled=true;
 try{await action();}
 catch(error){status(`${error.message}${error.requestId?'\n追踪号：'+error.requestId:''}${retry?'\n当前原请求保留；请先重试核对，不要另建业务。':''}`);}
 finally{$('panel').disabled=!client?.scope||Boolean(retry);$('connect').disabled=Boolean(retry);$('retry').disabled=!retry;}
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
 clear();client?.disconnect();
 const response=await fetch('/__salon_test_session',{method:'POST',cache:'no-store',redirect:'error'});
 const session=await response.json();if(!response.ok||session.environment!=='synthetic-local-only')throw Error('不是合成测试环境');
 token=session.token;client=createSalonClient({endpoint:location.origin+'/api/salon',getAccessToken:()=>token});
 await client.connect();
 const result=await client.read('stores');options('store',result.data.map(row=>({id:serverId(row.store_id),name:row.name})),row=>row.name);
 $('store').value=String(client.scope.storeId);await refresh();status('已连接临时数据库；所有操作只影响本次合成数据。');
});
$('store').onchange=()=>run(async()=>{const id=$('store').value;clear();client.disconnect();await client.connect(serverId(id));await refresh();status('已切换门店，旧选择已清除。');});
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
window.addEventListener('beforeunload',event=>{if(retry){event.preventDefault();event.returnValue='';}});
