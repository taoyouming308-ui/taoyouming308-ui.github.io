import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DATA_API_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const GENERIC_LOGIN_ERROR = "账号或密码错误，或账号尚未开放迁移";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function verifyLegacyPassword(storedValue: unknown, password: string): Promise<boolean> {
  const stored = cleanText(storedValue, 300);
  const inputHash = await sha256(password);
  if (/^sha256:[0-9a-f]{64}$/.test(stored)) return constantTimeHexEqual(stored.slice(7), inputHash);
  if (/^[0-9a-f]{64}$/.test(stored)) return constantTimeHexEqual(stored, inputHash);
  if (!stored) return false;
  return constantTimeHexEqual(await sha256(stored), inputHash);
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

async function rpc(name: string, body: JsonRecord): Promise<unknown> {
  const response = await serviceFetch(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`service_rpc_${name}_${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

function clientAddress(req: Request): string {
  const cloudflare = cleanText(req.headers.get("cf-connecting-ip"), 100);
  const forwarded = cleanText(req.headers.get("x-forwarded-for"), 500).split(",")[0]?.trim() || "";
  return cloudflare || forwarded || "unknown";
}

async function recordResult(
  identityHash: string,
  clientHash: string,
  requestId: string,
  eventType: "failure" | "success",
  reasonCode: string,
): Promise<void> {
  await rpc("zysyr_record_auth_migration_result", {
    p_identity_hash: identityHash,
    p_client_hash: clientHash,
    p_request_id: requestId,
    p_event_type: eventType,
    p_reason_code: reasonCode,
  });
}

async function signIn(email: string, password: string): Promise<JsonRecord | null> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: DATA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return null;
  const session = await response.json() as JsonRecord;
  return cleanText(session.access_token, 9000) && cleanText(session.refresh_token, 9000) ? session : null;
}

async function findAdminUser(email: string): Promise<JsonRecord | null> {
  const response = await serviceFetch("/auth/v1/admin/users?page=1&per_page=1000");
  if (!response.ok) throw new Error(`auth_admin_list_${response.status}`);
  const body = await response.json() as JsonRecord;
  const users = Array.isArray(body.users) ? body.users as JsonRecord[] : [];
  return users.find((user) => cleanText(user.email, 320).toLowerCase() === email) || null;
}

async function findAdminUserById(authUserId: string): Promise<JsonRecord | null> {
  if (!isUuid(authUserId)) return null;
  const response = await serviceFetch(`/auth/v1/admin/users/${authUserId}`);
  if (!response.ok) return null;
  const body = await response.json() as JsonRecord;
  return isUuid(body.id) ? body : (body.user && typeof body.user === "object" ? body.user as JsonRecord : null);
}

async function createOrRecoverAuthUser(
  email: string,
  password: string,
  employeeId: string,
  allowlistId: string,
  legacyStaffId: number,
): Promise<JsonRecord> {
  const response = await serviceFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        zysyr_employee_id: employeeId,
        zysyr_allowlist_id: allowlistId,
        zysyr_legacy_staff_id: legacyStaffId,
        zysyr_migration: "legacy_password_bootstrap_v1",
      },
    }),
  });

  let user: JsonRecord | null = null;
  if (response.ok) {
    const body = await response.json() as JsonRecord;
    user = isUuid(body.id) ? body : (body.user && typeof body.user === "object" ? body.user as JsonRecord : null);
  } else if (response.status === 422 || response.status === 409) {
    user = await findAdminUser(email);
  }

  const appMetadata = user?.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata as JsonRecord : {};
  if (!user || !isUuid(user.id)
      || cleanText(user.email, 320).toLowerCase() !== email
      || cleanText(appMetadata.zysyr_employee_id, 40) !== employeeId
      || cleanText(appMetadata.zysyr_allowlist_id, 40) !== allowlistId) {
    throw new Error(`auth_admin_create_${response.status}`);
  }
  return user;
}

function sessionPayload(session: JsonRecord, account: JsonRecord): JsonRecord {
  return {
    access_token: cleanText(session.access_token, 9000),
    refresh_token: cleanText(session.refresh_token, 9000),
    expires_in: Number(session.expires_in) || null,
    expires_at: Number(session.expires_at) || null,
    token_type: cleanText(session.token_type, 40) || "bearer",
    account,
    auth_boundary: "supabase_auth_rolling_migration",
  };
}

async function passwordLogin(req: Request, payload: JsonRecord): Promise<Response> {
  const username = cleanText(payload.username, 80);
  const password = cleanText(payload.password, 256);
  if (!username || !password) return json({ error: GENERIC_LOGIN_ERROR }, 403);

  const requestId = crypto.randomUUID();
  const [identityHash, clientHash] = await Promise.all([
    hmacSha256(`identity:${username}`),
    hmacSha256(`client:${clientAddress(req)}`),
  ]);

  const gate = await rpc("zysyr_begin_auth_migration", {
    p_identity_hash: identityHash,
    p_client_hash: clientHash,
    p_request_id: requestId,
  }) as JsonRecord;
  if (!gate?.allowed) return json({ error: "尝试次数过多，请15分钟后再试", retry_after_seconds: 900 }, 429);

  try {
    const directAccountRows = await restRows(
      `zysyr_user_accounts?select=id,company_id,auth_user_id,employee_id,login_name,display_name,status&login_name=eq.${encodeURIComponent(username.toLocaleLowerCase("zh-CN"))}&status=eq.active&limit=2`,
    );
    if (directAccountRows.length === 1) {
      const directAccount = directAccountRows[0];
      const accountId = cleanText(directAccount.id, 40);
      const authUserId = cleanText(directAccount.auth_user_id, 40);
      const financeRoles = await restRows("zysyr_roles?select=id&code=eq.finance&status=eq.active&limit=1");
      const financeRoleId = cleanText(financeRoles[0]?.id, 40);
      const financeGrants = isUuid(accountId) && isUuid(financeRoleId)
        ? await restRows(
          `zysyr_user_role_grants?select=id,scope_type,store_id,valid_from,valid_to,revoked_at&user_account_id=eq.${accountId}&role_id=eq.${financeRoleId}&revoked_at=is.null&valid_from=lte.${new Date().toISOString().slice(0, 10)}&limit=2`,
        )
        : [];
      const today = new Date().toISOString().slice(0, 10);
      const activeFinanceGrant = financeGrants.find((grant) => {
        const validTo = cleanText(grant.valid_to, 10);
        const scopeType = cleanText(grant.scope_type, 20);
        return (!validTo || validTo >= today)
          && (scopeType === "company" || (scopeType === "store" && isUuid(grant.store_id)));
      });

      if (activeFinanceGrant) {
        const authUser = await findAdminUserById(authUserId);
        const appMetadata = authUser?.app_metadata && typeof authUser.app_metadata === "object"
          ? authUser.app_metadata as JsonRecord
          : {};
        const email = cleanText(authUser?.email, 320).toLowerCase();
        if (!authUser || !isUuid(authUserId)
            || cleanText(appMetadata.zysyr_account_id, 40) !== accountId
            || cleanText(appMetadata.zysyr_company_id, 40) !== cleanText(directAccount.company_id, 40)
            || cleanText(appMetadata.zysyr_login_name, 80) !== username.toLocaleLowerCase("zh-CN")
            || cleanText(appMetadata.zysyr_role, 40) !== "finance"
            || !/^zysyr_account_[0-9a-f]{32}@auth\.zysyr\.invalid$/.test(email)) {
          await recordResult(identityHash, clientHash, requestId, "failure", "direct_identity_mismatch");
          return json({ error: GENERIC_LOGIN_ERROR }, 403);
        }

        const session = await signIn(email, password);
        const sessionUser = session?.user && typeof session.user === "object" ? session.user as JsonRecord : {};
        if (!session || cleanText(sessionUser.id, 40) !== authUserId) {
          await recordResult(identityHash, clientHash, requestId, "failure", "auth_rejected");
          return json({ error: GENERIC_LOGIN_ERROR }, 403);
        }

        await recordResult(identityHash, clientHash, requestId, "success", "direct_auth_login");
        return json(sessionPayload(session, directAccount));
      }
    }

    const allowRows = await restRows(
      `zysyr_auth_migration_allowlist?select=id,company_id,employee_id,legacy_staff_id,login_name,role_id,scope_type,store_id,status,expires_at&login_name=eq.${encodeURIComponent(username)}&status=eq.approved&limit=1`,
    );
    const approved = allowRows[0];
    const allowlistId = cleanText(approved?.id, 40);
    const employeeId = cleanText(approved?.employee_id, 40);
    const legacyStaffId = Number(approved?.legacy_staff_id);
    if (!approved || !isUuid(allowlistId) || !isUuid(employeeId) || !Number.isInteger(legacyStaffId)) {
      await recordResult(identityHash, clientHash, requestId, "failure", "not_allowlisted");
      return json({ error: GENERIC_LOGIN_ERROR }, 403);
    }

    const [staffRows, employeeRows, accountRows] = await Promise.all([
      restRows(`staff?select=id,username,password_hash,active,employment_status&id=eq.${legacyStaffId}&username=eq.${encodeURIComponent(username)}&limit=1`),
      restRows(`zysyr_employees?select=id,company_id,store_id,employee_code,name,employment_status&id=eq.${employeeId}&company_id=eq.${cleanText(approved.company_id, 40)}&limit=1`),
      restRows(`zysyr_user_accounts?select=id,company_id,auth_user_id,employee_id,login_name,status&employee_id=eq.${employeeId}&limit=1`),
    ]);
    const staff = staffRows[0];
    const employee = employeeRows[0];
    if (!staff || staff.active !== true || cleanText(staff.employment_status, 40) !== "active"
        || !employee || cleanText(employee.employment_status, 40) !== "active") {
      await recordResult(identityHash, clientHash, requestId, "failure", "inactive_identity");
      return json({ error: GENERIC_LOGIN_ERROR }, 403);
    }

    const email = `legacy_staff_${legacyStaffId}@auth.zysyr.invalid`;
    const existingAccount = accountRows[0];
    if (existingAccount) {
      if (cleanText(existingAccount.status, 20) !== "active" || !isUuid(existingAccount.auth_user_id)
          || cleanText(existingAccount.company_id, 40) !== cleanText(approved.company_id, 40)
          || cleanText(existingAccount.employee_id, 40) !== employeeId
          || cleanText(existingAccount.login_name, 80).toLowerCase() !== username.toLowerCase()) {
        await recordResult(identityHash, clientHash, requestId, "failure", "inactive_account");
        return json({ error: GENERIC_LOGIN_ERROR }, 403);
      }
      const session = await signIn(email, password);
      const authUser = session?.user && typeof session.user === "object" ? session.user as JsonRecord : {};
      const authMetadata = authUser.app_metadata && typeof authUser.app_metadata === "object"
        ? authUser.app_metadata as JsonRecord
        : {};
      if (!session
          || cleanText(authUser.id, 40) !== cleanText(existingAccount.auth_user_id, 40)
          || cleanText(authMetadata.zysyr_employee_id, 40) !== employeeId
          || cleanText(authMetadata.zysyr_allowlist_id, 40) !== allowlistId) {
        await recordResult(identityHash, clientHash, requestId, "failure", "auth_rejected");
        return json({ error: GENERIC_LOGIN_ERROR }, 403);
      }
      await recordResult(identityHash, clientHash, requestId, "success", "auth_login");
      return json(sessionPayload(session, existingAccount));
    }

    if (!await verifyLegacyPassword(staff.password_hash, password)) {
      await recordResult(identityHash, clientHash, requestId, "failure", "legacy_rejected");
      return json({ error: GENERIC_LOGIN_ERROR }, 403);
    }

    const authUser = await createOrRecoverAuthUser(email, password, employeeId, allowlistId, legacyStaffId);
    const account = await rpc("zysyr_complete_auth_migration", {
      p_allowlist_id: allowlistId,
      p_auth_user_id: cleanText(authUser.id, 40),
      p_request_id: requestId,
    }) as JsonRecord;
    const session = await signIn(email, password);
    if (!session) throw new Error("auth_signin_after_migration");

    await recordResult(identityHash, clientHash, requestId, "success", "legacy_migrated");
    return json(sessionPayload(session, account));
  } catch (error) {
    const reason = cleanText(error instanceof Error ? error.message : error, 80).replace(/[^a-zA-Z0-9_:-]/g, "_") || "internal_failure";
    try {
      await recordResult(identityHash, clientHash, requestId, "failure", reason);
    } catch {
      // Do not expose telemetry failures or credentials to the caller.
    }
    console.error("operations-auth-migrate", requestId, reason);
    return json({ error: GENERIC_LOGIN_ERROR }, 403);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "仅支持 POST" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !DATA_API_KEY) return json({ error: "认证迁移服务尚未配置" }, 503);

  let payload: JsonRecord;
  try {
    payload = await req.json() as JsonRecord;
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }

  const action = cleanText(payload.action, 40);
  if (action !== "password_login") return json({ error: "不支持的操作" }, 400);
  return passwordLogin(req, payload);
});
