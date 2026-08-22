import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import ExcelJS from "exceljs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SESSION_DAYS = 30;
const VOUCHER_BUCKET = "zysyr-vouchers";
const MAX_VOUCHER_BYTES = 10 * 1024 * 1024;
const REPORT_BUCKET = "zysyr-reports";
const MAX_REPORT_BYTES = 10 * 1024 * 1024;

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

function uuidIn(values: unknown[]): string {
  const ids = Array.from(new Set(values.map((value) => cleanText(value, 40)).filter((value) => /^[0-9a-f-]{36}$/i.test(value))));
  return `(${ids.join(",")})`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function exactArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(value));
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

function scopeRole(scope: JsonRecord, code: string): JsonRecord | null {
  const roles = Array.isArray(scope.roles) ? scope.roles as JsonRecord[] : [];
  return roles.find((role) => cleanText(role.code, 80) === code
    && role.scope && typeof role.scope === "object") || null;
}

function scopeCapability(scope: JsonRecord, code: string, scopeType: string, storeId: string): boolean {
  const capabilities = Array.isArray(scope.capabilities) ? scope.capabilities as JsonRecord[] : [];
  return capabilities.some((capability) => cleanText(capability.code, 100) === code
    && Array.isArray(capability.scopes)
    && (capability.scopes as JsonRecord[]).some((item) => cleanText(item.type, 20) === scopeType
      && (scopeType === "company" || cleanText(item.store_id, 40) === storeId)));
}

async function authSession(request: Request): Promise<JsonRecord | null> {
  const authorization = cleanText(request.headers.get("authorization"), 9000);
  if (!/^Bearer\s+[^\s]+$/i.test(authorization)) return null;
  const response = await fetch(`${SUPABASE_URL}/functions/v1/operations-auth`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: authorization, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Supabase Auth 登录已失效，请重新登录");
  const scope = await response.json() as JsonRecord;
  if (cleanText(scope.auth_boundary, 80) !== "supabase_auth_rls") throw new Error("Supabase Auth 权限范围无效");

  const shareholder = scopeRole(scope, "shareholder");
  const finance = scopeRole(scope, "finance");
  const storeManager = scopeRole(scope, "store_manager");
  const employee = scopeRole(scope, "employee");
  let operationsRole = "";
  let roleScope: JsonRecord = {};
  if (shareholder && cleanText((shareholder.scope as JsonRecord).type, 20) === "company") {
    operationsRole = "shareholder";
    roleScope = shareholder.scope as JsonRecord;
  } else if (finance) {
    operationsRole = "finance";
    roleScope = finance.scope as JsonRecord;
  } else if (storeManager) {
    operationsRole = "store_manager";
    roleScope = storeManager.scope as JsonRecord;
  } else if (employee) {
    operationsRole = "employee";
    roleScope = employee.scope as JsonRecord;
  }
  const scopeType = cleanText(roleScope.type, 20);
  const storeId = scopeType === "store" ? cleanText(roleScope.store_id, 40) : "";
  const authorized = operationsRole === "shareholder"
    ? scopeCapability(scope, "dashboard.group.read", "company", "")
    : operationsRole === "finance"
      ? scopeCapability(scope, "dashboard.store.read", scopeType, storeId)
        && scopeCapability(scope, "daily_report.write", scopeType, storeId)
      : operationsRole === "store_manager"
        ? scopeType === "store" && scopeCapability(scope, "dashboard.store.read", scopeType, storeId)
        : operationsRole === "employee"
          ? scopeType === "store" && scopeCapability(scope, "employee.self.read", scopeType, storeId)
            && /^[0-9a-f-]{36}$/i.test(cleanText((scope.user as JsonRecord)?.employee_id, 40))
          : false;
  if (!authorized || (scopeType !== "company" && scopeType !== "store")) {
    throw new Error("Supabase Auth 经营角色无权进入驾驶舱");
  }

  const rawStores = Array.isArray(scope.stores) ? scope.stores as JsonRecord[] : [];
  const scopedStores = rawStores.filter((store) => cleanText(store.status, 20) === "active"
    && (scopeType === "company" || cleanText(store.id, 40) === storeId));
  const user = scope.user && typeof scope.user === "object" ? scope.user as JsonRecord : {};
  const capabilities = Array.isArray(scope.capabilities) ? scope.capabilities as JsonRecord[] : [];
  const storeName = scopeType === "store"
    ? cleanText(scopedStores.find((store) => cleanText(store.id, 40) === storeId)?.name, 100)
    : "";
  if (scopeType === "store" && !storeName) throw new Error("Supabase Auth 门店范围无效");

  return {
    username: cleanText(user.login_name, 80) || cleanText(user.display_name, 120),
    role: `auth_${operationsRole}`,
    position: roleLabel(operationsRole),
    store: storeName,
    operations_role: operationsRole,
    auth_user_id: cleanText(user.auth_user_id, 40),
    auth_account_id: cleanText(user.id, 40),
    auth_employee_id: cleanText(user.employee_id, 40),
    auth_company_id: cleanText(user.company_id, 40),
    auth_scope_type: scopeType,
    auth_store_id: storeId,
    auth_stores: scopedStores.map((store) => cleanText(store.name, 100)).filter(Boolean),
    auth_store_records: scopedStores,
    auth_capabilities: capabilities.map((capability) => cleanText(capability.code, 100)).filter(Boolean),
  };
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
  return Boolean(cleanText(session.auth_account_id, 40))
    && Array.isArray(session.auth_capabilities)
    && (session.auth_capabilities as unknown[]).some((item) => cleanText(item, 100) === "expense.create_submit");
}

function canUploadReports(session: JsonRecord): boolean {
  return cleanText(session.operations_role, 40) === "finance"
    && Array.isArray(session.auth_capabilities)
    && (session.auth_capabilities as unknown[]).some((item) => cleanText(item, 100) === "report.upload");
}

function canUploadVouchers(session: JsonRecord): boolean {
  return cleanText(session.operations_role, 40) === "finance"
    && hasAuthCapability(session, "voucher.upload");
}

function canReviewVouchers(session: JsonRecord): boolean {
  return cleanText(session.operations_role, 40) === "finance"
    && hasAuthCapability(session, "voucher.review");
}

function hasAuthCapability(session: JsonRecord, capability: string): boolean {
  return Boolean(cleanText(session.auth_account_id, 40))
    && Array.isArray(session.auth_capabilities)
    && (session.auth_capabilities as unknown[]).some((item) => cleanText(item, 100) === capability);
}

async function availableStores(session: JsonRecord): Promise<string[]> {
  if (Array.isArray(session.auth_stores)) return (session.auth_stores as unknown[]).map((item) => cleanText(item, 100)).filter(Boolean);
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
    can_manage_finance_workbench: cleanText(session.operations_role, 40) === "finance"
      && hasAuthCapability(session, "expense.create_submit"),
    can_review_expenses: hasAuthCapability(session, "expense.approve"),
    can_confirm_payments: hasAuthCapability(session, "payment.confirm"),
    can_lock_reports: hasAuthCapability(session, "report.lock"),
    can_adjust_confirmed_finance: hasAuthCapability(session, "confirmed_finance.adjust"),
    can_read_salary: hasAuthCapability(session, "salary.read"),
    can_manage_payroll: role === "finance" && hasAuthCapability(session, "salary.write_approve"),
    can_view_personal_payroll: role === "employee"
      && /^[0-9a-f-]{36}$/i.test(cleanText(session.auth_employee_id, 40)),
    can_upload_reports: canUploadReports(session),
    can_import_photo_reports: role === "finance" && hasAuthCapability(session, "daily_report.write"),
    can_upload_vouchers: canUploadVouchers(session),
    can_review_vouchers: canReviewVouchers(session),
    can_manage_service_items: hasAuthCapability(session, "daily_report.write"),
    can_manage_inventory_catalog: hasAuthCapability(session, "inventory.write"),
    can_manage_inventory: hasAuthCapability(session, "inventory.write"),
    can_read_ai_analysis: hasAuthCapability(session, "ai_insight.read"),
    can_create_question: hasAuthCapability(session, "question.create"),
    can_respond_question: hasAuthCapability(session, "question.respond"),
    can_manage_employees: hasAuthCapability(session, "employee.write"),
    can_manage_stores: hasAuthCapability(session, "org.store.write")
      && cleanText(session.auth_scope_type, 20) === "company",
    can_create_store: hasAuthCapability(session, "org.store.write")
      && cleanText(session.auth_scope_type, 20) === "company",
    can_manage_finance_accounts: Array.isArray(session.auth_capabilities)
      && (session.auth_capabilities as unknown[]).some((item) => cleanText(item, 100) === "finance_account.create")
      && cleanText(session.auth_scope_type, 20) === "company",
    can_manage_workforce_accounts: Array.isArray(session.auth_capabilities)
      && (session.auth_capabilities as unknown[]).some((item) => cleanText(item, 100) === "workforce_account.create")
      && cleanText(session.auth_scope_type, 20) === "company",
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

async function requireSession(payload: JsonRecord, request: Request): Promise<JsonRecord> {
  const authenticated = await authSession(request);
  if (authenticated) return authenticated;
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
  const companyScope = cleanText(session.operations_role, 40) === "shareholder"
    || cleanText(session.auth_scope_type, 20) === "company";
  const store = companyScope ? (requested || stores[0] || "") : cleanText(session.store, 100);
  if (!store || !stores.includes(store)) throw new Error("请选择有效门店");
  return store;
}

async function selectedStoreInfo(session: JsonRecord, payload: JsonRecord): Promise<JsonRecord> {
  const name = await selectedStore(session, payload);
  const scoped = Array.isArray(session.auth_store_records) ? session.auth_store_records as JsonRecord[] : [];
  const matched = scoped.find((store) => cleanText(store.name, 100) === name);
  if (matched) {
    const companyId = cleanText(matched.company_id, 40) || cleanText(session.auth_company_id, 40);
    const storeId = cleanText(matched.id, 40);
    if (companyId && storeId) return { company_id: companyId, id: storeId, name };
  }
  const rows = await restRows(`zysyr_stores?select=id,company_id,name&name=eq.${encodeURIComponent(name)}&limit=2`);
  if (rows.length !== 1 || !cleanText(rows[0].company_id, 40)) throw new Error("门店尚未完成公司映射，不能读写财务报表");
  return rows[0];
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

function signedAmountValue(value: unknown): number {
  const raw = cleanText(value, 40);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("调整金额最多两位小数");
  const amount = Number(raw);
  if (!Number.isFinite(amount) || Math.abs(amount) > 9999999999.99) throw new Error("调整金额超出允许范围");
  return amount;
}

function rateValue(value: unknown): number {
  const raw = cleanText(value, 40);
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) throw new Error("提成比例必须为 0 至 1，最多四位小数");
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("提成比例必须为 0 至 1");
  return rate;
}

function catalogCostValue(value: unknown): number | null {
  const raw = cleanText(value, 40);
  if (!raw) return null;
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) throw new Error("参考成本必须为非负数字，最多四位小数");
  const cost = Number(raw);
  if (!Number.isFinite(cost) || cost < 0 || cost >= 10000000000) throw new Error("参考成本超出允许范围");
  return cost;
}

function quantityValue(value: unknown): number | null {
  const raw = cleanText(value, 40);
  if (!raw) return null;
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) throw new Error("数量必须为非负数字，最多四位小数");
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity >= 10000000000) throw new Error("数量超出允许范围");
  return quantity;
}

async function catalog(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const role = cleanText(session.operations_role, 40);
  if (role !== "shareholder" && role !== "finance" && role !== "store_manager") throw new Error("当前角色无权查看基础资料");
  const store = await selectedStoreInfo(session, payload);
  const companyId = cleanText(store.company_id, 40);
  if (!companyId) throw new Error("基础资料公司范围无效");
  const [serviceItems, products, suppliers, employees, stores] = await Promise.all([
    restRowsAll(`zysyr_service_items?select=id,name,category,status,created_at,updated_at&company_id=eq.${companyId}&deleted_at=is.null&order=status.asc,category.asc,name.asc&limit=2000`, 2000),
    restRowsAll(`zysyr_products?select=id,name,category,unit,default_cost,status,created_at,updated_at&company_id=eq.${companyId}&deleted_at=is.null&order=status.asc,category.asc,name.asc&limit=5000`, 5000),
    restRowsAll(`zysyr_suppliers?select=id,name,category,contact,status,created_at,updated_at&company_id=eq.${companyId}&deleted_at=is.null&order=status.asc,name.asc&limit=2000`, 2000),
    restRowsAll(`zysyr_employees?select=id,store_id,employee_code,name,position,level,join_date,leave_date,employment_status,created_at,updated_at&company_id=eq.${companyId}&store_id=eq.${cleanText(store.id, 40)}&deleted_at=is.null&order=employment_status.asc,employee_code.asc,name.asc&limit=2000`, 2000),
    restRowsAll(`zysyr_stores?select=id,company_id,name,code,city,address,status,manager_employee_id,created_at,updated_at&company_id=eq.${companyId}&deleted_at=is.null&order=status.asc,name.asc&limit=500`, 500),
  ]);
  return {
    company_id: companyId,
    store_id: cleanText(store.id, 40),
    store: cleanText(store.name, 100),
    service_items: serviceItems,
    products,
    suppliers,
    employees,
    stores,
  };
}

async function rpcSaved(path: string, body: JsonRecord): Promise<JsonRecord> {
  const response = await rest(path, { method: "POST", body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" ? data as JsonRecord : {};
    const code = cleanText(error.message, 120) || cleanText(error.code, 40);
    if (code === "CHANGE_REASON_REQUIRED") throw new Error("修改基础资料必须填写原因");
    if (/FORBIDDEN$/.test(code)) throw new Error("当前账号没有该基础资料维护权限");
    if (/_NOT_FOUND$/.test(code)) throw new Error("基础资料不存在或已归档");
    if (/_FIELDS_REQUIRED$|_NAME_REQUIRED$|_STATUS_INVALID$|_COST_INVALID$|_DATE_INVALID$|_CODE_INVALID$|_MANAGER.*INVALID$/.test(code)) throw new Error("基础资料字段无效");
    if (cleanText(error.code, 40) === "23505") throw new Error("编号或名称已存在，请更换后再保存");
    throw new Error(`基础资料保存失败 (${response.status})`);
  }
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved || typeof saved !== "object") throw new Error("基础资料保存结果无效");
  return saved as JsonRecord;
}

async function saveServiceItem(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "daily_report.write")) throw new Error("当前账号没有项目维护权限");
  const store = await selectedStoreInfo(session, payload);
  const actorId = cleanText(session.auth_account_id, 40);
  const id = cleanText(payload.id, 40);
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("服务项目ID无效");
  const saved = await rpcSaved("rpc/zysyr_upsert_service_item", {
    p_actor_user_id: actorId,
    p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40),
    p_id: id || null,
    p_name: cleanText(payload.name, 160),
    p_category: cleanText(payload.category, 100),
    p_status: cleanText(payload.status, 20) || "active",
    p_reason: cleanText(payload.reason, 500) || null,
  });
  return { saved };
}

async function saveProduct(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "inventory.write")) throw new Error("当前账号没有产品维护权限");
  const store = await selectedStoreInfo(session, payload);
  const actorId = cleanText(session.auth_account_id, 40);
  const id = cleanText(payload.id, 40);
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("产品ID无效");
  const saved = await rpcSaved("rpc/zysyr_upsert_product", {
    p_actor_user_id: actorId,
    p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40),
    p_id: id || null,
    p_name: cleanText(payload.name, 160),
    p_category: cleanText(payload.category, 100),
    p_unit: cleanText(payload.unit, 40),
    p_default_cost: catalogCostValue(payload.default_cost),
    p_status: cleanText(payload.status, 20) || "active",
    p_reason: cleanText(payload.reason, 500) || null,
  });
  return { saved };
}

