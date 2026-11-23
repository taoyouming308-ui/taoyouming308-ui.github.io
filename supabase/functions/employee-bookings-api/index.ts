import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { CustomerDesignError, handleCustomerDesign, isCustomerDesignOperation } from "../_shared/customer-design-archive.ts";
import { mergeEmployeeBookingRows } from "../_shared/employee-booking-merge.mjs";
import { encodeReadSync } from "../_shared/read-sync.mjs";
import { customerProfileStoreFilter, scopeCustomerProfile, customerReadStores, customerIdentityRows, scopeCustomerHairRecords, customerHairPhoneFilter, customerHairIdentityRows } from "../_shared/customer-profile-scope.mjs";

type JsonRecord = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SESSION_DAYS = 30;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function cleanText(value: unknown, max = 200): string {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function restRows(path: string): Promise<JsonRecord[]> {
  const response = await rest(path);
  if (!response.ok) throw new Error(`数据读取失败 (${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function activeEmployee(row: JsonRecord | undefined): boolean {
  return !!row && row.active !== false && cleanText(row.employment_status, 40) === "active" &&
    !!cleanText(row.username, 80) && !!cleanText(row.store, 100);
}

async function employeeLogin(payload: JsonRecord): Promise<JsonRecord> {
  const username = cleanText(payload.username, 80);
  const password = cleanText(payload.password, 200);
  if (!username || !password) throw new Error("请输入姓名和密码");
  const rows = await restRows(
    `staff?select=username,password_hash,store,position,active,employment_status&username=eq.${encodeURIComponent(username)}&limit=1`,
  );
  const employee = rows[0];
  const digest = await sha256(password);
  const stored = cleanText(employee?.password_hash, 200);
  const passwordMatches = /^sha256:/i.test(stored) ? stored === `sha256:${digest}`
    : /^[0-9a-f]{64}$/i.test(stored) ? stored === digest : stored === password;
  if (!activeEmployee(employee) || !stored || !passwordMatches) {
    throw new Error("姓名或密码错误，或账号未通过审核");
  }

  rest(`employee_booking_sessions?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  }).catch(() => undefined);

  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const response = await rest("employee_booking_sessions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      token_hash: await sha256(token),
      username: employee.username,
      store: employee.store,
      position: employee.position || "",
      expires_at: expiresAt,
    }),
  });
  if (!response.ok) throw new Error(`员工会话创建失败 (${response.status})`);
  return {
    session_token: token,
    expires_at: expiresAt,
    user: { username: employee.username, store: employee.store, position: employee.position || "" },
  };
}

