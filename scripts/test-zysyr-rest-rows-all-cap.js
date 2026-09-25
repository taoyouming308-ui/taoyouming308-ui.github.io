const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const start = api.indexOf('async function restRowsAll(');
const end = api.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start, 'the shared paginated reader must exist');
const helper = api.slice(start, end);

function createReader(pages) {
  const ranges = [];
  const sandbox = {
    rest: async (_path, init) => {
      const range = init.headers.Range;
      ranges.push(range);
      return { ok: true, json: async () => pages[ranges.length - 1] };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(stripTypeScriptTypes(`${helper}\nthis.readRows = restRowsAll;`), sandbox);
  return { readRows: sandbox.readRows, ranges };
}

(async () => {
  const belowCap = createReader([
    Array.from({ length: 1000 }, (_, index) => index),
    Array.from({ length: 200 }, (_, index) => index + 1000),
  ]);
  assert.equal((await belowCap.readRows('scoped-path', 1500)).length, 1200);
  assert.deepEqual(belowCap.ranges, ['0-999', '1000-1499']);

  const exactCap = createReader([
    Array.from({ length: 1000 }, (_, index) => index),
    Array.from({ length: 500 }, (_, index) => index + 1000),
  ]);
  await assert.rejects(exactCap.readRows('scoped-path', 1500), /1500.*可能不完整/);
  assert.deepEqual(exactCap.ranges, ['0-999', '1000-1499']);

  const narrowCap = createReader([Array.from({ length: 50 }, (_, index) => index)]);
  assert.equal((await narrowCap.readRows('scoped-path', 100)).length, 50);
  assert.deepEqual(narrowCap.ranges, ['0-99']);

  const invalidCap = createReader([]);
  await assert.rejects(invalidCap.readRows('scoped-path', 0), /读取上限无效/);
  assert.equal(invalidCap.ranges.length, 0);

  console.log('ZYSYR restRowsAll: bounded ranges, partial final page, fail-closed exact cap, and invalid cap passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
