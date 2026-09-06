const OPERATIONS={
  checkout:{rpc:'salon_checkout_order',fields:['orderId','requestKey','payments']},
  refund:{rpc:'salon_refund_order',fields:['orderId','requestKey','reason']},
  inventory_move:{rpc:'salon_move_inventory',fields:['catalogItemId','requestKey','movementType','quantity','orderId','reason']},
  context:{read:true},order_receipt:{read:true},inventory:{read:true},
};

function text(value,max=160){return String(value==null?'':value).trim().slice(0,max)}
function integer(value,label,optional=false){if(optional&&(value==null||value===''))return null;const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new Error(label+'无效');return n}
function requestKey(value){const key=text(value,120);if(key.length<16||!/^[A-Za-z0-9._:-]+$/.test(key))throw new Error('请求幂等键无效');return key}
function bearer(request){const value=request.headers.get('Authorization')||'';const match=value.match(/^Bearer\s+(.+)$/i);if(!match||match[1].length<20)throw new Error('请重新登录');return match[1]}
function errorCode(message){if(/请重新登录|登录已过期/.test(message))return'AUTH_REQUIRED';if(/账号|员工|停用/.test(message))return'STAFF_INACTIVE';if(/不支持/.test(message))return'UNSUPPORTED_OPERATION';if(/数据库请求失败/.test(message))return'DATABASE_OPERATION_FAILED';return'VALIDATION_ERROR'}

export function createSalonHandler(deps){return async function(request){
  if(request.method==='OPTIONS')return{status:204,body:null};
  if(request.method!=='POST')return{status:405,body:{error:'POST required'}};
  const started=Date.now(),requestId=crypto.randomUUID();let userId=null,staff=null,operation='';
  const finish=async(status,body)=>{const code=body?.error?errorCode(body.error):null,outcome=status<300?'success':status<500?'rejected':'failed';try{await deps.log?.({request_id:requestId,auth_user_id:userId,organization_id:staff?.organization_id||null,store_id:staff?.store_id||null,staff_id:staff?.id||null,operation,outcome,http_status:status,error_code:code,duration_ms:Math.max(0,Date.now()-started)})}catch{}return{status,body:{...(body||{}),requestId}}};
  try{
    const token=bearer(request),user=await deps.verifyUser(token);
    if(!user?.id)throw new Error('登录已过期，请重新登录');
    userId=user.id;staff=await deps.findStaff(user.id);
    if(!staff||staff.employment_status!=='active')throw new Error('账号未绑定在职员工或已停用');
    const payload=await request.json();operation=text(payload.operation,40);const spec=OPERATIONS[operation];
    if(!spec)throw new Error('不支持的操作');
    const common={p_actor_staff_id:integer(staff.id,'员工'),p_organization_id:integer(staff.organization_id,'组织'),p_store_id:integer(staff.store_id,'门店')};
    if(operation==='context')return finish(200,{data:{staffId:common.p_actor_staff_id,organizationId:common.p_organization_id,storeId:common.p_store_id,displayName:text(staff.display_name,100)}});
    if(operation==='order_receipt')return finish(200,{data:await deps.read('order_receipt',{organizationId:common.p_organization_id,storeId:common.p_store_id,orderId:integer(payload.orderId,'订单')})});
    if(operation==='inventory')return finish(200,{data:await deps.read('inventory',{organizationId:common.p_organization_id,storeId:common.p_store_id,catalogItemId:integer(payload.catalogItemId,'商品',true)})});
    let args;
    if(operation==='checkout'){
      if(!Array.isArray(payload.payments)||!payload.payments.length)throw new Error('请添加支付方式');
      args={...common,p_order_id:integer(payload.orderId,'订单'),p_request_key:requestKey(payload.requestKey),p_payments:payload.payments};
    }else if(operation==='refund'){
      const reason=text(payload.reason,500);if(!reason)throw new Error('退款原因不能为空');
      args={...common,p_order_id:integer(payload.orderId,'订单'),p_request_key:requestKey(payload.requestKey),p_reason:reason};
    }else{
      const movementType=text(payload.movementType,30),quantity=Number(payload.quantity),reason=text(payload.reason,500);
      if(!['receive','sale','consume','refund'].includes(movementType)||!Number.isFinite(quantity)||quantity<=0||!reason)throw new Error('库存操作参数无效');
      args={...common,p_catalog_item_id:integer(payload.catalogItemId,'商品'),p_request_key:requestKey(payload.requestKey),p_movement_type:movementType,p_quantity:quantity,p_order_id:integer(payload.orderId,'订单',true),p_reason:reason};
    }
    return finish(200,{data:await deps.invoke(spec.rpc,args)});
  }catch(error){const raw=error?.message||'请求失败',code=errorCode(raw),auth=code==='AUTH_REQUIRED'||code==='STAFF_INACTIVE',message=code==='DATABASE_OPERATION_FAILED'?'操作未完成，请稍后重试':raw;return finish(auth?403:code==='DATABASE_OPERATION_FAILED'?500:400,{error:message,code})}
}}
