import {createSalonClient,SalonClientError} from './api-client.mjs';

// Takes an explicitly initialized, Salon-only Supabase-compatible auth provider.
// This adapter never selects a project, signs users up, reads legacy storage or grants roles.
export function createSalonSession({auth,endpoint,fetchImpl,onReset=()=>{},now=()=>Date.now()}) {
  for(const method of ['getSession','getUser','onAuthStateChange','signOut'])
    if(typeof auth?.[method]!=='function')throw new Error(`缺少 Auth 接口 ${method}`);
  let identity=null,revision=0,disposed=false,recovery=false,logoutPending=false,logoutFailed=false;
  const error=(code,message)=>new SalonClientError(code,message);
  function invalidate(reason) {
    identity=null;revision++;api.disconnect();
    try{onReset(reason);}catch{/* UI failures cannot keep a session authorized. */}
  }
  function check(epoch) {
    if(disposed||epoch!==revision)throw error('STALE_SESSION','会话已变化，请重新连接');
    if(recovery||logoutPending||logoutFailed)throw error('AUTH_REQUIRED','当前会话不能进入业务，请完成登录或重试退出');
  }
  async function verify(epoch,expectedUser) {
    check(epoch);
    let result;
    try{result=await auth.getSession();}catch{check(epoch);invalidate('AUTH_UNAVAILABLE');throw error('AUTH_REQUIRED','无法取得会话，请重新登录');}
    check(epoch);
    const session=result?.data?.session;
    if(result?.error||!session?.user?.id||typeof session.access_token!=='string'||session.access_token.length<20||
       !Number.isFinite(session.expires_at)||session.expires_at*1000<=now()) {
      invalidate('SESSION_EXPIRED');throw error('AUTH_REQUIRED','登录已过期，请重新登录');
    }
    let verified;
    try{verified=await auth.getUser(session.access_token);}catch{check(epoch);invalidate('AUTH_UNAVAILABLE');throw error('AUTH_REQUIRED','无法验证会话，请重新登录');}
    check(epoch);
    const userId=verified?.data?.user?.id;
    if(verified?.error||!userId||userId!==session.user.id||(expectedUser&&userId!==expectedUser)) {
      invalidate('IDENTITY_CHANGED');throw error('AUTH_REQUIRED','登录身份不一致，请重新连接');
    }
    // Auth user is verified here, but staff/org/store/permissions are still resolved by the API.
    return {userId,token:session.access_token};
  }
  const api=createSalonClient({endpoint,fetchImpl,onAuthFailure:()=>invalidate('SERVER_AUTH_REJECTED'),getAccessToken:async()=>{
    if(!identity)throw error('AUTH_REQUIRED','请先验证登录会话');
    const epoch=revision;
    const verified=await verify(epoch,identity);
    check(epoch);return verified.token;
  }});
  // Deliberately synchronous: do not await SDK calls while its auth event lock is held.
  const {data}=auth.onAuthStateChange((event,session)=>{
    if(disposed)return;
    if(event==='PASSWORD_RECOVERY'){recovery=true;invalidate('PASSWORD_RECOVERY');return;}
    if(event==='SIGNED_OUT'){recovery=false;invalidate('SIGNED_OUT');return;}
    if(event==='USER_UPDATED'){invalidate('USER_UPDATED');return;}
    if(identity&&session?.user?.id!==identity)invalidate('IDENTITY_CHANGED');
    // Same-user TOKEN_REFRESHED / repeated SIGNED_IN does not discard a frozen request.
  });
  if(typeof data?.subscription?.unsubscribe!=='function')throw new Error('Auth 事件订阅无效');
  return {
    get scope(){return api.scope;},
    async connect(storeId) {
      check(revision);
      const epoch=++revision;identity=null;api.disconnect();
      const verified=await verify(epoch,null);check(epoch);identity=verified.userId;
      try{return await api.connect(storeId);}catch(cause){if(epoch===revision)invalidate('CONNECT_FAILED');throw cause;}
    },
    disconnect(){invalidate('DISCONNECTED');},
    read:(...args)=>api.read(...args),
    prepare:(...args)=>api.prepare(...args),
    submit:(...args)=>api.submit(...args),
    async signOut() {
      if(disposed)throw error('STALE_SESSION','会话已关闭');
      if(logoutPending)throw error('SIGNOUT_PENDING','退出请求正在处理中');
      logoutPending=true;invalidate('SIGNED_OUT');
      try{
        const result=await auth.signOut({scope:'local'});
        if(result?.error)throw result.error;
        logoutFailed=false;
      }catch{logoutFailed=true;throw error('SIGNOUT_UNCONFIRMED','本页面已锁定，但服务器退出未确认；请重试退出，不要视为令牌已撤销');}
      finally{logoutPending=false;}
    },
    dispose(){if(disposed)return;disposed=true;invalidate('DISPOSED');data.subscription.unsubscribe();},
  };
}
