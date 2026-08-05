import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SESSION_DAYS = 3650;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Content-Type": "application/json; charset=utf-8",
};

type JsonRecord = Record<string, unknown>;

function cleanText(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

function cleanPhone(value: unknown): string {
  return cleanText(value, 60).replace(/\D/g, "").slice(-20);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  if (!response.ok) throw new Error(`data read failed (${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function canUseFrontdesk(staff: JsonRecord): boolean {
  const role = cleanText(staff.role, 40);
  const position = cleanText(staff.position, 120);
  return ["admin", "store_admin"].includes(role) || /前台|店长/.test(position);
}

function canImport(session: JsonRecord): boolean {
  const role = cleanText(session.role, 40);
  return ["admin", "store_admin"].includes(role) || /店长/.test(cleanText(session.position, 120));
}

async function availableStores(session: JsonRecord): Promise<string[]> {
  const assigned = cleanText(session.store, 100);
  if (cleanText(session.role, 40) !== "admin") return assigned ? [assigned] : [];
  const rows = await restRows("staff?select=store&active=eq.true&employment_status=eq.active&order=store.asc&limit=1000");
  return Array.from(new Set([assigned, ...rows.map((row) => cleanText(row.store, 100))].filter(Boolean)));
}

async function sessionUser(session: JsonRecord): Promise<JsonRecord> {
  return {
    username: session.username,
    role: session.role || "staff",
    position: session.position || "",
    store: session.store || "",
    stores: await availableStores(session),
    can_import: canImport(session),
  };
}

async function login(payload: JsonRecord): Promise<JsonRecord> {
  const username = cleanText(payload.username, 80);
  const password = cleanText(payload.password, 200);
  if (!username || !password) throw new Error("请输入账号和密码");
  const rows = await restRows(
    `staff?select=username,password_hash,role,position,store,active,employment_status&username=eq.${encodeURIComponent(username)}&limit=1`,
  );
  const staff = rows[0];
  const hashed = await sha256(password);
  const stored = cleanText(staff?.password_hash, 200);
  if (!staff || staff.active === false || cleanText(staff.employment_status, 40) !== "active" ||
      !stored || (stored !== hashed && stored !== password)) {
    throw new Error("账号或密码错误");
  }
  if (!canUseFrontdesk(staff)) throw new Error("该账号尚未开通前台权限");
  if (cleanText(staff.role, 40) === "store_admin" && !cleanText(staff.store, 100)) {
    throw new Error("分店管理员尚未绑定门店");
  }

  rest(`frontdesk_sessions?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }).catch(() => undefined);

  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const response = await rest("frontdesk_sessions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      token_hash: await sha256(token),
      username: staff.username,
      role: staff.role || "staff",
      position: staff.position || "",
      store: staff.store || "",
      expires_at: expiresAt,
    }),
  });
  if (!response.ok) throw new Error(`登录会话创建失败 (${response.status})`);
  return { session_token: token, expires_at: expiresAt, user: await sessionUser(staff) };
}

async function logout(payload: JsonRecord): Promise<JsonRecord> {
  const token = cleanText(payload.session_token, 200);
  if (!token) return { logged_out: true };
  const response = await rest(`frontdesk_sessions?token_hash=eq.${encodeURIComponent(await sha256(token))}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!response.ok) throw new Error(`退出失败 (${response.status})`);
  return { logged_out: true };
}

async function requireSession(payload: JsonRecord): Promise<JsonRecord> {
  const token = cleanText(payload.session_token, 200);
  if (!token) throw new Error("请重新登录");
  const tokenHash = await sha256(token);
  const rows = await restRows(
    `frontdesk_sessions?select=username,role,position,store,expires_at&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
  );
  const session = rows[0];
  if (!session) throw new Error("登录已过期，请重新登录");
  const staffRows = await restRows(
    `staff?select=username,role,position,store,active,employment_status&username=eq.${encodeURIComponent(cleanText(session.username, 80))}&limit=1`,
  );
  const staff = staffRows[0];
  if (!staff || staff.active === false || cleanText(staff.employment_status, 40) !== "active" || !canUseFrontdesk(staff)) {
    await rest(`frontdesk_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    throw new Error("账号已停用或前台权限已撤销，请重新登录");
  }
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const current = {
    username: staff.username,
    role: staff.role || "staff",
    position: staff.position || "",
    store: staff.store || "",
    expires_at: expiresAt,
  };
  rest(`frontdesk_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...current, last_used_at: new Date().toISOString() }),
  }).catch(() => undefined);
  return current;
}

