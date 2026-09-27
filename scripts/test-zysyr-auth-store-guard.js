#!/usr/bin/env node
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'supabase/functions/operations-auth-migrate/index.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import\s+"jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\s*/m, '')
  .replace('Deno.serve(async (req: Request) => {', 'globalThis.__handler = async (req) => {')
  .replace(/\n\}\);\s*$/, '\n};');
const jsSource = stripTypeScriptTypes(source, { mode: 'strip' });

const companyId = '123e4567-e89b-42d3-a456-426614174000';
const employeeId = '123e4567-e89b-42d3-a456-426614174001';
const storeId = '123e4567-e89b-42d3-a456-426614174002';
const allowlistId = '123e4567-e89b-42d3-a456-426614174003';
const financeRoleId = '123e4567-e89b-42d3-a456-426614174004';
const legacyStaffId = 314;
const password = 'synthetic-password-only';
const authUserId = '123e4567-e89b-42d3-a456-426614174005';
const directAccountId = '123e4567-e89b-42d3-a456-426614174006';
let directLoginMode = false;
let storeName = '自由手艺人';
const passwordHash = `sha256:${crypto.createHash('sha256').update(password).digest('hex')}`;
const calls = [];
const serviceResults = {
  allowed: [{ allowed: true }],
  'zysyr_auth_migration_allowlist?': [{
    id: allowlistId,
    company_id: companyId,
    employee_id: employeeId,
    legacy_staff_id: legacyStaffId,
    login_name: '测试员工',
    role_id: financeRoleId,
    scope_type: 'store',
    store_id: storeId,
    status: 'approved',
  }],
  'staff?': [{
    id: legacyStaffId,
    username: '测试员工',
    password_hash: passwordHash,
    store: '向里造型',
    active: true,
    employment_status: 'active',
  }],
  'zysyr_employees?': [{
    id: employeeId,
    company_id: companyId,
    store_id: storeId,
    employee_code: 'synthetic-employee',
    name: '合成测试员工',
    employment_status: 'active',
  }],
  'zysyr_user_accounts?': [],
  'zysyr_legacy_id_map?': [{ target_id: employeeId, mapping_status: 'mapped' }],
  'zysyr_stores?': [{ id: storeId, company_id: companyId, name: storeName, status: 'active' }],
};

