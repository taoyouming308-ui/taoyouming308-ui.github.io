// Actual task loader, synthetic DOM/transport only. No business connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('perm-app.html', 'utf8');
const start = source.indexOf('  window.renderMyTasks = function()');
const end = source.indexOf('\n  };', start) + 5;
assert.ok(start > 0 && end > start);
let taskReads = 0, makeupReads = 0;
const box = { innerHTML: '' };
const context = {
  window: { _hairViewMode: 'form', renderMgjMakeupTasks() { makeupReads++; } },
  document: { getElementById() { return box; } },
  localStorage: { getItem() { return 'synthetic-staff'; } },
  BOOKING_BARBER: 'synthetic-staff', SUPABASE_URL: 'https://example.invalid', SUPABASE_KEY: 'synthetic',
  fetch() { taskReads++; return Promise.resolve({ json: () => Promise.resolve([]) }); }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
(async () => {
  context.window.renderMyTasks();
  assert.equal(taskReads, 0);
  assert.equal(makeupReads, 0, 'hidden form must not trigger three makeup reads');
  context.window._hairViewMode = 'tasks';
  context.window.renderMyTasks();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(taskReads, 1);
  assert.equal(makeupReads, 1);
  assert.match(box.innerHTML, /暂无记录/);
  context.window._hairViewMode = 'form';
  context.window.renderMyTasks();
  context.window._hairViewMode = 'tasks';
  context.window.renderMyTasks();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(taskReads, 2, 'returning to tasks still obtains fresh data');
  assert.equal(makeupReads, 2);
  console.log('hair tasks lazy loading passed: hidden form skips task + makeup reads, tasks refresh normally');
})().catch(error => { console.error(error); process.exitCode = 1; });