function selectedStore(session: JsonRecord, payload: JsonRecord): string {
  const assigned = cleanText(session.store, 100);
  const requested = cleanText(payload.store, 100);
  if (cleanText(session.role, 40) === "admin" && requested) return requested;
  return assigned;
}

function withStore(path: string, column: string, store: string): string {
  return store ? `${path}&${column}=eq.${encodeURIComponent(store)}` : path;
}

async function dashboard(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const date = cleanText(payload.date, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式错误");
  const store = selectedStore(session, payload);
  if (!store) throw new Error("请先选择分店");
  const bookingPath = withStore(
    `bookings?select=id,shop_name,barber_name,customer_name,customer_phone,time_label,reservation_time,date,status,service_name,notes&date=eq.${date}&order=reservation_time.asc&limit=300`,
    "shop_name",
    store,
  );
  const servicePath = withStore(
    `mgj_service_records?select=source_id,bill_no,customer_phone,customer_name,shop_name,service_date,service_time,staff,items,service_types,amount,synced_at&service_date=eq.${date}&order=service_time.asc&limit=500`,
    "shop_name",
    store,
  );
  const receptionPath = `frontdesk_today_customers?select=id,business_date,store,customer_name,customer_phone,barber_name,arrival_time,visit_source,service_intent,reception_notes,status,created_by,created_at,updated_at&business_date=eq.${date}&store=eq.${encodeURIComponent(store)}&order=arrival_time.asc.nullslast,created_at.asc&limit=500`;
  const staffPath = `staff?select=username,position,store&active=eq.true&employment_status=eq.active&store=eq.${encodeURIComponent(store)}&order=username.asc&limit=300`;
  const [bookings, services, reception, staffRows] = await Promise.all([
    restRows(bookingPath), restRows(servicePath), restRows(receptionPath), restRows(staffPath),
  ]);
  return {
    date,
    store,
    bookings,
    services,
    reception,
    barbers: staffRows.filter((row) => /发型师/.test(cleanText(row.position, 120))).map((row) => cleanText(row.username, 80)),
    synced_at: services.reduce((latest, row) => {
      const value = cleanText(row.synced_at, 40);
      return value > latest ? value : latest;
    }, ""),
  };
}

const TODAY_SOURCES = new Set(["walkin", "appointment", "referral", "other"]);
const TODAY_STATUSES = new Set(["waiting", "arrived", "in_service", "completed", "cancelled"]);

async function saveTodayCustomer(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = selectedStore(session, payload);
  if (!store) throw new Error("请先选择分店");
  const businessDate = cleanText(payload.business_date, 10);
  const customerName = cleanText(payload.customer_name, 160);
  const customerPhone = cleanPhone(payload.customer_phone);
  const barberName = cleanText(payload.barber_name, 120);
  const arrivalTime = cleanText(payload.arrival_time, 8);
  const visitSource = cleanText(payload.visit_source, 30) || "walkin";
  const status = cleanText(payload.status, 30) || "waiting";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error("接待日期无效");
  if (!customerName && !customerPhone) throw new Error("请填写客户姓名或手机号");
  if (!barberName) throw new Error("请选择发型师");
  if (arrivalTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) throw new Error("到店时间无效");
  if (!TODAY_SOURCES.has(visitSource) || !TODAY_STATUSES.has(status)) throw new Error("接待信息无效");
  const record = {
    business_date: businessDate,
    store,
    customer_name: customerName || "未命名客户",
    customer_phone: customerPhone,
    barber_name: barberName,
    arrival_time: arrivalTime || null,
    visit_source: visitSource,
    service_intent: cleanText(payload.service_intent, 500),
    reception_notes: cleanText(payload.reception_notes, 800),
    status,
    updated_at: new Date().toISOString(),
  };
  const id = cleanText(payload.id, 60);
  const response = id
    ? await rest(`frontdesk_today_customers?id=eq.${encodeURIComponent(id)}&store=eq.${encodeURIComponent(store)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(record),
    })
    : await rest("frontdesk_today_customers", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...record, created_by: session.username }),
    });
  if (!response.ok) throw new Error(`当天客户保存失败 (${response.status})`);
  const saved = await response.json();
  if (!Array.isArray(saved) || !saved.length) throw new Error("当天客户没有保存成功");
  return { saved: saved[0] };
}

function remainingPackageCount(value: unknown): number {
  const rows = Array.isArray(value) ? value : [];
  return rows.reduce((count, item) => {
    const pkg = (item || {}) as JsonRecord;
    const left = Number(pkg.left ?? pkg.remaining ?? pkg.leavetimes ?? 0) || 0;
    return count + (left > 0 ? 1 : 0);
  }, 0);
}

async function customerSearch(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const query = cleanText(payload.query, 80);
  if (query.length < 2) throw new Error("至少输入两个字或两位手机号");
  const phone = cleanPhone(query);
  const like = encodeURIComponent(`*${query.replace(/[*,()]/g, "")}*`);
  const profileFilter = phone.length >= 4
    ? `phone=ilike.${encodeURIComponent(`*${phone}*`)}`
    : `name=ilike.${like}`;
  const importFilter = phone.length >= 4
    ? `customer_phone=ilike.${encodeURIComponent(`*${phone}*`)}`
    : `customer_name=ilike.${like}`;
  const [profiles, imported] = await Promise.all([
    restRows(`customer_profiles?select=id,phone,name,barber_name,shop_name,last_visit_date,total_visits,total_consumption,card_packages&${profileFilter}&order=last_visit_date.desc.nullslast&limit=80`),
    restRows(`frontdesk_import_records?select=id,customer_phone,customer_name,visit_date,amount,service_items,store&${importFilter}&order=visit_date.desc&limit=80`),
  ]);
  const index = new Map<string, JsonRecord>();
  for (const row of profiles) {
    const key = cleanPhone(row.phone) || `name:${cleanText(row.name, 160)}`;
    const current = index.get(key) || {
      phone: cleanPhone(row.phone), name: row.name || "未命名客户", shops: [],
      last_visit: "", visits: 0, consumption: 0, remaining_packages: 0, sources: [],
    };
    current.name = current.name || row.name;
    current.last_visit = String(current.last_visit || "") > cleanText(row.last_visit_date, 40) ? current.last_visit : row.last_visit_date;
    current.visits = Number(current.visits || 0) + (Number(row.total_visits) || 0);
    current.consumption = Number(current.consumption || 0) + (Number(row.total_consumption) || 0);
    current.remaining_packages = Number(current.remaining_packages || 0) + remainingPackageCount(row.card_packages);
    current.shops = Array.from(new Set([...(current.shops as unknown[]), row.shop_name].filter(Boolean)));
    current.sources = Array.from(new Set([...(current.sources as unknown[]), "美管加"]));
    index.set(key, current);
  }
  for (const row of imported) {
    const key = cleanPhone(row.customer_phone) || `name:${cleanText(row.customer_name, 160)}`;
    const current = index.get(key) || {
      phone: cleanPhone(row.customer_phone), name: row.customer_name || "未命名客户", shops: [],
      last_visit: "", visits: 0, consumption: 0, remaining_packages: 0, sources: [],
    };
    current.last_visit = String(current.last_visit || "") > cleanText(row.visit_date, 40) ? current.last_visit : row.visit_date;
    current.shops = Array.from(new Set([...(current.shops as unknown[]), row.store].filter(Boolean)));
    current.sources = Array.from(new Set([...(current.sources as unknown[]), "历史表格"]));
    index.set(key, current);
  }
  const results = Array.from(index.values()).sort((a, b) => String(b.last_visit || "").localeCompare(String(a.last_visit || ""))).slice(0, 60);
  return { query, results, store: selectedStore(session, payload) };
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

function collectPackages(profiles: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const packages: JsonRecord[] = [];
  for (const profile of profiles) {
    for (const item of parseArray(profile.card_packages)) {
      const pkg = (item || {}) as JsonRecord;
      const left = Number(pkg.left ?? pkg.remaining ?? pkg.leavetimes ?? 0) || 0;
      const total = Number(pkg.total ?? pkg.sumtimes ?? 0) || 0;
      if (left <= 0) continue;
      const normalized = {
        name: cleanText(pkg.name ?? pkg.itemname, 200) || "套餐",
        package_name: cleanText(pkg.package_name, 200),
        left,
        total,
        shop: cleanText(pkg.shop ?? profile.shop_name, 100),
        expire_date: cleanText(pkg.expire_date ?? pkg.validdate, 40),
        status: cleanText(pkg.status, 40),
      };
      const key = [normalized.name, normalized.left, normalized.total, normalized.shop, normalized.expire_date].join("|");
      if (!seen.has(key)) { seen.add(key); packages.push(normalized); }
    }
  }
  return packages.sort((a, b) => Number(a.left) / Math.max(1, Number(a.total)) - Number(b.left) / Math.max(1, Number(b.total)));
}

function historyFromProfiles(profiles: JsonRecord[]): JsonRecord[] {
  const history: JsonRecord[] = [];
  for (const profile of profiles) {
    for (const item of parseArray(profile.service_history)) {
      const row = (typeof item === "string" ? { items: [{ name: item }] } : (item || {})) as JsonRecord;
      const items = parseArray(row.items).map((project) => cleanText((project as JsonRecord)?.name ?? (project as JsonRecord)?.itemname ?? project, 200)).filter(Boolean);
      history.push({
        source: "美管加档案",
        source_id: row.source_id || row.id || "",
        date: row.date || cleanText(profile.last_visit_date, 10),
        time: row.time || "",
        items,
        amount: Number(row.amount ?? row.consumefee ?? 0) || 0,
        staff: parseArray(row.staff).map((x) => cleanText(x, 100)).filter(Boolean),
        barber: row.barber || profile.barber_name || "",
        shop: row.shop || profile.shop_name || "",
        note: row.comment || "",
      });
    }
  }
  return history;
}

function sameCustomer(rowPhone: unknown, rowName: unknown, phone: string, name: string): boolean {
  const normalized = cleanPhone(rowPhone);
  if (phone && normalized) return phone === normalized;
  return !phone && cleanText(rowName, 160) === name;
}

async function customerDetail(payload: JsonRecord): Promise<JsonRecord> {
  const phone = cleanPhone(payload.phone);
  const name = cleanText(payload.name, 160);
  if (!phone && !name) throw new Error("缺少客户信息");
  const profileFilter = phone
    ? `phone=ilike.${encodeURIComponent(`*${phone}*`)}`
    : `name=eq.${encodeURIComponent(name)}`;
  const serviceFilter = phone
    ? `customer_phone=ilike.${encodeURIComponent(`*${phone}*`)}`
    : `customer_name=eq.${encodeURIComponent(name)}`;
  const importedFilter = phone
    ? `customer_phone=eq.${encodeURIComponent(phone)}`
    : `customer_name=eq.${encodeURIComponent(name)}`;
  const [profileRows, liveRows, importedRows] = await Promise.all([
    restRows(`customer_profiles?select=*&${profileFilter}&order=last_visit_date.desc.nullslast&limit=200`),
    restRows(`mgj_service_records?select=source_id,bill_no,customer_phone,customer_name,shop_name,service_date,service_time,staff,items,service_types,amount,synced_at&${serviceFilter}&order=service_date.desc,service_time.desc&limit=1000`),
    restRows(`frontdesk_import_records?select=id,customer_phone,customer_name,visit_date,coupon_code,service_items,barber_name,technician_name,assistant_name,amount,payment_summary,package_note,store,source_file&${importedFilter}&order=visit_date.desc&limit=2000`),
  ]);
  const profiles = profileRows.filter((row) => sameCustomer(row.phone, row.name, phone, name));
  const live = liveRows.filter((row) => sameCustomer(row.customer_phone, row.customer_name, phone, name));
  const imported = importedRows.filter((row) => sameCustomer(row.customer_phone, row.customer_name, phone, name));
  const history = historyFromProfiles(profiles);
  for (const row of live) {
    history.push({
      source: "美管加实时",
      source_id: row.source_id,
      date: row.service_date,
      time: row.service_time || "",
      items: parseArray(row.items).map((item) => cleanText((item as JsonRecord)?.name ?? (item as JsonRecord)?.itemname ?? item, 200)).filter(Boolean),
      amount: Number(row.amount) || 0,
      staff: parseArray(row.staff).map((x) => cleanText(x, 100)).filter(Boolean),
      barber: "",
      shop: row.shop_name || "",
      note: "",
    });
  }
  for (const row of imported) {
    history.push({
      source: "历史表格",
      source_id: `legacy-${row.id}`,
      date: row.visit_date,
      time: "",
      items: cleanText(row.service_items, 500).split(/[、,，/]/).map((x) => x.trim()).filter(Boolean),
      amount: Number(row.amount) || 0,
      staff: [row.barber_name, row.technician_name, row.assistant_name].map((x) => cleanText(x, 100)).filter(Boolean),
      barber: row.barber_name || "",
      shop: row.store || "",
      note: [row.payment_summary, row.package_note, row.coupon_code ? `券码 ${row.coupon_code}` : ""].filter(Boolean).join(" · "),
    });
  }
  const deduped = new Map<string, JsonRecord>();
  for (const row of history) {
    const key = cleanText(row.source_id, 160) || [row.date, row.time, row.amount, JSON.stringify(row.items), row.shop].join("|");
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const timeline = Array.from(deduped.values()).sort((a, b) => `${b.date || ""} ${b.time || ""}`.localeCompare(`${a.date || ""} ${a.time || ""}`));
  const summary = profiles.reduce((total, row) => ({
    visits: total.visits + (Number(row.total_visits) || 0),
    consumption: total.consumption + (Number(row.total_consumption) || 0),
    last_visit: String(total.last_visit) > cleanText(row.last_visit_date, 40) ? total.last_visit : cleanText(row.last_visit_date, 40),
  }), { visits: 0, consumption: 0, last_visit: "" });
  const profilesMissingHistory = profiles.filter((row) =>
    (Number(row.total_visits) || Number(row.total_consumption)) && parseArray(row.service_history).length === 0
  ).length;
  return {
    customer: { phone, name: name || profiles[0]?.name || imported[0]?.customer_name || "未命名客户" },
    summary,
    historical_import: { rows: imported.length, amount: imported.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) },
    packages: collectPackages(profiles),
    timeline,
    notes: profiles.map((row) => cleanText(row.notes, 500)).filter(Boolean),
    data_quality: {
      profile_rows: profiles.length,
      live_rows: live.length,
      imported_rows: imported.length,
      summary_without_history: profilesMissingHistory,
      message: profilesMissingHistory > 0
        ? "美管加档案包含到店/消费汇总，但尚未返回对应逐笔明细；当前时间线只展示已经同步和导入的记录。"
        : "当前时间线已展示可用的美管加明细和历史导入记录。",
    },
  };
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function normalizeImportRows(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || value.length > 250) throw new Error("单次最多导入 250 行");
  return value.map((raw, index) => {
    const row = (raw || {}) as JsonRecord;
    const date = cleanText(row.visit_date, 10);
    const name = cleanText(row.customer_name, 160);
    const phone = cleanPhone(row.customer_phone);
    if (!validDate(date)) throw new Error(`第 ${index + 1} 行日期无效`);
    if (!name && !phone) throw new Error(`第 ${index + 1} 行缺少客户姓名或手机号`);
    const amount = Math.max(0, Math.min(99999999, Number(row.amount) || 0));
    return {
      source_row: Math.max(1, Number(row.source_row) || index + 2),
      visit_date: date,
      coupon_code: cleanText(row.coupon_code, 160),
      customer_name: name || "未命名客户",
      customer_phone: phone,
      service_items: cleanText(row.service_items, 500),
      barber_name: cleanText(row.barber_name, 120),
      technician_name: cleanText(row.technician_name, 120),
      assistant_name: cleanText(row.assistant_name, 120),
      amount,
      payment_summary: cleanText(row.payment_summary, 500),
      package_note: cleanText(row.package_note, 500),
      raw_row: typeof row.raw_row === "object" && row.raw_row ? row.raw_row : {},
    };
  });
}

async function importRows(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!canImport(session)) throw new Error("只有店长或管理员可以导入历史表格");
  const batchId = cleanText(payload.batch_id, 60);
  const filename = cleanText(payload.filename, 240);
  if (!/^[0-9a-f-]{36}$/i.test(batchId) || !filename) throw new Error("导入批次信息无效");
  const rows = normalizeImportRows(payload.rows);
  const response = await rest("rpc/import_frontdesk_records", {
    method: "POST",
    body: JSON.stringify({
      p_batch_id: batchId,
      p_filename: filename,
      p_operator: session.username,
      p_store: selectedStore(session, payload),
      p_rows: rows,
      p_complete: payload.complete === true,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`导入失败 (${response.status}) ${detail.slice(0, 180)}`);
  }
  return await response.json();
}

async function importBatches(session: JsonRecord): Promise<JsonRecord> {
  if (!canImport(session)) throw new Error("只有店长或管理员可以查看导入记录");
  const store = cleanText(session.store, 100);
  const path = withStore(
    "frontdesk_import_batches?select=id,original_filename,total_rows,imported_rows,duplicate_rows,imported_by,store,status,created_at,completed_at&order=created_at.desc&limit=30",
    "store",
    cleanText(session.role, 40) === "admin" ? "" : store,
  );
  return { batches: await restRows(path) };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "service not configured" }, 503);
  let payload: JsonRecord;
  try { payload = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const operation = cleanText(payload.operation, 40);
  try {
    if (operation === "login") return json(await login(payload));
    if (operation === "logout") return json(await logout(payload));
    const session = await requireSession(payload);
    if (operation === "session") return json({ user: await sessionUser(session), expires_at: session.expires_at });
    if (operation === "dashboard") return json(await dashboard(payload, session));
    if (operation === "today_customer_save") return json(await saveTodayCustomer(payload, session));
    if (operation === "customer_search") return json(await customerSearch(payload, session));
    if (operation === "customer_detail") return json(await customerDetail(payload));
    if (operation === "import_rows") return json(await importRows(payload, session));
    if (operation === "import_batches") return json(await importBatches(session));
    return json({ error: "不支持的操作" }, 400);
  } catch (error) {
    const message = (error as Error).message || "请求失败";
    const authError = /登录|账号|密码|权限|过期/.test(message);
    return json({ error: message }, authError ? 403 : 400);
  }
});
