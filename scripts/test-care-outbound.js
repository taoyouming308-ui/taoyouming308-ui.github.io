#!/usr/bin/env node
const fs = require('fs');

function fail(message) {
  console.error('CARE OUTBOUND TEST FAILED: ' + message);
  process.exit(1);
}

const html = fs.readFileSync('perm-app.html', 'utf8');
const functionNames = [
  'careUsageKey',
  'careUsageTotals',
  'careUsageMap',
  'prepareCareOutboundBaseline',
  'validateCareOutboundReduction',
  'persistHairRecordData',
  'careOutboundPendingRows',
  'finalizeCareOutboundPending',
  'submitCareOutboundPending',
  'recoverCareOutboundPending',
  'enqueueCareOutboundForRecord'
];

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) fail(`missing function: ${name}`);
  let index = html.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  fail(`unterminated function: ${name}`);
}

const source = functionNames.map(extractFunction).join('\n') +
  '\nreturn { careUsageTotals, prepareCareOutboundBaseline, validateCareOutboundReduction, enqueueCareOutboundForRecord };';
const requests = [];
const queuedRows = [];
async function mockFetch(url, options) {
  requests.push({ url, options });
  if (url.includes('/care_outbound_queue')) {
    if (!options || options.method !== 'POST') {
      return { ok: true, json: async () => queuedRows };
    }
    const rows = JSON.parse(options.body);
    const inserted = rows.map((row, index) => ({ ...row, id: queuedRows.length + index + 101 }));
    queuedRows.push(...inserted);
    return {
      ok: true,
      json: async () => inserted
    };
  }
  return { ok: true, text: async () => '' };
}
const api = new Function('fetch', 'SUPABASE_URL', 'SUPABASE_KEY', source)(
  mockFetch,
  'https://example.supabase.co',
  'test-key'
);

const firstSave = { careUsage: [{ brand: '歌薇', product: '6A', grams: '15' }] };
api.prepareCareOutboundBaseline(firstSave, { careUsage: [] });
if (firstSave.careOutboundSnapshot.length !== 0) fail('new record baseline must be empty');
firstSave.careOutboundSnapshot = api.careUsageTotals(firstSave.careUsage);

const repeatedSave = { careUsage: [{ brand: '歌薇', product: '6A', grams: 15 }] };
api.prepareCareOutboundBaseline(repeatedSave, firstSave);
if (api.validateCareOutboundReduction(repeatedSave).length !== 0) fail('same amount was rejected');
if (api.careUsageTotals(repeatedSave.careUsage)[0].grams - repeatedSave.careOutboundSnapshot[0].grams !== 0) {
  fail('same amount generated a second outbound quantity');
}

const increasedSave = { careUsage: [{ brand: '歌薇', product: '6A', grams: 20 }] };
api.prepareCareOutboundBaseline(increasedSave, firstSave);
if (api.careUsageTotals(increasedSave.careUsage)[0].grams - increasedSave.careOutboundSnapshot[0].grams !== 5) {
  fail('20g after 15g must generate a 5g delta');
}

const reducedSave = { careUsage: [{ brand: '歌薇', product: '6A', grams: 10 }] };
api.prepareCareOutboundBaseline(reducedSave, firstSave);
if (api.validateCareOutboundReduction(reducedSave).length !== 1) {
  fail('reducing an outbound quantity must be blocked');
}

const grouped = api.careUsageTotals([
  { brand: '歌薇', product: '6A', grams: 8 },
  { brand: '歌薇', product: '6A', grams: 7 }
]);
if (grouped.length !== 1 || grouped[0].grams !== 15) fail('duplicate care products were not grouped');

api.enqueueCareOutboundForRecord({
  id: 'hair-1',
  barber: '不应进入队列',
  careUsage: [{ brand: '歌薇', product: '6A', grams: 20 }],
  careOutboundSnapshot: [{ brand: '歌薇', product: '6A', grams: 15 }],
  careOutboundBatches: []
}).then((result) => {
  const queueRequest = requests.find(request => request.url.includes('/care_outbound_queue'));
  if (!queueRequest) fail('outbound queue request was not created');
  const queueRows = JSON.parse(queueRequest.options.body);
  if (queueRows.length !== 1 || queueRows[0].grams !== 5) fail('queue payload must contain only the 5g delta');
  if (Object.prototype.hasOwnProperty.call(queueRows[0], 'barber')) fail('queue payload contains nonexistent barber column');
  if (!result.queued || result.record.careOutboundBatches[0].ids[0] !== 101) fail('queue ids were not recorded');
  const interrupted = {
    id: 'hair-2',
    careUsage: [{ brand: '歌薇', product: '6A', grams: 20 }],
    careOutboundSnapshot: [{ brand: '歌薇', product: '6A', grams: 15 }],
    careOutboundPending: {
      queuedAt: queuedRows[0].created_at,
      items: [{ brand: '歌薇', product: '6A', grams: 5 }],
      snapshot: [{ brand: '歌薇', product: '6A', grams: 20 }]
    },
    careOutboundBatches: []
  };
  const postCountBeforeRecovery = requests.filter(request => request.url.includes('/care_outbound_queue') && request.options && request.options.method === 'POST').length;
  return api.enqueueCareOutboundForRecord(interrupted).then((recovered) => {
    const postCountAfterRecovery = requests.filter(request => request.url.includes('/care_outbound_queue') && request.options && request.options.method === 'POST').length;
    if (postCountAfterRecovery !== postCountBeforeRecovery) fail('interrupted batch was inserted twice');
    if (recovered.record.careOutboundPending) fail('recovered batch still has a pending marker');
    console.log('care outbound test ok: delta=5g reduction=blocked interrupted-batch=recovered');
  });
}).catch(error => fail(error.message));
