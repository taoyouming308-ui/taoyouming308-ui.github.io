/** Prepared server transaction bridge. No fetch, secrets, live SQL or migrations. */
import { createProductionEmployeeAdapter, validateProductionDesignScope } from './employee-adapter.mjs';

export class ProductionArchiveError extends Error {
  constructor(code) { super(code); this.name = 'ProductionArchiveError'; this.code = code; }
}
const fail = code => { throw new ProductionArchiveError(code); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, expected) => { if (!plain(v) || Object.keys(v).sort().join('|') !== [...expected].sort().join('|')) fail('ARCHIVE_INVALID_FIELDS'); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STEPS = ['style', 'person', 'length', 'features', 'layers', 'bangs', 'curls', 'care'];
const MODEL_FIELDS = ['outline', 'root_flow', ...STEPS];
const ZONES = ['bangs', 'top', 'ear_front', 'ear_back', 'middle', 'bottom'];
const EXECUTION = ['issue', 'target', 'actions', 'check'];
const PROCESS = ['care_texture', 'styling', 'style_feel', 'application', 'winding', 'rod_direction', 'curl_control', 'thinning_space', 'proposal', 'technique_layers'];
const REVIEW = ['achieved', 'pending', 'next'];
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
const clone = v => JSON.parse(canonical(v));
function uuid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) fail('ARCHIVE_INVALID_ID');
  return value;
}
function text(value) {
  if (typeof value !== 'string' || value.length > 4000 || value !== value.trim() || /[\u0000\u000b\u000c]/.test(value)) fail('ARCHIVE_INVALID_TEXT');
  return value;
}
function textObject(value, allowed, optional = false) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('ARCHIVE_INVALID_FIELDS');
  if (!optional) keys(value, allowed);
  Object.values(value).forEach(text);
  return clone(value);
}
function model(value) {
  keys(value, ['outline', 'root_flow', 'steps']);
  text(value.outline); text(value.root_flow); textObject(value.steps, STEPS);
}
/** Exact legacy schema only. The complete UI draft/event journal is NOT lossy-converted. */
export function validateLegacyArchiveSnapshot(value) {
  keys(value, ['baseline', 'optimized', 'reasons', 'execution', 'process', 'review', 'status', 'photo_ids', 'archive_url']);
  model(value.baseline); model(value.optimized); textObject(value.reasons, MODEL_FIELDS);
  for (const key of MODEL_FIELDS) {
    const a = STEPS.includes(key) ? value.baseline.steps[key] : value.baseline[key];
    const b = STEPS.includes(key) ? value.optimized.steps[key] : value.optimized[key];
    if (b && a !== b && !value.reasons[key]) fail('ARCHIVE_REASON_REQUIRED');
  }
  if (!plain(value.execution) || Object.keys(value.execution).some(key => !ZONES.includes(key))) fail('ARCHIVE_INVALID_FIELDS');
  Object.values(value.execution).forEach(item => textObject(item, EXECUTION, true));
  textObject(value.process, PROCESS, true); textObject(value.review, REVIEW, true);
  if (!['baseline', 'optimizing', 'confirmed', 'completed', 'followup'].includes(value.status)) fail('ARCHIVE_INVALID_STATUS');
  if (!Array.isArray(value.photo_ids) || value.photo_ids.length > 30 || new Set(value.photo_ids).size !== value.photo_ids.length) fail('ARCHIVE_INVALID_PHOTOS');
  value.photo_ids.forEach(id => uuid(id));
  // External links, uploads and image bytes need another explicitly authorized route.
  if (value.archive_url !== null) fail('ARCHIVE_LINK_UNSUPPORTED');
  if (new TextEncoder().encode(canonical(value)).length > 768 * 1024) fail('ARCHIVE_TOO_LARGE');
  return freeze(clone(value));
}
function normalizedSnapshot(value) {
  const result = clone(value);
  result.archive_url = ''; // Existing SQL stores an absent URL as empty text.
  // Match existing SQL's optional_text_document/execution_document normalization.
  for (const name of ['process', 'review']) {
    const allowed = name === 'process' ? PROCESS : REVIEW;
    result[name] = Object.values(value[name]).some(Boolean) ? Object.fromEntries(allowed.map(k => [k, value[name][k] || ''])) : {};
  }
  result.execution = Object.values(value.execution).some(row => Object.values(row).some(Boolean))
    ? Object.fromEntries(ZONES.map(zone => [zone, Object.fromEntries(EXECUTION.map(key => [key, value.execution[zone]?.[key] || '']))])) : {};
  return result;
}
const same = (a, b) => canonical(a) === canonical(b);
function publicResult(raw, bound, request, snapshot) {
  if (!plain(raw) || raw.saved !== true || typeof raw.already_applied !== 'boolean' || !plain(raw.version)) fail('ARCHIVE_RESULT_INVALID');
  const v = raw.version, c = bound.context;
  uuid(v.id); uuid(v.previous_version_id, true);
  if (raw.latest_version_id !== v.id || v.request_id !== request.requestId || v.customer_profile_id !== c.customer_profile_id || v.booking_id !== c.booking_id || v.booking_date !== c.booking_date || v.visit_key !== c.visit_key || v.store !== c.store || v.source !== 'manual' || v.author !== bound.actor.username || v.previous_version_id !== request.expectedLatestVersionId || !Number.isSafeInteger(v.version_no) || v.version_no < 1 || ((v.version_no === 1) !== (v.previous_version_id === null)) || typeof v.created_at !== 'string' || !Number.isFinite(Date.parse(v.created_at))) fail('ARCHIVE_RESULT_SCOPE_MISMATCH');
  const got = Object.fromEntries(Object.keys(snapshot).map(k => [k, v[k]]));
  if (!same(normalizedSnapshot(snapshot), got)) fail('ARCHIVE_RESULT_PAYLOAD_MISMATCH');
  // Do not forward SQL diagnostics, hash, private storage paths or arbitrary keys.
  return freeze({ saved: true, alreadyApplied: raw.already_applied, appliedVersionId: v.id, version: {
    id: v.id, requestId: v.request_id, versionNumber: v.version_no, previousVersionId: v.previous_version_id,
    createdAt: v.created_at, actor: { ...bound.actor }, scope: { ...bound.scope }, snapshot: { ...clone(got), archive_url: null },
  } });
}
function databaseFailure(error) {
  if (error instanceof ProductionArchiveError || error?.name === 'ProductionEmployeeError' || error?.name === 'DesignAccessError') throw error;
  // Only stable, enumerated DB signals are exposed; never SQL messages/PII.
  if (error?.code === '40001') fail('ARCHIVE_VERSION_CONFLICT');
  if (error?.code === 'CUSTOMER_DESIGN_REQUEST_REUSED' || error?.message === 'CUSTOMER_DESIGN_REQUEST_REUSED') fail('ARCHIVE_REQUEST_CONFLICT');
  if (error?.code === 'CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED' || error?.message === 'CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED') fail('ARCHIVE_CLIENT_UPGRADE_REQUIRED');
  if (error?.code === '42501' || error?.code === 'P0002') fail('ARCHIVE_SCOPE_DENIED');
  // A transport/commit failure may have committed. Caller must retain requestId.
  fail('ARCHIVE_OUTCOME_UNCERTAIN');
}
/**
 * transaction(callback) must execute every callback read/RPC in ONE DB
 * transaction, with assignment/session/binding locks through commit, rollback on
 * throw and an atomic beforeCommit hook. Separate REST calls are NOT sufficient.
 * Nothing supplies this capability by default or configures live database access.
 */