async function saveSupplier(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "inventory.write")) throw new Error("当前账号没有供应商维护权限");
  const store = await selectedStoreInfo(session, payload);
  const actorId = cleanText(session.auth_account_id, 40);
  const id = cleanText(payload.id, 40);
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("供应商ID无效");
  const saved = await rpcSaved("rpc/zysyr_upsert_supplier", {
    p_actor_user_id: actorId,
    p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40),
    p_id: id || null,
    p_name: cleanText(payload.name, 160),
    p_category: cleanText(payload.category, 100) || null,
    p_contact: cleanText(payload.contact, 300) || null,
    p_status: cleanText(payload.status, 20) || "active",
    p_reason: cleanText(payload.reason, 500) || null,
  });
  return { saved };
}

async function saveEmployee(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "employee.write")) throw new Error("当前账号没有员工维护权限");
  const store = await selectedStoreInfo(session, payload);
  const actorId = cleanText(session.auth_account_id, 40);
  const id = cleanText(payload.id, 40);
  const joinDate = cleanText(payload.join_date, 10);
  const leaveDate = cleanText(payload.leave_date, 10);
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("员工ID无效");
  if (joinDate && !validDate(joinDate)) throw new Error("入职日期无效");
  if (leaveDate && !validDate(leaveDate)) throw new Error("离职日期无效");
  const saved = await rpcSaved("rpc/zysyr_upsert_employee", {
    p_actor_user_id: actorId,
    p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40),
    p_id: id || null,
    p_employee_code: cleanText(payload.employee_code, 80),
    p_name: cleanText(payload.name, 120),
    p_position: cleanText(payload.position, 120),
    p_level: cleanText(payload.level, 80) || null,
    p_join_date: joinDate || null,
    p_leave_date: leaveDate || null,
    p_employment_status: cleanText(payload.employment_status, 20) || "active",
    p_reason: cleanText(payload.reason, 500) || null,
  });
  return { saved };
}

async function saveStore(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "org.store.write") || cleanText(session.auth_scope_type, 20) !== "company") {
    throw new Error("当前账号没有门店维护权限");
  }
  const contextStore = await selectedStoreInfo(session, payload);
  const actorId = cleanText(session.auth_account_id, 40);
  const id = cleanText(payload.id, 40);
  const managerId = cleanText(payload.manager_employee_id, 40);
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("门店ID无效");
  if (managerId && !/^[0-9a-f-]{36}$/i.test(managerId)) throw new Error("负责人ID无效");
  const code = cleanText(payload.code, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(code)) throw new Error("门店编号仅支持小写字母、数字、横线和下划线");
  const saved = await rpcSaved("rpc/zysyr_upsert_store", {
    p_actor_user_id: actorId,
    p_company_id: cleanText(contextStore.company_id, 40),
    p_id: id || null,
    p_name: cleanText(payload.name, 100),
    p_code: code,
    p_city: cleanText(payload.city, 100),
    p_address: cleanText(payload.address, 300) || null,
    p_manager_employee_id: managerId || null,
    p_status: cleanText(payload.status, 20) || "active",
    p_reason: cleanText(payload.reason, 500) || null,
  });
  return { saved };
}

async function overview(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStoreInfo(session, payload);
  const month = cleanText(payload.month, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) throw new Error("月份无效");
  const start = `${month}-01`;
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const reportPath = `zysyr_report_uploads?select=id,report_type,report_date,template_code,template_version,version,status,original_filename,mime_type,size_bytes,sha256,display_data,uploaded_by_user_id,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&report_date=gte.${start}&report_date=lt.${end}&order=report_date.desc,version.desc&limit=500`;
  const voucherPath = `zysyr_voucher_attachments?select=id,record_id,original_filename,mime_type,note,uploaded_by,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&record_type=eq.report&order=uploaded_at.desc&limit=1000`;
  const [rawReports, vouchers] = await Promise.all([restRowsAll(reportPath), restRowsAll(voucherPath)]);
  const reports = rawReports.filter((row, index, list) => list.findIndex((item) => cleanText(item.report_type, 40) === cleanText(row.report_type, 40)
    && cleanText(item.report_date, 10) === cleanText(row.report_date, 10)) === index);
  const voucherMap = new Map<string, JsonRecord[]>();
  for (const voucher of vouchers) {
    const key = cleanText(voucher.record_id, 80);
    const list = voucherMap.get(key) || [];
    list.push(voucher);
    voucherMap.set(key, list);
  }
  const uploaderFilter = uuidIn(reports.map((report) => report.uploaded_by_user_id));
  const uploaders = uploaderFilter === "()" ? [] : await restRows(`zysyr_user_accounts?select=id,login_name,display_name&id=in.${uploaderFilter}&limit=500`);
  const uploaderMap = new Map(uploaders.map((account) => [cleanText(account.id, 40), {
    login_name: cleanText(account.login_name, 80), display_name: cleanText(account.display_name, 120),
  }]));
  const withEvidence: JsonRecord[] = reports.map((report) => ({
    ...report,
    uploaded_by: uploaderMap.get(cleanText(report.uploaded_by_user_id, 40)) || null,
    vouchers: voucherMap.get(cleanText(report.id, 80)) || [],
  }));
  const monthlyReport = withEvidence.find((report) => cleanText(report.report_type, 40) === "monthly_profit_loss"
    && cleanText(report.report_date, 10) === start) || null;
  const cellTraceStatus: Record<string, string> = {};
  const traceSummary = { total: 0, matched: 0, mismatch: 0, missing_evidence: 0, unlinked: 0, formula: 0 };
  if (monthlyReport) {
    const reportId = cleanText(monthlyReport.id, 40);
    const cells = await restRowsAll(`zysyr_report_cells?select=id,cell_address,cell_kind,numeric_value,precedent_addresses&company_id=eq.${companyId}&store_id=eq.${storeId}&report_id=eq.${reportId}&order=row_number.asc,column_number.asc`, 5000);
    const cellFilter = uuidIn(cells.map((cell) => cell.id));
    const revisions = cellFilter === "()" ? [] : await restRowsAll(`zysyr_report_cell_trace_revisions?select=target_cell_id,revision,status&company_id=eq.${companyId}&target_cell_id=in.${cellFilter}&order=revision.desc`, 5000);
    const latest = new Map<string, string>();
    for (const revision of revisions) {
      const cellId = cleanText(revision.target_cell_id, 40);
      if (!latest.has(cellId)) latest.set(cellId, cleanText(revision.status, 30));
    }
    const cellsByAddress = new Map(cells.map((cell) => [cleanText(cell.cell_address, 20), cell]));
    const resolved = new Map<string, string>();
    function resolveStatus(cell: JsonRecord, trail = new Set<string>()): string {
      const id = cleanText(cell.id, 40);
      if (resolved.has(id)) return resolved.get(id) as string;
      if (trail.has(id)) return "mismatch";
      if (cleanText(cell.cell_kind, 20) !== "formula") {
        const status = latest.get(id) || "unlinked";
        resolved.set(id, status);
        return status;
      }
      const nextTrail = new Set(trail); nextTrail.add(id);
      const addresses = Array.isArray(cell.precedent_addresses) ? cell.precedent_addresses as unknown[] : [];
      const precedentStatuses = addresses.map((address) => cellsByAddress.get(cleanText(address, 20))).filter(Boolean)
        .map((precedent) => resolveStatus(precedent as JsonRecord, nextTrail));
      const status = !precedentStatuses.length || precedentStatuses.includes("unlinked") ? "unlinked"
        : precedentStatuses.includes("mismatch") ? "mismatch"
          : precedentStatuses.includes("missing_evidence") ? "missing_evidence" : "formula";
      resolved.set(id, status);
      return status;
    }
    for (const cell of cells) {
      const address = cleanText(cell.cell_address, 20);
      const status = resolveStatus(cell);
      cellTraceStatus[address] = status;
      traceSummary.total += 1;
      if (Object.prototype.hasOwnProperty.call(traceSummary, status)) (traceSummary as Record<string, number>)[status] += 1;
    }
  }
  return {
    store: cleanText(store.name, 100), month, source_boundary: "finance_uploads_only",
    monthly_report: monthlyReport,
    reports: withEvidence,
    cell_trace_status: cellTraceStatus,
    trace_summary: traceSummary,
  };
}

function requireFinanceCapability(session: JsonRecord, capability: string, message: string): void {
  if (cleanText(session.operations_role, 40) !== "finance" || !hasAuthCapability(session, capability)) {
    throw new Error(message);
  }
}

function uuidValue(value: unknown, message: string, optional = false): string | null {
  const id = cleanText(value, 40);
  if (!id && optional) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(message);
  return id;
}

function voucherIdValues(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error("每笔财务记录必须选择 1 至 20 份已审核凭证");
  return Array.from(new Set(value.map((id) => uuidValue(id, "凭证编号无效") as string)));
}

async function financeWorkbench(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (cleanText(session.operations_role, 40) !== "finance") throw new Error("只有财务账号可以进入财务录入区");
  const store = await selectedStoreInfo(session, payload);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const month = cleanText(payload.month, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) throw new Error("月份无效");
  const start = `${month}-01`;
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);
  const [categories, expenses, pettyCash, payments, monthlyReports, vouchers, uploadedMonthlyReports, employees] = await Promise.all([
    restRowsAll(`zysyr_expense_categories?select=id,code,name,report_section,sort_order,status&company_id=eq.${companyId}&order=status.asc,sort_order.asc,name.asc&limit=1000`, 1000),
    restRowsAll(`zysyr_expense_records?select=id,expense_date,expense_category_id,category,counterparty,summary,amount,payment_method,workflow_status,submitted_at,approved_at,paid_at,daily_report_line_id&company_id=eq.${companyId}&store_id=eq.${storeId}&deleted_at=is.null&expense_date=gte.${start}&expense_date=lt.${end}&order=expense_date.desc,created_at.desc&limit=3000`, 3000),
    restRowsAll(`zysyr_petty_cash_records?select=id,transaction_date,direction,category,summary,amount,status,daily_report_line_id,confirmed_at&company_id=eq.${companyId}&store_id=eq.${storeId}&transaction_date=gte.${start}&transaction_date=lt.${end}&order=transaction_date.desc,created_at.desc&limit=3000`, 3000),
    restRowsAll(`zysyr_payment_records?select=id,payment_date,business_type,business_id,payee,amount,payment_method,payment_reference,status,confirmed_at&company_id=eq.${companyId}&store_id=eq.${storeId}&payment_date=gte.${start}&payment_date=lt.${end}&order=payment_date.desc,created_at.desc&limit=3000`, 3000),
    restRowsAll(`zysyr_monthly_reports?select=id,period_month,version,source_report_id,status,generated_at,reviewed_at,locked_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&period_month=eq.${start}&order=version.desc&limit=100`, 100),
    restRowsAll(`zysyr_voucher_attachments?select=id,original_filename,document_type,audit_status,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&audit_status=eq.approved&order=uploaded_at.desc&limit=2000`, 2000),
    restRowsAll(`zysyr_report_uploads?select=id,report_date,version,original_filename&company_id=eq.${companyId}&store_id=eq.${storeId}&report_type=eq.monthly_profit_loss&status=eq.active&report_date=eq.${start}&order=version.desc&limit=100`, 100),
    restRowsAll(`zysyr_employees?select=id,employee_code,name,position,employment_status&company_id=eq.${companyId}&store_id=eq.${storeId}&deleted_at=is.null&order=employment_status.asc,employee_code.asc&limit=1000`, 1000),
  ]);
  const reportIds = monthlyReports.map((report) => cleanText(report.id, 40));
  const monthlyLines = reportIds.length
    ? await restRowsAll(`zysyr_monthly_report_lines?select=id,monthly_report_id,line_number,metric_code,metric_name,amount,calculation_method,calculation_expression,source_count&company_id=eq.${companyId}&store_id=eq.${storeId}&monthly_report_id=in.${uuidIn(reportIds)}&order=monthly_report_id,line_number.asc&limit=5000`, 5000)
    : [];
  const paidByExpense: Record<string, number> = {};
  for (const payment of payments) {
    if (cleanText(payment.business_type, 30) === "expense" && cleanText(payment.status, 20) === "confirmed") {
      const id = cleanText(payment.business_id, 40);
      paidByExpense[id] = (paidByExpense[id] || 0) + Number(payment.amount || 0);
    }
  }
  return {
    company_id: companyId, store_id: storeId, store: cleanText(store.name, 100), month,
    categories, expenses, petty_cash: pettyCash, payments, monthly_reports: monthlyReports,
    monthly_lines: monthlyLines, approved_vouchers: vouchers,
    uploaded_monthly_reports: uploadedMonthlyReports, employees, paid_by_expense: paidByExpense,
    permissions: {
      create_expense: hasAuthCapability(session, "expense.create_submit"),
      approve_expense: hasAuthCapability(session, "expense.approve"),
      confirm_payment: hasAuthCapability(session, "payment.confirm"),
      lock_report: hasAuthCapability(session, "report.lock"),
      reverse: hasAuthCapability(session, "confirmed_finance.adjust"),
    },
    source_boundary: "finance_uploads_only", meiguanjia_used: false,
  };
}

async function saveExpenseCategory(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireFinanceCapability(session, "expense.create_submit", "当前账号没有支出分类维护权限");
  const store = await selectedStoreInfo(session, payload);
  const id = uuidValue(payload.id, "支出分类编号无效", true);
  const reason = cleanText(payload.reason, 500);
  const saved = await financeRpcSaved("rpc/zysyr_upsert_expense_category", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_id: id, p_code: cleanText(payload.code, 64).toUpperCase(),
    p_name: cleanText(payload.name, 120), p_report_section: cleanText(payload.report_section, 120),
    p_sort_order: Number.isInteger(Number(payload.sort_order)) ? Number(payload.sort_order) : 0,
    p_status: cleanText(payload.status, 20) || "active", p_reason: reason || null,
  });
  return { saved };
}

async function submitExpense(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireFinanceCapability(session, "expense.create_submit", "只有财务账号可以提交正式支出");
  const store = await selectedStoreInfo(session, payload);
  const expenseDate = cleanText(payload.expense_date, 10);
  const reason = cleanText(payload.reason, 500);
  if (!validDate(expenseDate) || !reason || !cleanText(payload.summary, 500)) throw new Error("请完整填写支出日期、摘要和提交原因");
  const saved = await financeRpcSaved("rpc/zysyr_submit_expense", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_expense_date: expenseDate,
    p_expense_category_id: uuidValue(payload.expense_category_id, "请选择支出分类"),
    p_counterparty: cleanText(payload.counterparty, 160), p_summary: cleanText(payload.summary, 500),
    p_amount: amountValue(payload.amount), p_payment_method: cleanText(payload.payment_method, 80),
    p_operator_employee_id: uuidValue(payload.operator_employee_id, "经办员工无效", true),
    p_daily_report_line_id: uuidValue(payload.daily_report_line_id, "日报明细无效", true),
    p_voucher_ids: voucherIdValues(payload.voucher_ids), p_reason: reason,
  });
  return { saved, formal_source: "finance_submitted_expense", cashier_untouched: true, meiguanjia_used: false };
}

