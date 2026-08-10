import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SESSION_DAYS = 30;
const VOUCHER_BUCKET = "zysyr-vouchers";
const MAX_VOUCHER_BYTES = 10 * 1024 * 1024;

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
  if (!response.ok) throw new Error(`数据读取失败 (${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function restRowsAll(path: string, maxRows = 10000): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const response = await rest(path, { headers: { Range: `${offset}-${offset + pageSize - 1}` } });
    if (!response.ok) throw new Error(`数据读取失败 (${response.status})`);
    const page = await response.json();
    if (!Array.isArray(page)) break;
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error("当前日期范围记录超过 10000 条，请缩短日期范围后重试");
}

function operationsRole(staff: JsonRecord): string {
  const role = cleanText(staff.role, 40);
  const position = cleanText(staff.position, 120);
  if (role === "admin") return "shareholder";
  if (/财务/.test(position)) return "finance";
  if (role === "store_admin" || /店长/.test(position)) return "store_manager";
  return "employee";
}

function roleLabel(role: unknown): string {
  const labels: Record<string, string> = { shareholder: "股东", finance: "财务", store_manager: "店长", employee: "员工" };
  return labels[cleanText(role, 40)] || "员工";
}

function canWriteExpense(session: JsonRecord): boolean {
  return ["shareholder", "finance", "store_manager"].includes(cleanText(session.operations_role, 40));
}

async function availableStores(session: JsonRecord): Promise<string[]> {
  const assigned = cleanText(session.store, 100);
  if (cleanText(session.operations_role, 40) !== "shareholder") return assigned ? [assigned] : [];
  const rows = await restRows("zysyr_stores?select=name&status=eq.active&order=name.asc&limit=300");
  return rows.map((row) => cleanText(row.name, 100)).filter(Boolean);
}

async function sessionUser(session: JsonRecord): Promise<JsonRecord> {
  const role = cleanText(session.operations_role, 40);
  return {
    username: session.username,
    role,
    role_label: roleLabel(role),
    position: session.position || "",
    store: session.store || "",
    stores: await availableStores(session),
    can_write_expense: canWriteExpense(session),
    can_create_store: role === "shareholder",
    personal_scope: role === "employee",
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
      !stored || (stored !== hashed && stored !== `sha256:${hashed}` && stored !== password)) {
    throw new Error("账号或密码错误");
  }
  const operations_role = operationsRole(staff);
  if (operations_role !== "shareholder" && !cleanText(staff.store, 100)) throw new Error("该账号尚未绑定门店");

  rest(`zysyr_operations_sessions?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  }).catch(() => undefined);
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const response = await rest("zysyr_operations_sessions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      token_hash: await sha256(token), username: staff.username, role: staff.role || "staff",
      position: staff.position || "", store: staff.store || "", expires_at: expiresAt,
    }),
  });
  if (!response.ok) throw new Error(`登录会话创建失败 (${response.status})`);
  const session = { ...staff, operations_role, expires_at: expiresAt };
  return { session_token: token, expires_at: expiresAt, user: await sessionUser(session) };
}

async function logout(payload: JsonRecord): Promise<JsonRecord> {
  const token = cleanText(payload.session_token, 200);
  if (!token) return { logged_out: true };
  const response = await rest(`zysyr_operations_sessions?token_hash=eq.${encodeURIComponent(await sha256(token))}`, {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  });
  if (!response.ok) throw new Error(`退出失败 (${response.status})`);
  return { logged_out: true };
}

