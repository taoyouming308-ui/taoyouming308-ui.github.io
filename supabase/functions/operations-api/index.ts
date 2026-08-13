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
  let operationsRole = "";
  let roleScope: JsonRecord = {};
  if (shareholder && cleanText((shareholder.scope as JsonRecord).type, 20) === "company") {
    operationsRole = "shareholder";
    roleScope = shareholder.scope as JsonRecord;
  } else if (finance) {
    operationsRole = "finance";
    roleScope = finance.scope as JsonRecord;
  }
  const scopeType = cleanText(roleScope.type, 20);
  const storeId = scopeType === "store" ? cleanText(roleScope.store_id, 40) : "";
  const authorized = operationsRole === "shareholder"
    ? scopeCapability(scope, "dashboard.group.read", "company", "")
    : operationsRole === "finance"
      ? scopeCapability(scope, "dashboard.store.read", scopeType, storeId)
        && scopeCapability(scope, "daily_report.write", scopeType, storeId)
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
  if (Array.isArray(session.auth_capabilities)) {
    return (session.auth_capabilities as unknown[]).some((item) => cleanText(item, 100) === "expense.create_submit");
  }
  return ["shareholder", "finance", "store_manager"].includes(cleanText(session.operations_role, 40));
}

function canUploadReports(session: JsonRecord): boolean {
  return cleanText(session.operations_role, 40) === "finance"
    && Array.isArray(session.auth_capabilities)
    && (session.auth_capabilities as unknown[]).some((item) => cleanText(item, 100) === "report.upload");
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
    can_upload_reports: canUploadReports(session),
    can_create_store: role === "shareholder",
    can_manage_finance_accounts: Array.isArray(session.auth_capabilities)
      && (session.auth_capabilities as unknown[]).some((item) => cleanText(item, 100) === "finance_account.create")
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

async function overview(payload: JsonRecord, session: JsonRecord): Promise<JsonRecord> {
  const store = await selectedStoreInfo(session, payload);
  const month = cleanText(payload.month, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份无效");
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
  const withEvidence: JsonRecord[] = reports.map((report) => ({ ...report, vouchers: voucherMap.get(cleanText(report.id, 80)) || [] }));
  const monthlyReport = withEvidence.find((report) => cleanText(report.report_type, 40) === "monthly_profit_loss"
    && cleanText(report.report_date, 10) === start) || null;
  return {
    store: cleanText(store.name, 100), month, source_boundary: "finance_uploads_only",
    monthly_report: monthlyReport,
    reports: withEvidence,
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

function excelCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return cleanText(value, 500);
  const record = value as JsonRecord;
  if (record.result !== undefined) return excelCellText(record.result);
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

async function workbookDisplay(bytes: Uint8Array, reportType: string): Promise<JsonRecord> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(exactArrayBuffer(bytes));
  } catch {
    throw new Error("Excel 文件无法识别，请确认文件未损坏且为 XLSX 格式");
  }
  const preferred = reportType === "monthly_profit_loss"
    ? ["模版", "模板", "月盈亏统计"]
    : reportType === "performance"
      ? ["业绩报表", "向里业绩报表"]
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
  const model = sheet.model as unknown as JsonRecord;
  const merges = (Array.isArray(model.merges) ? model.merges : []).map((merge) => mergeCoordinates(cleanText(merge, 40)));
  const rangeText = `A1:${sheet.getCell(rowCount, columnCount).address}`;
  return { sheet_name: sheetName, range: rangeText, rows: rowCount, columns: columnCount, values, merges };
}

function reportDateValue(payload: JsonRecord, reportType: string): string {
  const raw = cleanText(payload.report_date, 10);
  if (reportType === "monthly_profit_loss") {
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
  if (!["daily", "performance", "monthly_profit_loss"].includes(reportType)) throw new Error("报表类型无效");
  const reportDate = reportDateValue(payload, reportType);
  const filename = cleanText(payload.filename, 200);
  const mime = cleanText(payload.mime_type, 120);
  if (mime !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    throw new Error("日报、业绩表和月度盈亏表请上传 XLSX 文件");
  }
  let bytes: Uint8Array;
  try { bytes = decodeBase64(cleanText(payload.base64, 15000000)); } catch { throw new Error("报表文件内容无效"); }
  if (!bytes.length || bytes.length > MAX_REPORT_BYTES) throw new Error("报表文件必须小于 10MB");
  const displayData = await workbookDisplay(bytes, reportType);
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  const accountId = cleanText(session.auth_account_id, 40);
  if (!companyId || !storeId || !accountId) throw new Error("财务账号公司、门店或身份范围无效");
  const previous = await restRows(`zysyr_report_uploads?select=id,version&company_id=eq.${companyId}&store_id=eq.${storeId}&report_type=eq.${reportType}&report_date=eq.${reportDate}&order=version.desc&limit=1`);
  const prior = previous[0];
  const version = Number(prior?.version || 0) + 1;
  const extension = "xlsx";
  const objectPath = `${companyId}/${storeId}/${reportType}/${reportDate}/${crypto.randomUUID()}.${extension}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${REPORT_BUCKET}/${storagePath(objectPath)}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": mime, "x-upsert": "false" },
    body: exactArrayBuffer(bytes),
  });
  if (!upload.ok) throw new Error(`报表原件上传失败 (${upload.status})`);
  const metadata = await rest("zysyr_report_uploads", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      company_id: companyId, store_id: storeId, report_type: reportType, report_date: reportDate,
      template_code: reportType === "monthly_profit_loss" ? "zysyr_monthly_profit_loss_original" : `zysyr_${reportType}_original`,
      template_version: 1, version, supersedes_report_id: prior?.id || null,
      original_filename: filename || `report.${extension}`, mime_type: mime, size_bytes: bytes.length,
      sha256: await sha256Bytes(bytes), bucket_id: REPORT_BUCKET, object_path: objectPath,
      display_data: displayData, uploaded_by_user_id: accountId,
    }),
  });
  if (!metadata.ok) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${REPORT_BUCKET}/${storagePath(objectPath)}`, {
      method: "DELETE", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    throw new Error(`报表登记失败 (${metadata.status})`);
  }
  const rows = await metadata.json();
  const saved = rows[0] as JsonRecord;
  if (prior?.id) {
    await rest(`zysyr_report_uploads?id=eq.${encodeURIComponent(cleanText(prior.id, 40))}&company_id=eq.${companyId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "superseded" }),
    });
  }
  return { saved, source_boundary: "finance_uploads_only", original_private: true };
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
  const recordType = cleanText(payload.record_type, 20);
  const recordId = cleanText(payload.record_id, 100);
  const filename = cleanText(payload.filename, 200);
  const mime = cleanText(payload.mime_type, 80);
  if (!recordId || !["expense", "income", "report"].includes(recordType)) throw new Error("凭证关联记录无效");
  if (recordType === "report" && !canUploadReports(session)) throw new Error("只有财务账号可以上传报表消费凭证");
  if (recordType !== "report" && !canWriteExpense(session)) throw new Error("当前角色没有凭证上传权限");
  if (!["image/jpeg", "image/png", "application/pdf"].includes(mime)) throw new Error("凭证仅支持 JPG、PNG 或 PDF");
  const companyId = cleanText(store.company_id, 40);
  const storeId = cleanText(store.id, 40);
  if (recordType === "expense") {
    const records = await restRows(`zysyr_expense_records?select=id&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${encodeURIComponent(recordId)}&limit=1`);
    if (!records.length) throw new Error("费用记录不存在或无权访问");
  }
  if (recordType === "report") {
    const reports = await restRows(`zysyr_report_uploads?select=id&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${encodeURIComponent(recordId)}&limit=1`);
    if (!reports.length) throw new Error("报表不存在或无权关联消费凭证");
  }
  let bytes: Uint8Array;
  try { bytes = decodeBase64(cleanText(payload.base64, 15000000)); } catch { throw new Error("凭证文件内容无效"); }
  if (!bytes.length || bytes.length > MAX_VOUCHER_BYTES) throw new Error("凭证文件必须小于 10MB");
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const objectPath = `${companyId}/${storeId}/${recordType}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${VOUCHER_BUCKET}/${storagePath(objectPath)}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": mime, "x-upsert": "false" },
    body: exactArrayBuffer(bytes),
  });
  if (!upload.ok) throw new Error(`凭证上传失败 (${upload.status})`);
  const metadata = await rest("zysyr_voucher_attachments", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      company_id: companyId, store_id: storeId, store: cleanText(store.name, 100),
      record_type: recordType, record_id: recordId, object_path: objectPath,
      original_filename: filename || `voucher.${extension}`, mime_type: mime, size_bytes: bytes.length,
      sha256: await sha256Bytes(bytes), version: 1,
      note: cleanText(payload.note, 500), uploaded_by: session.username,
      uploaded_by_user_id: cleanText(session.auth_account_id, 40) || null,
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
    const session = await requireSession(payload, request);
    if (operation === "session") return json({ user: await sessionUser(session), expires_at: session.expires_at });
    if (operation === "overview") return json(await overview(payload, session));
    if (operation === "report_upload") return json(await uploadReport(payload, session));
    if (operation === "report_url") return json(await reportUrl(payload, session));
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