async function reviewExpense(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireFinanceCapability(session, "expense.approve", "当前账号没有支出审核权限");
  const store = await selectedStoreInfo(session, payload);
  const decision = cleanText(payload.decision, 20);
  const reason = cleanText(payload.reason, 500);
  if (!["approved", "rejected"].includes(decision) || !reason) throw new Error("请填写支出审核决定和原因");
  const saved = await financeRpcSaved("rpc/zysyr_review_expense", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_expense_id: uuidValue(payload.expense_id, "支出编号无效"),
    p_decision: decision, p_reason: reason,
  });
  return { saved };
}

async function recordPettyCash(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireFinanceCapability(session, "expense.create_submit", "只有财务账号可以登记备用金");
  const store = await selectedStoreInfo(session, payload);
  const date = cleanText(payload.transaction_date, 10);
  const direction = cleanText(payload.direction, 20);
  const reason = cleanText(payload.reason, 500);
  if (!validDate(date) || !["inflow", "outflow"].includes(direction) || !reason) throw new Error("请完整填写备用金日期、方向和原因");
  const saved = await financeRpcSaved("rpc/zysyr_record_petty_cash", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_transaction_date: date, p_direction: direction,
    p_category: cleanText(payload.category, 120), p_summary: cleanText(payload.summary, 500),
    p_amount: amountValue(payload.amount), p_daily_report_line_id: uuidValue(payload.daily_report_line_id, "日报明细无效", true),
    p_voucher_ids: voucherIdValues(payload.voucher_ids), p_reason: reason,
  });
  return { saved };
}

async function confirmExpensePayment(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireFinanceCapability(session, "payment.confirm", "当前账号没有付款确认权限");
  const store = await selectedStoreInfo(session, payload);
  const date = cleanText(payload.payment_date, 10);
  const reason = cleanText(payload.reason, 500);
  if (!validDate(date) || !reason) throw new Error("请完整填写付款日期和确认原因");
  const saved = await financeRpcSaved("rpc/zysyr_confirm_expense_payment", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_expense_id: uuidValue(payload.expense_id, "支出编号无效"),
    p_payment_date: date, p_payee: cleanText(payload.payee, 160), p_amount: amountValue(payload.amount),
    p_payment_method: cleanText(payload.payment_method, 80), p_payment_reference: cleanText(payload.payment_reference, 100) || null,
    p_voucher_ids: voucherIdValues(payload.voucher_ids), p_reason: reason,
  });
  return { saved };
}

async function reverseFinanceRecord(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireFinanceCapability(session, "confirmed_finance.adjust", "当前账号没有已确认财务记录冲销权限");
  const store = await selectedStoreInfo(session, payload);
  const recordType = cleanText(payload.record_type, 40);
  const reason = cleanText(payload.reason, 500);
  if (!["income_record", "expense_record", "petty_cash_record", "payment_record"].includes(recordType) || !reason) throw new Error("冲销类型或原因无效");
  const saved = await financeRpcSaved("rpc/zysyr_reverse_finance_record", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_record_type: recordType,
    p_record_id: uuidValue(payload.record_id, "财务记录编号无效"), p_reason: reason,
  });
  return { saved };
}