async function requireEmployeeSession(payload: JsonRecord): Promise<JsonRecord> {
  const token = cleanText(payload.session_token, 200);
  if (!token) throw new Error("请重新登录");
  const tokenHash = await sha256(token);
  const sessions = await restRows(
    `employee_booking_sessions?select=username,store,position,expires_at&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
  );
  const session = sessions[0];
  if (!session) throw new Error("登录已过期，请重新登录");
  const employees = await restRows(
    `staff?select=username,store,position,active,employment_status&username=eq.${encodeURIComponent(cleanText(session.username, 80))}&limit=1`,
  );
  const employee = employees[0];
  if (!activeEmployee(employee) || cleanText(employee.store, 100) !== cleanText(session.store, 100)) {
    await rest(`employee_booking_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, {
      method: "DELETE", headers: { Prefer: "return=minimal" },
    });
    throw new Error("账号已停用或门店已变化，请重新登录");
  }
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await rest(`employee_booking_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ position: employee.position || "", expires_at: expiresAt, last_used_at: new Date().toISOString() }),
  });
  return { username: employee.username, store: employee.store, position: employee.position || "", expires_at: expiresAt };
}

async function employeeLogout(payload: JsonRecord): Promise<JsonRecord> {
  const token = cleanText(payload.session_token, 200);
  if (!token) return { logged_out: true };
  const response = await rest(`employee_booking_sessions?token_hash=eq.${encodeURIComponent(await sha256(token))}`, {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  });
  if (!response.ok) throw new Error(`退出失败 (${response.status})`);
  return { logged_out: true };
}

async function todayBookings(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const date = cleanText(payload.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式错误");
  const store = cleanText(session.store, 100);
  const barber = cleanText(session.username, 80);
  const bookingPath = `bookings?select=id,customer_name,customer_phone,barber_name,shop_name,time_label,reservation_time,service_name,notes,status,date&shop_name=eq.${encodeURIComponent(store)}&barber_name=eq.${encodeURIComponent(barber)}&date=eq.${date}&order=reservation_time.asc&limit=300`;
  const receptionPath = `frontdesk_today_customers?select=id,business_date,store,customer_name,customer_phone,barber_name,arrival_time,service_intent,reception_notes,status&store=eq.${encodeURIComponent(store)}&barber_name=eq.${encodeURIComponent(barber)}&business_date=eq.${date}&order=arrival_time.asc.nullslast&limit=300`;
  const [bookings, frontdesk] = await Promise.all([restRows(bookingPath), restRows(receptionPath)]);
  const merged = mergeEmployeeBookingRows(bookings, frontdesk);
  return {
    ...merged,
    date,
    store,
    barber,
    sources_read_only: true,
    bookings_untouched: true,
    frontdesk_records_untouched: true,
  };
}

function safeFilterValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function customerProfiles(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = cleanText(session.store, 100);
  const scope = cleanText(payload.customer_scope || 'store', 20);
  customerReadStores(store, scope);
  if (!store) throw new Error("账号未绑定门店，无法读取客户资料");
  const rawSearch = cleanText(payload.search, 100).replace(/[,*()]/g, " ").trim();
  const limit = Math.max(1, Math.min(1000, Number.parseInt(String(payload.limit || "1000"), 10) || 1000));
  const fields = "id,phone,name,barber_name,shop_name,last_visit_date,total_visits,total_consumption,card_packages,service_history,notes,preferences,last_updated";
  let path = `customer_profiles?select=${fields}&${customerProfileStoreFilter(store, scope)}&order=last_visit_date.desc.nullslast&limit=${limit}`;
  if (rawSearch) {
    const term = safeFilterValue(rawSearch);
    path += `&and=(or(phone.ilike.*${term}*,name.ilike.*${term}*))`;
  }
  let rows = await restRows(path);
  const candidates = rows.length;
  if (payload.phone) rows = customerIdentityRows(rows, payload.phone, payload.name);
  return { rows: rows.map(row => scopeCustomerProfile(row, store, scope)).filter(Boolean), store, customer_scope: scope,
    identity_warning: payload.phone && candidates && !rows.length ? '该手机号下的档案姓名与当前客户不一致，请核对身份，不自动合并。' : '', read_only: true };
}

async function customerHairRecords(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = cleanText(session.store, 100), scope = cleanText(payload.customer_scope || 'store', 20);
  customerReadStores(store, scope);
  const phone = cleanText(payload.phone, 60).replace(/\D/g, '').replace(/^86(?=1\d{10}$)/, '');
  if (phone.length < 11) return { rows: [], identity_warning: '缺少完整手机号，暂不跨档案关联，避免同名客户混淆。', read_only: true };
  const view = payload.read_view === 'index' || payload.read_view === 'record' ? payload.read_view : '';
  const fullFields = 'id,customer_name,customer_phone,technician,barber,status,record_data,created_at';
  // These paths also cover the legacy identity/store and booking-date fallbacks.
  // Never transmit photos, technique notes or the full form for a list of visits.
  const keys = ['id','seq','customerName','name','customerPhone','phone','customerPhoneNormalized','shopName','shop_name','store','bookingId','booking_id','bookingDate','booking_date','visitDate','date','createdAt','created_at','technician','barber','serviceType','targetColor','tone','toneOther','developer'];
  const paths = [...keys.map(k=>`h_${k}:record_data->${k}`),
    'h_form_phone:record_data->formFields->hair-form-phone','h_form_name:record_data->formFields->hair-form-name',
    ...['root','mid','end'].map(k=>`h_level_${k}:record_data->threeSection->${k}->level`)];
  const fields = view ? ['id,customer_name,customer_phone,technician,barber,status,created_at',...paths].join(',') : fullFields;
  const phoneFilter = customerHairPhoneFilter(phone);
  const rows: JsonRecord[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await restRows(`hair_records?select=${fields}&status=neq.deleted&${phoneFilter}&order=created_at.desc,id.asc&limit=500&offset=${offset}`);
    for (const row of page) {
      if (!view) { rows.push(row); continue; }
      const bits: JsonRecord = {};
      for (const key of keys) if (row['h_'+key] != null) bits[key]=row['h_'+key];
      bits.formFields = {'hair-form-phone':row.h_form_phone,'hair-form-name':row.h_form_name};
      if (['root','mid','end'].every(k=>row['h_level_'+k]!=null)) {
        bits.threeSection = Object.fromEntries(['root','mid','end'].map(k=>[k,{level:row['h_level_'+k]}]));
      }
      rows.push({id:row.id,customer_name:row.customer_name,customer_phone:row.customer_phone,created_at:row.created_at,
        technician:row.technician,barber:row.barber,status:row.status,record_data:bits});
    }
    if (page.length < 500) break;
  }
  const identified = customerHairIdentityRows(rows, phone, payload.name);
  const visible = scopeCustomerHairRecords(identified, store, scope);
  if (view !== 'record') return {rows:visible,...(view ? {read_view:view,...(rows.length && !identified.length ? {identity_warning:'无法核实所选顾客身份，请核对后再查看。'} : {})} : {}),customer_scope:scope,read_only:true};
  const selected = visible.find((r:JsonRecord)=>String(r.id)===String(payload.record_id));
  if (!selected) return {rows:[],read_view:view,customer_scope:scope,read_only:true};
  // A requested ID is not authority: first resolve all identities above, then
  // re-read by ID + phone and check name, origin and deletion on the fresh row.
  const exact = await restRows(`hair_records?select=${fullFields}&status=neq.deleted&${phoneFilter}&id=eq.${safeFilterValue(String(selected.id))}&limit=1`);
  const detail = scopeCustomerHairRecords(customerHairIdentityRows(exact,phone,payload.name),store,scope)
    .filter((r:JsonRecord)=>String(r.id)===String(selected.id) && r.customer_name===selected.customer_name && r.archive_store===selected.archive_store);
  return {rows:detail,read_view:view,customer_scope:scope,read_only:true};
}

// User-initiated, one verified visit only. The calendar never scans or exports
// the store's hair-record/phone directory just to decorate its buttons.
async function bookingHairStatus(payload:JsonRecord,session:JsonRecord):Promise<JsonRecord>{
  const store=cleanText(session.store,100),barber=cleanText(session.username,80),date=cleanText(payload.date,10);
  const prefix='frontdesk:',fullId=cleanText(payload.booking_id,80),desk=fullId.startsWith(prefix),id=desk?fullId.slice(prefix.length):fullId;
  const scope=cleanText(payload.customer_scope || 'store',20);customerReadStores(store,scope);
  const uncertain={verified:false,read_only:true};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))return uncertain;
  const path=(desk?'frontdesk_today_customers?select=id,customer_phone,customer_name,status&business_date=':'bookings?select=id,customer_phone,customer_name,status&date=')+'eq.'+date+
    '&'+(desk?'store':'shop_name')+'=eq.'+safeFilterValue(store)+'&barber_name=eq.'+safeFilterValue(barber)+'&id=eq.'+safeFilterValue(id)+'&limit=1';
  const visit=(await restRows(path))[0];
  // Same source eligibility as design_admin_service_binding: cancelled, null
  // or future unknown states cannot authorize reading this visit or a new task.
  const activeStatuses=desk?['waiting','arrived','in_service','completed']:['0','1','3','4'];
  if(!visit || String(visit.id)!==id || !activeStatuses.includes(String(visit.status)))return uncertain;
  const phoneKey=(v:unknown)=>cleanText(v,60).replace(/\D/g,'').replace(/^86(?=1\d{10}$)/,'');
  const nameKey=(v:unknown)=>cleanText(v,120).replace(/\s/g,'').toLowerCase();
  const phone=phoneKey(visit?.customer_phone),name=nameKey(visit?.customer_name);
  if(!visit || !/^1\d{10}$/.test(phone) || !name || phone!==phoneKey(payload.phone) || name!==nameKey(payload.name))return uncertain;
  const index=await customerHairRecords({phone,name:visit.customer_name,customer_scope:scope,read_view:'index'},session);
  if(index.identity_warning)return uncertain;
  const rows=(index.rows as JsonRecord[]).flatMap(r=>{
    const bits=(r.record_data || {}) as JsonRecord, visitId=cleanText(bits.bookingId || bits.booking_id,80);
    // Keep ambiguous legacy date strings for the existing client date parser.
    const stamp=cleanText(bits.bookingDate || bits.booking_date || bits.visitDate || bits.date || r.created_at || bits.createdAt,80);
    const iso=stamp.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if(visitId ? visitId!==fullId : iso && [iso[1],iso[2].padStart(2,'0'),iso[3].padStart(2,'0')].join('-')!==date)return [];
    return [{id:r.id,customer_phone:r.customer_phone,created_at:r.created_at,record_data:{bookingId:visitId,bookingDate:stamp}}];
  });
  const queue:JsonRecord[]=[];let unclear=false;
  const tomorrow=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const visitFilter='or('+( /^\d+$/.test(fullId) ? 'booking_id.eq.'+fullId+',' : '')+'booking_date.eq.'+date+
    ',and(booking_date.is.null,created_at.gte.'+date+'T00:00:00Z,created_at.lt.'+tomorrow+'T00:00:00Z))';
  const storeFilter='or(shop_name.eq.'+JSON.stringify(store)+',shop_name.is.null,shop_name.eq."")';
  // Include formatted legacy phones as candidates; check normalized identity before using any result.
  for(let offset=0;;offset+=250){
    const page=await restRows('hair_analysis_queue?select=phone,booking_id,booking_date,created_at,status,customer_name,shop_name,barber_name&phone=ilike.'+
      '*'+phone.split('').join('*')+'*&and='+encodeURIComponent('('+storeFilter+','+visitFilter+')')+
      '&order=created_at.desc,id.asc&limit=250&offset='+offset);
    for(const q of page){
      if(phoneKey(q.phone)!==phone)continue;
      const booking=cleanText(q.booking_id,80),day=cleanText(q.booking_date || q.created_at,30).slice(0,10);
      if(booking ? booking!==fullId : day!==date)continue;
      if(q.shop_name!==store || (q.customer_name && nameKey(q.customer_name)!==name) || (!booking && (!nameKey(q.customer_name) || q.barber_name!==barber))){unclear=true;continue;}
      queue.push({booking_id:booking,booking_date:day,status:q.status});
    }
    if(page.length<250)break;
  }
  return {verified:true,rows,queue,unclear,read_only:true};
}

async function customerHistory(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = cleanText(session.store, 100);
  const scope = cleanText(payload.customer_scope || 'store', 20);
  customerReadStores(store, scope);
  const phone = cleanText(payload.phone, 60).replace(/\D/g, "").slice(-20);
  if (!store) throw new Error("账号未绑定门店，无法读取客户历史");
  if (!phone) return { rows: [], bookings: [], store, read_only: true };
  const encodedStore = safeFilterValue(store);
  const encodedPhone = safeFilterValue(phone);
  const profileFields = "phone,name,barber_name,shop_name,last_visit_date,total_visits,total_consumption,card_packages,service_history,notes,preferences,last_updated";
  const bookingFields = "id,date,barber_name,customer_name,customer_phone,time_label,reservation_time,service_name,notes,status";
  const [rows, bookings] = await Promise.all([
    restRows(`customer_profiles?select=${profileFields}&${customerProfileStoreFilter(store, scope)}&phone=eq.${encodedPhone}&order=last_visit_date.desc.nullslast&limit=100`),
    restRows(`bookings?select=${bookingFields}&shop_name=eq.${encodedStore}&customer_phone=ilike.*${encodedPhone}*&order=date.asc&limit=500`),
  ]);
  return { rows: customerIdentityRows(rows, phone, payload.name).map((row: JsonRecord) => scopeCustomerProfile(row, store, scope)).filter(Boolean), bookings, store, customer_scope: scope, read_only: true };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "service not configured" }, 503);
  let payload: JsonRecord;
  try { payload = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const operation = cleanText(payload.operation, 40);
  try {
    // Scoped import tokens never participate in employee/login operations.
    if (payload.ingest_token !== undefined && !isCustomerDesignOperation(operation)) {
      return json({ error: "导入授权不可用于其他操作", code: "DESIGN_INGEST_DENIED" }, 403);
    }
    if (isCustomerDesignOperation(operation)) {
      const designSession = payload.ingest_token !== undefined ? null : await requireEmployeeSession(payload);
      return json(await handleCustomerDesign(payload, designSession, {
        rest, restRows, supabaseUrl: SUPABASE_URL,
        storage: (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/storage/v1${path}`, {
          ...init, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(init.headers || {}) },
        }),
      }));
    }
    if (operation === "login") {
      for (const key of [`employee:${cleanText(payload.username,80).toLowerCase()}`, `employee-client:${request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"}`]) {
        const gate = await rest("rpc/staff_access_rate_limit", {method:"POST",body:JSON.stringify({p_key_hash:await sha256(key),p_max_attempts:key.startsWith('employee-client:')?120:20})});
        if (!gate.ok) throw new Error("登录服务暂不可用，请稍后重试");
        if (await gate.json() !== true) return json({error:"尝试次数过多，请15分钟后再试"},429);
      }
      return json(await employeeLogin(payload));
    }
    if (operation === "logout") return json(await employeeLogout(payload));
    const session = await requireEmployeeSession(payload);
    if (operation === "session") return json({ user: session, expires_at: session.expires_at });
    if (operation === "today_bookings") {
      const result = await todayBookings(payload, session);
      return json(payload.read_sync ? await encodeReadSync(payload.read_sync, result) : result);
    }
    if (operation === "customer_profiles") return json(await customerProfiles(payload, session));
    if (operation === "customer_history") return json(await customerHistory(payload, session));
    if (operation === "customer_hair_records") return json(await customerHairRecords(payload, session));
    if (operation === "booking_hair_status") return json(await bookingHairStatus(payload, session));
    return json({ error: "不支持的操作" }, 400);
  } catch (error) {
    if (error instanceof CustomerDesignError) return json({ error: error.message, code: error.code }, error.status);
    const message = (error as Error).message || "请求失败";
    const authError = /登录|账号|姓名|密码|审核|停用|门店已变化/.test(message);
    return json({ error: message }, authError ? 403 : 400);
  }
});