function response(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function fakeFetch(input, init = {}) {
  const url = new URL(String(input));
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  calls.push({ url: url.pathname + url.search, method: init.method || 'GET', body });
  if (url.pathname.endsWith('/rpc/zysyr_begin_auth_migration')) return response({ allowed: true });
  if (url.pathname.endsWith('/rpc/zysyr_complete_auth_migration')) return response({
    id: '123e4567-e89b-42d3-a456-426614174006',
    company_id: companyId,
    employee_id: employeeId,
    auth_user_id: authUserId,
    login_name: '测试员工',
    display_name: '合成测试员工',
    status: 'active',
  });
  if (url.pathname.endsWith('/rpc/zysyr_record_auth_migration_result')) return response(null, 204);
  if (directLoginMode && url.pathname.endsWith('/zysyr_user_accounts')) return response([{
    id: directAccountId,
    company_id: companyId,
    auth_user_id: authUserId,
    employee_id: employeeId,
    login_name: '测试员工',
    display_name: '合成测试员工',
    status: 'active',
  }]);
  if (directLoginMode && url.pathname.endsWith('/zysyr_roles')) return response([{ id: financeRoleId }]);
  if (directLoginMode && url.pathname.endsWith('/zysyr_user_role_grants')) return response([{
    id: '123e4567-e89b-42d3-a456-426614174007',
    scope_type: 'store',
    store_id: storeId,
    valid_to: null,
    revoked_at: null,
  }]);
  if (directLoginMode && url.pathname.endsWith(`/auth/v1/admin/users/${authUserId}`)) return response({
    id: authUserId,
    email: 'zysyr_account_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@auth.zysyr.invalid',
    app_metadata: {
      zysyr_account_id: directAccountId,
      zysyr_company_id: companyId,
      zysyr_login_name: '测试员工',
      zysyr_role: 'finance',
      zysyr_migration: 'legacy_password_bootstrap_v1',
      zysyr_legacy_staff_id: legacyStaffId,
    },
  });
  if (url.pathname.endsWith('/auth/v1/admin/users') && init.method === 'POST') {
    return response({
      id: authUserId,
      email: `legacy_staff_${legacyStaffId}@auth.zysyr.invalid`,
      app_metadata: { zysyr_employee_id: employeeId, zysyr_allowlist_id: allowlistId },
    });
  }
  if (url.pathname.endsWith('/auth/v1/token')) {
    return response({
      access_token: 'synthetic-access-token',
      refresh_token: 'synthetic-refresh-token',
      expires_in: 3600,
      user: { id: authUserId },
    });
  }
  const result = Object.entries(serviceResults).find(([prefix]) => url.pathname.endsWith(`/${prefix.split('?')[0]}`))?.[1];
  if (result === undefined) throw new Error(`unexpected synthetic request: ${url.pathname}${url.search}`);
  return response(result);
}

const context = {
  Deno: { env: { get: (key) => ({
    SUPABASE_URL: 'https://synthetic.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    SUPABASE_PUBLISHABLE_KEY: 'synthetic-publishable-key',
  })[key] || '' } },
  crypto: crypto.webcrypto,
  TextEncoder,
  Request,
  Response,
  URL,
  fetch: fakeFetch,
  console: { error() {} },
};
vm.runInNewContext(jsSource, context, { filename: sourcePath });

async function runLogin() {
  const req = new Request('https://edge.synthetic.test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'password_login', username: '测试员工', password }),
  });
  return context.__handler(req);
}

(async () => {
  const mismatch = await runLogin();
  assert.equal(mismatch.status, 403, 'cross-store legacy mapping should fail closed');
  assert.deepEqual(await mismatch.json(), { error: '账号或密码错误，或账号尚未开放迁移' });
  assert.equal(calls.filter((call) => call.url.includes('/auth/v1/')).length, 0, 'must not create an Auth user or issue a password session');
  const resultEvent = calls.find((call) => call.url.endsWith('/rpc/zysyr_record_auth_migration_result'));
  assert.equal(resultEvent?.body?.p_reason_code, 'store_mapping_mismatch', 'must leave a fixed, non-identifying audit reason');

  calls.length = 0;
  directLoginMode = true;
  const directMismatch = await runLogin();
  assert.equal(directMismatch.status, 403, 'direct migrated finance login must reject a cross-store legacy mapping');
  assert.deepEqual(await directMismatch.json(), { error: '账号或密码错误，或账号尚未开放迁移' });
  assert.equal(calls.filter((call) => call.url.includes('/auth/v1/token?grant_type=password')).length, 0, 'mismatched direct migrated login must be rejected before password sign-in');
  const directResultEvent = calls.find((call) => call.url.endsWith('/rpc/zysyr_record_auth_migration_result'));
  assert.equal(directResultEvent?.body?.p_reason_code, 'store_mapping_mismatch');

  calls.length = 0;
  directLoginMode = false;
  storeName = '向里造型';
  serviceResults['zysyr_stores?'][0].name = storeName;
  const matched = await runLogin();
  assert.equal(matched.status, 200, 'same-store allowlisted migration should preserve the existing login flow');
  const payload = await matched.json();
  assert.equal(payload.auth_boundary, 'supabase_auth_rolling_migration');
  assert.equal(payload.access_token, 'synthetic-access-token');
  assert.equal(calls.filter((call) => call.url.endsWith('/auth/v1/admin/users') && call.method === 'POST').length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/auth/v1/token?grant_type=password')).length, 1);
  console.log('ZYSYR Auth store guard blocks both cross-store login paths and preserves same-store migration login.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
