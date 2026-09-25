#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(fetchImpl) {
  const timers = [];
  const cleared = [];
  const session = { session_token: 'synthetic-shareholder-session' };
  const storage = { getItem: key => key === 'booking-session' ? JSON.stringify(session) : null };
  const context = {
    URLSearchParams,
    AbortController,
    location: { search: '' },
    localStorage: storage,
    document: {},
    fetch: fetchImpl,
    setTimeout(fn, ms) { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimeout(timer) { cleared.push(timer); },
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('operations-staff-view.js', 'utf8'), context);
  return { view: context.StaffReportView, timers, cleared, storage };
}

async function expectAbortIn(stage) {
  let signal;
  let bodyStartedResolve;
  const bodyStarted = new Promise(resolve => { bodyStartedResolve = resolve; });
  const harness = setup((_url, options) => {
    signal = options.signal;
    if (stage === 'fetch') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    return Promise.resolve({
      ok: true,
      json: () => {
        bodyStartedResolve();
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      },
    });
  });
  const request = harness.view.request('https://finance.example/api', 'publishable-key', 'overview', {});
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].ms, 45000, 'shareholder reads use the same 45 second ceiling');
  assert.equal(signal.aborted, false);
  if (stage === 'body') await bodyStarted;
  harness.timers[0].fn();
  await assert.rejects(request, error => {
    assert.equal(error.code, 'STAFF_REPORT_READ_TIMEOUT');
    assert.match(error.message, /超时.*未提交任何修改/);
    return true;
  });
  assert.equal(JSON.parse(harness.storage.getItem('booking-session')).session_token, 'synthetic-shareholder-session', 'timeout must preserve the employee session');
  assert.deepEqual(harness.cleared, harness.timers, 'timer is cleared on completion');
}

async function main() {
  await expectAbortIn('fetch');
  await expectAbortIn('body');
  const harness = setup(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  assert.deepEqual(await harness.view.request('https://finance.example/api', 'publishable-key', 'overview', {}), { ok: true });
  assert.deepEqual(harness.cleared, harness.timers);
  console.log('staff shareholder read timeout: stalled network/body are aborted at 45s; session is retained; successful reads remain unchanged');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
