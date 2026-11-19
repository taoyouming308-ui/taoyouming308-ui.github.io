import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const sql=readFileSync(new URL('../packages/design-production-adapter/drafts/stage37-browser-archive-command-fixture.sql',import.meta.url),'utf8');
test('synthetic-only guard and no old definitions or grants changed',()=>{
 for(const x of ['design_executor_synthetic','offline-stage6-only','server_version_num'])assert.ok(sql.includes(x));
 assert.ok(!/CREATE OR REPLACE|CREATE ROLE/.test(sql));assert.equal((sql.match(/CREATE FUNCTION /g)||[]).length,2);
 for(const x of sql.split('\n').filter(x=>/^GRANT /.test(x)))assert.ok(x.includes('design_browser_archive_command'),x);
});
test('sidecar stores command only and cannot update/delete',()=>{
 assert.ok(sql.includes('commands(request_key text PRIMARY KEY,authority jsonb NOT NULL,command jsonb NOT NULL)'));
 assert.ok(sql.includes('FORCE ROW LEVEL SECURITY'));assert.ok(sql.includes('BEFORE UPDATE OR DELETE'));assert.ok(sql.includes('GRANT SELECT,INSERT'));
 assert.ok(!sql.includes('FOR SHARE;'));assert.ok(!/GRANT .*UPDATE/.test(sql));
});
test('exact immutable owner and command bind source, CAS and result',()=>{
 for(const x of ["c->'authority'=a",'sourceRevision','sourceDigest','expectedVersion','expectedParentDigest','resultVersion','resultSha256',"row.authority IS DISTINCT FROM a",'design_identity.require_authority()'])assert.ok(sql.includes(x),x);
});
test('new sidecar only follows same transaction existing append',()=>{
 const append=sql.indexOf('IF design_dependency_authority.append_full(expected)'),insert=sql.indexOf('INSERT INTO design_browser_archive_command.commands');
 assert.ok(append>0&&insert>append);assert.ok(sql.includes('prior IS DISTINCT FROM jsonb_build_object'));assert.ok(sql.includes('An old receipt is not evidence'));
});
test('replay requires historical source, existing full receipt and original full author',()=>{
 for(const x of ["jsonb_array_elements(b->'workflowRows')", "jsonb_array_elements(b->'fullReceipts')", "jsonb_array_elements(b->'dependencyAuthors')", "x->'authority'=a",'b IS DISTINCT FROM design_dependency_authority.read_bundle()'])assert.ok(sql.includes(x),x);
});
