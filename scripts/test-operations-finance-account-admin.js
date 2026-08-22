#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'supabase/functions/operations-auth-admin/index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const authScope = fs.readFileSync(path.join(root, 'supabase/functions/operations-auth/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260813091814_zysyr_finance_account_admin_gate.sql'), 'utf8');
const sprint4 = fs.readFileSync(path.join(root, 'supabase/migrations/20260822015949_zysyr_sprint4_payroll_traceability.sql'), 'utf8');
const html = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(source.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Auth Admin key must remain server-side');
expect(source.includes('/functions/v1/operations-auth'), 'administrator JWT/RLS scope verification missing');
expect(source.includes('finance_account.create'), 'narrow finance-account capability check missing');
expect(source.includes('/auth/v1/admin/users'), 'Supabase Auth Admin user creation missing');
expect(source.includes('email_confirm: true'), 'internal Auth identity must be confirmed without sending email');
expect(source.includes('zysyr_account_id') && source.includes('zysyr_role: "finance"'), 'server-managed Auth identity metadata missing');
expect(source.includes('passwordValue') && source.includes('password.length < 10'), 'password policy missing');
expect(source.includes('deleteAuthUser') && source.includes('已安全回滚'), 'partial Auth creation compensation missing');
expect(source.includes('completedAccount') && source.includes('rpc/zysyr_admin_complete_finance_account'), 'uncertain RPC completion reconciliation missing');
expect(!source.includes('console.log'), 'finance account endpoint must not log request or password data');
expect(!/console\.error\([^\n]*(?:payload|password|authBody)/.test(source), 'finance account endpoint must not log secret-bearing values');
expect(!/return json\([^\n]*password/.test(source), 'finance account endpoint must never return the password');
expect(source.includes('workforce_account.create') && source.includes('create_workforce_account'), 'workforce account capability/action missing');
expect(source.includes('zysyr_employee_id') && source.includes('zysyr_store_id'), 'workforce Auth metadata scope missing');
expect(source.includes('rpc/zysyr_admin_complete_workforce_account'), 'atomic workforce account completion missing');

expect(migration.includes("('finance_account.create', '创建财务账号', 'high')"), 'high-risk account-creation capability missing');
expect(migration.includes("lower(btrim(ua.login_name)) = 'admin'"), 'capability grant must target the exact active admin account');
expect(migration.includes("r.code = 'shareholder'") && migration.includes("g.scope_type = 'company'"), 'admin shareholder company-scope precondition missing');
expect(migration.includes('zysyr_admin_complete_finance_account'), 'atomic finance account completion RPC missing');
expect(migration.includes('from auth.users') && migration.includes('raw_app_meta_data'), 'Auth identity binding validation missing');
expect(migration.includes("'password_storage', 'supabase_auth_only'") && migration.includes("'email_exposed', false"), 'audit boundary provenance missing');
expect(migration.includes("'finance_account_created'"), 'immutable finance-account audit event missing');
expect(migration.includes('security definer\nset search_path = \'\''), 'privileged completion RPC must pin empty search_path');
expect(migration.includes('from public, anon, authenticated, service_role') && migration.includes('to service_role'), 'completion RPC execution boundary missing');
expect(!/\b(insert|update)\s+(?:into\s+)?public\.staff/i.test(migration), 'direct finance Auth must not create or rewrite legacy staff passwords');
expect(!/password_hash/i.test(migration), 'finance account migration must never store a legacy password hash');
expect(sprint4.includes("('workforce_account.create', '创建店长和员工账号', 'high')"), 'separate high-risk workforce capability missing');
expect(sprint4.includes('zysyr_admin_complete_workforce_account') && sprint4.includes("p_role_code not in ('store_manager','employee')"), 'workforce completion role allowlist missing');
expect(sprint4.includes('account.employee_id=p_employee_id') && sprint4.includes("'workforce_account_created'"), 'one-account-per-employee and audit gate missing');

expect(api.includes('async function authSession(request: Request)'), 'operations API Auth JWT session missing');
expect(api.includes('Authorization: authorization') && api.includes('auth_scope_type'), 'operations API must revalidate JWT and preserve scope');
expect(api.includes('can_manage_finance_accounts') && api.includes('finance_account.create'), 'operations session must expose the gated admin entry');
expect(api.includes('can_manage_workforce_accounts') && api.includes('workforce_account.create'), 'operations session must expose workforce account permission');
expect(api.includes('session.auth_capabilities') && api.includes('expense.create_submit'), 'Auth expense writes must follow the V2 capability matrix');
expect(api.includes('cleanText(session.auth_scope_type, 20) === "company"'), 'company-scoped finance store selection missing');
expect(authScope.includes('display_name,login_name,status'), 'Auth scope must return the user-facing login name');
expect(html.includes('密码只发送到受 Supabase Auth 保护的服务端创建接口'), 'password handling explanation missing');
expect(html.includes('autocomplete="new-password"') && html.includes('id="finance-password-confirm"'), 'safe password inputs/confirmation missing');
expect(html.includes('id="finance-role"') && html.includes('id="finance-employee"') && html.includes('createWorkforceAccount'), 'workforce account UI binding missing');

const syntaxProbe = spawnSync(process.execPath, [
  '--experimental-strip-types',
  '--check',
  sourcePath,
], { encoding: 'utf8' });
expect(syntaxProbe.status === 0, `operations-auth-admin TypeScript syntax failed: ${syntaxProbe.stderr}`);

console.log('operations finance-account administrator tests passed');