async function generateMonthlyReport(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireFinanceCapability(session, "report.lock", "当前账号没有月报生成或锁账权限");
  const store = await selectedStoreInfo(session, payload);
  const month = cleanText(payload.month, 7);
  const reason = cleanText(payload.reason, 500);
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`) || !reason) throw new Error("请选择月份并填写生成原因");
  const saved = await financeRpcSaved("rpc/zysyr_generate_monthly_report", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_period_month: `${month}-01`,
    p_source_report_id: uuidValue(payload.source_report_id, "月报原件编号无效", true), p_reason: reason,
  });
  return { saved, meiguanjia_used: false };
}

async function transitionMonthlyReport(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const action = cleanText(payload.action, 20);
  requireFinanceCapability(session, action === "reverse" ? "confirmed_finance.adjust" : "report.lock", "当前账号没有月报审核、锁账或冲销权限");
  const store = await selectedStoreInfo(session, payload);
  const reason = cleanText(payload.reason, 500);
  if (!["review", "lock", "reverse"].includes(action) || !reason) throw new Error("请选择月报操作并填写原因");
  const saved = await financeRpcSaved("rpc/zysyr_transition_monthly_report", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_monthly_report_id: uuidValue(payload.monthly_report_id, "月报编号无效"),
    p_action: action, p_reason: reason,
  });
  return { saved };
}

async function importExpenses(_payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireFinanceCapability(session, "expense.create_submit", "当前账号没有支出录入权限");
  throw new Error("历史支出不能无凭证批量写入；请在财务录入区逐笔选择已审核凭证后提交");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function excelCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return cleanText(value, 500);
  const record = value as JsonRecord;
  if (record.result !== undefined) return excelCellText(record.result);
  if (record.formula !== undefined) return `=${cleanText(record.formula, 490)}`;
  if (Array.isArray(record.richText)) return cleanText(record.richText.map((part) => cleanText((part as JsonRecord).text, 500)).join(""), 500);
  if (record.text !== undefined) return cleanText(record.text, 500);
  if (record.hyperlink !== undefined) return cleanText(record.hyperlink, 500);
  if (record.error !== undefined) return cleanText(record.error, 500);
  return cleanText(value, 500);
}

function mergeCoordinates(text: string): JsonRecord {
  const parts = text.split(":");
  function cell(value: string): { row: number; column: number } {
    const match = value.match(/^([A-Z]+)(\d+)$/i);
    if (!match) return { row: 1, column: 1 };
    let column = 0;
    for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
    return { row: Number(match[2]), column };
  }
  const from = cell(parts[0]);
  const to = cell(parts[1] || parts[0]);
  return { start_row: from.row - 1, start_col: from.column - 1, end_row: to.row - 1, end_col: to.column - 1 };
}

function columnLetters(column: number): string {
  let value = column;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function numericCellValue(value: unknown): number | null {
  const resolved = value && typeof value === "object" && (value as JsonRecord).result !== undefined
    ? (value as JsonRecord).result
    : value;
  if (typeof resolved === "number" && Number.isFinite(resolved)) return Number(resolved.toFixed(4));
  return null;
}

function formulaCellText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as JsonRecord;
  return cleanText(record.formula ?? record.sharedFormula, 2000);
}

function formulaPrecedents(formula: string, sheetName: string): string[] {
  if (!formula || formula.includes("#REF!")) return [];
  const found = new Set<string>();
  const pattern = /(?:(?:'([^']+)'|([A-Za-z0-9_\u4e00-\u9fff]+))!)?\$?([A-Z]{1,3})\$?([1-9][0-9]{0,3})(?::\$?([A-Z]{1,3})\$?([1-9][0-9]{0,3}))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(formula.toUpperCase())) !== null) {
    if (formula.slice(match.index + match[0].length).startsWith("(")) continue;
    const referencedSheet = cleanText(match[1] || match[2], 120);
    if (referencedSheet && referencedSheet !== sheetName.toUpperCase()) continue;
    const start = mergeCoordinates(`${match[3]}${match[4]}:${match[5] || match[3]}${match[6] || match[4]}`);
    const startRow = Number(start.start_row) + 1;
    const endRow = Number(start.end_row) + 1;
    const startColumn = Number(start.start_col) + 1;
    const endColumn = Number(start.end_col) + 1;
    if ((endRow - startRow + 1) * (endColumn - startColumn + 1) > 500) continue;
    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) found.add(`${columnLetters(column)}${row}`);
    }
  }
  return Array.from(found);
}

function reportCellLabel(values: string[][], row: number, column: number): string {
  const parts: string[] = [];
  for (let cursor = column - 1; cursor >= Math.max(1, column - 6); cursor -= 1) {
    const value = cleanText(values[row - 1]?.[cursor - 1], 120);
    if (value && !/^-?\d+(?:\.\d+)?$/.test(value) && !parts.includes(value)) parts.unshift(value);
    if (parts.length >= 2) break;
  }
  for (let cursor = row - 1; cursor >= Math.max(1, row - 15); cursor -= 1) {
    const value = cleanText(values[cursor - 1]?.[column - 1], 120);
    if (value && !/^-?\d+(?:\.\d+)?$/.test(value) && !parts.includes(value)) {
      parts.push(value);
      break;
    }
  }
  return cleanText(parts.join(" / "), 300);
}

async function workbookDisplay(bytes: Uint8Array, reportType: string, storeName = ""): Promise<JsonRecord> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(exactArrayBuffer(bytes));
  } catch {
    throw new Error("Excel 文件无法识别，请确认文件未损坏且为 XLSX 格式");
  }
  const preferred = reportType === "monthly_profit_loss"
    ? ["模版", "模板", "月盈亏统计"]
    : reportType === "salary"
      ? ["工资", "工资表", "工资明细"]
    : reportType === "performance"
      ? (/向里/.test(storeName) ? ["向里业绩报表", "业绩报表"] : ["业绩报表", "向里业绩报表"])
      : ["日报", "日报表"];
  const sheet = preferred.map((name) => workbook.getWorksheet(name)).find(Boolean) || workbook.worksheets[0];
  if (!sheet) throw new Error("Excel 文件中没有可读取的工作表");
  const sheetName = cleanText(sheet.name, 120);
  const rowCount = sheet.actualRowCount || sheet.rowCount || 1;
  const columnCount = sheet.actualColumnCount || sheet.columnCount || 1;
  if (rowCount > 120 || columnCount > 30) throw new Error("报表范围过大，最多支持 120 行、30 列");
  const values = Array.from({ length: rowCount }, () => Array(columnCount).fill(""));
  for (let row = 1; row <= rowCount; row += 1) {
    for (let column = 1; column <= columnCount; column += 1) {
      values[row - 1][column - 1] = excelCellText(sheet.getCell(row, column).value);
    }
  }
  const cells: JsonRecord[] = [];
  for (let row = 1; row <= rowCount; row += 1) {
    for (let column = 1; column <= columnCount; column += 1) {
      const source = sheet.getCell(row, column).value;
      const formula = formulaCellText(source);
      const numericValue = numericCellValue(source);
      if (numericValue === null && !formula) continue;
      const address = `${columnLetters(column)}${row}`;
      const label = reportCellLabel(values, row, column);
      const numberFormat = cleanText(sheet.getCell(row, column).numFmt, 80).toLowerCase();
      if (!formula && (/(编号|序号|员工号|日期)/.test(label) || /(^|[^a-z])[ymdhis]+([^a-z]|$)/.test(numberFormat))) continue;
      cells.push({
        sheet_name: sheetName,
        cell_address: address,
        row_number: row,
        column_number: column,
        cell_kind: formula ? "formula" : "input",
        display_value: values[row - 1][column - 1],
        numeric_value: numericValue,
        formula: formula || null,
        precedent_addresses: formulaPrecedents(formula, sheetName),
        label,
      });
    }
  }
  if (!cells.length) throw new Error("Excel 中没有可追溯的数字或公式单元格");
  const model = sheet.model as unknown as JsonRecord;
  const merges = (Array.isArray(model.merges) ? model.merges : []).map((merge) => mergeCoordinates(cleanText(merge, 40)));
  const rangeText = `A1:${sheet.getCell(rowCount, columnCount).address}`;
  return { sheet_name: sheetName, range: rangeText, rows: rowCount, columns: columnCount, values, merges, cells };
}

function reportDateValue(payload: JsonRecord, reportType: string): string {
  const raw = cleanText(payload.report_date, 10);
  if (reportType === "monthly_profit_loss" || reportType === "salary") {
    const month = /^\d{4}-\d{2}$/.test(raw) ? raw : cleanText(payload.month, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("请选择月报月份");
    return `${month}-01`;
  }
  if (!validDate(raw)) throw new Error("请选择报表日期");
  return raw;
}

async function uploadReport(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!canUploadReports(session)) throw new Error("只有财务账号可以上传门店报表");
  const store = await selectedStoreInfo(session, payload);
  const reportType = cleanText(payload.report_type, 40);
  if (!["daily", "performance", "salary", "monthly_profit_loss"].includes(reportType)) throw new Error("报表类型无效");
  const reportDate = reportDateValue(payload, reportType);
  const filename = cleanText(payload.filename, 200);
  const mime = cleanText(payload.mime_type, 120);
  if (mime !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    throw new Error("日报、业绩表、工资表和月度盈亏表请上传 XLSX 文件");
  }
  let bytes: Uint8Array;
  try { bytes = decodeBase64(cleanText(payload.base64, 15000000)); } catch { throw new Error("报表文件内容无效"); }
  if (!bytes.length || bytes.length > MAX_REPORT_BYTES) throw new Error("报表文件必须小于 10MB");
  const displayData = await workbookDisplay(bytes, reportType, cleanText(store.name, 100));
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const accountId = cleanText(session.auth_account_id, 40);
  if (!companyId || !storeId || !accountId) throw new Error("财务账号公司、门店或身份范围无效");
  const extension = "xlsx";
  const objectPath = `${companyId}/${storeId}/${reportType}/${reportDate}/${crypto.randomUUID()}.${extension}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${REPORT_BUCKET}/${storagePath(objectPath)}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": mime, "x-upsert": "false" },
    body: exactArrayBuffer(bytes),
  });
  if (!upload.ok) throw new Error(`报表原件上传失败 (${upload.status})`);
  const metadata = await rest("rpc/zysyr_register_report_upload", {
    method: "POST",
    body: JSON.stringify({
      p_report: {
        company_id: companyId, store_id: storeId, report_type: reportType, report_date: reportDate,
        template_code: reportType === "monthly_profit_loss" ? "zysyr_monthly_profit_loss_original" : `zysyr_${reportType}_original`,
        template_version: 1, original_filename: filename || `report.${extension}`, mime_type: mime,
        size_bytes: bytes.length, sha256: await sha256Bytes(bytes), bucket_id: REPORT_BUCKET,
        object_path: objectPath, display_data: displayData, uploaded_by_user_id: accountId,
      },
      p_cells: Array.isArray(displayData.cells) ? displayData.cells : [],
    }),
  });
  if (!metadata.ok) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${REPORT_BUCKET}/${storagePath(objectPath)}`, {
      method: "DELETE", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    throw new Error(`报表登记失败 (${metadata.status})`);
  }
  const saved = await metadata.json() as JsonRecord;
  return { saved, source_boundary: "finance_uploads_only", original_private: true };
}

function uuidArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("追溯选择数量无效");
  const items = value.map((item) => cleanText(item, 40));
  if (items.some((item) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item))) {
    throw new Error("追溯记录标识无效");
  }
  return Array.from(new Set(items));
}

async function reportCells(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStoreInfo(session, payload);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const reportId = cleanText(payload.report_id, 40);
  const reports = await restRows(`zysyr_report_uploads?select=id,report_type,report_date,version,original_filename,uploaded_by_user_id,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${encodeURIComponent(reportId)}&limit=1`);
  const report = reports[0];
  if (!report) throw new Error("报表不存在或无权访问");
  const [cells, vouchers, uploaders] = await Promise.all([
    restRowsAll(`zysyr_report_cells?select=id,sheet_name,cell_address,row_number,column_number,cell_kind,display_value,numeric_value,formula,label&company_id=eq.${companyId}&store_id=eq.${storeId}&report_id=eq.${reportId}&order=row_number.asc,column_number.asc`, 5000),
    restRowsAll(`zysyr_voucher_attachments?select=id,original_filename,mime_type,note,uploaded_by,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&record_type=eq.report&record_id=eq.${reportId}&order=uploaded_at.asc`, 1000),
    restRows(`zysyr_user_accounts?select=id,login_name,display_name&id=eq.${cleanText(report.uploaded_by_user_id, 40)}&limit=1`),
  ]);
  return { report: { ...report, uploaded_by: uploaders[0] || null }, cells, vouchers };
}

async function cellTrace(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStoreInfo(session, payload);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const reportId = cleanText(payload.report_id, 40);
  const address = cleanText(payload.cell_address, 20).toUpperCase();
  const reports = await restRows(`zysyr_report_uploads?select=id,report_type,report_date,version,original_filename,uploaded_by_user_id,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${reportId}&limit=1`);
  const report = reports[0];
  if (!report) throw new Error("月报不存在或无权访问");
  const cells = await restRows(`zysyr_report_cells?select=id,sheet_name,cell_address,row_number,column_number,cell_kind,display_value,numeric_value,formula,precedent_addresses,label&company_id=eq.${companyId}&store_id=eq.${storeId}&report_id=eq.${reportId}&cell_address=eq.${encodeURIComponent(address)}&limit=1`);
  const target = cells[0];
  if (!target) throw new Error("该位置不是可追溯的金额或公式单元格");
  const uploaderRows = await restRows(`zysyr_user_accounts?select=id,login_name,display_name&id=eq.${cleanText(report.uploaded_by_user_id, 40)}&limit=1`);
  const result: JsonRecord = { target, report: { ...report, uploaded_by: uploaderRows[0] || null }, can_edit: canUploadReports(session) };

  if (cleanText(target.cell_kind, 20) === "formula") {
    const precedents = Array.isArray(target.precedent_addresses) ? target.precedent_addresses as unknown[] : [];
    const addresses = precedents.map((item) => cleanText(item, 20)).filter((item) => /^[A-Z]{1,3}[1-9][0-9]{0,3}$/.test(item));
    const addressFilter = addresses.length ? `(${addresses.join(",")})` : "()";
    const sourceCells = addressFilter === "()" ? [] : await restRowsAll(`zysyr_report_cells?select=id,cell_address,cell_kind,display_value,numeric_value,formula,label&company_id=eq.${companyId}&report_id=eq.${reportId}&cell_address=in.${addressFilter}&order=row_number.asc,column_number.asc`, 1000);
    const sourceFilter = uuidIn(sourceCells.map((cell) => cell.id));
    const revisions = sourceFilter === "()" ? [] : await restRowsAll(`zysyr_report_cell_trace_revisions?select=target_cell_id,revision,status,source_amount,delta,evidence_count&company_id=eq.${companyId}&target_cell_id=in.${sourceFilter}&order=revision.desc`, 2000);
    const revisionMap = new Map<string, JsonRecord>();
    for (const revision of revisions) {
      const key = cleanText(revision.target_cell_id, 40);
      if (!revisionMap.has(key)) revisionMap.set(key, revision);
    }
    result.mode = "formula";
    result.precedents = sourceCells.map((cell) => ({ ...cell, trace: revisionMap.get(cleanText(cell.id, 40)) || null }));
    return result;
  }

  const revisions = await restRows(`zysyr_report_cell_trace_revisions?select=id,revision,expected_amount,source_amount,delta,status,source_count,evidence_count,created_by_user_id,created_at&company_id=eq.${companyId}&target_cell_id=eq.${cleanText(target.id, 40)}&order=revision.desc&limit=1`);
  const revision = revisions[0] || null;
  const sources: JsonRecord[] = [];
  let evidence: JsonRecord[] = [];
  if (revision) {
    const [sourceLinks, evidenceLinks] = await Promise.all([
      restRowsAll(`zysyr_report_cell_trace_sources?select=source_cell_id,source_amount&company_id=eq.${companyId}&trace_revision_id=eq.${cleanText(revision.id, 40)}&limit=500`, 500),
      restRowsAll(`zysyr_report_cell_trace_evidence?select=voucher_id&company_id=eq.${companyId}&trace_revision_id=eq.${cleanText(revision.id, 40)}&limit=200`, 200),
    ]);
    const sourceFilter = uuidIn(sourceLinks.map((link) => link.source_cell_id));
    const sourceCells = sourceFilter === "()" ? [] : await restRowsAll(`zysyr_report_cells?select=id,report_id,sheet_name,cell_address,row_number,column_number,cell_kind,display_value,numeric_value,formula,label&company_id=eq.${companyId}&store_id=eq.${storeId}&id=in.${sourceFilter}&limit=500`, 500);
    const sourceReportFilter = uuidIn(sourceCells.map((cell) => cell.report_id));
    const sourceReports = sourceReportFilter === "()" ? [] : await restRowsAll(`zysyr_report_uploads?select=id,report_type,report_date,version,original_filename,uploaded_by_user_id,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&id=in.${sourceReportFilter}&limit=500`, 500);
    const sourceUploaderFilter = uuidIn(sourceReports.map((item) => item.uploaded_by_user_id));
    const sourceUploaders = sourceUploaderFilter === "()" ? [] : await restRowsAll(`zysyr_user_accounts?select=id,login_name,display_name&id=in.${sourceUploaderFilter}&limit=500`, 500);
    const reportMap = new Map(sourceReports.map((item) => [cleanText(item.id, 40), item]));
    const accountMap = new Map(sourceUploaders.map((item) => [cleanText(item.id, 40), item]));
    for (const cell of sourceCells) {
      const sourceReport = reportMap.get(cleanText(cell.report_id, 40)) || {};
      sources.push({ ...cell, report: { ...sourceReport, uploaded_by: accountMap.get(cleanText(sourceReport.uploaded_by_user_id, 40)) || null } });
    }
    const evidenceFilter = uuidIn(evidenceLinks.map((link) => link.voucher_id));
    evidence = evidenceFilter === "()" ? [] : await restRowsAll(`zysyr_voucher_attachments?select=id,record_id,original_filename,mime_type,note,uploaded_by,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&id=in.${evidenceFilter}&limit=200`, 200);
  }
  result.mode = "input";
  result.revision = revision;
  result.sources = sources;
  result.evidence = evidence;
  return result;
}

async function saveCellTrace(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!canUploadReports(session)) throw new Error("只有财务账号可以设置月报数字追溯");
  const store = await selectedStoreInfo(session, payload);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const targetCellId = cleanText(payload.target_cell_id, 40);
  const actorId = cleanText(session.auth_account_id, 40);
  const target = await restRows(`zysyr_report_cells?select=id&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${targetCellId}&limit=1`);
  if (!target.length || !actorId) throw new Error("目标单元格或财务身份无效");
  const response = await rest("rpc/zysyr_save_report_cell_trace", {
    method: "POST",
    body: JSON.stringify({
      p_target_cell_id: targetCellId,
      p_source_cell_ids: uuidArray(payload.source_cell_ids, 500),
      p_voucher_ids: uuidArray(payload.voucher_ids, 200),
      p_actor_user_id: actorId,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as JsonRecord;
    throw new Error(cleanText(error.message ?? error.error, 500) || `追溯保存失败 (${response.status})`);
  }
  const saved = await response.json();
  return { saved };
}

async function reportUrl(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStoreInfo(session, payload);
  const reportId = cleanText(payload.report_id, 80);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const rows = await restRows(`zysyr_report_uploads?select=id,object_path,original_filename&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${encodeURIComponent(reportId)}&limit=1`);
  const report = rows[0];
  if (!report) throw new Error("报表不存在或无权访问");
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${REPORT_BUCKET}/${storagePath(cleanText(report.object_path, 500))}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  if (!response.ok) throw new Error(`报表链接生成失败 (${response.status})`);
  const signed = await response.json();
  const signedPath = cleanText(signed.signedURL ?? signed.signedUrl, 2000);
  if (!signedPath) throw new Error("报表链接生成失败");
  return { url: signedPath.startsWith("http") ? signedPath : `${SUPABASE_URL}/storage/v1${signedPath}`, expires_in: 300, filename: report.original_filename };
}

function storagePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function uploadVoucher(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStoreInfo(session, payload);
  const recordType = cleanText(payload.record_type, 20) || "unassigned";
  const recordId = cleanText(payload.record_id, 100);
  const filename = cleanText(payload.filename, 200);
  const mime = cleanText(payload.mime_type, 80);
  if (!canUploadVouchers(session)) throw new Error("只有财务账号可以上传凭证");
  if (!["unassigned", "report"].includes(recordType)
    || (recordType === "report" && !/^[0-9a-f-]{36}$/i.test(recordId))
    || (recordType === "unassigned" && recordId)) throw new Error("凭证关联记录无效");
  if (!["image/jpeg", "image/png", "application/pdf"].includes(mime)) throw new Error("凭证仅支持 JPG、PNG 或 PDF");
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  if (recordType === "report") {
    const reports = await restRows(`zysyr_report_uploads?select=id&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${encodeURIComponent(recordId)}&limit=1`);
    if (!reports.length) throw new Error("报表不存在或无权关联消费凭证");
  }
  let bytes: Uint8Array;
  try { bytes = decodeBase64(cleanText(payload.base64, 15000000)); } catch { throw new Error("凭证文件内容无效"); }
  if (!bytes.length || bytes.length > MAX_VOUCHER_BYTES) throw new Error("凭证文件必须小于 10MB");
  const digest = await sha256Bytes(bytes);
  const duplicates = await restRows(`zysyr_voucher_attachments?select=id,original_filename&company_id=eq.${companyId}&sha256=eq.${digest}&limit=1`);
  if (duplicates.length) throw new Error(`该文件已上传：${cleanText(duplicates[0].original_filename, 200) || "同一凭证"}`);
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const voucherId = crypto.randomUUID();
  const objectPath = `${companyId}/${storeId}/voucher-center/${new Date().toISOString().slice(0, 10)}/${voucherId}.${extension}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${VOUCHER_BUCKET}/${storagePath(objectPath)}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": mime, "x-upsert": "false" },
    body: exactArrayBuffer(bytes),
  });
  if (!upload.ok) throw new Error(`凭证上传失败 (${upload.status})`);
  const metadata = await rest("rpc/zysyr_register_voucher", {
    method: "POST",
    body: JSON.stringify({
      p_actor_user_id: cleanText(session.auth_account_id, 40),
      p_company_id: companyId,
      p_store_id: storeId,
      p_id: voucherId,
      p_record_type: recordType,
      p_record_id: recordId || null,
      p_object_path: objectPath,
      p_original_filename: filename || `voucher.${extension}`,
      p_mime_type: mime,
      p_size_bytes: bytes.length,
      p_sha256: digest,
      p_note: cleanText(payload.note, 500),
    }),
  });
  if (!metadata.ok) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${VOUCHER_BUCKET}/${storagePath(objectPath)}`, {
      method: "DELETE", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const error = await metadata.json().catch(() => ({})) as JsonRecord;
    const code = cleanText(error.message ?? error.code, 120);
    if (code === "VOUCHER_DUPLICATE_FILE" || cleanText(error.code, 20) === "23505") throw new Error("相同凭证已经上传，请直接关联已有凭证");
    if (code === "VOUCHER_UPLOAD_FORBIDDEN") throw new Error("当前账号没有凭证上传权限");
    throw new Error(`凭证登记失败 (${metadata.status})`);
  }
  const result = await metadata.json();
  return { saved: Array.isArray(result) ? result[0] : result, private: true, ocr_candidate_only: true };
}

async function voucherCenter(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "voucher.read")) throw new Error("当前账号没有凭证查看权限");
  const store = await selectedStoreInfo(session, payload);
  const month = cleanText(payload.month, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份无效");
  const start = `${month}-01`;
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const vouchers = await restRowsAll(`zysyr_voucher_attachments?select=id,record_type,record_id,original_filename,mime_type,size_bytes,note,sha256,ocr_status,audit_status,document_type,uploaded_by_user_id,uploaded_at,reviewed_by_user_id,reviewed_at&company_id=eq.${companyId}&store_id=eq.${storeId}&uploaded_at=gte.${start}T00:00:00Z&uploaded_at=lt.${end}T00:00:00Z&order=uploaded_at.desc&limit=2000`, 2000);
  const voucherFilter = uuidIn(vouchers.map((voucher) => voucher.id));
  const [tasks, reviews, links, reports] = await Promise.all([
    voucherFilter === "()" ? [] : restRowsAll(`zysyr_voucher_ocr_tasks?select=id,voucher_id,provider,status,attempt,candidate_fields,field_confidences,error_message,queued_at,started_at,completed_at&company_id=eq.${companyId}&voucher_id=in.${voucherFilter}&order=attempt.desc&limit=4000`, 4000),
    voucherFilter === "()" ? [] : restRowsAll(`zysyr_voucher_reviews?select=id,voucher_id,review_version,decision,document_type,candidate_fields,corrected_fields,field_confidences,reason,reviewer_user_id,reviewed_at&company_id=eq.${companyId}&voucher_id=in.${voucherFilter}&order=review_version.desc&limit=4000`, 4000),
    voucherFilter === "()" ? [] : restRowsAll(`zysyr_voucher_links?select=id,voucher_id,business_type,business_id,relation_type,linked_by_user_id,linked_at&company_id=eq.${companyId}&store_id=eq.${storeId}&voucher_id=in.${voucherFilter}&unlinked_at=is.null&limit=4000`, 4000),
    restRowsAll(`zysyr_report_uploads?select=id,report_type,report_date,version,original_filename&company_id=eq.${companyId}&store_id=eq.${storeId}&report_date=gte.${start}&report_date=lt.${end}&order=report_date.desc,version.desc&limit=1000`, 1000),
  ]);
  const accountFilter = uuidIn(vouchers.flatMap((voucher) => [voucher.uploaded_by_user_id, voucher.reviewed_by_user_id]));
  const accounts = accountFilter === "()" ? [] : await restRowsAll(`zysyr_user_accounts?select=id,login_name,display_name&company_id=eq.${companyId}&id=in.${accountFilter}&limit=1000`, 1000);
  const accountMap = new Map(accounts.map((account) => [cleanText(account.id, 40), account]));
  const latestTask = new Map<string, JsonRecord>();
  for (const task of tasks) if (!latestTask.has(cleanText(task.voucher_id, 40))) latestTask.set(cleanText(task.voucher_id, 40), task);
  const latestReview = new Map<string, JsonRecord>();
  for (const review of reviews) if (!latestReview.has(cleanText(review.voucher_id, 40))) latestReview.set(cleanText(review.voucher_id, 40), review);
  const linkMap = new Map<string, JsonRecord[]>();
  for (const link of links) {
    const key = cleanText(link.voucher_id, 40);
    linkMap.set(key, [...(linkMap.get(key) || []), link]);
  }
  return {
    vouchers: vouchers.map((voucher) => ({
      ...voucher,
      uploaded_by: accountMap.get(cleanText(voucher.uploaded_by_user_id, 40)) || null,
      reviewed_by: accountMap.get(cleanText(voucher.reviewed_by_user_id, 40)) || null,
      latest_ocr_task: latestTask.get(cleanText(voucher.id, 40)) || null,
      latest_review: latestReview.get(cleanText(voucher.id, 40)) || null,
      links: linkMap.get(cleanText(voucher.id, 40)) || [],
    })),
    reports,
    can_upload: canUploadVouchers(session),
    can_review: canReviewVouchers(session),
    ocr_provider_configured: Boolean(Deno.env.get("SILICONFLOW_API_KEY")),
  };
}

async function retryVoucherOcr(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!canReviewVouchers(session)) throw new Error("只有当前门店财务账号可以重新发起 OCR");
  const store = await selectedStoreInfo(session, payload);
  const voucherId = uuidValue(payload.voucher_id, "凭证无效");
  const reason = cleanText(payload.reason, 500);
  if (!reason) throw new Error("请填写重新识别原因");
  const saved = await financeRpcSaved("rpc/zysyr_retry_voucher_ocr", {
    p_actor_user_id: cleanText(session.auth_account_id, 40),
    p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40),
    p_voucher_id: voucherId,
    p_reason: reason,
  });
  return { saved, candidate_only: true, human_review_required: true };
}

async function reviewVoucher(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!canReviewVouchers(session)) throw new Error("只有财务账号可以审核凭证");
  const store = await selectedStoreInfo(session, payload);
  const voucherId = cleanText(payload.voucher_id, 40);
  const decision = cleanText(payload.decision, 20);
  const documentType = cleanText(payload.document_type, 40);
  const reportIds = uuidArray(payload.report_ids ?? [], 100);
  const reason = cleanText(payload.reason, 500);
  if (!/^[0-9a-f-]{36}$/i.test(voucherId) || !["approved", "rejected"].includes(decision) || !reason) throw new Error("请完整填写审核决定和原因");
  const corrected = payload.corrected_fields && typeof payload.corrected_fields === "object" && !Array.isArray(payload.corrected_fields)
    ? payload.corrected_fields as JsonRecord : {};
  const confidences = payload.field_confidences && typeof payload.field_confidences === "object" && !Array.isArray(payload.field_confidences)
    ? payload.field_confidences as JsonRecord : {};
  const response = await rest("rpc/zysyr_review_voucher", {
    method: "POST",
    body: JSON.stringify({
      p_actor_user_id: cleanText(session.auth_account_id, 40),
      p_company_id: cleanText(store.company_id, 40),
      p_store_id: cleanText(store.id, 40),
      p_voucher_id: voucherId,
      p_decision: decision,
      p_document_type: documentType,
      p_corrected_fields: corrected,
      p_field_confidences: confidences,
      p_report_ids: reportIds,
      p_reason: reason,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = result && typeof result === "object" ? result as JsonRecord : {};
    const code = cleanText(error.message ?? error.code, 120);
    if (code === "VOUCHER_REVIEW_FORBIDDEN") throw new Error("当前账号没有凭证审核权限");
    if (code === "REPORT_NOT_FOUND") throw new Error("关联报表不存在或不属于当前门店");
    if (/_INVALID$/.test(code)) throw new Error("凭证审核字段无效");
    throw new Error(`凭证审核失败 (${response.status})`);
  }
  return { saved: Array.isArray(result) ? result[0] : result };
}

async function financeRpcSaved(path: string, body: JsonRecord): Promise<JsonRecord> {
  const response = await rest(path, { method: "POST", body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" ? data as JsonRecord : {};
    const code = cleanText(error.message ?? error.code, 160);
    if (code === "FINANCE_SCOPE_FORBIDDEN") throw new Error("只有当前门店财务账号可以维护正式财务记录");
    if (code === "FINANCE_PERIOD_LOCKED") throw new Error("该月份已锁账，不能继续修改");
    if (code === "APPROVED_DAILY_REPORT_REQUIRES_REVERSAL") throw new Error("已审核日报不能覆盖，必须先走冲销流程");
    if (code === "DAILY_SOURCE_REPORT_NOT_FOUND") throw new Error("日报原件不存在、已被替代或不属于当前门店");
    if (code === "DAILY_REPORT_SOURCE_CELL_NOT_FOUND") throw new Error("日报数字没有对应到当前原表单元格");
    if (code === "APPROVED_VOUCHER_NOT_FOUND") throw new Error("凭证尚未人工审核通过或不属于当前门店");
    if (code === "APPROVED_VOUCHER_REQUIRED") throw new Error("每笔正式财务记录必须关联已审核凭证");
    if (code === "PAYMENT_EXCEEDS_EXPENSE") throw new Error("本次付款会超过支出金额");
    if (code === "EXPENSE_HAS_CONFIRMED_PAYMENT") throw new Error("该支出已有确认付款，请先冲销付款记录");
    if (code === "MONTHLY_TRANSITION_NOT_ALLOWED") throw new Error("月报当前状态不允许执行此操作");
    if (code === "CURRENT_MONTHLY_REPORT_EXISTS") throw new Error("本月已有未冲销的正式月报，请先完成或冲销现有版本");
    if (code === "FINANCE_BUSINESS_RECORD_NOT_FOUND") throw new Error("正式财务记录不存在或不属于当前门店");
    if (code === "PERFORMANCE_HAIRSTYLIST_ONLY") throw new Error("只有岗位为发型师的员工才能计入业绩和提成");
    if (code === "COMMISSION_RULE_REQUIRED") throw new Error("该员工本月业绩没有可用的提成规则，请先维护规则");
    if (code === "COMMISSION_RULE_AMBIGUOUS") throw new Error("同一业绩匹配到多条提成规则，请先停用重复规则");
    if (code === "SALARY_CONFIRMED_REVERSE_REQUIRED") throw new Error("已审核或已支付工资不能覆盖，必须先冲销");
    if (code === "SALARY_REVERSE_REQUIRED") throw new Error("该记录已进入已确认工资，请先冲销工资");
    if (code === "PAYROLL_DEPENDENCY_REVERSE_FIRST") throw new Error("该考勤已关联奖罚，请先冲销奖罚记录");
    if (code === "SALARY_TRANSITION_NOT_ALLOWED") throw new Error("工资当前状态不允许执行此操作");
    if (code === "INVENTORY_SCOPE_FORBIDDEN") throw new Error("当前账号没有该门店采购和库存维护权限");
    if (code === "INSUFFICIENT_INVENTORY") throw new Error("当前结存不足，不能消耗、报损或员工自购");
    if (code === "RECEIPT_EXCEEDS_ORDER") throw new Error("累计到货数量不能超过采购数量");
    if (code === "PURCHASE_ORDER_NOT_APPROVED") throw new Error("采购单尚未批准，不能办理入库");
    if (code === "PURCHASE_ORDER_TRANSITION_INVALID") throw new Error("采购单当前状态不允许执行此操作");
    if (code === "PAYMENT_EXCEEDS_PURCHASE_ORDER") throw new Error("本次付款会超过采购单金额");
    if (code === "PAYMENT_EXCEEDS_EMPLOYEE_PURCHASE") throw new Error("本次收款会超过员工自购应收金额");
    if (code === "INVENTORY_REVERSAL_REQUIRES_LATEST_TRANSACTION") throw new Error("该产品之后已有库存变动，请从最新一笔开始冲销");
    if (code === "EMPLOYEE_PURCHASE_HAS_PAYMENT") throw new Error("员工自购已有确认收款，请先冲销收款记录");
    if (/_INVALID$|_REQUIRED$/.test(code)) throw new Error("正式财务记录字段不完整或格式无效");
    if (/_NOT_FOUND$/.test(code)) throw new Error("正式财务记录不存在或不属于当前门店");
    throw new Error(`正式财务记录保存失败 (${response.status})`);
  }
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved || typeof saved !== "object") throw new Error("正式财务记录保存结果无效");
  return saved as JsonRecord;
}

async function saveDailyReport(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (cleanText(session.operations_role, 40) !== "finance" || !hasAuthCapability(session, "daily_report.write")) {
    throw new Error("只有财务账号可以提交正式日报");
  }
  const store = await selectedStoreInfo(session, payload);
  const sourceReportId = cleanText(payload.source_report_id, 40);
  const reason = cleanText(payload.reason, 500);
  if (!/^[0-9a-f-]{36}$/i.test(sourceReportId) || !reason) throw new Error("请选择日报原件并填写提交原因");
  if (!Array.isArray(payload.lines) || !payload.lines.length || payload.lines.length > 500) throw new Error("日报明细必须为 1 至 500 行");
  const lines = (payload.lines as JsonRecord[]).map((line) => {
    const lineType = cleanText(line.line_type, 30);
    const metricCode = cleanText(line.metric_code, 64).toUpperCase();
    const description = cleanText(line.description, 300);
    const sourceCellId = cleanText(line.source_report_cell_id, 40);
    if (!["income", "expense", "petty_cash", "payment", "note"].includes(lineType)
      || !/^[A-Z][A-Z0-9_]{1,63}$/.test(metricCode) || !description) throw new Error("日报明细类型、指标或说明无效");
    if (lineType === "note") return { line_type: lineType, metric_code: metricCode, description };
    if (!/^[0-9a-f-]{36}$/i.test(sourceCellId)) throw new Error("每个日报数字都必须选择原表单元格");
    return {
      line_type: lineType,
      metric_code: metricCode,
      description,
      amount: amountValue(line.amount),
      quantity: quantityValue(line.quantity),
      source_report_cell_id: sourceCellId,
    };
  });
  const businessDay = typeof payload.is_business_day === "boolean" ? payload.is_business_day : null;
  const saved = await financeRpcSaved("rpc/zysyr_save_daily_report", {
    p_actor_user_id: cleanText(session.auth_account_id, 40),
    p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40),
    p_source_report_id: sourceReportId,
    p_is_business_day: businessDay,
    p_lines: lines,
    p_reason: reason,
  });
  return { saved, formal_source: "finance_uploaded_daily_report", meiguanjia_used: false };
}

async function reviewDailyReport(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (cleanText(session.operations_role, 40) !== "finance" || !hasAuthCapability(session, "daily_report.write")) {
    throw new Error("只有财务账号可以审核正式日报");
  }
  const store = await selectedStoreInfo(session, payload);
  const reportId = cleanText(payload.daily_report_id, 40);
  const decision = cleanText(payload.decision, 20);
  const reason = cleanText(payload.reason, 500);
  if (!/^[0-9a-f-]{36}$/i.test(reportId) || !["approved", "rejected"].includes(decision) || !reason) {
    throw new Error("请完整填写日报审核决定和原因");
  }
  const saved = await financeRpcSaved("rpc/zysyr_review_daily_report", {
    p_actor_user_id: cleanText(session.auth_account_id, 40),
    p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40),
    p_daily_report_id: reportId,
    p_decision: decision,
    p_reason: reason,
  });
  return { saved, approved_income_materialized: decision === "approved", meiguanjia_used: false };
}

async function linkFinanceVoucher(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (cleanText(session.operations_role, 40) !== "finance" || !hasAuthCapability(session, "voucher.review")) {
    throw new Error("只有财务账号可以关联正式记录与凭证");
  }
  const store = await selectedStoreInfo(session, payload);
  const voucherId = cleanText(payload.voucher_id, 40);
  const businessId = cleanText(payload.business_id, 40);
  const businessType = cleanText(payload.business_type, 40);
  const relationType = cleanText(payload.relation_type, 30) || "evidence";
  const reason = cleanText(payload.reason, 500);
  if (!/^[0-9a-f-]{36}$/i.test(voucherId) || !/^[0-9a-f-]{36}$/i.test(businessId) || !reason) {
    throw new Error("请选择凭证、正式记录并填写关联原因");
  }
  const saved = await financeRpcSaved("rpc/zysyr_link_finance_voucher", {
    p_actor_user_id: cleanText(session.auth_account_id, 40),
    p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40),
    p_voucher_id: voucherId,
    p_business_type: businessType,
    p_business_id: businessId,
    p_relation_type: relationType,
    p_reason: reason,
  });
  return { saved };
}

function requirePayrollRead(session: JsonRecord): void {
  const role = cleanText(session.operations_role, 40);
  const selfEmployee = role === "employee" && /^[0-9a-f-]{36}$/i.test(cleanText(session.auth_employee_id, 40));
  if (!selfEmployee && !hasAuthCapability(session, "salary.read")) {
    throw new Error("当前账号没有工资查看权限");
  }
}

function requirePayrollWrite(session: JsonRecord): void {
  requireFinanceCapability(session, "salary.write_approve", "只有财务账号可以维护、审核和支付工资");
}

async function payrollCenter(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollRead(session);
  const store = await selectedStoreInfo(session, payload);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const month = cleanText(payload.month, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) throw new Error("月份无效");
  const start = `${month}-01`;
  const endDate = new Date(`${start}T00:00:00Z`); endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);
  const employeeId = cleanText(session.operations_role, 40) === "employee"
    ? cleanText(session.auth_employee_id, 40) : cleanText(payload.employee_id, 40);
  const employeeFilter = employeeId ? `&employee_id=eq.${employeeId}` : "";
  const [employees, salaries, attendance, checks, penaltyRewards, performance, rules] = await Promise.all([
    restRowsAll(`zysyr_employees?select=id,employee_code,name,position,employment_status&company_id=eq.${companyId}&store_id=eq.${storeId}&deleted_at=is.null${employeeId ? `&id=eq.${employeeId}` : ""}&order=employee_code.asc&limit=1000`, 1000),
    restRowsAll(`zysyr_salaries?select=id,employee_id,salary_month,version,source_report_id,base_salary,commission_amount,bonus_amount,deduction_amount,social_security,other_adjustment,final_salary,status,generated_at,approved_at,paid_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&salary_month=eq.${start}${employeeFilter}&order=employee_id.asc,version.desc&limit=3000`, 3000),
    restRowsAll(`zysyr_attendance_records?select=id,employee_id,attendance_date,attendance_type,minutes,note,status,confirmed_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&attendance_date=gte.${start}&attendance_date=lt.${end}${employeeFilter}&order=attendance_date.desc,created_at.desc&limit=5000`, 5000),
    restRowsAll(`zysyr_check_records?select=id,employee_id,check_date,check_type,item_name,result,note,status,confirmed_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&check_date=gte.${start}&check_date=lt.${end}${employeeFilter}&order=check_date.desc,created_at.desc&limit=5000`, 5000),
    restRowsAll(`zysyr_penalty_reward_records?select=id,employee_id,record_date,record_type,reason,amount,source_type,source_id,status,confirmed_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&record_date=gte.${start}&record_date=lt.${end}${employeeFilter}&order=record_date.desc,created_at.desc&limit=5000`, 5000),
    restRowsAll(`zysyr_performance_records?select=id,employee_id,business_date,service_item_code,revenue_amount,customer_count,source_type,source_report_cell_id,status,confirmed_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&business_date=gte.${start}&business_date=lt.${end}${employeeFilter}&order=business_date.desc,created_at.desc&limit=5000`, 5000),
    cleanText(session.operations_role, 40) === "employee" ? Promise.resolve([]) : restRowsAll(`zysyr_commission_rules?select=id,store_id,position,service_item_code,rate,effective_from,effective_to,status,updated_at&company_id=eq.${companyId}&or=(store_id.is.null,store_id.eq.${storeId})&order=status.asc,effective_from.desc&limit=1000`, 1000),
  ]);
  const salaryIds = salaries.map((salary) => salary.id);
  const details = salaryIds.length ? await restRowsAll(`zysyr_salary_details?select=id,salary_id,line_number,line_type,source_type,source_id,commission_rule_id,source_report_cell_id,amount,note&company_id=eq.${companyId}&store_id=eq.${storeId}&salary_id=in.${uuidIn(salaryIds)}&order=salary_id,line_number.asc&limit=10000`, 10000) : [];
  const sourceCellIds = Array.from(new Set([
    ...performance.map((item) => item.source_report_cell_id),
    ...details.map((item) => item.source_report_cell_id),
  ].map((value) => cleanText(value, 40)).filter(Boolean)));
  const sourceCells = sourceCellIds.length ? await restRowsAll(`zysyr_report_cells?select=id,report_id,sheet_name,cell_address,row_number,column_number,display_value,numeric_value,label&company_id=eq.${companyId}&store_id=eq.${storeId}&id=in.${uuidIn(sourceCellIds)}&limit=10000`, 10000) : [];
  const entityIds = Array.from(new Set([
    ...salaries.map((item) => item.id), ...attendance.map((item) => item.id), ...checks.map((item) => item.id),
    ...penaltyRewards.map((item) => item.id), ...performance.map((item) => item.id),
  ]));
  const voucherLinks = entityIds.length ? await restRowsAll(`zysyr_voucher_links?select=voucher_id,business_type,business_id,relation_type,linked_at&company_id=eq.${companyId}&store_id=eq.${storeId}&business_id=in.${uuidIn(entityIds)}&unlinked_at=is.null&limit=10000`, 10000) : [];
  const voucherIds = Array.from(new Set(voucherLinks.map((link) => link.voucher_id)));
  const vouchers = voucherIds.length ? await restRowsAll(`zysyr_voucher_attachments?select=id,original_filename,document_type,audit_status,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&id=in.${uuidIn(voucherIds)}&limit=5000`, 5000) : [];
  const writable = cleanText(session.operations_role, 40) === "finance" && hasAuthCapability(session, "salary.write_approve");
  const approvedVouchers = writable ? await restRowsAll(`zysyr_voucher_attachments?select=id,original_filename,document_type,audit_status,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&audit_status=eq.approved&order=uploaded_at.desc&limit=2000`, 2000) : [];
  const salaryReports = writable ? await restRowsAll(`zysyr_report_uploads?select=id,report_type,report_date,version,original_filename&company_id=eq.${companyId}&store_id=eq.${storeId}&report_type=in.(salary,performance)&status=eq.active&report_date=gte.${start}&report_date=lt.${end}&order=report_date.desc,version.desc&limit=1000`, 1000) : [];
  return {
    company_id: companyId, store_id: storeId, store: cleanText(store.name, 100), month,
    employees, salaries, salary_details: details, attendance, checks,
    penalty_rewards: penaltyRewards, performance, commission_rules: rules,
    source_cells: sourceCells, voucher_links: voucherLinks, vouchers,
    approved_vouchers: approvedVouchers, salary_reports: salaryReports,
    personal_scope: cleanText(session.operations_role, 40) === "employee",
    permissions: { read: true, write: writable },
    performance_rule: "hairstylist_only", source_boundary: "finance_uploads_only",
    meiguanjia_used: false,
  };
}

async function recordAttendance(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollWrite(session);
  const store = await selectedStoreInfo(session, payload);
  const date = cleanText(payload.attendance_date, 10);
  const type = cleanText(payload.attendance_type, 30);
  const minutes = Number(payload.minutes || 0);
  const reason = cleanText(payload.reason, 500);
  if (!validDate(date) || !["normal","late","leave","absent","early_leave"].includes(type)
    || !Number.isInteger(minutes) || minutes < 0 || !reason) throw new Error("请完整填写考勤类型、日期、分钟数和登记原因");
  const saved = await financeRpcSaved("rpc/zysyr_record_attendance", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_employee_id: uuidValue(payload.employee_id, "请选择员工"),
    p_attendance_date: date, p_attendance_type: type, p_minutes: minutes,
    p_note: cleanText(payload.note, 500), p_voucher_ids: voucherIdValues(payload.voucher_ids), p_reason: reason,
  });
  return { saved, formal_source: "finance_confirmed_attendance" };
}

async function recordCheck(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollWrite(session);
  const store = await selectedStoreInfo(session, payload);
  const date = cleanText(payload.check_date, 10);
  const type = cleanText(payload.check_type, 30);
  const result = cleanText(payload.result, 20);
  const reason = cleanText(payload.reason, 500);
  if (!validDate(date) || !["appearance","hygiene","service_discipline","other"].includes(type)
    || !["pass","fail"].includes(result) || !cleanText(payload.item_name, 160) || !reason) {
    throw new Error("请完整填写检查日期、类型、项目、结果和登记原因");
  }
  const saved = await financeRpcSaved("rpc/zysyr_record_check", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_employee_id: uuidValue(payload.employee_id, "请选择员工"),
    p_check_date: date, p_check_type: type, p_item_name: cleanText(payload.item_name, 160),
    p_result: result, p_note: cleanText(payload.note, 500),
    p_voucher_ids: voucherIdValues(payload.voucher_ids), p_reason: reason,
  });
  return { saved, formal_source: "finance_confirmed_check" };
}

async function recordPenaltyReward(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollWrite(session);
  const store = await selectedStoreInfo(session, payload);
  const date = cleanText(payload.record_date, 10);
  const type = cleanText(payload.record_type, 20);
  const sourceType = cleanText(payload.source_type, 20);
  const reason = cleanText(payload.reason, 500);
  if (!validDate(date) || !["reward","penalty"].includes(type)
    || !["attendance","check","manual"].includes(sourceType) || !reason
    || !cleanText(payload.record_reason, 500)) throw new Error("请完整填写奖罚类型、日期、事由、来源和登记原因");
  const saved = await financeRpcSaved("rpc/zysyr_record_penalty_reward", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_employee_id: uuidValue(payload.employee_id, "请选择员工"),
    p_record_date: date, p_record_type: type, p_record_reason: cleanText(payload.record_reason, 500),
    p_amount: amountValue(payload.amount), p_source_type: sourceType,
    p_source_id: uuidValue(payload.source_id, "来源记录无效", sourceType === "manual"),
    p_voucher_ids: voucherIdValues(payload.voucher_ids), p_reason: reason,
  });
  return { saved, structured_record: true };
}

async function recordPerformance(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollWrite(session);
  const store = await selectedStoreInfo(session, payload);
  const date = cleanText(payload.business_date, 10);
  const sourceType = cleanText(payload.source_type, 30);
  const customerCount = Number(payload.customer_count || 0);
  const reason = cleanText(payload.reason, 500);
  if (!validDate(date) || !["daily_report","service_order","import"].includes(sourceType)
    || !Number.isInteger(customerCount) || customerCount < 0 || !reason) throw new Error("请完整填写业绩日期、来源、客数和登记原因");
  const saved = await financeRpcSaved("rpc/zysyr_record_performance", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_employee_id: uuidValue(payload.employee_id, "请选择员工"),
    p_business_date: date, p_service_item_code: cleanText(payload.service_item_code, 80) || null,
    p_revenue_amount: amountValue(payload.revenue_amount), p_customer_count: customerCount,
    p_source_type: sourceType, p_source_report_cell_id: uuidValue(payload.source_report_cell_id, "请选择业绩原表单元格"),
    p_reason: reason,
  });
  return { saved, performance_rule: "hairstylist_only", meiguanjia_used: false };
}

async function saveCommissionRule(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollWrite(session);
  const store = await selectedStoreInfo(session, payload);
  const start = cleanText(payload.effective_from, 10); const end = cleanText(payload.effective_to, 10);
  const reason = cleanText(payload.reason, 500);
  if (!validDate(start) || (end && !validDate(end)) || !reason) throw new Error("请完整填写提成规则生效日期和修改原因");
  const saved = await financeRpcSaved("rpc/zysyr_upsert_commission_rule", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_rule_store_id: payload.company_wide === true ? null : cleanText(store.id, 40),
    p_rule_id: uuidValue(payload.id, "提成规则编号无效", true), p_position: cleanText(payload.position, 120) || null,
    p_service_item_code: cleanText(payload.service_item_code, 80) || null, p_rate: rateValue(payload.rate),
    p_effective_from: start, p_effective_to: end || null, p_status: cleanText(payload.status, 20) || "active",
    p_reason: reason,
  });
  return { saved, guessed_rate: false };
}

async function generateSalary(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollWrite(session);
  const store = await selectedStoreInfo(session, payload);
  const month = cleanText(payload.salary_month, 10); const reason = cleanText(payload.reason, 500);
  if (!validDate(month) || !/^\d{4}-\d{2}-01$/.test(month) || !reason) throw new Error("请选择工资月份并填写生成原因");
  const saved = await financeRpcSaved("rpc/zysyr_generate_salary", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_employee_id: uuidValue(payload.employee_id, "请选择员工"),
    p_salary_month: month, p_source_report_id: uuidValue(payload.source_report_id, "请选择工资原表"),
    p_base_salary: amountValue(payload.base_salary),
    p_base_source_cell_id: uuidValue(payload.base_source_cell_id, "请选择底薪对应单元格", Number(payload.base_salary) === 0),
    p_social_security: amountValue(payload.social_security),
    p_social_security_source_cell_id: uuidValue(payload.social_security_source_cell_id, "请选择社保对应单元格", Number(payload.social_security) === 0),
    p_other_adjustment: signedAmountValue(payload.other_adjustment ?? 0),
    p_other_adjustment_source_cell_id: uuidValue(payload.other_adjustment_source_cell_id, "请选择其他调整对应单元格", Number(payload.other_adjustment || 0) === 0),
    p_voucher_ids: voucherIdValues(payload.voucher_ids), p_reason: reason,
  });
  return { saved, decomposed: true, guessed_rate: false };
}

async function transitionSalary(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollWrite(session);
  const store = await selectedStoreInfo(session, payload);
  const action = cleanText(payload.action, 20); const reason = cleanText(payload.reason, 500);
  if (!["approve","pay","reverse"].includes(action) || !reason) throw new Error("请选择工资操作并填写原因");
  const paymentDate = cleanText(payload.payment_date, 10);
  if (action === "pay" && (!validDate(paymentDate) || !cleanText(payload.payment_method, 80))) throw new Error("支付工资必须填写支付日期和方式");
  const saved = await financeRpcSaved("rpc/zysyr_transition_salary", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_salary_id: uuidValue(payload.salary_id, "工资记录无效"),
    p_action: action, p_payment_date: action === "pay" ? paymentDate : null,
    p_payment_method: action === "pay" ? cleanText(payload.payment_method, 80) : null,
    p_payment_reference: action === "pay" ? cleanText(payload.payment_reference, 160) || null : null,
    p_voucher_ids: action === "pay" ? voucherIdValues(payload.voucher_ids) : [], p_reason: reason,
  });
  return { saved };
}

async function reversePayrollRecord(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requirePayrollWrite(session);
  const store = await selectedStoreInfo(session, payload);
  const type = cleanText(payload.entity_type, 40); const reason = cleanText(payload.reason, 500);
  if (!["attendance_record","check_record","penalty_reward","performance_record"].includes(type) || !reason) throw new Error("请选择待冲销记录并填写原因");
  const saved = await financeRpcSaved("rpc/zysyr_reverse_payroll_record", {
    p_actor_user_id: cleanText(session.auth_account_id, 40), p_company_id: cleanText(store.company_id, 40),
    p_store_id: cleanText(store.id, 40), p_entity_type: type,
    p_entity_id: uuidValue(payload.entity_id, "待冲销记录无效"), p_reason: reason,
  });
  return { saved };
}

function requireInventoryWrite(session: JsonRecord): void {
  if (!hasAuthCapability(session, "inventory.write")) throw new Error("当前账号没有采购和库存维护权限");
}

function inventoryQuantity(value: unknown): number {
  const quantity = quantityValue(value);
  if (quantity === null || quantity <= 0) throw new Error("数量必须大于 0，最多四位小数");
  return quantity;
}

async function inventoryCenter(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const role = cleanText(session.operations_role, 40);
  if (role !== "shareholder" && role !== "finance" && role !== "store_manager") throw new Error("当前角色无权查看采购库存");
  const store = await selectedStoreInfo(session, payload);
  const companyId = cleanText(store.company_id, 40); const storeId = cleanText(store.id, 40);
  const month = cleanText(payload.month, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) throw new Error("月份无效");
  const start = `${month}-01`; const endDate = new Date(`${start}T00:00:00Z`); endDate.setUTCMonth(endDate.getUTCMonth()+1);
  const end = endDate.toISOString().slice(0,10);
  const [products,suppliers,employees,orders,balances,transactions,usage,purchases,receipts,approvedVouchers,companyStores,stockTransfers] = await Promise.all([
    restRowsAll(`zysyr_products?select=id,name,category,unit,default_cost,status&company_id=eq.${companyId}&deleted_at=is.null&order=status.asc,category.asc,name.asc&limit=5000`,5000),
    restRowsAll(`zysyr_suppliers?select=id,name,category,contact,status&company_id=eq.${companyId}&deleted_at=is.null&order=status.asc,name.asc&limit=2000`,2000),
    restRowsAll(`zysyr_employees?select=id,employee_code,name,position,employment_status&company_id=eq.${companyId}&store_id=eq.${storeId}&deleted_at=is.null&order=employee_code.asc&limit=2000`,2000),
    restRowsAll(`zysyr_purchase_orders?select=id,supplier_id,order_number,order_date,expected_date,status,receipt_status,payment_status,total_amount,notes,created_at,approved_at&company_id=eq.${companyId}&store_id=eq.${storeId}&order_date=gte.${start}&order_date=lt.${end}&order=order_date.desc,created_at.desc&limit=2000`,2000),
    restRowsAll(`zysyr_inventory_balances?select=id,product_id,quantity,moving_average_cost,inventory_value,last_posting_sequence,updated_at&company_id=eq.${companyId}&store_id=eq.${storeId}&order=updated_at.desc&limit=5000`,5000),
    restRowsAll(`zysyr_inventory_transactions?select=id,product_id,business_date,posted_at,posting_sequence,transaction_type,direction,quantity,unit_cost,total_cost,quantity_before,quantity_after,average_cost_before,average_cost_after,source_type,source_id,status,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&business_date=gte.${start}&business_date=lt.${end}&order=posting_sequence.desc&limit=5000`,5000),
    restRowsAll(`zysyr_usage_records?select=id,product_id,employee_id,usage_date,usage_type,quantity,unit_cost,total_cost,notes,status,inventory_transaction_id,confirmed_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&usage_date=gte.${start}&usage_date=lt.${end}&order=usage_date.desc,created_at.desc&limit=5000`,5000),
    restRowsAll(`zysyr_employee_purchases?select=id,employee_id,product_id,purchase_date,quantity,unit_price,amount,inventory_unit_cost,inventory_cost,payment_status,paid_amount,status,inventory_transaction_id,notes,approved_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&purchase_date=gte.${start}&purchase_date=lt.${end}&order=purchase_date.desc,created_at.desc&limit=5000`,5000),
    restRowsAll(`zysyr_goods_receipts?select=id,purchase_order_id,receipt_number,receipt_date,status,total_amount,posted_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&receipt_date=gte.${start}&receipt_date=lt.${end}&order=receipt_date.desc,created_at.desc&limit=3000`,3000),
    hasAuthCapability(session,"inventory.write") ? restRowsAll(`zysyr_voucher_attachments?select=id,original_filename,document_type,audit_status,uploaded_at&company_id=eq.${companyId}&store_id=eq.${storeId}&audit_status=eq.approved&order=uploaded_at.desc&limit=2000`,2000) : Promise.resolve([]),
    restRowsAll(`zysyr_stores?select=id,name,code,status&company_id=eq.${companyId}&deleted_at=is.null&order=name.asc&limit=500`,500),
    restRowsAll(`zysyr_stock_transfers?select=id,source_store_id,destination_store_id,transfer_number,transfer_date,status,total_cost,notes,posted_at,reverse_reason&company_id=eq.${companyId}&or=(source_store_id.eq.${storeId},destination_store_id.eq.${storeId})&transfer_date=gte.${start}&transfer_date=lt.${end}&order=transfer_date.desc,created_at.desc&limit=3000`,3000),
  ]);
  const orderIds=orders.map((item)=>item.id); const receiptIds=receipts.map((item)=>item.id); const employeePurchaseIds=purchases.map((item)=>item.id); const stockTransferIds=stockTransfers.map((item)=>item.id);
  const [orderLines,receiptLines,purchasePayments,employeePurchasePayments,stockTransferLines] = await Promise.all([
    orderIds.length ? restRowsAll(`zysyr_purchase_order_lines?select=id,purchase_order_id,line_number,product_id,ordered_quantity,unit_cost,line_amount&company_id=eq.${companyId}&store_id=eq.${storeId}&purchase_order_id=in.${uuidIn(orderIds)}&order=purchase_order_id,line_number.asc&limit=10000`,10000) : Promise.resolve([]),
    receiptIds.length ? restRowsAll(`zysyr_goods_receipt_lines?select=id,goods_receipt_id,purchase_order_line_id,product_id,quantity,unit_cost,line_amount&company_id=eq.${companyId}&store_id=eq.${storeId}&goods_receipt_id=in.${uuidIn(receiptIds)}&limit=10000`,10000) : Promise.resolve([]),
    orderIds.length ? restRowsAll(`zysyr_payment_records?select=id,business_id,payment_date,payee,amount,payment_method,payment_reference,status,confirmed_at&company_id=eq.${companyId}&store_id=eq.${storeId}&business_type=eq.purchase&business_id=in.${uuidIn(orderIds)}&limit=5000`,5000) : Promise.resolve([]),
    employeePurchaseIds.length ? restRowsAll(`zysyr_employee_purchase_payments?select=id,employee_purchase_id,payment_date,amount,payment_method,payment_reference,status,confirmed_at,reverse_reason&company_id=eq.${companyId}&store_id=eq.${storeId}&employee_purchase_id=in.${uuidIn(employeePurchaseIds)}&limit=5000`,5000) : Promise.resolve([]),
    stockTransferIds.length ? restRowsAll(`zysyr_stock_transfer_lines?select=id,stock_transfer_id,line_number,product_id,quantity,unit_cost,total_cost,source_transaction_id,destination_transaction_id&company_id=eq.${companyId}&stock_transfer_id=in.${uuidIn(stockTransferIds)}&order=stock_transfer_id,line_number.asc&limit=10000`,10000) : Promise.resolve([]),
  ]);
  const businessIds=Array.from(new Set([...receipts,...usage,...purchases,...purchasePayments,...employeePurchasePayments,...stockTransfers].map((item)=>item.id)));
  const voucherLinks=businessIds.length ? await restRowsAll(`zysyr_voucher_links?select=voucher_id,business_type,business_id,relation_type,linked_at&company_id=eq.${companyId}&store_id=eq.${storeId}&business_id=in.${uuidIn(businessIds)}&unlinked_at=is.null&limit=10000`,10000) : [];
  const authorizedStoreNames=await availableStores(session); const authorizedStores=companyStores.filter((item)=>authorizedStoreNames.includes(cleanText(item.name,100)));
  return {company_id:companyId,store_id:storeId,store:cleanText(store.name,100),month,products,suppliers,employees,
    purchase_orders:orders,purchase_order_lines:orderLines,goods_receipts:receipts,goods_receipt_lines:receiptLines,
    balances,transactions,usage_records:usage,employee_purchases:purchases,purchase_payments:purchasePayments,
    employee_purchase_payments:employeePurchasePayments,stock_transfers:stockTransfers,stock_transfer_lines:stockTransferLines,
    authorized_stores:authorizedStores,voucher_links:voucherLinks,approved_vouchers:approvedVouchers,permissions:{read:true,write:hasAuthCapability(session,"inventory.write")},
    costing_method:"moving_average",source_boundary:"finance_uploaded_records_only",meiguanjia_used:false};
}

async function savePurchaseOrder(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireInventoryWrite(session); const store=await selectedStoreInfo(session,payload);
  const date=cleanText(payload.order_date,10); const expected=cleanText(payload.expected_date,10); const reason=cleanText(payload.reason,500);
  if(!validDate(date)||(expected&&!validDate(expected))||!cleanText(payload.order_number,100)||!reason) throw new Error("请完整填写采购单号、日期、供应商和保存原因");
  if(!Array.isArray(payload.lines)||!payload.lines.length||payload.lines.length>500) throw new Error("采购明细必须为 1 至 500 行");
  const lines=(payload.lines as JsonRecord[]).map((line)=>({product_id:uuidValue(line.product_id,"请选择产品"),quantity:inventoryQuantity(line.quantity),unit_cost:catalogCostValue(line.unit_cost)??0}));
  const saved=await financeRpcSaved("rpc/zysyr_save_purchase_order",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),
    p_id:uuidValue(payload.id,"采购单编号无效",true),p_supplier_id:uuidValue(payload.supplier_id,"请选择供应商"),p_order_number:cleanText(payload.order_number,100),p_order_date:date,
    p_expected_date:expected||null,p_lines:lines,p_notes:cleanText(payload.notes,500)||null,p_reason:reason});
  return {saved,receipt_independent_from_payment:true,meiguanjia_used:false};
}

async function transitionPurchaseOrder(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireInventoryWrite(session); const store=await selectedStoreInfo(session,payload); const action=cleanText(payload.action,20); const reason=cleanText(payload.reason,500);
  if(!["submit","approve","reject","cancel"].includes(action)||!reason) throw new Error("请选择采购单操作并填写原因");
  const saved=await financeRpcSaved("rpc/zysyr_transition_purchase_order",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),p_purchase_order_id:uuidValue(payload.purchase_order_id,"采购单无效"),p_action:action,p_reason:reason});
  return {saved};
}

async function postGoodsReceipt(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireInventoryWrite(session); const store=await selectedStoreInfo(session,payload); const date=cleanText(payload.receipt_date,10); const reason=cleanText(payload.reason,500);
  if(!validDate(date)||!cleanText(payload.receipt_number,100)||!reason||!Array.isArray(payload.lines)||(payload.lines as unknown[]).length===0) throw new Error("请完整填写入库单号、日期、明细和原因");
  const lines=(payload.lines as JsonRecord[]).map((line)=>({purchase_order_line_id:uuidValue(line.purchase_order_line_id,"采购明细无效"),quantity:inventoryQuantity(line.quantity)}));
  const saved=await financeRpcSaved("rpc/zysyr_post_goods_receipt",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),p_purchase_order_id:uuidValue(payload.purchase_order_id,"采购单无效"),p_receipt_number:cleanText(payload.receipt_number,100),p_receipt_date:date,p_lines:lines,p_voucher_ids:voucherIdValues(payload.voucher_ids),p_reason:reason});
  return {saved,costing_method:"moving_average",partial_receipt_supported:true};
}

async function recordInventoryUsage(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireInventoryWrite(session); const store=await selectedStoreInfo(session,payload); const date=cleanText(payload.usage_date,10); const type=cleanText(payload.usage_type,30); const reason=cleanText(payload.reason,500);
  if(!validDate(date)||!["salon_service","daily_consumable","damage","other"].includes(type)||!reason) throw new Error("请完整填写消耗日期、类型和登记原因");
  const saved=await financeRpcSaved("rpc/zysyr_record_usage",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),p_product_id:uuidValue(payload.product_id,"请选择产品"),p_employee_id:uuidValue(payload.employee_id,"员工无效",true),p_usage_date:date,p_usage_type:type,p_quantity:inventoryQuantity(payload.quantity),p_notes:cleanText(payload.notes,500)||null,p_voucher_ids:voucherIdValues(payload.voucher_ids),p_reason:reason});
  return {saved,cost_from_inventory_snapshot:true};
}

async function recordEmployeePurchase(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireInventoryWrite(session); const store=await selectedStoreInfo(session,payload); const date=cleanText(payload.purchase_date,10); const reason=cleanText(payload.reason,500);
  if(!validDate(date)||!reason) throw new Error("请完整填写员工自购日期和登记原因");
  const saved=await financeRpcSaved("rpc/zysyr_record_employee_purchase",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),p_employee_id:uuidValue(payload.employee_id,"请选择员工"),p_product_id:uuidValue(payload.product_id,"请选择产品"),p_purchase_date:date,p_quantity:inventoryQuantity(payload.quantity),p_unit_price:catalogCostValue(payload.unit_price)??0,p_notes:cleanText(payload.notes,500)||null,p_voucher_ids:voucherIdValues(payload.voucher_ids),p_reason:reason});
  return {saved,inventory_cost_from_snapshot:true};
}

async function confirmInventoryPayment(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store=await selectedStoreInfo(session,payload); const kind=cleanText(payload.payment_kind,30); const date=cleanText(payload.payment_date,10); const reason=cleanText(payload.reason,500);
  if(!validDate(date)||!reason||!cleanText(payload.payment_method,80)) throw new Error("请完整填写收付款日期、方式和登记原因");
  if(kind==="purchase") {
    requireFinanceCapability(session,"payment.confirm","只有财务账号可以确认采购付款");
    const saved=await financeRpcSaved("rpc/zysyr_confirm_purchase_payment",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),p_purchase_order_id:uuidValue(payload.business_id,"采购单无效"),p_payment_date:date,p_amount:amountValue(payload.amount),p_payment_method:cleanText(payload.payment_method,80),p_payment_reference:cleanText(payload.payment_reference,160)||null,p_voucher_ids:voucherIdValues(payload.voucher_ids),p_reason:reason}); return {saved,payment_kind:kind};
  }
  requireInventoryWrite(session);
  const saved=await financeRpcSaved("rpc/zysyr_confirm_employee_purchase_payment",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),p_employee_purchase_id:uuidValue(payload.business_id,"员工自购记录无效"),p_payment_date:date,p_amount:amountValue(payload.amount),p_payment_method:cleanText(payload.payment_method,80),p_payment_reference:cleanText(payload.payment_reference,160)||null,p_voucher_ids:voucherIdValues(payload.voucher_ids),p_reason:reason}); return {saved,payment_kind:"employee_purchase"};
}

async function reverseInventoryRecord(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireInventoryWrite(session); const store=await selectedStoreInfo(session,payload); const type=cleanText(payload.business_type,40); const reason=cleanText(payload.reason,500);
  if(!["goods_receipt","usage_record","employee_purchase","stock_transfer"].includes(type)||!reason) throw new Error("请选择库存记录并填写冲销原因");
  const saved=await financeRpcSaved("rpc/zysyr_reverse_inventory_record",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),p_business_type:type,p_business_id:uuidValue(payload.business_id,"库存记录无效"),p_reason:reason}); return {saved};
}

async function postStockTransfer(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  requireInventoryWrite(session); const source=await selectedStoreInfo(session,payload); const destinationId=uuidValue(payload.destination_store_id,"请选择目标门店");
  const date=cleanText(payload.transfer_date,10); const reason=cleanText(payload.reason,500);
  if(!validDate(date)||!cleanText(payload.transfer_number,100)||!reason||!Array.isArray(payload.lines)||(payload.lines as unknown[]).length===0) throw new Error("请完整填写调拨单号、日期、产品和原因");
  const lines=(payload.lines as JsonRecord[]).map((line)=>({product_id:uuidValue(line.product_id,"请选择调拨产品"),quantity:inventoryQuantity(line.quantity)}));
  const saved=await financeRpcSaved("rpc/zysyr_post_stock_transfer",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(source.company_id,40),p_source_store_id:cleanText(source.id,40),p_destination_store_id:destinationId,p_transfer_number:cleanText(payload.transfer_number,100),p_transfer_date:date,p_lines:lines,p_notes:cleanText(payload.notes,500)||null,p_voucher_ids:voucherIdValues(payload.voucher_ids),p_reason:reason}); return {saved,cost_from_source_snapshot:true};
}

async function reverseInventoryPayment(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store=await selectedStoreInfo(session,payload); const type=cleanText(payload.payment_type,30); const reason=cleanText(payload.reason,500);
  if(!["purchase","employee_purchase"].includes(type)||!reason) throw new Error("请选择收付款并填写冲销原因");
  if(type==="purchase") requireFinanceCapability(session,"payment.confirm","只有财务账号可以冲销采购付款"); else requireInventoryWrite(session);
  const saved=await financeRpcSaved("rpc/zysyr_reverse_inventory_payment",{p_actor_user_id:cleanText(session.auth_account_id,40),p_company_id:cleanText(store.company_id,40),p_store_id:cleanText(store.id,40),p_payment_type:type,p_payment_id:uuidValue(payload.payment_id,"收付款记录无效"),p_reason:reason}); return {saved};
}

async function analysisCenter(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "ai_insight.read") && !hasAuthCapability(session, "question.create")
    && !hasAuthCapability(session, "question.respond")) throw new Error("当前账号没有经营分析或问答权限");
  const store = await selectedStoreInfo(session, payload);
  const month = parseMonth(payload.month);
  const companyId = cleanText(store.company_id, 40), storeId = cleanText(store.id, 40);
  const next = new Date(`${month}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.toISOString().slice(0, 10);
  const reports = await restRowsAll(`zysyr_monthly_reports?select=id,period_month,version,status,created_at,locked_at&company_id=eq.${companyId}&store_id=eq.${storeId}&period_month=gte.${month}-01&period_month=lt.${end}&order=version.desc&limit=100`, 100);
  const reportFilter = uuidIn(reports.map((row) => row.id));
  const [runs, questions] = await Promise.all([
    reportFilter === "()" ? [] : restRowsAll(`zysyr_ai_analysis_runs?select=id,monthly_report_id,analysis_type,status,provider,model,prompt_version,attempt,snapshot_sha256,output_json,error_message,requested_by_user_id,requested_at,completed_at&company_id=eq.${companyId}&store_id=eq.${storeId}&monthly_report_id=in.${reportFilter}&order=requested_at.desc&limit=1000`, 1000),
    reportFilter === "()" ? [] : restRowsAll(`zysyr_questions?select=id,monthly_report_id,title,body,status,created_by_user_id,created_at,answered_at&company_id=eq.${companyId}&store_id=eq.${storeId}&monthly_report_id=in.${reportFilter}&order=created_at.desc&limit=1000`, 1000),
  ]);
  const questionFilter = uuidIn(questions.map((row) => row.id));
  const messages = questionFilter === "()" ? [] : await restRowsAll(`zysyr_question_messages?select=id,question_id,sender_user_id,sender_role,body,created_at&company_id=eq.${companyId}&store_id=eq.${storeId}&question_id=in.${questionFilter}&order=created_at.asc,id.asc&limit=5000`, 5000);
  return { month, store_id: storeId, monthly_reports: reports, analysis_runs: runs, questions, question_messages: messages,
    permissions: { request_analysis: hasAuthCapability(session, "ai_insight.read"), create_question: hasAuthCapability(session, "question.create"), respond_question: hasAuthCapability(session, "question.respond") },
    ai_provider_configured: Boolean(Deno.env.get("ZYSYR_AI_API_KEY")), evidence_mode: "immutable_monthly_snapshot", meiguanjia_used: false };
}