export function createProductionArchiveAdapter({ employeeAdapter, transaction } = {}) {
  async function appendLegacyVersion(request) {
    if (!employeeAdapter || typeof employeeAdapter.resolveArchiveContext !== 'function' || typeof transaction !== 'function') fail('ARCHIVE_TRANSACTION_NOT_CONFIGURED');
    keys(request, ['credential', 'scope', 'requestId', 'expectedLatestVersionId', 'snapshot']);
    const scope = validateProductionDesignScope(request.scope);
    const requestId = uuid(request.requestId), expectedLatestVersionId = uuid(request.expectedLatestVersionId, true);
    const snapshot = validateLegacyArchiveSnapshot(request.snapshot);
    const fixed = { credential: request.credential, scope, requestId, expectedLatestVersionId };
    const initial = await employeeAdapter.resolveArchiveContext(fixed);
    try {
      let invoked = false, guarded = false, checkedResult;
      const result = await transaction(async tx => {
        if (invoked) fail('ARCHIVE_TRANSACTION_REENTRY');
        invoked = true;
        if (!plain(tx) || typeof tx.rpc !== 'function' || typeof tx.restRows !== 'function' || typeof tx.resolveVisitBinding !== 'function' || typeof tx.beforeCommit !== 'function') fail('ARCHIVE_TRANSACTION_NOT_CONFIGURED');
        const employee = createProductionEmployeeAdapter(tx);
        const current = await employee.resolveArchiveContext(fixed);
        if (!same(initial, current)) fail('ARCHIVE_AUTHORIZATION_CHANGED');
        const guard = await employee.gate.createCommitGuard(fixed);
        async function checkBinding() {
          await guard.recheck();
          const latest = await employee.resolveArchiveContext(fixed);
          if (!same(current, latest)) fail('ARCHIVE_AUTHORIZATION_CHANGED');
        }
        await checkBinding();
        // This callback must run inside the transaction immediately before COMMIT.
        await tx.beforeCommit(async () => { await checkBinding(); guarded = true; });
        const raw = await tx.rpc('append_customer_design_version', freeze({
          p_payload: { ...current.context, ...clone(snapshot), request_id: requestId, expected_latest_version_id: expectedLatestVersionId },
          p_actor: current.actor.username, p_source: 'manual',
        }));
        const checked = publicResult(raw, current, fixed, snapshot);
        await checkBinding();
        checkedResult = checked;
        return checked;
      });
      if (!invoked) fail('ARCHIVE_TRANSACTION_NOT_EXECUTED');
      if (!guarded || !same(result, checkedResult)) fail('ARCHIVE_OUTCOME_UNCERTAIN');
      // Executor is trusted, but still require the validated callback result shape.
      if (!result || result.saved !== true || result.version?.requestId !== requestId || !same(result.version?.scope, scope)) fail('ARCHIVE_RESULT_INVALID');
      return freeze(clone(result));
    } catch (error) { databaseFailure(error); }
  }
  return freeze({ appendLegacyVersion });
}
