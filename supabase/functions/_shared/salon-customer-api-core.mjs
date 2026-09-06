const OPERATIONS={
  store_time:{rpc:'salon_customer_get_store_time_context'},
  reschedule_request:{rpc:'salon_customer_request_reschedule'},reschedule_requests:{rpc:'salon_customer_list_reschedules'},
  context:{rpc:'salon_customer_get_context'},booking_options:{rpc:'salon_customer_list_booking_options'},works:{rpc:'salon_customer_list_public_works'},bookings:{rpc:'salon_customer_list_bookings'},
  consent_set:{rpc:'salon_customer_set_consent'},booking_create:{rpc:'salon_customer_request_booking'},booking_cancel:{rpc:'salon_customer_request_booking_cancel'},review_create:{rpc:'salon_customer_create_review'},
};
function text(value,max=160){return String(value==null?'':value).trim().slice(0,max)}
function integer(value,label,optional=false){if(optional&&(value==null||value===''))return null;const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new Error(label+'无效');return n}
function nonnegative(value,label){const n=Number(value==null||value===''?0:value);if(!Number.isFinite(n)||n<0)throw new Error(label+'无效');return n}
function requestKey(value){const key=text(value,120);if(key.length<16||!/^[A-Za-z0-9._:-]+$/.test(key))throw new Error('请求幂等键无效');return key}
function timestamp(value,label){const v=text(value,64);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw new Error(label+'无效');return v}
function bearer(request){const value=request.headers.get('Authorization')||'';const match=value.match(/^Bearer\s+(.+)$/i);if(!match||match[1].length<20)throw new Error('请重新登录');return match[1]}
function errorCode(message){if(/请重新登录|登录已过期/.test(message))return'AUTH_REQUIRED';if(/未绑定|停用/.test(message))return'CUSTOMER_INACTIVE';if(/不支持/.test(message))return'UNSUPPORTED_OPERATION';if(/数据库请求失败/.test(message))return'DATABASE_OPERATION_FAILED';return'VALIDATION_ERROR'}

export function createSalonCustomerHandler(deps){return async function(request){
 if(request.method==='OPTIONS')return{status:204,body:null};if(request.method!=='POST')return{status:405,body:{error:'POST required'}};
 const started=Date.now(),requestId=crypto.randomUUID();let userId=null,operation='',organizationId=null,storeId=null;
 const finish=async(status,body)=>{const code=body?.error?errorCode(body.error):null,outcome=status<300?'success':status<500?'rejected':'failed';try{await deps.log?.({request_id:requestId,auth_user_id:userId,organization_id:organizationId,store_id:storeId,staff_id:null,operation,outcome,http_status:status,error_code:code,duration_ms:Math.max(0,Date.now()-started)})}catch{}return{status,body:{...(body||{}),requestId}}};
 try{
  const user=await deps.verifyUser(bearer(request));if(!user?.id)throw new Error('登录已过期，请重新登录');userId=user.id;
  const payload=await request.json();if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('请求内容无效');operation=text(payload.operation,40);const spec=Object.hasOwn(OPERATIONS,operation)?OPERATIONS[operation]:null;if(!spec)throw new Error('不支持的操作');
  let args={p_auth_user_id:userId};
  if(operation!=='context'){organizationId=integer(payload.organizationId,'组织');storeId=integer(payload.storeId,'门店');args={...args,p_organization_id:organizationId,p_store_id:storeId}}
  if(operation==='works'||operation==='bookings'||operation==='reschedule_requests')args={...args,p_limit:Math.min(integer(payload.limit||100,'数量'),200)};
  else if(operation==='consent_set'){
   const type=text(payload.consentType,30),evidence=text(payload.evidenceRef,500),scope=payload.scope&&typeof payload.scope==='object'&&!Array.isArray(payload.scope)?payload.scope:{};if(!['work_publication','marketing_messages'].includes(type)||!evidence||typeof payload.granted!=='boolean')throw new Error('授权参数无效');args={...args,p_request_key:requestKey(payload.requestKey),p_consent_type:type,p_granted:payload.granted,p_scope_json:scope,p_evidence_ref:evidence};
  }else if(operation==='booking_create'){
   const starts=text(payload.startsAt,40),ends=text(payload.endsAt,40);if(!starts||!ends)throw new Error('预约时间无效');args={...args,p_request_key:requestKey(payload.requestKey),p_catalog_item_id:integer(payload.catalogItemId,'预约项目'),p_staff_id:integer(payload.staffId,'手艺人',true),p_starts_at:starts,p_ends_at:ends,p_notes:text(payload.notes,500)};
  }else if(operation==='reschedule_request'){
   const reason=text(payload.reason,500),version=payload.expectedVersion;if(!reason)throw new Error('改期原因不能为空');if(!Number.isInteger(version)||version<0||version>2147483647)throw new Error('预约改期版本无效');args={...args,p_booking_request_id:integer(payload.bookingRequestId,'预约申请'),p_request_key:requestKey(payload.requestKey),p_expected_starts_at:timestamp(payload.expectedStartsAt,'原开始时间'),p_expected_ends_at:timestamp(payload.expectedEndsAt,'原结束时间'),p_expected_version:version,p_new_starts_at:timestamp(payload.newStartsAt,'新开始时间'),p_reason:reason};
  }else if(operation==='booking_cancel'){
   const reason=text(payload.reason,500);if(!reason)throw new Error('取消原因不能为空');args={...args,p_booking_request_id:integer(payload.bookingRequestId,'预约申请'),p_request_key:requestKey(payload.requestKey),p_reason:reason};
  }else if(operation==='review_create'){
   const rating=Number(payload.rating);if(!Number.isInteger(rating)||rating<1||rating>5)throw new Error('评分需为1至5分');args={...args,p_request_key:requestKey(payload.requestKey),p_order_id:integer(payload.orderId,'订单'),p_staff_id:integer(payload.staffId,'服务人员'),p_rating:rating,p_comment:text(payload.comment,1000),p_is_anonymous:payload.isAnonymous===true,p_tip_amount:nonnegative(payload.tipAmount,'打赏意向金额')};
  }
  return finish(200,{data:await deps.invoke(spec.rpc,args)});
 }catch(error){const raw=error?.message||'请求失败',code=errorCode(raw),auth=code==='AUTH_REQUIRED'||code==='CUSTOMER_INACTIVE',message=code==='DATABASE_OPERATION_FAILED'?'操作未完成，请稍后重试':raw;return finish(auth?403:code==='DATABASE_OPERATION_FAILED'?500:400,{error:message,code,operation})}
}}
