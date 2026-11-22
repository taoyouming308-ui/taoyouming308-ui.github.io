import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../packages/design-production-adapter/drafts/stage30-managed-view-ancestor-helper-fixture.sql',import.meta.url),'utf8');
test('offline PG17 fixture guard and only additive two helpers',()=>{
 for(const x of ['design_executor_synthetic','offline-stage6-only','server_version_num'])assert.ok(sql.includes(x));
 assert.equal((sql.match(/CREATE FUNCTION /g)||[]).length,2);assert.ok(!/CREATE OR REPLACE|CREATE TABLE|INSERT INTO|UPDATE |DELETE FROM/.test(sql));
});
test('proof uses fresh checked bundle and immutable candidate/consumption',()=>{
 for(const x of ['b IS DISTINCT FROM design_dependency_authority.checked_bundle(a)','stored.candidate','consumed.acceptance','stored.authority=a','consumed.record_sha256=acceptedrow','consumed.previous_sha256=oldrow'])assert.ok(sql.includes(x),x);
});
test('latest grouping preserves current visible entry and exact history match',()=>{
 for(const x of ['y.n>x.n','groupId','service','side','ORDER BY x.n LIMIT 1','IF n<>1','managed_completion_comparison',"receipt->'selectedIndices'='[0]'::jsonb"])assert.ok(sql.includes(x),x);
});
test('ancestry checks original prefix, exact acceptance and journal continuation',()=>{
 for(const x of ['receipt=expected_receipt','sessionDigest','recordDigest','expected_journal IS DISTINCT FROM acceptedrow',"jsonb_array_elements(s->'journal')",'WHERE j.n<=finish'])assert.ok(sql.includes(x),x);
});
test('each before/after task must match current live binding and stored input',()=>{
 for(const x of ["jsonb_array_length(c->'evidenceBinding'->'images')=2",'image_context(a,binding', 'live IS DISTINCT FROM binding',"x->>'taskId'=binding->>'taskId' AND x IN",'imageBindingDigests'])assert.ok(sql.includes(x),x);
});
test('confirmation and known judgment evidence remain distinct and deterministic',()=>{
 for(const x of ['confirmationDigest','entryStatus','confirmedAngles','unconfirmedAngles','limited_evidence','potential_conflict','consistent_judgments','mixed_judgments',"THEN 'model_review_focus' ELSE 'deterministic'"])assert.ok(sql.includes(x),x);
 const order=['missing_views','noncomparable_views','opposing_judgments','cross_view_differences','confirm_angle_judgment','capture_conditions'].map(x=>sql.indexOf("'"+x+"'"));assert.deepEqual([...order].sort((a,b)=>a-b),order);
});
test('no key, fee, dispatch or direct LOGIN helper capability',()=>{
 assert.ok(!/key_heads|key_versions|issued_receipts|approvals|attempts|dispatchClaim/.test(sql.replace(/--[^\n]*/g,'')));
 assert.ok(sql.includes('FROM PUBLIC,anon,authenticated,design_identity_runtime'));
 assert.ok(sql.includes('TO design_provider_issuer_capability'));
 assert.ok(!/TO design_identity_runtime/.test(sql));
});
