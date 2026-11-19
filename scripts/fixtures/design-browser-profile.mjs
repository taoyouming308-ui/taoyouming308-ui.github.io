/** Synthetic test instrumentation only. No request bodies, identifiers or SQL. */
import { AsyncLocalStorage } from 'node:async_hooks';

const operations = new Map([
  ['api/design/candidate/synthesize', 'synthesis'],
  ['api/design/candidate/load', 'candidate_read'],
]);
const phases = new Set(['lease_spawn', 'lease_first_frame', 'query_frame', 'result_parse', 'query_total', 'lease_closed', 'lease_total', 'workflow_history_scan']);
const commands = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'BEGIN', 'SET', 'COMMIT', 'ROLLBACK']);
const errorKinds = new Set(['none', 'server_error', 'frame_invalid', 'result_invalid', 'connection_closed', 'query_timeout', 'transport_error', 'unknown']);
const finite = n => Number.isFinite(n) && n >= 0 && n <= 3_600_000;
const round = n => Math.round(n * 1000) / 1000;
const copy = value => JSON.parse(JSON.stringify(value));
function plain(value, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && allowed.includes(key) && 'value' in descriptors[key]);
}

export function createBrowserStageProfile({ clock = () => performance.now(), maxSpans = 64 } = {}) {
  if (typeof clock !== 'function' || !Number.isSafeInteger(maxSpans) || maxSpans < 1 || maxSpans > 128) throw Error('INVALID_SYNTHETIC_PROFILE');
  const context = new AsyncLocalStorage(), spans = [], counts = new Map();
  let discardedEvents = 0, unattributedEvents = 0, overflow = 0;
  function begin(path, sameRequestAsPrior = false) {
    const operation = operations.get(path);
    if (!operation) return null;
    if (spans.length === maxSpans) { overflow++; return null; }
    const attempt = (counts.get(operation) || 0) + 1;
    counts.set(operation, attempt);
    const span = { operation, attempt, sameRequestAsPrior: sameRequestAsPrior === true, started: clock(), ended: null, metrics: new Map(), result: null };
    spans.push(span);
    return span;
  }
  function within(span, work) {
    if (typeof work !== 'function' || span !== null && !spans.includes(span)) throw Error('INVALID_SYNTHETIC_PROFILE');
    return context.run(span, work);
  }
  function observe(event) {
    if (!plain(event, ['phase', 'durationMs', 'outcome', 'errorKind', 'command']) || !phases.has(event.phase) || !finite(event.durationMs) || !['success', 'error'].includes(event.outcome) || !errorKinds.has(event.errorKind) || event.command !== undefined && !commands.has(event.command)) { discardedEvents++; return; }
    const span = context.getStore();
    if (!span || !spans.includes(span) || span.ended !== null) { unattributedEvents++; return; }
    const key = [event.phase, event.command || 'none', event.outcome, event.errorKind].join(':');
    if (!span.metrics.has(key) && span.metrics.size >= 128) { overflow++; return; }
    const metric = span.metrics.get(key) || { phase: event.phase, command: event.command || 'none', outcome: event.outcome, errorKind: event.errorKind, count: 0, inclusiveTotalMs: 0, maxMs: 0 };
    metric.count++; metric.inclusiveTotalMs += event.durationMs; metric.maxMs = Math.max(metric.maxMs, event.durationMs);
    span.metrics.set(key, metric);
  }
  function finish(span, result = {}) {
    if (!span) return;
    if (!spans.includes(span) || span.ended !== null || !plain(result, ['httpStatus', 'candidateReturned', 'replayed', 'failed'])) throw Error('INVALID_SYNTHETIC_PROFILE');
    if (result.httpStatus !== undefined && (!Number.isInteger(result.httpStatus) || result.httpStatus < 100 || result.httpStatus > 599)) throw Error('INVALID_SYNTHETIC_PROFILE');
    for (const key of ['candidateReturned', 'replayed', 'failed']) if (result[key] !== undefined && typeof result[key] !== 'boolean') throw Error('INVALID_SYNTHETIC_PROFILE');
    span.ended = clock(); span.result = copy(result);
  }
  function snapshot() {
    return copy({
      schemaVersion: 'synthetic-browser-profile-v1',
      interpretation: 'HTTP wall and inclusive DB/lease/frame/parse durations overlap. Do not add them; query frames include SQL, transport and scheduling, not pure SQL time. workflow_history_scan counts exact SQL row reads and repeats query_total, not completed JS history validation.',
      discardedEvents, unattributedEvents, overflow,
      spans: spans.map(span => ({ operation: span.operation, attempt: span.attempt, sameRequestAsPrior: span.sameRequestAsPrior, pending: span.ended === null, wallMs: round(Math.max(0, (span.ended ?? clock()) - span.started)), result: span.result, metrics: [...span.metrics.values()].map(m => ({ ...m, inclusiveTotalMs: round(m.inclusiveTotalMs), maxMs: round(m.maxMs) })) })),
    });
  }
  return Object.freeze({ begin, within, observe, finish, snapshot });
}

/** Data from the test-only browser fetch observer, never response/source text. */
export function safeBrowserTimings(rows) {
  if (!Array.isArray(rows) || rows.length > 128) return [];
  const allowed = ['operation', 'attempt', 'abortMs', 'headersMs', 'failureMs', 'httpStatus', 'failure'];
  return rows.filter(row => plain(row, allowed) && ['synthesis', 'candidate_read'].includes(row.operation) && Number.isSafeInteger(row.attempt) && row.attempt >= 1 && row.attempt <= 128 && ['abortMs', 'headersMs', 'failureMs'].every(k => row[k] === undefined || finite(row[k])) && (row.httpStatus === undefined || Number.isInteger(row.httpStatus) && row.httpStatus >= 100 && row.httpStatus <= 599) && (row.failure === undefined || ['abort', 'fetch_error'].includes(row.failure))).map(row => copy(row));
}
