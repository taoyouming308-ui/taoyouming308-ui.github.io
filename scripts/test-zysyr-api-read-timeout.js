const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../operations.html'), 'utf8');
const start = html.indexOf('  var API_READ_ONLY_OPERATIONS=');
const end = html.indexOf('\n  async function api(', start);
assert.ok(start >= 0 && end > start, 'read timeout helper must remain next to the API wrapper');
const code = html.slice(start, end);

async function testFetchTimeout() {
  let observedSignal;
  const context = vm.createContext({
    API: 'https://example.invalid/operations-api',
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (_url, options) => {
      observedSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
        const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
      }, { once: true }));
    },
  });
  vm.runInContext(code, context);
  await assert.rejects(context.requestApiResponse('overview', { method: 'POST' }, 10), error => {
    assert.equal(error.code, 'API_READ_TIMEOUT');
    assert.match(error.message, /未提交任何修改/);
    return true;
  });
  assert.equal(observedSignal.aborted, true, 'safe read request must be actually aborted');
}

async function testBodyReadTimeout() {
  let observedSignal;
  const context = vm.createContext({
    API: 'https://example.invalid/operations-api',
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (_url, options) => {
      observedSignal = options.signal;
      return Promise.resolve({ ok: true, json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
        const error = new Error('body aborted'); error.name = 'AbortError'; reject(error);
      }, { once: true })) });
    },
  });
  vm.runInContext(code, context);
  await assert.rejects(context.requestApiResponse('cell_trace_batch', { method: 'POST' }, 10), error => error.code === 'API_READ_TIMEOUT');
  assert.equal(observedSignal.aborted, true, 'read timer must cover response-body parsing too');
}

async function testWritesAreNeverAborted() {
  for (const operation of ['daily_sheet_confirm', 'report_upload', 'monthly_income_adjustment_save', 'history_import_preview']) {
    let observedOptions;
    const context = vm.createContext({
      API: 'https://example.invalid/operations-api',
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: async (_url, options) => {
        observedOptions = options;
        return { ok: true, json: async () => ({ accepted: true }) };
      },
    });
    vm.runInContext(code, context);
    const result = await context.requestApiResponse(operation, { method: 'POST' }, 1);
    assert.equal(result.data.accepted, true, operation);
    assert.equal('signal' in observedOptions, false, operation + ' must not be aborted by read timeout');
  }
  console.log('ZYSYR API timeout: safe reads abort during network/body wait; finance writes and unclassified operations never receive a timeout signal');
}

(async () => {
  await testFetchTimeout();
  await testBodyReadTimeout();
  await testWritesAreNeverAborted();
})().catch(error => { console.error(error); process.exitCode = 1; });
