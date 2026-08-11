#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'supabase/functions/operations-auth-migrate/index.ts');
const migrationPath = path.join(root, 'supabase/migrations/20260811035138_zysyr_auth_rolling_migration.sql');
const allowlistPath = path.join(root, 'supabase/migrations/20260811040207_zysyr_gate_c1_admin_shareholder_allowlist.sql');
const source = fs.readFileSync(sourcePath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');
const allowlist = fs.readFileSync(allowlistPath, 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(source.includes('action !== "password_login"'), 'migration function must expose only password_login');
expect(source.includes('SUPABASE_SERVICE_ROLE_KEY'), 'trusted Auth Admin boundary missing');
expect(source.includes('SUPABASE_PUBLISHABLE_KEY'), 'password token exchange must use publishable key');
expect(source.includes('/auth/v1/admin/users'), 'Auth Admin create/recovery route missing');
expect(source.includes('/auth/v1/token?grant_type=password'), 'standard Supabase password login missing');
expect(source.includes('email_confirm: true'), 'internal synthetic identity must not send email');
expect(source.includes('@auth.zysyr.invalid'), 'reserved non-deliverable internal identifier missing');
expect(source.includes('verifyLegacyPassword'), 'one-time legacy password verification missing');
expect(source.includes('constantTimeHexEqual'), 'constant-time hash comparison missing');
expect(source.includes('HMAC') && source.includes('identityHash') && source.includes('clientHash'), 'HMAC rate-limit fingerprints missing');
expect(source.includes('zysyr_begin_auth_migration'), 'atomic rate-limit gate missing');
expect(source.includes('zysyr_complete_auth_migration'), 'atomic account/grant completion missing');
expect(source.includes('GENERIC_LOGIN_ERROR'), 'generic anti-enumeration error missing');
expect(!source.includes('console.log'), 'credentials or success payloads must not be logged');
expect(!source.includes('user_metadata'), 'user-editable metadata must not authorize migration');

expect(migration.includes('add column if not exists login_name text'), 'stable username mapping missing');
expect(migration.includes('zysyr_auth_migration_allowlist'), 'explicit migration allowlist missing');
expect(migration.includes('approved_by text not null') && migration.includes('approval_reference text'), 'allowlist approval provenance missing');
expect(migration.includes('zysyr_auth_migration_events'), 'rate-limit event table missing');
expect(migration.includes('force row level security'), 'migration control tables must force RLS');
expect(migration.includes('zysyr_auth_migration_events_immutable'), 'migration telemetry must be append-only');
expect(migration.includes('security definer\nset search_path = \'\''), 'privileged functions must pin empty search_path');
expect(migration.includes('from public, anon, authenticated, service_role'), 'function default execution revoke missing');
expect(migration.includes('to service_role'), 'service-only execution grant missing');
expect(migration.includes("action = 'legacy_password_auth_activated'"), 'activation audit event missing');
expect(migration.includes("'password_source', 'verified_once_then_rehashed_by_supabase_auth'"), 'password migration provenance missing');
expect(!/insert\s+into\s+public\.zysyr_auth_migration_allowlist/i.test(migration), 'schema migration must not silently approve users');
expect(!/\bdelete\s+from\s+(?:public\.)?(?:staff|zysyr_employees|zysyr_user_accounts)/i.test(migration), 'migration must not delete identity history');
expect(!/\bupdate\s+(?:public\.)?staff/i.test(migration), 'migration must not rewrite legacy passwords');

expect(allowlist.includes("(('admin', 'ziyou'), ('哈维', 'xiangli'))"), 'Gate C1 must target only the approved administrator/store pairs');
expect(allowlist.includes("s.role = 'admin'") && allowlist.includes("s.active is true"), 'Gate C1 administrator state guards missing');
expect(allowlist.includes("'company'") && allowlist.includes("'shareholder'"), 'Gate C1 company-scoped shareholder approval missing');
expect(allowlist.includes("codex-task-2026-08-11-gate-c1"), 'Gate C1 approval provenance missing');
expect(allowlist.includes('v_candidate_count <> 2') && allowlist.includes('v_inserted_count <> 2'), 'Gate C1 exact cardinality guards missing');
expect(allowlist.includes('shareholder capability matrix has drifted'), 'Gate C1 role capability drift guard missing');
expect(allowlist.includes("action,\n      after_json") && allowlist.includes("'auth_migration_allowlisted'"), 'Gate C1 allowlist audit event missing');
expect(!/insert\s+into\s+auth\.users/i.test(allowlist), 'Gate C1 must not create Auth users before a valid password login');
expect(!/insert\s+into\s+public\.zysyr_user_accounts/i.test(allowlist), 'Gate C1 must not pre-create user accounts');
expect(!/insert\s+into\s+public\.zysyr_user_role_grants/i.test(allowlist), 'Gate C1 must not pre-create role grants');
expect(!/\b(update|delete)\s+(?:from\s+)?(?:public\.)?staff/i.test(allowlist), 'Gate C1 must not modify legacy staff records');

const syntaxProbe = spawnSync(process.execPath, [
  '--experimental-strip-types',
  '--check',
  sourcePath,
], { encoding: 'utf8' });
expect(syntaxProbe.status === 0, `operations-auth-migrate TypeScript syntax failed: ${syntaxProbe.stderr}`);

console.log('operations Auth rolling migration tests passed');