async function requestAiAnalysis(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "ai_insight.read")) throw new Error("当前账号没有发起经营分析的权限");
  const store = await selectedStoreInfo(session, payload), reason = cleanText(payload.reason, 500);
  const type = cleanText(payload.analysis_type, 40) || "monthly_operations";
  if (!reason || !["monthly_operations", "variance", "voucher_completeness"].includes(type)) throw new Error("请选择分析类型并填写原因");
  const saved = await financeRpcSaved("rpc/zysyr_request_ai_analysis", { p_actor_user_id: cleanText(session.auth_account_id, 40),
    p_company_id: cleanText(store.company_id, 40), p_store_id: cleanText(store.id, 40),
    p_monthly_report_id: uuidValue(payload.monthly_report_id, "请选择正式月报"), p_analysis_type: type, p_reason: reason });
  return { saved, read_only: true, citations_required: true };
}

async function createQuestion(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "question.create")) throw new Error("当前账号没有发起问题的权限");
  const store = await selectedStoreInfo(session, payload), title = cleanText(payload.title, 160), body = cleanText(payload.body, 2000);
  if (!title || !body) throw new Error("请填写问题标题和内容");
  const saved = await financeRpcSaved("rpc/zysyr_create_question", { p_actor_user_id: cleanText(session.auth_account_id, 40),
    p_company_id: cleanText(store.company_id, 40), p_store_id: cleanText(store.id, 40),
    p_monthly_report_id: uuidValue(payload.monthly_report_id, "请选择正式月报"), p_title: title, p_body: body });
  return { saved, evidence_snapshot_preserved: true };
}

