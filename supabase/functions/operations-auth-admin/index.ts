import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanText(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanText(value, 40));
}

function bearerToken(req: Request): string {
  const header = cleanText(req.headers.get("authorization"), 9000);
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || match[1].length < 20 || match[1].length > 8192) throw new Error("请重新登录");
  return match[1];
}

function loginName(value: unknown): string {
  const normalized = cleanText(value, 80).toLocaleLowerCase("zh-CN");
  if (!/^[a-z0-9_\-\u3400-\u9fff]{2,40}$/.test(normalized)) {
    throw new Error("账号需为2至40位中文、字母、数字、下划线或短横线");
  }
  return normalized;
}

function passwordValue(value: unknown): string {
  const password = String(value ?? "");
  if (password.length < 10 || password.length > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("密码需为10至72位，并同时包含字母和数字");
  }
  if (/\s/.test(password)) throw new Error("密码不能包含空格");
  return password;
}

async function serviceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
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
  const response = await serviceFetch(`/rest/v1/${path}`);
  if (!response.ok) throw new Error(`service_read_${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows as JsonRecord[] : [];
}

async function authScope(token: string): Promise<JsonRecord> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/operations-auth`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) throw new Error("管理员认证失败");
  return await response.json() as JsonRecord;
}

function hasCompanyCapability(scope: JsonRecord, code: string): boolean {
  const capabilities = Array.isArray(scope.capabilities) ? scope.capabilities as JsonRecord[] : [];
  return capabilities.some((capability) => cleanText(capability.code, 100) === code
    && Array.isArray(capability.scopes)
    && (capability.scopes as JsonRecord[]).some((item) => cleanText(item.type, 20) === "company"));
}

