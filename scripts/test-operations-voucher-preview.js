const assert = require('node:assert/strict');
const core = require('../operations-voucher-preview.js');

async function test() {
  const evidence = { id: 'receipt-a', trace_link_level: 'page_confirmed', trace_source_locator: 'word/media/image1.jpeg' };
  const leaf = (files, amount = 10) => ({ mode: 'input', target: { numeric_value: amount }, evidence: files });
  const formula = (...refs) => ({ mode: 'formula', precedents: refs.map(cell_address => ({ cell_address })) });
  const calls = [];
  const traces = { C3: leaf([evidence]), C4: formula('C3', 'C5', 'C8'), C5: leaf([{ ...evidence, trace_source_locator: 'word/media/image2.jpeg' }]), C8: formula('C4') };
  const result = await core.collect(formula('C3', 'C4', 'C6', 'C7'), 'C8', async address => {
    calls.push(address);
    if (address === 'C6') throw Error('synthetic unavailable');
    return address === 'C7' ? leaf([]) : traces[address];
  });
  assert.equal(result.evidence.length, 1, 'same original must not be duplicated');
  assert.deepEqual(new Set(result.evidence[0].trace_source_locators), new Set(['word/media/image1.jpeg', 'word/media/image2.jpeg']));
  assert.equal(calls.length, new Set(calls).size, 'cycles and shared descendants must be fetched once');
  assert.equal(result.missing_leaves, 1);
  assert.deepEqual(result.failures, ['C6']);
  assert.equal(result.leaf_count, 3);
  assert.equal(result.truncated, false);
  const batchCalls = [];
  const batchRefs = Array.from({ length: 9 }, (_, index) => 'D' + (index + 1));
  const batched = await core.collect(formula(...batchRefs), 'D0', async () => {
    throw Error('single-cell fallback must not be used when batch tracing is enabled');
  }, { fetchTraceBatch: async addresses => {
    batchCalls.push(addresses.slice());
    return Object.fromEntries(addresses.map(address => [address, address === 'D3'
      ? { error: 'synthetic cell failure' }
      : { trace: leaf([{ id: 'voucher-' + address }]) }]));
  } });
  assert.deepEqual(batchCalls, [batchRefs.slice(0, 8), ['D9']], 'one request per bounded layer batch');
  assert.deepEqual(batched.failures, ['D3'], 'a single bad cell must not discard successful batch siblings');
  assert.equal(batched.leaf_count, 8);
  assert.equal(batched.evidence.length, 8);
  const limited = await core.collect(formula('A1', 'A2', 'A3'), 'A0', async () => leaf([]), { limit: 2 });
  assert.equal(limited.truncated, true, 'limit must never silently claim completeness');
  const depthLimited = await core.collect(formula('A1'), 'A0', async address => formula(address === 'A1' ? 'A2' : 'A3'), { maxDepth: 1 });
  assert.equal(depthLimited.truncated, true, 'maximum formula depth must be visible as an incomplete trace');
  let active = true;
  const cancelled = await core.collect(formula('B1', 'B2', 'B3', 'B4', 'B5'), 'B0', async () => { active = false; return leaf([evidence]); }, { active: () => active });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.evidence.length, 0, 'stale scope results must be discarded');
  const images = [{ filename: 'image1.jpeg' }, { filename: 'image2.jpeg' }];
  assert.deepEqual(core.selectImages({ ...evidence, images }).images, [images[0]]);
  assert.deepEqual(core.selectImages({ ...evidence, trace_source_locator: 'missing.jpeg', images }), { images: [], missing: true });
  assert.equal(core.selectImages({ ...evidence, trace_source_locators: ['image1.jpeg', 'missing.jpeg'], images }).missing, true);
  assert.equal(core.selectImages({ ...evidence, trace_link_level: 'bundle_only', images }).images.length, 2);
  const map = new Map(); core.merge(map, evidence); core.merge(map, { ...evidence, trace_link_level: 'bundle_only' });
  assert.equal([...map.values()][0].trace_link_level, 'bundle_only');
  core.merge(map, { ...evidence, evidence_source: 'voucher_attachment' });
  assert.equal(map.size, 2, 'different private tables must not conflate identities');
  assert.equal(core.safeURL('javascript:alert(1)'), '');
  assert.equal(core.safeURL('data:image/svg+xml,<svg/>'), '');
  assert.equal(core.kind({ filename: '原件.JPG' }), 'image', 'signed voucher URL response may lack MIME');
  assert.equal(core.kind({ filename: '原件.pdf' }), 'pdf');
  let running = 0, peak = 0;
  const loaded = [];
  await core.loadFiles(Array.from({ length: 8 }, (_, id) => ({ id })), async file => {
    running++; peak = Math.max(peak, running); await new Promise(resolve => setTimeout(resolve, 2)); running--;
    if (file.id === 3) throw Error('synthetic expired'); return file;
  }, (file, index) => loaded[index] = file, () => true);
  assert.equal(peak, 3);
  assert.equal(loaded.length, 8);
  assert.equal(loaded[3].preview_error, 'synthetic expired');
  console.log('voucher preview: traversal, exact scope, failures, cancellation, MIME and bounded loading passed');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