async function requireSession(payload: JsonRecord): Promise<JsonRecord> {
  const token = cleanText(payload.session_token, 200);
  if (!token) throw new Error("请重新登录");
  const tokenHash = await sha256(token);
  const rows = await restRows(
    `zysyr_operations_sessions?select=username,role,position,store,expires_at&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
  );
  const saved = rows[0];
  if (!saved) throw new Error("登录已过期，请重新登录");
  const staffRows = await restRows(
    `staff?select=username,role,position,store,active,employment_status&username=eq.${encodeURIComponent(cleanText(saved.username, 80))}&limit=1`,
  );
  const staff = staffRows[0];
  if (!staff || staff.active === false || cleanText(staff.employment_status, 40) !== "active") {
    await rest(`zysyr_operations_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    throw new Error("账号已停用或离职，请重新登录");
  }
  const current = { ...staff, operations_role: operationsRole(staff), expires_at: saved.expires_at };
  await rest(`zysyr_operations_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      role: staff.role || "staff", position: staff.position || "", store: staff.store || "",
      last_used_at: new Date().toISOString(),
    }),
  });
  return current;
}

async function selectedStore(session: JsonRecord, payload: JsonRecord): Promise<string> {
  const stores = await availableStores(session);
  const requested = cleanText(payload.store, 100);
  const store = cleanText(session.operations_role, 40) === "shareholder" ? (requested || stores[0] || "") : cleanText(session.store, 100);
  if (!store || !stores.includes(store)) throw new Error("请选择有效门店");
  return store;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function amountValue(value: unknown): number {
  const raw = cleanText(value, 40);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("金额必须为非负数字，最多两位小数");
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) throw new Error("金额超出允许范围");
  return amount;
}

function staffNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => cleanText((item as JsonRecord)?.name ?? item, 80)).filter(Boolean);
  const text = cleanText(value, 500);
  if (!text) return [];
  try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return staffNames(parsed); } catch { /* plain text */ }
  return text.split(/[,，、/]/).map((item) => item.trim()).filter(Boolean);
}

async function overview(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStore(session, payload);
  const start = cleanText(payload.start, 10);
  const end = cleanText(payload.end, 10);
  if (!validDate(start) || !validDate(end) || start > end) throw new Error("日期范围无效");
  const incomePath = `mgj_service_records?select=source_id,bill_no,customer_name,shop_name,service_date,staff,items,service_types,amount,source,synced_at&shop_name=eq.${encodeURIComponent(store)}&service_date=gte.${start}&service_date=lte.${end}&order=service_date.desc&limit=5000`;
  const expensePath = `zysyr_expense_records?select=id,store,expense_date,category,counterparty,summary,amount,payment_method,source,source_ref,created_by,updated_by,created_at,updated_at&store=eq.${encodeURIComponent(store)}&expense_date=gte.${start}&expense_date=lte.${end}&order=expense_date.desc,created_at.desc&limit=5000`;
  const voucherPath = `zysyr_voucher_attachments?select=id,record_type,record_id,original_filename,mime_type,note,uploaded_by,uploaded_at&store=eq.${encodeURIComponent(store)}&order=uploaded_at.desc&limit=5000`;
  const [rawIncome, expenses, vouchers] = await Promise.all([restRowsAll(incomePath), restRowsAll(expensePath), restRowsAll(voucherPath)]);
  const personal = cleanText(session.operations_role, 40) === "employee";
  const username = cleanText(session.username, 80);
  const incomes = (personal ? rawIncome.filter((row) => staffNames(row.staff).some((name) => name === username || name.endsWith(username) || username.endsWith(name))) : rawIncome)
    .map((row) => ({ ...row, amount: Number(row.amount) || 0, staff_names: staffNames(row.staff), source_label: "美管加已同步消费" }));
  const visibleExpenses = personal ? [] : expenses.map((row) => ({ ...row, amount: Number(row.amount) || 0 }));
  const voucherMap = new Map<string, JsonRecord>();
  for (const row of vouchers) {
    const key = `${cleanText(row.record_type, 20)}:${cleanText(row.record_id, 100)}`;
    if (!voucherMap.has(key)) voucherMap.set(key, row);
  }
  const incomeRecords = incomes.map((row) => ({
    id: cleanText(row.source_id ?? row.bill_no, 120), type: "income", date: row.service_date,
    title: cleanText(row.customer_name, 120) || "到店消费", amount: row.amount, staff: row.staff_names,
    source: row.source_label, source_ref: row.bill_no || row.source_id, items: row.items, synced_at: row.synced_at,
    voucher: voucherMap.get(`income:${cleanText(row.source_id ?? row.bill_no, 120)}`) || null,
  }));
  const expenseRecords = visibleExpenses.map((row) => ({
    id: row.id, type: "expense", date: row.expense_date, title: row.summary, category: row.category,
    amount: row.amount, counterparty: row.counterparty, payment_method: row.payment_method,
    source: row.source === "history_import" ? "历史导入" : "经营录入", source_ref: row.source_ref,
    created_by: row.created_by, updated_at: row.updated_at,
    voucher: voucherMap.get(`expense:${cleanText(row.id, 120)}`) || null,
  }));
  const incomeTotal = incomeRecords.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const expenseTotal = expenseRecords.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingVouchers = expenseRecords.filter((row) => !row.voucher).length;
  const daily = new Map<string, { date: string; income: number; expense: number }>();
  for (const row of [...incomeRecords, ...expenseRecords]) {
    const date = cleanText(row.date, 10); const item = daily.get(date) || { date, income: 0, expense: 0 };
    item[row.type as "income" | "expense"] += Number(row.amount || 0); daily.set(date, item);
  }
  const performance = new Map<string, { name: string; amount: number; orders: number }>();
  for (const row of incomes) for (const name of row.staff_names as string[]) {
    const item = performance.get(name) || { name, amount: 0, orders: 0 };
    item.amount += Number(row.amount || 0); item.orders += 1; performance.set(name, item);
  }
  return {
    store, start, end, scope: personal ? "personal" : "store", source_boundary: "income_read_only_from_mgj",
    summary: { income: incomeTotal, expense: expenseTotal, profit: incomeTotal - expenseTotal, pending_vouchers: pendingVouchers },
    records: [...incomeRecords, ...expenseRecords].sort((a, b) => `${b.date}`.localeCompare(`${a.date}`)),
    daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
    performance: Array.from(performance.values()).sort((a, b) => b.amount - a.amount),
  };
}

async function saveExpense(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!canWriteExpense(session)) throw new Error("当前角色没有费用录入权限");
  const store = await selectedStore(session, payload);
  const expenseDate = cleanText(payload.expense_date, 10);
  const category = cleanText(payload.category, 80);
  const summary = cleanText(payload.summary, 500);
  if (!validDate(expenseDate) || !category || !summary) throw new Error("请完整填写日期、类别和摘要");
  const record = {
    store, expense_date: expenseDate, category, summary,
    counterparty: cleanText(payload.counterparty, 160), amount: amountValue(payload.amount),
    payment_method: cleanText(payload.payment_method, 80), updated_by: session.username,
    updated_at: new Date().toISOString(),
  };
  const id = cleanText(payload.id, 80);
  const response = id
    ? await rest(`zysyr_expense_records?id=eq.${encodeURIComponent(id)}&store=eq.${encodeURIComponent(store)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(record),
    })
    : await rest("zysyr_expense_records", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...record, source: "manual", created_by: session.username }),
    });
  if (!response.ok) throw new Error(`费用保存失败 (${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("费用记录不存在或保存失败");
  return { saved: rows[0], cashier_untouched: true };
}

async function importExpenses(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!canWriteExpense(session)) throw new Error("当前角色没有历史导入权限");
  const store = await selectedStore(session, payload);
  const filename = cleanText(payload.filename, 200) || "history.csv";
  const input = Array.isArray(payload.rows) ? payload.rows.slice(0, 250) : [];
  if (!input.length) throw new Error("没有可导入的历史记录");
  const rows = [];
  for (let index = 0; index < input.length; index += 1) {
    const row = (input[index] || {}) as JsonRecord;
    const expenseDate = cleanText(row.expense_date, 10);
    const category = cleanText(row.category, 80);
    const summary = cleanText(row.summary, 500);
    if (!validDate(expenseDate) || !category || !summary) throw new Error(`第 ${index + 1} 行日期、类别或摘要无效`);
    const amount = amountValue(row.amount);
    const normalized = [store, expenseDate, category, amount.toFixed(2), summary, cleanText(row.counterparty, 160), cleanText(row.payment_method, 80)].join("|");
    rows.push({
      store, expense_date: expenseDate, category, summary, amount,
      counterparty: cleanText(row.counterparty, 160), payment_method: cleanText(row.payment_method, 80),
      source: "history_import", source_ref: await sha256(normalized), created_by: session.username,
      updated_by: session.username,
    });
  }
  const response = await rest("zysyr_expense_records?on_conflict=source_ref", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`历史导入失败 (${response.status})`);
  const inserted = await response.json();
  return { filename, submitted: rows.length, imported: Array.isArray(inserted) ? inserted.length : 0, duplicates: rows.length - (Array.isArray(inserted) ? inserted.length : 0) };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function storagePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function uploadVoucher(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!canWriteExpense(session)) throw new Error("当前角色没有凭证上传权限");
  const store = await selectedStore(session, payload);
  const recordType = cleanText(payload.record_type, 20);
  const recordId = cleanText(payload.record_id, 100);
  const filename = cleanText(payload.filename, 200);
  const mime = cleanText(payload.mime_type, 80);
  if (!recordId || !["expense", "income"].includes(recordType)) throw new Error("凭证关联记录无效");
  if (!["image/jpeg", "image/png", "application/pdf"].includes(mime)) throw new Error("凭证仅支持 JPG、PNG 或 PDF");
  if (recordType === "expense") {
    const records = await restRows(`zysyr_expense_records?select=id&store=eq.${encodeURIComponent(store)}&id=eq.${encodeURIComponent(recordId)}&limit=1`);
    if (!records.length) throw new Error("费用记录不存在或无权访问");
  }
  let bytes: Uint8Array;
  try { bytes = decodeBase64(cleanText(payload.base64, 15000000)); } catch { throw new Error("凭证文件内容无效"); }
  if (!bytes.length || bytes.length > MAX_VOUCHER_BYTES) throw new Error("凭证文件必须小于 10MB");
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const objectPath = `${store}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${VOUCHER_BUCKET}/${storagePath(objectPath)}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": mime, "x-upsert": "false" },
    body: bytes,
  });
  if (!upload.ok) throw new Error(`凭证上传失败 (${upload.status})`);
  const metadata = await rest("zysyr_voucher_attachments", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      store, record_type: recordType, record_id: recordId, object_path: objectPath,
      original_filename: filename || `voucher.${extension}`, mime_type: mime, size_bytes: bytes.length,
      note: cleanText(payload.note, 500), uploaded_by: session.username,
    }),
  });
  if (!metadata.ok) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${VOUCHER_BUCKET}/${storagePath(objectPath)}`, {
      method: "DELETE", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    throw new Error(`凭证登记失败 (${metadata.status})`);
  }
  const rows = await metadata.json();
  return { saved: rows[0], private: true };
}

async function voucherUrl(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStore(session, payload);
  const voucherId = cleanText(payload.voucher_id, 80);
  const rows = await restRows(`zysyr_voucher_attachments?select=id,object_path,original_filename&store=eq.${encodeURIComponent(store)}&id=eq.${encodeURIComponent(voucherId)}&limit=1`);
  const voucher = rows[0];
  if (!voucher) throw new Error("凭证不存在或无权访问");
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${VOUCHER_BUCKET}/${storagePath(cleanText(voucher.object_path, 500))}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  if (!response.ok) throw new Error(`凭证链接生成失败 (${response.status})`);
  const signed = await response.json();
  const signedPath = cleanText(signed.signedURL ?? signed.signedUrl, 2000);
  if (!signedPath) throw new Error("凭证链接生成失败");
  return { url: signedPath.startsWith("http") ? signedPath : `${SUPABASE_URL}/storage/v1${signedPath}`, expires_in: 300, filename: voucher.original_filename };
}

async function createStore(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (cleanText(session.operations_role, 40) !== "shareholder") throw new Error("只有股东账号可以新增门店");
  const name = cleanText(payload.name, 100);
  if (name.length < 2) throw new Error("请填写有效门店名称");
  const response = await rest("zysyr_stores", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name, city: cleanText(payload.city, 100), created_by: session.username }),
  });
  if (response.status === 409) throw new Error("门店名称已存在");
  if (!response.ok) throw new Error(`门店创建失败 (${response.status})`);
  const rows = await response.json();
  return { saved: rows[0] };
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
    if (operation === "overview") return json(await overview(payload, session));
    if (operation === "expense_save") return json(await saveExpense(payload, session));
    if (operation === "expense_import") return json(await importExpenses(payload, session));
    if (operation === "voucher_upload") return json(await uploadVoucher(payload, session));
    if (operation === "voucher_url") return json(await voucherUrl(payload, session));
    if (operation === "store_create") return json(await createStore(payload, session));
    return json({ error: "不支持的操作" }, 400);
  } catch (error) {
    const message = (error as Error).message || "请求失败";
    const authError = /登录|账号|密码|权限|离职|无权/.test(message);
    return json({ error: message }, authError ? 403 : 400);
  }
});
