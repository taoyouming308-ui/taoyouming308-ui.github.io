import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserStageProfile, safeBrowserTimings } from './fixtures/design-browser-profile.mjs';

const path = 'api/design/candidate/synthesize';
const event = (phase = 'query_frame', durationMs = 4) => ({ phase, durationMs, command: 'SELECT', outcome: 'success', errorKind: 'none' });
test('only fixed synthesis/readback routes are profiled; no locator or query is recorded', () => {
  const p = createBrowserStageProfile(); assert.equal(p.begin(path + '?key=SECRET'), null); assert.equal(p.begin('api/design/workflow/load'), null);
  p.begin(path); const state = JSON.stringify(p.snapshot()); assert(!state.includes('SECRET')); assert(!state.includes('/api/'));
});
test('wall and inclusive metrics remain separate, never summed into execution time', async () => {
  let time = 0; const p = createBrowserStageProfile({ clock: () => time }), span = p.begin(path);
  await p.within(span, async () => { p.observe(event('lease_first_frame', 12)); p.observe(event('query_frame', 10)); p.observe(event('result_parse', 3)); time = 20; });
  p.finish(span, { httpStatus: 200, candidateReturned: true }); const result = p.snapshot().spans[0];
  assert.equal(result.wallMs, 20); assert.equal(result.metrics.reduce((a, m) => a + m.inclusiveTotalMs, 0), 25); assert.match(p.snapshot().interpretation, /overlap/);
});
test('overlapping asynchronous requests retain separate contexts and replay marker only', async () => {
  const p = createBrowserStageProfile(), a = p.begin(path), b = p.begin(path, true);
  await Promise.all([p.within(a, async () => { await new Promise(r => setTimeout(r, 8)); p.observe(event('query_frame', 3)); }), p.within(b, async () => { await new Promise(r => setTimeout(r, 1)); p.observe(event('query_frame', 9)); })]);
  p.finish(a); p.finish(b); const rows = p.snapshot().spans; assert.equal(rows[0].metrics[0].maxMs, 3); assert.equal(rows[1].metrics[0].maxMs, 9); assert.equal(rows[1].sameRequestAsPrior, true);
});
test('unattributed and post-finish events do not contaminate measured requests', () => {
  const p = createBrowserStageProfile(), span = p.begin(path); p.observe(event()); p.finish(span); p.within(span, () => p.observe(event()));
  assert.equal(p.snapshot().unattributedEvents, 2); assert.deepEqual(p.snapshot().spans[0].metrics, []);
});
test('unknown fields/getters/SQL/errors/nonfinite durations are never emitted', () => {
  const p = createBrowserStageProfile(), span = p.begin(path); let getter = 0;
  p.within(span, () => { for (const extra of [{ sql: 'SECRET' }, { result: 'SECRET' }, { errorKind: 'SECRET' }, { durationMs: Infinity }, { durationMs: -1 }]) p.observe({ ...event(), ...extra }); const poisoned = { ...event() }; Object.defineProperty(poisoned, 'token', { get() { getter++; return 'SECRET'; }, enumerable: true }); p.observe(poisoned); });
  assert.equal(getter, 0); assert.equal(p.snapshot().discardedEvents, 6); assert(!JSON.stringify(p.snapshot()).includes('SECRET'));
});
test('result metadata is strictly bounded and never accepts body or request identifiers', () => {
  const p = createBrowserStageProfile(), span = p.begin(path); assert.throws(() => p.finish(span, { body: 'SECRET' })); assert.throws(() => p.finish(span, { httpStatus: 0 })); p.finish(span, { httpStatus: 409, failed: true }); assert.throws(() => p.finish(span)); assert(!JSON.stringify(p.snapshot()).includes('SECRET'));
});
test('fixed span budget and snapshots prevent unbounded or mutable diagnostic output', () => {
  const p = createBrowserStageProfile({ maxSpans: 1 }); p.begin(path); assert.equal(p.begin(path), null); const view = p.snapshot(); view.spans[0].operation = 'SECRET'; assert.equal(p.snapshot().spans[0].operation, 'synthesis'); assert.equal(p.snapshot().overflow, 1);
});
test('browser abort/headers timings accept only fixed labels/numbers, not error text or URLs', () => {
  const row = { operation: 'synthesis', attempt: 1, abortMs: 30001, failureMs: 30002, failure: 'abort' };
  assert.deepEqual(safeBrowserTimings([row]), [row]); for (const bad of [{ ...row, body: 'SECRET' }, { ...row, failure: 'SECRET' }, { ...row, abortMs: NaN }, { ...row, operation: 'https://SECRET' }]) assert.deepEqual(safeBrowserTimings([bad]), []);
});

test('history scan events count exact row reads without inventing JS validation timing', () => { const p=createBrowserStageProfile(), span=p.begin(path); p.within(span,()=>{p.observe(event('query_total',12));p.observe(event('workflow_history_scan',12));p.observe({...event('workflow_history_scan',5),outcome:'error',errorKind:'server_error'});});p.finish(span);const result=p.snapshot();assert.equal(result.discardedEvents,0);assert.equal(result.overflow,0);assert.equal(result.spans[0].metrics.filter(m=>m.phase==='workflow_history_scan').reduce((n,m)=>n+m.count,0),2);assert.match(result.interpretation,/not completed JS history validation/);});
