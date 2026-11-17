/** Static regression only. This does not establish SQL semantics or role isolation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../packages/design-production-adapter/drafts/stage17-dependency-authority-fixture.sql',import.meta.url),'utf8');
test('draft installation is restricted to the synthetic PG17 fixture',()=>{
 assert.match(sql,/current_database\(\)\s*<>\s*'design_executor_synthetic'/);
 assert.match(sql,/current_setting\('design_executor\.synthetic_fixture',true\) IS DISTINCT FROM 'offline-stage6-only'/);
 assert.match(sql,/current_setting\('server_version_num'\)::int\/10000\s*<>\s*17/);
 assert.match(sql,/SYNTHETIC_DEPENDENCY_AUTHORITY_REQUIRED/);
 assert.doesNotMatch(sql,/PLACEHOLDER/);
});
test('draft does not rewrite old rows, replace previous capabilities, or grant runtime direct table access',()=>{
 assert.doesNotMatch(sql,/\b(?:DELETE\s+FROM|UPDATE|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE)\s+(?:design_private|public)\./i);
 assert.doesNotMatch(sql,/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?!design_dependency_authority\.)/i);
 assert.doesNotMatch(sql,/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)\b[^;]*\bTO\s+design_identity_runtime\b/i);
 assert.doesNotMatch(sql,/GRANT\s+design_dependency_(?:issuer_)?capability\s+TO\s+design_identity_runtime/i);
});
test('security-definer functions specify a trusted fixed search path',()=>{
 const definitions=[...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+[\s\S]*?AS\s*\$\$/gi)];
 assert(definitions.length>0);
 for(const [definition] of definitions)if(/SECURITY\s+DEFINER/i.test(definition))assert.match(definition,/SET\s+search_path\s*=\s*pg_catalog\s*,\s*pg_temp/i);
 assert(/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_dependency_authority FROM PUBLIC/i.test(sql),'explicit PUBLIC function privilege revocation is required');
});
test('JSON subtraction is parenthesized instead of consuming an extraction key',()=>{
 assert.doesNotMatch(sql,/->\s*'[^']+'\s*-(?!>)/i);
});