async function deleteAuthUser(authUserId: string): Promise<void> {
  const response = await serviceFetch(`/auth/v1/admin/users/${authUserId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`auth_cleanup_${response.status}`);
}

async function completedAccount(accountId: string, authUserId: string): Promise<JsonRecord | null> {
  const rows = await restRows(
    `zysyr_user_accounts?select=id,login_name,display_name,employee_id,status&id=eq.${accountId}&auth_user_id=eq.${authUserId}&limit=1`,
  );
  return rows[0] || null;
}

async function createWorkforceAccount(req: Request, payload: JsonRecord): Promise<Response> {
  const token = bearerToken(req);
  const scope = await authScope(token);
  const user = scope.user && typeof scope.user === "object" ? scope.user as JsonRecord : {};
  const actorAuthUserId = cleanText(user.auth_user_id, 40);
  const companyId = cleanText(user.company_id, 40);
  if (cleanText(scope.auth_boundary, 80) !== "supabase_auth_rls" || !isUuid(actorAuthUserId)
      || !isUuid(companyId) || !hasCompanyCapability(scope, "workforce_account.create")) {
    throw new Error("只有已授权管理员可以创建店长或员工账号");
  }
  const username = loginName(payload.login_name);
  const displayName = cleanText(payload.display_name, 80);
  if (displayName.length < 2) throw new Error("请填写至少2个字的姓名或称呼");
  const password = passwordValue(payload.password);
  const roleCode = cleanText(payload.role_code, 30);
  const storeId = cleanText(payload.store_id, 40);
  const employeeId = cleanText(payload.employee_id, 40);
  if (!["store_manager", "employee"].includes(roleCode)) throw new Error("请选择店长或员工角色");
  if (!isUuid(storeId) || !isUuid(employeeId)) throw new Error("请选择所属门店和对应员工");
  const stores = Array.isArray(scope.stores) ? scope.stores as JsonRecord[] : [];
  if (!stores.some((store) => cleanText(store.id, 40) === storeId
      && cleanText(store.company_id, 40) === companyId && cleanText(store.status, 20) === "active")) {
    throw new Error("所选门店不在管理员授权范围内");
  }
  const [employees, accounts, legacyStaff] = await Promise.all([
    restRows(`zysyr_employees?select=id,name,employment_status,deleted_at&company_id=eq.${companyId}&store_id=eq.${storeId}&id=eq.${employeeId}&limit=1`),
    restRows(`zysyr_user_accounts?select=id,login_name,employee_id&company_id=eq.${companyId}&limit=1000`),
    restRows("staff?select=id,username&limit=1000"),
  ]);
  const employee = employees[0];
  if (!employee || cleanText(employee.employment_status, 30) !== "active" || employee.deleted_at) {
    throw new Error("所选员工不是该门店的在职员工");
  }
  if (accounts.some((account) => cleanText(account.employee_id, 40) === employeeId)) {
    return json({ error: "该员工已经绑定登录账号" }, 409);
  }
  if (accounts.some((account) => cleanText(account.login_name, 80).toLocaleLowerCase("zh-CN") === username)
      || legacyStaff.some((staff) => cleanText(staff.username, 80).toLocaleLowerCase("zh-CN") === username)) {
    return json({ error: "该账号已存在，请更换账号" }, 409);
  }
  const requestId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const email = `zysyr_account_${accountId.replaceAll("-", "")}@auth.zysyr.invalid`;
  const authResponse = await serviceFetch("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({
    email, password, email_confirm: true,
    app_metadata: { zysyr_account_id: accountId, zysyr_company_id: companyId,
      zysyr_login_name: username, zysyr_role: roleCode, zysyr_store_id: storeId,
      zysyr_employee_id: employeeId, zysyr_provisioning: "admin_direct_v2" },
  }) });
  if (!authResponse.ok) throw new Error(`auth_admin_create_${authResponse.status}`);
  const authBody = await authResponse.json() as JsonRecord;
  const authUser = isUuid(authBody.id) ? authBody
    : authBody.user && typeof authBody.user === "object" ? authBody.user as JsonRecord : {};
  const authUserId = cleanText(authUser.id, 40);
  if (!isUuid(authUserId)) throw new Error("auth_admin_create_invalid_user");
  let completed: JsonRecord | null = null;
  try {
    const rpcResponse = await serviceFetch("/rest/v1/rpc/zysyr_admin_complete_workforce_account", {
      method: "POST", body: JSON.stringify({ p_actor_auth_user_id: actorAuthUserId,
        p_account_id: accountId, p_auth_user_id: authUserId, p_login_name: username,
        p_display_name: displayName, p_role_code: roleCode, p_store_id: storeId,
        p_employee_id: employeeId, p_request_id: requestId }),
    });
    if (rpcResponse.ok) completed = await rpcResponse.json() as JsonRecord;
    else completed = await completedAccount(accountId, authUserId);
  } catch { completed = await completedAccount(accountId, authUserId).catch(() => null); }
  if (!completed || cleanText(completed.status, 20) !== "active"
      || cleanText(completed.employee_id, 40) !== employeeId) {
    try { await deleteAuthUser(authUserId); } catch (cleanupError) {
      console.error("operations-auth-admin workforce cleanup", requestId, cleanText(cleanupError, 100));
    }
    throw new Error("经营账号创建未完成，已安全回滚，请重试");
  }
  return json({ created: { account_id: cleanText(completed.account_id || completed.id, 40) || accountId,
    login_name: cleanText(completed.login_name, 80) || username,
    display_name: cleanText(completed.display_name, 80) || displayName,
    role: roleCode, scope_type: "store", store_id: storeId,
    store_name: cleanText(completed.store_name, 100) || null,
    employee_id: employeeId, employee_name: cleanText(completed.employee_name, 100) || cleanText(employee.name, 100),
    status: "active" } });
}

async function createFinanceAccount(req: Request, payload: JsonRecord): Promise<Response> {
  const token = bearerToken(req);
  const scope = await authScope(token);
  const user = scope.user && typeof scope.user === "object" ? scope.user as JsonRecord : {};
  const actorAuthUserId = cleanText(user.auth_user_id, 40);
  const companyId = cleanText(user.company_id, 40);
  if (cleanText(scope.auth_boundary, 80) !== "supabase_auth_rls"
      || !isUuid(actorAuthUserId)
      || !isUuid(companyId)
      || !hasCompanyCapability(scope, "finance_account.create")) {
    throw new Error("只有已授权管理员可以创建财务账号");
  }

  const username = loginName(payload.login_name);
  const displayName = cleanText(payload.display_name, 80);
  if (displayName.length < 2) throw new Error("请填写至少2个字的姓名或称呼");
  const password = passwordValue(payload.password);
  const scopeType = cleanText(payload.scope_type, 20);
  const storeId = cleanText(payload.store_id, 40);
  if (scopeType !== "company" && scopeType !== "store") throw new Error("请选择财务权限范围");
  if (scopeType === "store" && !isUuid(storeId)) throw new Error("请选择财务所属门店");

  const stores = Array.isArray(scope.stores) ? scope.stores as JsonRecord[] : [];
  if (scopeType === "store" && !stores.some((store) => cleanText(store.id, 40) === storeId
      && cleanText(store.company_id, 40) === companyId
      && cleanText(store.status, 20) === "active")) {
    throw new Error("所选门店不在管理员授权范围内");
  }

  const [accounts, legacyStaff] = await Promise.all([
    restRows(`zysyr_user_accounts?select=id,login_name&company_id=eq.${companyId}&limit=1000`),
    restRows("staff?select=id,username&limit=1000"),
  ]);
  if (accounts.some((account) => cleanText(account.login_name, 80).toLocaleLowerCase("zh-CN") === username)
      || legacyStaff.some((staff) => cleanText(staff.username, 80).toLocaleLowerCase("zh-CN") === username)) {
    return json({ error: "该账号已存在，请更换账号" }, 409);
  }

  const requestId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const email = `zysyr_account_${accountId.replaceAll("-", "")}@auth.zysyr.invalid`;
  const authResponse = await serviceFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        zysyr_account_id: accountId,
        zysyr_company_id: companyId,
        zysyr_login_name: username,
        zysyr_role: "finance",
        zysyr_provisioning: "admin_direct_v1",
      },
    }),
  });
  if (!authResponse.ok) throw new Error(`auth_admin_create_${authResponse.status}`);
  const authBody = await authResponse.json() as JsonRecord;
  const authUser = isUuid(authBody.id)
    ? authBody
    : authBody.user && typeof authBody.user === "object" ? authBody.user as JsonRecord : {};
  const authUserId = cleanText(authUser.id, 40);
  if (!isUuid(authUserId)) throw new Error("auth_admin_create_invalid_user");

  let completed: JsonRecord | null = null;
  try {
    const rpcResponse = await serviceFetch("/rest/v1/rpc/zysyr_admin_complete_finance_account", {
      method: "POST",
      body: JSON.stringify({
        p_actor_auth_user_id: actorAuthUserId,
        p_account_id: accountId,
        p_auth_user_id: authUserId,
        p_login_name: username,
        p_display_name: displayName,
        p_scope_type: scopeType,
        p_store_id: scopeType === "store" ? storeId : null,
        p_request_id: requestId,
      }),
    });
    if (rpcResponse.ok) completed = await rpcResponse.json() as JsonRecord;
    else completed = await completedAccount(accountId, authUserId);
  } catch {
    completed = await completedAccount(accountId, authUserId).catch(() => null);
  }

  if (!completed || cleanText(completed.status, 20) !== "active") {
    try {
      await deleteAuthUser(authUserId);
    } catch (cleanupError) {
      console.error("operations-auth-admin cleanup", requestId, cleanText(cleanupError, 100));
    }
    throw new Error("财务账号创建未完成，已安全回滚，请重试");
  }

  return json({
    created: {
      account_id: cleanText(completed.account_id || completed.id, 40) || accountId,
      login_name: cleanText(completed.login_name, 80) || username,
      display_name: cleanText(completed.display_name, 80) || displayName,
      role: "finance",
      scope_type: cleanText(completed.scope_type, 20) || scopeType,
      store_id: cleanText(completed.store_id, 40) || null,
      store_name: cleanText(completed.store_name, 100) || null,
      status: "active",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "仅支持 POST" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "账号管理服务尚未配置" }, 503);

  let payload: JsonRecord;
  try {
    payload = await req.json() as JsonRecord;
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }

  try {
    const action = cleanText(payload.action, 40);
    if (action === "create_finance_account") return await createFinanceAccount(req, payload);
    if (action === "create_workforce_account") return await createWorkforceAccount(req, payload);
    return json({ error: "不支持的操作" }, 400);
  } catch (error) {
    const message = cleanText(error instanceof Error ? error.message : error, 300) || "经营账号创建失败";
    const status = /重新登录|认证/.test(message) ? 401 : /只有已授权|权限范围/.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }
});
