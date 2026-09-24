import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { mergeEmployeeBookingRows } from "../_shared/employee-booking-merge.mjs";

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
  if (!store) throw new Error("账号未绑定门店，无法读取客户资料");
  const rawSearch = cleanText(payload.search, 100).replace(/[,*()]/g, " ").trim();
  const limit = Math.max(1, Math.min(1000, Number.parseInt(String(payload.limit || "1000"), 10) || 1000));
  const fields = "phone,name,barber_name,shop_name,last_visit_date,total_visits,total_consumption,card_packages,service_history,notes,preferences";
  let path = `customer_profiles?select=${fields}&shop_name=eq.${safeFilterValue(store)}&order=last_visit_date.desc.nullslast&limit=${limit}`;
  if (rawSearch) {
    const term = safeFilterValue(rawSearch);
    path += `&or=(phone.ilike.*${term}*,name.ilike.*${term}*)`;
  }
  const rows = await restRows(path);
  return { rows, store, read_only: true };
}

async function customerHistory(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = cleanText(session.store, 100);
  const phone = cleanText(payload.phone, 60).replace(/\D/g, "").slice(-20);
  if (!store) throw new Error("账号未绑定门店，无法读取客户历史");
  if (!phone) return { rows: [], bookings: [], store, read_only: true };
  const encodedStore = safeFilterValue(store);
  const encodedPhone = safeFilterValue(phone);
  const profileFields = "phone,name,barber_name,shop_name,last_visit_date,total_visits,total_consumption,card_packages,service_history,notes,preferences";
  const bookingFields = "id,date,barber_name,customer_name,customer_phone,time_label,reservation_time,service_name,notes,status";
  const [rows, bookings] = await Promise.all([
    restRows(`customer_profiles?select=${profileFields}&shop_name=eq.${encodedStore}&phone=ilike.*${encodedPhone}*&order=last_visit_date.desc.nullslast&limit=100`),
    restRows(`bookings?select=${bookingFields}&shop_name=eq.${encodedStore}&customer_phone=ilike.*${encodedPhone}*&order=date.asc&limit=500`),
  ]);
  return { rows, bookings, store, read_only: true };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "service not configured" }, 503);
  let payload: JsonRecord;
  try { payload = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const operation = cleanText(payload.operation, 40);
  try {
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
    if (operation === "today_bookings") return json(await todayBookings(payload, session));
    if (operation === "customer_profiles") return json(await customerProfiles(payload, session));
    if (operation === "customer_history") return json(await customerHistory(payload, session));
    return json({ error: "不支持的操作" }, 400);
  } catch (error) {
    const message = (error as Error).message || "请求失败";
    const authError = /登录|账号|姓名|密码|审核|停用|门店已变化/.test(message);
    return json({ error: message }, authError ? 403 : 400);
  }
});
