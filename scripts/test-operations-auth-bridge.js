#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'operations-auth-bridge.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const releaseVersion = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();

function expect(value, message) {
  if (!value) throw new Error(message);
}

new vm.Script(source, { filename: 'operations-auth-bridge.js' });
expect(source.includes('/functions/v1/operations-auth-migrate'), 'rolling migration endpoint missing');
expect(source.includes('/functions/v1/operations-auth'), 'RLS scope verification endpoint missing');
expect(source.includes('/functions/v1/operations-auth-admin'), 'secure finance-account administration endpoint missing');
expect(source.includes('/auth/v1/token?grant_type=refresh_token'), 'refresh token rotation missing');
expect(source.includes('/auth/v1/logout?scope=local'), 'local Supabase sign-out missing');
expect(source.includes("roleScope(scope,'shareholder')") && source.includes("roleScope(scope,'finance')")
  && source.includes("roleScope(scope,'store_manager')") && source.includes("roleScope(scope,'employee')"), 'all operations Auth role verification missing');
expect(source.includes("capabilityAt(scope,'dashboard.group.read'") && source.includes("capabilityAt(scope,'daily_report.write'"), 'role capability verification missing');
expect(source.includes("scope.auth_boundary!=='supabase_auth_rls'"), 'RLS boundary verification missing');
expect(!/SERVICE_ROLE|service_role|password_hash|legacy_staff_/.test(source), 'browser Auth bridge must not contain privileged or legacy identity material');
expect(!/console\.(?:log|error)/.test(source), 'Auth bridge must not log tokens or credentials');

expect(html.includes(`operations-auth-bridge.js?v=${releaseVersion}`), 'versioned Auth bridge script missing from operations page');
expect(html.includes("['shareholder','finance','store_manager','employee']"), 'all operations roles Auth transition guard missing');
expect(html.includes("authBridge.login(username,password)"), 'shareholder Auth migration call missing');
expect(html.includes("window.ZysyrAuthBridge?") && html.includes("新认证组件暂未就绪"), 'legacy login fallback for bridge loading failure missing');
expect(html.includes("api('login',{username:username,password:password})"), 'legacy session must remain first for no-downtime transition');
expect(html.includes('新认证暂未完成，当前已安全使用旧登录'), 'explicit legacy fallback status missing');
expect(html.includes('Supabase Auth 已验证'), 'successful Auth status missing');
expect(html.includes('仍填写用户名和密码，无需填写邮箱'), 'no-email Auth guidance missing');
expect(html.includes("Promise.allSettled([api('logout'),authBridge.signOut()])"), 'dual-session logout missing');
expect(html.includes('id="finance-account-form"') && html.includes('创建并立即启用'), 'administrator finance-account form missing');
expect(html.includes("authBridge.createFinanceAccount"), 'finance-account form is not wired to the secure Auth bridge');
expect(html.includes("authBridge.createWorkforceAccount"), 'workforce-account form is not wired to the secure Auth bridge');
expect(html.includes("hasAuthCapability('finance_account.create')"), 'finance-account entry must be capability-gated');

async function runBridgeFlow() {
  const values = new Map();
  const calls = [];
  const localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const scope = {
    auth_boundary: 'supabase_auth_rls',
    roles: [{ code: 'shareholder', scope: { type: 'company', store_id: null } }],
    capabilities: [{ code: 'dashboard.group.read', scopes: [{ type: 'company', store_id: null }] }],
  };
  function response(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }
  const window = { localStorage };
  window.window = window;
  window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('operations-auth-migrate')) {
      return response(200, { access_token: 'access-one', refresh_token: 'refresh-one', expires_at: 9999999999, token_type: 'bearer' });
    }
    if (url.includes('grant_type=refresh_token')) {
      return response(200, { access_token: 'access-two', refresh_token: 'refresh-two', expires_at: 9999999999, token_type: 'bearer' });
    }
    if (url.includes('/functions/v1/operations-auth-admin')) return response(200, { created: { login_name: 'finance01', status: 'active' } });
    if (url.includes('/functions/v1/operations-auth')) return response(200, scope);
    if (url.includes('/auth/v1/logout?scope=local')) return response(204, {});
    return response(404, { error: 'unexpected mock URL' });
  };

  vm.runInNewContext(source, { window, Date, JSON, Math, String, Error, Promise });
  const bridge = window.ZysyrAuthBridge.create({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' });
  const loggedIn = await bridge.login('admin', 'existing-password');
  expect(loggedIn.scope.auth_boundary === 'supabase_auth_rls', 'scope verification result was not persisted');
  expect(bridge.read().session.refresh_token === 'refresh-one', 'initial refresh token missing');

  const created = await bridge.createFinanceAccount({
    login_name: 'finance01', display_name: '财务', password: 'SafePass123', scope_type: 'company', store_id: null,
  });
  expect(created.created.login_name === 'finance01', 'finance account response missing');
  const adminCall = calls.find((call) => call.url.includes('operations-auth-admin'));
  expect(adminCall && adminCall.options.headers.Authorization === 'Bearer access-one', 'finance account creation must use the administrator JWT');
  expect(JSON.parse(adminCall.options.body).password === 'SafePass123', 'password must only be sent in the protected request body');
  const workforce = await bridge.createWorkforceAccount({ login_name: 'employee01', display_name: '员工一', password: 'SafePass123',
    role_code: 'employee', store_id: '00000000-0000-0000-0000-000000000002', employee_id: '00000000-0000-0000-0000-000000000003' });
  expect(workforce.created.status === 'active', 'workforce account response missing');
  const workforceCall = calls.filter((call) => call.url.includes('operations-auth-admin')).pop();
  expect(JSON.parse(workforceCall.options.body).action === 'create_workforce_account', 'workforce action missing');
  expect(JSON.parse(workforceCall.options.body).employee_id === '00000000-0000-0000-0000-000000000003', 'employee binding missing');

  const expired = bridge.read();
  expired.session.expires_at = 1;
  localStorage.setItem(window.ZysyrAuthBridge.storageKey, JSON.stringify(expired));
  const restored = await bridge.restore();
  expect(restored.session.access_token === 'access-two', 'expired access token was not refreshed');
  expect(restored.session.refresh_token === 'refresh-two', 'rotated refresh token did not replace the old token');
  expect(calls.some((call) => call.url.includes('grant_type=refresh_token') && JSON.parse(call.options.body).refresh_token === 'refresh-one'), 'refresh request did not use the stored token');

  await bridge.signOut();
  expect(bridge.read() === null, 'local Auth session was not cleared on logout');
  expect(calls.some((call) => call.url.includes('/auth/v1/logout?scope=local')), 'Supabase local sign-out was not requested');
}

runBridgeFlow().then(() => {
  console.log('operations Auth bridge tests passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