async function respondQuestion(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "question.respond")) throw new Error("当前账号没有回复经营问题的权限");
  const store = await selectedStoreInfo(session, payload), body = cleanText(payload.body, 2000);
  if (!body) throw new Error("请填写回复内容");
  const saved = await financeRpcSaved("rpc/zysyr_respond_question", { p_actor_user_id: cleanText(session.auth_account_id, 40),
    p_company_id: cleanText(store.company_id, 40), p_store_id: cleanText(store.id, 40),
    p_question_id: uuidValue(payload.question_id, "问题无效"), p_body: body });
  return { saved, evidence_snapshot_preserved: true };
}

async function importCenter(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (!hasAuthCapability(session, "daily_report.write")) throw new Error("当前账号没有真实日报导入权限");
  const store=await selectedStoreInfo(session,payload), month=parseMonth(payload.month), companyId=cleanText(store.company_id,40), storeId=cleanText(store.id,40);
  const next=new Date(`${month}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth()+1); const end=next.toISOString().slice(0,10);
  const [batches,vouchers,dailyReports]=await Promise.all([
    restRowsAll(`zysyr_import_batches?select=id,report_date,import_type,status,raw_row_count,mapped_row_count,payload_sha256,source_voucher_id,source_report_id,reason,error_message,created_at,completed_at&company_id=eq.${companyId}&store_id=eq.${storeId}&report_date=gte.${month}-01&report_date=lt.${end}&order=created_at.desc&limit=1000`,1000),
    restRowsAll(`zysyr_voucher_attachments?select=id,object_path,original_filename,mime_type,size_bytes,ocr_status,audit_status,document_type,reviewed_at&company_id=eq.${companyId}&store_id=eq.${storeId}&audit_status=eq.approved&document_type=eq.daily_report&order=reviewed_at.desc&limit=1000`,1000),
    restRowsAll(`zysyr_daily_reports?select=id,report_date,version,status,source_report_id,submitted_at,reviewed_at&company_id=eq.${companyId}&store_id=eq.${storeId}&report_date=gte.${month}-01&report_date=lt.${end}&order=report_date.desc,version.desc&limit=1000`,1000),
  ]);
  const batchFilter=uuidIn(batches.map((row)=>row.id));
  const [conflicts,reconciliations]=await Promise.all([
    batchFilter==="()"?[]:restRowsAll(`zysyr_import_conflicts?select=id,import_batch_id,conflict_type,existing_entity_type,existing_entity_id,details,resolution_status,created_at&company_id=eq.${companyId}&store_id=eq.${storeId}&import_batch_id=in.${batchFilter}&order=created_at.desc&limit=2000`,2000),
    batchFilter==="()"?[]:restRowsAll(`zysyr_reconciliation_reports?select=id,import_batch_id,daily_report_id,status,source_row_count,business_row_count,source_amount,business_amount,delta,generated_at&company_id=eq.${companyId}&store_id=eq.${storeId}&import_batch_id=in.${batchFilter}&order=generated_at.desc&limit=1000`,1000),
  ]);
  return {month,batches,vouchers,daily_reports:dailyReports,conflicts,reconciliations,permissions:{import:cleanText(session.operations_role,40)==="finance"&&hasAuthCapability(session,"daily_report.write")},meiguanjia_used:false};
}

async function photoDailyImport(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  if (cleanText(session.operations_role,40)!=="finance"||!hasAuthCapability(session,"daily_report.write")) throw new Error("只有当前门店财务账号可以导入真实日报图片");
  const store=await selectedStoreInfo(session,payload), companyId=cleanText(store.company_id,40), storeId=cleanText(store.id,40), accountId=cleanText(session.auth_account_id,40);
  const reportDate=cleanText(payload.report_date,10), reason=cleanText(payload.reason,500), voucherId=uuidValue(payload.voucher_id,"请选择已审核日报图片");
  if(!validDate(reportDate)||!reason||!Array.isArray(payload.rows)||(payload.rows as unknown[]).length<1||(payload.rows as unknown[]).length>1000) throw new Error("请填写日期、来源图片、导入明细和原因");
  const rows=(payload.rows as JsonRecord[]).map((row)=>({line_type:cleanText(row.line_type,30),metric_code:cleanText(row.metric_code,64).toUpperCase(),description:cleanText(row.description,300),amount:cleanText(row.line_type,30)==="note"?null:amountValue(row.amount),quantity:row.quantity==null?null:Number(row.quantity)}));
  if(!rows.some((row)=>row.line_type!=="note")) throw new Error("日报至少要有一行金额明细");
  const batch=await financeRpcSaved("rpc/zysyr_create_photo_import_batch",{p_actor_user_id:accountId,p_company_id:companyId,p_store_id:storeId,p_report_date:reportDate,p_source_voucher_id:voucherId,p_rows:rows,p_reason:reason});
  if(cleanText(batch.status,30)==="conflict") return {batch,imported:false,conflict:true,message:"发现现有日报或行校验问题，未覆盖任何数据"};
  const voucherRows=await restRows(`zysyr_voucher_attachments?select=id,object_path,original_filename,mime_type,size_bytes,sha256&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${voucherId}&audit_status=eq.approved&document_type=eq.daily_report&limit=1`);
  const voucher=voucherRows[0]; if(!voucher) throw new Error("已审核日报图片不存在或不属于当前门店");
  const download=await fetch(`${SUPABASE_URL}/storage/v1/object/${VOUCHER_BUCKET}/${storagePath(cleanText(voucher.object_path,500))}`,{headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`}});
  if(!download.ok) throw new Error(`日报原图读取失败 (${download.status})`); const bytes=new Uint8Array(await download.arrayBuffer());
  if(!bytes.length||bytes.length>MAX_REPORT_BYTES) throw new Error("日报原图必须小于 10MB");
  const mime=cleanText(voucher.mime_type,80); if(!["image/jpeg","image/png"].includes(mime)) throw new Error("真实日报导入当前支持 JPG 或 PNG");
  const values:[[string,string],...string[][]]=[["项目","金额"],...rows.map((row)=>[row.description,row.line_type==="note"?"":String(row.amount)])];
  const cells=rows.map((row,index)=>row.line_type==="note"?null:{sheet_name:"人工复核日报",cell_address:`B${index+2}`,row_number:index+2,column_number:2,cell_kind:"input",display_value:String(row.amount),numeric_value:row.amount,formula:null,precedent_addresses:[],label:row.description}).filter(Boolean) as JsonRecord[];
  const displayData={sheet_name:"人工复核日报",range:`A1:B${rows.length+1}`,rows:rows.length+1,columns:2,values,merges:[],cells,source_kind:"approved_daily_photo",source_voucher_id:voucherId};
  const extension=mime==="image/png"?"png":"jpg", objectPath=`${companyId}/${storeId}/daily/${reportDate}/${crypto.randomUUID()}.${extension}`;
  const upload=await fetch(`${SUPABASE_URL}/storage/v1/object/${REPORT_BUCKET}/${storagePath(objectPath)}`,{method:"POST",headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":mime,"x-upsert":"false"},body:exactArrayBuffer(bytes)});
  if(!upload.ok) throw new Error(`日报原图归档失败 (${upload.status})`);
  const metadata=await rest("rpc/zysyr_register_report_upload",{method:"POST",body:JSON.stringify({p_report:{company_id:companyId,store_id:storeId,report_type:"daily",report_date:reportDate,template_code:"zysyr_daily_photo_reviewed",template_version:1,original_filename:cleanText(voucher.original_filename,200),mime_type:mime,size_bytes:bytes.length,sha256:await sha256Bytes(bytes),bucket_id:REPORT_BUCKET,object_path:objectPath,display_data:displayData,uploaded_by_user_id:accountId},p_cells:cells})});
  if(!metadata.ok){await fetch(`${SUPABASE_URL}/storage/v1/object/${REPORT_BUCKET}/${storagePath(objectPath)}`,{method:"DELETE",headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`}});throw new Error(`日报图片登记失败 (${metadata.status})`)}
  const reportData=await metadata.json() as JsonRecord, report=Array.isArray(reportData)?reportData[0]:reportData, reportId=uuidValue((report as JsonRecord).id,"日报图片登记结果无效");
  await financeRpcSaved("rpc/zysyr_attach_import_report",{p_actor_user_id:accountId,p_company_id:companyId,p_store_id:storeId,p_import_batch_id:batch.id,p_source_report_id:reportId});
  const importRows=await restRowsAll(`zysyr_import_rows?select=row_number,mapped_json,source_report_cell_id&company_id=eq.${companyId}&store_id=eq.${storeId}&import_batch_id=eq.${batch.id}&order=row_number.asc&limit=1000`,1000);
  const lines=importRows.map((row)=>({...(row.mapped_json as JsonRecord),source_report_cell_id:row.source_report_cell_id||null}));
  const daily=await financeRpcSaved("rpc/zysyr_save_daily_report",{p_actor_user_id:accountId,p_company_id:companyId,p_store_id:storeId,p_source_report_id:reportId,p_is_business_day:payload.is_business_day==null?null:Boolean(payload.is_business_day),p_lines:lines,p_reason:reason});
  const reconciliation=await financeRpcSaved("rpc/zysyr_finalize_daily_import",{p_actor_user_id:accountId,p_company_id:companyId,p_store_id:storeId,p_import_batch_id:batch.id,p_daily_report_id:daily.id});
  return {batch_id:batch.id,report,daily_report:daily,reconciliation,imported:cleanText(reconciliation.status,30)==="matched",source_boundary:"approved_photo_human_review",meiguanjia_used:false};
}

async function voucherUrl(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStoreInfo(session, payload);
  const voucherId = cleanText(payload.voucher_id, 80);
  const rows = await restRows(`zysyr_voucher_attachments?select=id,object_path,original_filename&company_id=eq.${cleanText(store.company_id, 40)}&store_id=eq.${cleanText(store.id, 40)}&id=eq.${encodeURIComponent(voucherId)}&limit=1`);
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
  return saveStore(payload, session);
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
    const session = await requireSession(payload, request);
    if (operation === "session") return json({ user: await sessionUser(session), expires_at: session.expires_at });
    if (cleanText(session.operations_role, 40) === "employee" && operation !== "payroll_center") {
      throw new Error("员工账号只能查看本人的工资、考勤、奖罚和业绩");
    }
    if (operation === "overview") return json(await overview(payload, session));
    if (operation === "catalog") return json(await catalog(payload, session));
    if (operation === "service_item_save") return json(await saveServiceItem(payload, session));
    if (operation === "product_save") return json(await saveProduct(payload, session));
    if (operation === "supplier_save") return json(await saveSupplier(payload, session));
    if (operation === "employee_save") return json(await saveEmployee(payload, session));
    if (operation === "store_save") return json(await saveStore(payload, session));
    if (operation === "report_upload") return json(await uploadReport(payload, session));
    if (operation === "report_cells") return json(await reportCells(payload, session));
    if (operation === "cell_trace") return json(await cellTrace(payload, session));
    if (operation === "cell_trace_save") return json(await saveCellTrace(payload, session));
    if (operation === "report_url") return json(await reportUrl(payload, session));
    if (operation === "finance_workbench") return json(await financeWorkbench(payload, session));
    if (operation === "expense_category_save") return json(await saveExpenseCategory(payload, session));
    if (operation === "expense_save" || operation === "expense_submit") return json(await submitExpense(payload, session));
    if (operation === "expense_import") return json(await importExpenses(payload, session));
    if (operation === "expense_review") return json(await reviewExpense(payload, session));
    if (operation === "petty_cash_record") return json(await recordPettyCash(payload, session));
    if (operation === "expense_payment_confirm") return json(await confirmExpensePayment(payload, session));
    if (operation === "finance_record_reverse") return json(await reverseFinanceRecord(payload, session));
    if (operation === "monthly_generate") return json(await generateMonthlyReport(payload, session));
    if (operation === "monthly_transition") return json(await transitionMonthlyReport(payload, session));
    if (operation === "voucher_upload") return json(await uploadVoucher(payload, session));
    if (operation === "voucher_center") return json(await voucherCenter(payload, session));
    if (operation === "voucher_review") return json(await reviewVoucher(payload, session));
    if (operation === "voucher_ocr_retry") return json(await retryVoucherOcr(payload, session));
    if (operation === "daily_report_save") return json(await saveDailyReport(payload, session));
    if (operation === "daily_report_review") return json(await reviewDailyReport(payload, session));
    if (operation === "finance_voucher_link") return json(await linkFinanceVoucher(payload, session));
    if (operation === "payroll_center") return json(await payrollCenter(payload, session));
    if (operation === "attendance_record") return json(await recordAttendance(payload, session));
    if (operation === "check_record") return json(await recordCheck(payload, session));
    if (operation === "penalty_reward_record") return json(await recordPenaltyReward(payload, session));
    if (operation === "performance_record") return json(await recordPerformance(payload, session));
    if (operation === "commission_rule_save") return json(await saveCommissionRule(payload, session));
    if (operation === "salary_generate") return json(await generateSalary(payload, session));
    if (operation === "salary_transition") return json(await transitionSalary(payload, session));
    if (operation === "payroll_record_reverse") return json(await reversePayrollRecord(payload, session));
    if (operation === "inventory_center") return json(await inventoryCenter(payload, session));
    if (operation === "purchase_order_save") return json(await savePurchaseOrder(payload, session));
    if (operation === "purchase_order_transition") return json(await transitionPurchaseOrder(payload, session));
    if (operation === "goods_receipt_post") return json(await postGoodsReceipt(payload, session));
    if (operation === "inventory_usage_record") return json(await recordInventoryUsage(payload, session));
    if (operation === "employee_purchase_record") return json(await recordEmployeePurchase(payload, session));
    if (operation === "inventory_payment_confirm") return json(await confirmInventoryPayment(payload, session));
    if (operation === "inventory_record_reverse") return json(await reverseInventoryRecord(payload, session));
    if (operation === "stock_transfer_post") return json(await postStockTransfer(payload, session));
    if (operation === "inventory_payment_reverse") return json(await reverseInventoryPayment(payload, session));
    if (operation === "analysis_center") return json(await analysisCenter(payload, session));
    if (operation === "ai_analysis_request") return json(await requestAiAnalysis(payload, session));
    if (operation === "question_create") return json(await createQuestion(payload, session));
    if (operation === "question_respond") return json(await respondQuestion(payload, session));
    if (operation === "import_center") return json(await importCenter(payload, session));
    if (operation === "photo_daily_import") return json(await photoDailyImport(payload, session));
    if (operation === "voucher_url") return json(await voucherUrl(payload, session));
    if (operation === "store_create") return json(await createStore(payload, session));
    return json({ error: "不支持的操作" }, 400);
  } catch (error) {
    const message = (error as Error).message || "请求失败";
    const authError = /登录|账号|密码|权限|离职|无权/.test(message);
    return json({ error: message }, authError ? 403 : 400);
  }
});
