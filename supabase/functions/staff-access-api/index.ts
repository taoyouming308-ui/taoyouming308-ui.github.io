import { staffReportIdentity } from "../_shared/staff-report-access.ts";
type Row = Record<string, unknown>;
const URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const cors = {"Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS", "Cache-Control":"no-store"};
const clean = (v: unknown, n=100) => String(v ?? "").trim().slice(0,n);
const reply = (data: unknown, status=200) => new Response(JSON.stringify(data), {status,headers:{...cors,"Content-Type":"application/json"}});
async function hash(v: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))).map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function request(path: string, method="GET", data?: unknown) {
  const r=await fetch(`${URL}/rest/v1/${path}`, {method, headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,"Content-Type":"application/json",Prefer:"return=representation"},body:data===undefined?undefined:JSON.stringify(data)});
  if (!r.ok) {
    const e=await r.json().catch(()=>({}));
    if (r.status===409) throw new Error("账号已存在或资料冲突，请刷新后重试");
    const messages: Record<string,string>={ADMIN_SESSION_INVALID:"后台登录已失效，请重新登录",STAFF_FORBIDDEN:"没有管理该员工的权限",REPORT_GRANT_FORBIDDEN:"只有总管理员可设置股东权限",STORE_INVALID:"授权门店无效",SELF_CHANGE_FORBIDDEN:"不能停用或降级当前管理员",APPLICATION_CHANGED:"申请已处理，请刷新"};
    throw new Error(messages[e.message] || `请求未完成 (${r.status})`);
  }
  return r.status===204?null:r.json();
}
async function rows(path: string): Promise<Row[]> { return (await request(path)) || []; }
async function limit(req: Request, name: string, operation: string) {
  // Both trusted gateway IP and identity buckets are bounded; raw addresses/names
  // are not persisted. Fail closed if the limiter is unavailable.
  for(const key of [`identity:${operation}:${name.toLowerCase()}`, `client:${operation}:${req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"}`]) {
    if(!await request("rpc/staff_access_rate_limit","POST",{p_key_hash:await hash(key),p_max_attempts:key.startsWith('client:')?120:20})) throw new Error("尝试次数过多，请15分钟后再试");
  }
}
async function admin(token: unknown) {
  if(typeof token!=="string" || !/^[a-f0-9-]{72}$/i.test(token)) throw new Error("后台登录已失效，请重新登录");
  const session=(await rows(`staff_access_sessions?select=staff_id,role,store,credential_hash&token_hash=eq.${await hash(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`))[0];
  const actor=session && (await rows(`staff?select=id,username,role,store,active,employment_status,password_hash&id=eq.${Number(session.staff_id)}&limit=1`))[0];
  if(!actor || actor.active!==true || actor.employment_status!=="active" || !["admin","store_admin"].includes(String(actor.role)) || actor.role!==session.role || String(actor.store||'')!==session.store || actor.password_hash!==session.credential_hash || (actor.role==='store_admin' && !actor.store)) throw new Error("后台登录已失效，请重新登录");
  return actor;
}
function requireCustomerAdmin(actor: Row) {
  if (actor.role !== "admin") throw new Error("客户档案与回访仅总管理员可用");
}
function customerFilter(value: unknown, max = 100): string {
  return encodeURIComponent(clean(value, max).replace(/[,*()]/g, " ").trim());
}
async function customerProfilesAdmin(p: Row): Promise<Row[]> {
  const fields = "id,phone,name,barber_name,shop_name,last_visit_date,total_visits,total_consumption,service_history,card_packages,preferences,notes,last_updated";
  const limit = Math.max(1, Math.min(1000, Number.parseInt(String(p.limit || "200"), 10) || 200));
  let path = `customer_profiles?select=${fields}&order=last_visit_date.desc.nullslast&limit=${limit}`;
  const search = clean(p.search, 100).replace(/[,*()]/g, " ").trim();
  const barber = clean(p.barber, 80);
  const store = clean(p.store, 100);
  if (search) {
    const term = customerFilter(search);
    path += `&or=(phone.ilike.*${term}*,name.ilike.*${term}*)`;
  }
  if (barber) path += `&barber_name=eq.${customerFilter(barber, 80)}`;
  if (store) path += `&shop_name=eq.${customerFilter(store)}`;
  return rows(path);
}
async function customerSyncStatus(actor: Row): Promise<Row> {
  requireCustomerAdmin(actor);
  const [bookings, profiles] = await Promise.all([
    rows("bookings?select=updated_at&order=updated_at.desc&limit=1"),
    rows("customer_profiles?select=last_updated&order=last_updated.desc.nullslast&limit=1"),
  ]);
  return { booking_updated_at: bookings[0]?.updated_at || null, customer_updated_at: profiles[0]?.last_updated || null };
}
async function appendCustomerFollowup(p: Row, actor: Row): Promise<Row> {
  requireCustomerAdmin(actor);
  const id = Number(p.profile_id);
  const content = clean(p.content, 4000);
  const next = clean(p.next, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || !content) throw new Error("客户档案或回访内容无效");
  if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) throw new Error("下次回访日期格式错误");
  const actorName = clean(actor.username, 80);
  for (let attempt = 0; attempt < 4; attempt++) {
    const profile = (await rows(`customer_profiles?select=id,phone,notes&id=eq.${id}&limit=1`))[0];
    if (!profile) throw new Error("客户档案不存在，请刷新后重试");
    let notes: Row = {};
    try { const parsed = JSON.parse(String(profile.notes || "{}")); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) notes = parsed; } catch { /* preserve a safe structured note rather than overwrite malformed text */ }
    if (profile.notes && !Object.keys(notes).length) throw new Error("客户备注格式异常，请先人工核对，未写入回访");
    const followUps = Array.isArray(notes.follow_ups) ? notes.follow_ups.slice() : [];
    followUps.push({ date: new Date().toISOString().slice(0, 10), barber: actorName, content, next });
    notes.follow_ups = followUps;
    const oldFilter = profile.notes == null ? "notes=is.null" : `notes=eq.${encodeURIComponent(String(profile.notes))}`;
    const result = await request(`customer_profiles?id=eq.${id}&${oldFilter}`, "PATCH", { notes: JSON.stringify(notes) });
    if (Array.isArray(result) && result.length === 1) return { saved: true, profile_id: id };
  }
  throw new Error("客户资料刚被其他人修改，回访未保存；请刷新后再试");
}
function publicStaff(staff: Row) { const {password_hash, ...safe}=staff; void password_hash; return safe; }
async function handle(req: Request, p: Row) {
  const op=clean(p.operation);
  if(op==="admin_login") {
    const username=clean(p.username,80), password=String(p.password??"");
    await limit(req,username,"login");
    const staff=(await rows(`staff?select=id,username,role,store,active,employment_status,password_hash&username=eq.${encodeURIComponent(username)}&limit=1`))[0];
    const digest=await hash(password), stored=String(staff?.password_hash || "");
    const matches=/^sha256:/i.test(stored)?stored===`sha256:${digest}`:/^[0-9a-f]{64}$/i.test(stored)?stored===digest:stored===password;
    if(!password || password.length>200 || !staff || staff.active!==true || staff.employment_status!=="active" || !["admin","store_admin"].includes(String(staff.role)) || (staff.role==="store_admin" && !staff.store) || !stored || !matches) throw new Error("账号或密码错误，或没有后台权限");
    const token=crypto.randomUUID()+crypto.randomUUID(), expires=new Date(Date.now()+2*3600*1000).toISOString();
    await request("staff_access_sessions","POST",{token_hash:await hash(token),staff_id:staff.id,credential_hash:stored,role:staff.role,store:staff.store||"",expires_at:expires});
    return {user:publicStaff(staff),session_token:token,expires_at:expires};
  }
  if(op==="register") {
    const username=clean(p.username,80), password=String(p.password??"");
    await limit(req,username,"register");
    if(!username || password.length<6 || password.length>200) throw new Error("请填写姓名及至少6位密码");
    const store=clean(p.store), positions=clean(p.position,160).split(",");
    if(!positions.length || positions.some(v=>!["发型师","技师","助理","前台","店长"].includes(v))) throw new Error("请选择有效职位");
    if(!(await rows(`zysyr_stores?select=id&name=eq.${encodeURIComponent(store)}&status=eq.active&limit=1`)).length) throw new Error("请选择有效门店");
    await request("staff","POST",{username,password_hash:`sha256:${await hash(password)}`,store,position:positions.join(","),role:"staff",active:false,employment_status:"pending"});
    return {submitted:true};
  }
  if(op==="report_access") {
    const result=await staffReportIdentity(p.session_token,rows,hash);
    return {enabled:result.stores.length>0,stores:result.stores.map(s=>({id:s.id,name:s.name})),readonly:true};
  }
  const actor=await admin(p.session_token);
  if(op==="session") return {user:publicStaff(actor)};
  if(op==="logout") { await request(`staff_access_sessions?token_hash=eq.${await hash(String(p.session_token))}`,"DELETE"); return {logged_out:true}; }
  if(op==="customer_profiles_admin") { requireCustomerAdmin(actor); return {rows:await customerProfilesAdmin(p)}; }
  if(op==="customer_sync_status") return await customerSyncStatus(actor);
  if(op==="customer_profile_notes") {
    requireCustomerAdmin(actor);
    const id=Number(p.profile_id);
    if(!Number.isSafeInteger(id)||id<=0) throw new Error("客户档案编号无效");
    return {rows:await rows(`customer_profiles?select=id,phone,name,shop_name,notes&id=eq.${id}&limit=1`)};
  }
  if(op==="customer_followup_append") return await appendCustomerFollowup(p,actor);
  if(op==="staff_access") {
    const id=Number(p.staff_id);
    const target=(await rows(`staff?select=id,username,role,store,active,employment_status&id=eq.${id}&limit=1`))[0];
    if(!target || (actor.role!=="admin" && (target.role!=="staff" || target.store!==actor.store))) throw new Error("没有管理该员工的权限");
    const stores=await rows(`zysyr_stores?select=id,name&status=eq.active${actor.role==="admin"?"":`&name=eq.${encodeURIComponent(String(actor.store))}`}&order=name&limit=50`);
    const grants=await rows(`staff_report_grants?select=store_id&staff_id=eq.${id}&limit=50`);
    return {stores,report_store_ids:grants.map(g=>g.store_id),can_manage:actor.role==="admin"};
  }
  if(op==="stores") return {stores:await rows(`zysyr_stores?select=id,name&status=eq.active${actor.role==="admin"?"":`&name=eq.${encodeURIComponent(String(actor.store))}`}&order=name&limit=50`),can_manage:actor.role==="admin"};
  if(!["save","approve","reject","employment","grants"].includes(op)) throw new Error("不支持的操作");
  const data={...(p.data && typeof p.data==="object"?p.data as Row:{})};
  if(data.password!==undefined) {
    const password=String(data.password);
    if(password.length<6 || password.length>200) throw new Error("密码需为6至200位");
    data.password_hash=`sha256:${await hash(password)}`;
  } else delete data.password_hash;
  delete data.password;
  for(const key of ["username","role","store","position"]) if(data[key]!==undefined)data[key]=clean(data[key],key==="position"?160:80);
  const saved=await request("rpc/staff_access_manage","POST",{p_token_hash:await hash(String(p.session_token)),p_operation:op,p_target_id:Number(p.staff_id)||0,p_data:data});
  return {saved};
}
Deno.serve(async (req: Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({error:"POST required"},405);
  if(!URL||!KEY)return reply({error:"权限服务配置不完整"},503);
  try { return reply(await handle(req,await req.json())); }
  catch(e) {const error=(e as Error).message;return reply({error},/尝试次数/.test(error)?429:403);}
});
