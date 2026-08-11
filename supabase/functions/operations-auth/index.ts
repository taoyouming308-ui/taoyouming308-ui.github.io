const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const DATA_API_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

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

async function authUser(token: string): Promise<JsonRecord> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: DATA_API_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("登录已失效，请重新登录");
  const user = await response.json() as JsonRecord;
  if (!isUuid(user.id)) throw new Error("登录身份无效");
  return user;
}

async function restRows(path: string, token: string): Promise<JsonRecord[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: DATA_API_KEY,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const detail = cleanText(await response.text(), 500);
    console.error("operations-auth Data API error", response.status, detail);
    throw new Error("权限数据读取失败");
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows as JsonRecord[] : [];
}

function activeGrant(row: JsonRecord, today: string): boolean {
  const validFrom = cleanText(row.valid_from, 10);
  const validTo = cleanText(row.valid_to, 10);
  return !row.revoked_at && (!validFrom || validFrom <= today) && (!validTo || validTo >= today);
}

function uuidList(values: unknown[]): string[] {
  return [...new Set(values.map((value) => cleanText(value, 40)).filter(isUuid))];
}

function inFilter(values: string[]): string {
  return `in.(${values.join(",")})`;
}

function scopeOf(row: JsonRecord): JsonRecord {
  const scopeType = cleanText(row.scope_type, 20);
  return {
    type: scopeType,
    store_id: scopeType === "store" ? cleanText(row.store_id, 40) : null,
  };
}

async function loadScope(token: string, authUserId: string): Promise<JsonRecord> {
  const accounts = await restRows(
    `zysyr_user_accounts?select=id,company_id,auth_user_id,employee_id,display_name,status,activated_at&auth_user_id=eq.${authUserId}&limit=1`,
    token,
  );
  const account = accounts[0];
  if (!account || cleanText(account.status, 20) !== "active") {
    throw new Error("经营驾驶舱账号尚未激活");
  }

  const accountId = cleanText(account.id, 40);
  const companyId = cleanText(account.company_id, 40);
  if (!isUuid(accountId) || !isUuid(companyId)) throw new Error("账号范围配置无效");

  const today = new Date().toISOString().slice(0, 10);
  const [rawRoleGrants, rawCapabilityGrants] = await Promise.all([
    restRows(
      `zysyr_user_role_grants?select=id,company_id,role_id,scope_type,store_id,valid_from,valid_to,revoked_at&user_account_id=eq.${accountId}&revoked_at=is.null&limit=500`,
      token,
    ),
    restRows(
      `zysyr_user_capability_grants?select=id,company_id,capability_id,scope_type,store_id,valid_from,valid_to,revoked_at&user_account_id=eq.${accountId}&revoked_at=is.null&limit=500`,
      token,
    ),
  ]);

  const roleGrants = rawRoleGrants.filter((row) => cleanText(row.company_id, 40) === companyId && activeGrant(row, today));
  const capabilityGrants = rawCapabilityGrants.filter((row) => cleanText(row.company_id, 40) === companyId && activeGrant(row, today));
  if (!roleGrants.length) throw new Error("账号尚未配置经营角色");

  const roleIds = uuidList(roleGrants.map((row) => row.role_id));
  const directCapabilityIds = uuidList(capabilityGrants.map((row) => row.capability_id));
  const [roles, roleCapabilities] = await Promise.all([
    roleIds.length
      ? restRows(`zysyr_roles?select=id,code,name,status&id=${inFilter(roleIds)}&status=eq.active&limit=100`, token)
      : Promise.resolve([]),
    roleIds.length
      ? restRows(`zysyr_role_capabilities?select=role_id,capability_id&role_id=${inFilter(roleIds)}&limit=1000`, token)
      : Promise.resolve([]),
  ]);

  const capabilityIds = uuidList([
    ...directCapabilityIds,
    ...roleCapabilities.map((row) => row.capability_id),
  ]);
  const capabilities = capabilityIds.length
    ? await restRows(
      `zysyr_capabilities?select=id,code,name,risk_level&id=${inFilter(capabilityIds)}&limit=1000`,
      token,
    )
    : [];

  const roleById = new Map(roles.map((row) => [cleanText(row.id, 40), row]));
  const capabilityById = new Map(capabilities.map((row) => [cleanText(row.id, 40), row]));
  const roleCapabilityIds = new Map<string, string[]>();
  for (const row of roleCapabilities) {
    const roleId = cleanText(row.role_id, 40);
    const capabilityId = cleanText(row.capability_id, 40);
    const list = roleCapabilityIds.get(roleId) || [];
    if (isUuid(capabilityId)) list.push(capabilityId);
    roleCapabilityIds.set(roleId, list);
  }

  const capabilityScopes = new Map<string, { capability: JsonRecord; scopes: JsonRecord[] }>();
  const appendCapability = (capabilityId: string, scope: JsonRecord) => {
    const capability = capabilityById.get(capabilityId);
    if (!capability) return;
    const code = cleanText(capability.code, 100);
    const entry = capabilityScopes.get(code) || { capability, scopes: [] };
    const scopeKey = `${scope.type}:${scope.store_id || "company"}`;
    if (!entry.scopes.some((item) => `${item.type}:${item.store_id || "company"}` === scopeKey)) {
      entry.scopes.push(scope);
    }
    capabilityScopes.set(code, entry);
  };

  for (const grant of roleGrants) {
    const roleId = cleanText(grant.role_id, 40);
    const scope = scopeOf(grant);
    for (const capabilityId of roleCapabilityIds.get(roleId) || []) appendCapability(capabilityId, scope);
  }
  for (const grant of capabilityGrants) appendCapability(cleanText(grant.capability_id, 40), scopeOf(grant));

  const stores = await restRows(
    `zysyr_stores?select=id,company_id,code,name,city,status&company_id=eq.${companyId}&status=eq.active&order=name.asc&limit=500`,
    token,
  );

  return {
    auth_boundary: "supabase_auth_rls",
    legacy_login: "read_only_transition",
    user: {
      id: accountId,
      auth_user_id: authUserId,
      company_id: companyId,
      employee_id: isUuid(account.employee_id) ? cleanText(account.employee_id, 40) : null,
      display_name: cleanText(account.display_name, 120),
    },
    roles: roleGrants.map((grant) => {
      const role = roleById.get(cleanText(grant.role_id, 40)) || {};
      return { code: cleanText(role.code, 80), name: cleanText(role.name, 100), scope: scopeOf(grant) };
    }),
    capabilities: [...capabilityScopes.values()]
      .map(({ capability, scopes }) => ({
        code: cleanText(capability.code, 100),
        name: cleanText(capability.name, 120),
        risk_level: cleanText(capability.risk_level, 20),
        scopes,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    stores,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "仅支持 POST" }, 405);
  if (!SUPABASE_URL || !DATA_API_KEY) return json({ error: "认证服务配置不完整" }, 500);

  try {
    const token = bearerToken(req);
    const user = await authUser(token);
    return json(await loadScope(token, cleanText(user.id, 40)));
  } catch (error) {
    const message = cleanText(error instanceof Error ? error.message : error, 300) || "认证失败";
    const status = /读取失败|配置/.test(message) ? 500 : /尚未|权限/.test(message) ? 403 : 401;
    return json({ error: message }, status);
  }
});
