#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const sourcePath = path.resolve(__dirname, '../supabase/functions/operations-auth/index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(source.includes('/auth/v1/user'), 'Supabase Auth user verification missing');
expect(source.includes('Authorization: `Bearer ${token}`'), 'user JWT must be forwarded to Auth and Data API');
expect(source.includes('SUPABASE_PUBLISHABLE_KEY') && source.includes('SUPABASE_ANON_KEY'), 'publishable/legacy data API key fallback missing');
expect(!source.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Auth scope service must not query user data with service role');
expect(!/password_hash|session_token|zysyr_operations_sessions/.test(source), 'legacy password/session logic must not enter Auth scope service');
expect(!/user_metadata|raw_user_meta_data|auth\.jwt\(\)/.test(source), 'user-editable JWT metadata must not authorize scope');

expect(source.includes('zysyr_user_accounts?select='), 'account mapping query missing');
expect(source.includes('zysyr_user_role_grants?select='), 'role grant query missing');
expect(source.includes('zysyr_user_capability_grants?select='), 'direct capability grant query missing');
expect(source.includes('zysyr_role_capabilities?select='), 'role capability query missing');
expect(source.includes('zysyr_stores?select='), 'RLS-protected store query missing');
expect(source.includes('revoked_at=is.null') && source.includes('activeGrant'), 'grant revocation/effective-date checks missing');

expect(source.includes('auth_boundary: "supabase_auth_rls"'), 'Auth/RLS boundary marker missing');
expect(source.includes('legacy_login: "read_only_transition"'), 'legacy read-only transition marker missing');
expect(source.includes('账号尚未激活') && source.includes('账号尚未配置经营角色'), 'inactive/ungranted account denial missing');
expect(source.includes('if (req.method !== "POST")'), 'method guard missing');
expect(source.includes('if (!match || match[1].length < 20 || match[1].length > 8192)'), 'bearer token validation missing');

const syntaxProbe = spawnSync(process.execPath, [
  '--experimental-strip-types',
  '-e',
  `globalThis.Deno={env:{get:()=>''},serve:()=>{}}; import(${JSON.stringify(pathToFileURL(sourcePath).href)})`,
], { encoding: 'utf8' });
expect(syntaxProbe.status === 0, `operations-auth TypeScript syntax failed: ${syntaxProbe.stderr}`);

console.log('operations Auth scope tests passed');
