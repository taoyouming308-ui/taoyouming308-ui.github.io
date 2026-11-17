/**
 * Local-only, deterministic design pilot contracts. These checks are NOT server
 * authentication, authorization, durable transactions, or a production archive.
 * No network, credentials, customer lookup, persistence, or model calls occur.
 */
export const LEGACY_DESIGN_SCHEMA_VERSION = 'design-pilot-local-v1';
export const DESIGN_SCHEMA_VERSION = 'design-pilot-local-v2';
export const DESIGN_PHASES = Object.freeze(['before_analysis', 'proposal', 'execution', 'completed_review', 'archive']);
export const DESIGN_ZONES = Object.freeze(['bangs', 'top', 'ear_front', 'ear_back', 'middle', 'bottom']);
export const DESIGN_TECHNIQUE_FIELDS = Object.freeze(['rod_type', 'rod_size_mm', 'rod_method', 'direction', 'angle_degrees', 'turns', 'product', 'formula', 'mixture', 'application', 'softening_check', 'time_minutes', 'temperature_celsius', 'color_target', 'color_formula']);
export const DESIGN_MANAGED_BEFORE_FIELDS = Object.freeze(['front','back','left','right'].flatMap(angle=>['managed_before_outline_'+angle,'managed_before_hair_shape_'+angle]));
export const DESIGN_MANAGED_REVIEW_FIELDS = Object.freeze(['front','back','left','right'].map(angle=>'managed_photo_comparison_'+angle).concat(['managed_completion_synthesis_left','managed_completion_synthesis_right']));
export const DESIGN_PERSON_FIELDS = Object.freeze(['requested_style', 'self_description', 'daily_routine', 'maintenance_preference', 'visible_outline', 'visible_hair_shape', ...DESIGN_MANAGED_BEFORE_FIELDS]);
export const DESIGN_REVIEW_FIELDS = Object.freeze(['observed_result', 'customer_feedback', 'employee_review', 'model_photo_comparison_front', 'model_photo_comparison_back', 'model_photo_comparison_left', 'model_photo_comparison_right', 'model_completion_synthesis_left', 'model_completion_synthesis_right', ...DESIGN_MANAGED_REVIEW_FIELDS]);
export const DESIGN_SERVICES = Object.freeze(['cut', 'perm', 'dye', 'unknown']);
export const DESIGN_SIDES = Object.freeze(['left', 'right', 'center', 'bilateral', 'unknown']);
const SCOPE_KEYS = ['customerId', 'visitId', 'sessionId'];
const ENTRY_KEYS = ['id', 'category', 'field', 'zone', 'track', 'origin', 'basis', 'value', 'status', 'sources', 'replacesEntryId'];
const GROUP_KEYS = ['groupId', 'service', 'side'];
const MAX_EVENTS = 1000;

export class DesignContractError extends Error {
  constructor(code, message) { super(message); this.name = 'DesignContractError'; this.code = code; }
}
function fail(code, message) { throw new DesignContractError(code, message); }
function check(test, code, message) { if (!test) fail(code, message); }
function record(value, label) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'INVALID_OBJECT', `${label} must be a plain object`);
}
function keys(value, expected, label) {
  record(value, label);
  check(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), 'INVALID_FIELDS', `${label} has missing or unsupported fields`);
}
function text(value, label, max = 2000) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_TEXT', `${label} must be nonempty text (at most ${max})`);
}
function id(value, label) { text(value, label, 160); check(value === value.trim(), 'INVALID_ID', `${label} must not have surrounding whitespace`); }
function oneOf(value, allowed, label) { check(allowed.includes(value), 'INVALID_ENUM', `${label} is not supported`); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  record(value, 'JSON value');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
function clone(value) { return JSON.parse(canonical(value)); }
function scope(value) { keys(value, SCOPE_KEYS, 'scope'); SCOPE_KEYS.forEach(key => id(value[key], key)); return clone(value); }
function sameScope(a, b) { scope(b); check(canonical(a) === canonical(b), 'SCOPE_MISMATCH', 'Customer, visit and session must all match exactly'); }
function empty(scopeValue, schemaVersion = DESIGN_SCHEMA_VERSION) {
  return { schemaVersion, scope: scope(scopeValue), revision: 0, phase: 'before_analysis', sources: [], entries: [], journal: [] };
}
export function createDesignSession(scopeValue) { return freeze(empty(scopeValue)); }

function sourceReferences(refs, state, { required = false, employeeOnly = false } = {}) {
  check(Array.isArray(refs) && refs.length <= 12 && (!required || refs.length > 0), 'INVALID_SOURCES', 'Evidence must be a bounded list; known claims need source evidence');
  const seen = new Set();
  return refs.map(ref => {
    keys(ref, ['messageId', 'quote'], 'source reference');
    id(ref.messageId, 'messageId'); text(ref.quote, 'quote');
    check(!seen.has(ref.messageId + '\n' + ref.quote), 'DUPLICATE_SOURCE', 'Duplicate source reference');
    seen.add(ref.messageId + '\n' + ref.quote);
    const found = state.sources.find(item => item.messageId === ref.messageId);
    check(found && found.text.includes(ref.quote), 'SOURCE_MISMATCH', 'Evidence must quote an existing message exactly');
    if (employeeOnly) check(found.actor === 'employee' && ['text', 'speech_transcript'].includes(found.kind), 'EMPLOYEE_EVIDENCE_REQUIRED', 'Confirmation needs an explicit employee text or speech source');
    return found;
  });
}
function entryKey(entry) { return canonical([entry.category, entry.field, entry.zone, entry.track, entry.groupId ?? null, entry.service ?? null, entry.side ?? null]); }
function latestEntry(state, entry) { return state.entries.filter(item => entryKey(item) === entryKey(entry)).at(-1); }
function quoteContainsValue(quote, value) {
  const literal = String(value);
  if (/^[+-]?\d+(?:\.\d+)?$/.test(literal)) {
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(quote);
  }
  return quote.includes(literal);
}
function validateEntry(entry, state) {
  keys(entry, state.schemaVersion === DESIGN_SCHEMA_VERSION ? [...ENTRY_KEYS, ...GROUP_KEYS] : ENTRY_KEYS, 'entry'); id(entry.id, 'entry.id');
  check(!state.entries.some(item => item.id === entry.id), 'DUPLICATE_ENTRY', 'Entry identifiers are immutable and unique');
  oneOf(entry.category, ['person_style', 'technique', 'result_review'], 'category');
  oneOf(entry.origin, ['extraction', 'suggestion'], 'origin');
  oneOf(entry.basis, ['said', 'observable', 'inferred'], 'basis');
  oneOf(entry.track, ['context', 'planned', 'actual'], 'track');
  oneOf(entry.status, ['unknown', 'not_confirmed'], 'status');
  if (state.schemaVersion === DESIGN_SCHEMA_VERSION) {
    if (entry.category === 'technique') {
      id(entry.groupId, 'groupId'); oneOf(entry.service, DESIGN_SERVICES, 'service'); oneOf(entry.side, DESIGN_SIDES, 'side');
    } else check(GROUP_KEYS.every(key => entry[key] === null), 'INVALID_GROUP', 'Non-technique entries must have null groupId, service and side');
  }
  check(entry.value === null || typeof entry.value === 'string' || (typeof entry.value === 'number' && Number.isFinite(entry.value)), 'INVALID_VALUE', 'Value must be text, finite number or explicit null');
  if (typeof entry.value === 'string') text(entry.value, 'entry.value');
  check((entry.value === null) === (entry.status === 'unknown'), 'UNKNOWN_REQUIRED', 'Null must be unknown; supplied values must remain not_confirmed');
  if (entry.category === 'person_style') {
    oneOf(entry.field, DESIGN_PERSON_FIELDS, 'person_style field');
    check(entry.zone === null && entry.track === 'context', 'INVALID_PERSON_CONTEXT', 'Person/style fields are context, without a technique zone');
    check(['before_analysis', 'proposal', 'execution'].includes(state.phase), 'PHASE_VIOLATION', 'Person/style context cannot be added after execution');
    if (state.phase === 'before_analysis') check(['requested_style', 'self_description', 'visible_outline', 'visible_hair_shape', ...DESIGN_MANAGED_BEFORE_FIELDS].includes(entry.field) && entry.origin === 'extraction' && entry.basis !== 'inferred', 'BEFORE_ANALYSIS_ONLY', 'Before analysis only records explicit person/basic-style evidence, not daily maintenance analysis, proposals or care');
    if (entry.basis === 'observable') check(['visible_outline', 'visible_hair_shape', ...DESIGN_MANAGED_BEFORE_FIELDS].includes(entry.field), 'APPEARANCE_INFERENCE', 'Appearance cannot establish personality, lifestyle or preferences');
    if (DESIGN_MANAGED_BEFORE_FIELDS.includes(entry.field)) check(state.phase==='before_analysis' && entry.origin==='extraction' && entry.basis==='observable', 'BEFORE_ANALYSIS_ONLY', 'Managed before views are observable before-analysis evidence only');
    if (entry.basis === 'inferred') check(entry.origin === 'suggestion' && entry.field === 'requested_style', 'APPEARANCE_INFERENCE', 'Inferences can only be labeled style suggestions, never personal attributes');
  } else if (entry.category === 'technique') {
    oneOf(entry.field, DESIGN_TECHNIQUE_FIELDS, 'technique field'); oneOf(entry.zone, DESIGN_ZONES, 'zone');
    check(entry.track !== 'context', 'INVALID_TRACK', 'Technique must distinguish planned and actual');
    check(entry.track === 'planned' ? ['proposal', 'execution'].includes(state.phase) : ['execution', 'completed_review'].includes(state.phase), 'PHASE_VIOLATION', 'Technique track is not allowed in this phase');
    if (entry.value !== null) check(entry.origin === 'extraction' && entry.basis === 'said', 'NO_TECHNIQUE_GUESS', 'Technical values require explicit source statements, never inferred defaults');
    if (typeof entry.value === 'number') check(entry.value >= 0, 'INVALID_VALUE', 'Technical measurements cannot be negative');
  } else {
    oneOf(entry.field, DESIGN_REVIEW_FIELDS, 'review field');
    check(state.phase === 'completed_review' && entry.track === 'actual' && (entry.zone === null || DESIGN_ZONES.includes(entry.zone)), 'PHASE_VIOLATION', 'Results can only be recorded as actual in completed review');
    if (entry.field.startsWith('managed_photo_comparison_')) check(entry.zone===null && entry.origin==='extraction' && entry.basis==='observable', 'INVALID_BASIS', 'Managed comparisons describe observable results, not procedures');
    if (entry.field.startsWith('managed_completion_synthesis_')) check(entry.zone===null && entry.origin==='suggestion' && entry.basis==='inferred', 'INVALID_BASIS', 'Managed synthesis is an explicitly inferred review');
  }
  const sources = sourceReferences(entry.sources, state, { required: entry.value !== null && entry.origin === 'extraction' });
  if (entry.value !== null && entry.origin === 'extraction') {
    check(entry.basis !== 'inferred', 'INVALID_BASIS', 'Extraction cannot be an inference');
    check(entry.sources.some(ref => quoteContainsValue(ref.quote, entry.value)), 'VALUE_NOT_IN_SOURCE', 'Extracted value must occur verbatim in its source quote, not inside another number');
    if (entry.basis === 'said') check(sources.every(item => ['text', 'speech_transcript'].includes(item.kind) && !['model', 'system'].includes(item.actor)), 'INVALID_BASIS', 'Said evidence must be a person’s original text or speech');
    if (entry.basis === 'observable') check(sources.every(item => item.kind === 'image_description' || item.kind === 'synthetic_image_description' && DESIGN_MANAGED_BEFORE_FIELDS.includes(entry.field) || item.kind === 'synthetic_application_comparison' && state.phase === 'completed_review' && /^managed_photo_comparison_(front|back|left|right)$/.test(entry.field)), 'INVALID_BASIS', 'Observable evidence must be explicitly labeled image description; synthetic descriptions only use dedicated before-view fields');
  }
  if(sources.some(s=>s.kind==='synthetic_application_comparison'))check(state.phase==='completed_review'&&sources.every(s=>s.kind==='synthetic_application_comparison')&&/^managed_photo_comparison_(front|back|left|right)$/.test(entry.field)&&entry.category==='result_review'&&entry.track==='actual'&&entry.origin==='extraction'&&entry.basis==='observable','INVALID_BASIS','Synthetic comparison is restricted to review fields');
  if(sources.some(s=>s.kind==='synthetic_application_synthesis'))check(state.phase==='completed_review'&&sources.every(s=>s.kind==='synthetic_application_synthesis')&&/^managed_completion_synthesis_(left|right)$/.test(entry.field)&&entry.category==='result_review'&&entry.track==='actual'&&entry.origin==='suggestion'&&entry.basis==='inferred','INVALID_BASIS','Synthetic synthesis is restricted to review fields');
  const previous = latestEntry(state, entry);
  check(previous ? entry.replacesEntryId === previous.id : entry.replacesEntryId === null, 'REVISION_LINK_REQUIRED', 'Corrections must reference the latest entry for the same field, zone, group, service, side and planned/actual track');
}
function addSource(state, source) {
  keys(source, ['messageId', 'kind', 'actor', 'text'], 'source');
  id(source.messageId, 'messageId'); text(source.text, 'original text', 12000);
  oneOf(source.kind, ['text', 'speech_transcript', 'image_description', 'model_synthesis', 'server_synthesis', 'synthetic_image_description', 'synthetic_application_comparison', 'synthetic_application_synthesis'], 'source.kind');
  oneOf(source.actor, ['customer', 'employee', 'model', 'system'], 'source.actor');
  check(['server_synthesis','synthetic_image_description','synthetic_application_comparison','synthetic_application_synthesis'].includes(source.kind) === (source.actor === 'system'), 'INVALID_SOURCE_ACTOR', 'Only server synthesis or explicitly synthetic image descriptions have system actor');
  if (source.kind === 'synthetic_image_description') check(state.phase === 'before_analysis' && (source.messageId.startsWith('synthetic-normalized:') || source.messageId.startsWith('synthetic-application:')) && source.text.startsWith('合成演练，mock 响应，未调用真实模型；'), 'INVALID_SOURCE_ACTOR', 'Synthetic image source must retain its explicit non-production attribution');
  if(source.kind==='synthetic_application_comparison')check(state.phase==='completed_review'&&source.messageId.startsWith('synthetic-application-comparison:')&&source.text.startsWith('合成演练，mock 响应，未调用真实模型；应用图片逐角比较，未确认、非测量或执行事实：'),'INVALID_SOURCE_ACTOR','Synthetic comparison requires explicit system attribution');
  if(source.kind==='synthetic_application_synthesis')check(state.phase==='completed_review'&&source.messageId.startsWith('synthetic-application-synthesis:')&&(source.text.startsWith('合成演练，服务器整理，未调用新模型：')||source.text.startsWith('合成演练，mock 响应，未调用真实模型；整理已采纳逐角判断，未重新查看照片：')),'INVALID_SOURCE_ACTOR','Synthetic synthesis requires explicit system attribution');
  if (source.kind === 'model_synthesis') check(source.actor === 'model', 'INVALID_SOURCE_ACTOR', 'Model synthesis cannot be employee or customer original speech');
  check(!state.sources.some(item => item.messageId === source.messageId), 'DUPLICATE_MESSAGE', 'Original message IDs cannot be overwritten');
  state.sources.push(clone(source));
}
function applyEvent(state, event) {
  record(event, 'event');
  if (event.type === 'schema_migrated') {
    keys(event, ['type', 'targetVersion', 'parentArchiveRevision'], 'migration event');
    check(state.schemaVersion === LEGACY_DESIGN_SCHEMA_VERSION && event.targetVersion === DESIGN_SCHEMA_VERSION, 'MIGRATION_CONFLICT', 'Only one explicit v1 to v2 migration is supported');
    check(event.parentArchiveRevision === (state.phase === 'archive' ? state.revision : null), 'ARCHIVE_MISMATCH', 'Archived migration must link the exact current archive revision');
    state.entries.forEach(entry => Object.assign(entry, entry.category === 'technique'
      ? { groupId: 'legacy-ungrouped', service: 'unknown', side: 'unknown' }
      : { groupId: null, service: null, side: null }));
    state.schemaVersion = DESIGN_SCHEMA_VERSION;
    return;
  }
  if (event.type === 'revision_opened') {
    keys(event, ['type', 'parentArchiveRevision', 'resumePhase', 'reasonSource'], 'revision event');
    check(state.schemaVersion === DESIGN_SCHEMA_VERSION, 'MIGRATION_REQUIRED', 'Migrate v1 explicitly before opening an archived revision');
    check(state.phase === 'archive' && event.parentArchiveRevision === state.revision, 'ARCHIVE_MISMATCH', 'Revision must link the exact latest archived checkpoint');
    oneOf(event.resumePhase, ['proposal', 'execution', 'completed_review'], 'resumePhase');
    record(event.reasonSource, 'reasonSource');
    check(event.reasonSource.actor === 'employee' && ['text', 'speech_transcript'].includes(event.reasonSource.kind), 'EMPLOYEE_EVIDENCE_REQUIRED', 'An archived revision needs a new explicit employee reason source');
    addSource(state, event.reasonSource);
    state.phase = event.resumePhase;
    return;
  }
  check(state.phase !== 'archive', 'ARCHIVE_IMMUTABLE', 'Archived sessions cannot accept new events');
  if (event.type === 'source_recorded') {
    keys(event, ['type', 'source'], 'source event');
    addSource(state, event.source);
  } else if (event.type === 'entry_recorded') {
    keys(event, ['type', 'entry'], 'entry event'); validateEntry(event.entry, state);
    state.entries.push({ ...clone(event.entry), confirmation: null });
  } else if (event.type === 'entry_confirmed') {
    keys(event, ['type', 'entryId', 'confirmedValue', 'sources'], 'confirmation event');
    const entry = state.entries.find(item => item.id === event.entryId);
    check(entry && latestEntry(state, entry).id === entry.id, 'STALE_ENTRY', 'Only the latest existing field entry can be confirmed');
    check(entry.value !== null && entry.status === 'not_confirmed', 'INVALID_CONFIRMATION', 'Unknown or already confirmed entries cannot be confirmed');
    check(canonical(entry.value) === canonical(event.confirmedValue), 'CONFIRMATION_MISMATCH', 'Confirm the exact recorded value');
    sourceReferences(event.sources, state, { required: true, employeeOnly: true });
    entry.status = 'confirmed'; entry.confirmation = { revision: state.revision + 1, sources: clone(event.sources) };
  } else if (event.type === 'phase_advanced') {
    keys(event, ['type', 'phase'], 'phase event');
    check(DESIGN_PHASES[DESIGN_PHASES.indexOf(state.phase) + 1] === event.phase, 'PHASE_VIOLATION', 'Advance exactly one phase; do not skip, rewind or relabel a session');
    state.phase = event.phase;
  } else fail('UNSUPPORTED_EVENT', 'Unknown design event');
}
function validateRequest(request, state) {
  keys(request, ['requestId', 'expectedRevision', 'scope', 'event'], 'request'); id(request.requestId, 'requestId');
  sameScope(state.scope, request.scope);
  check(Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 0, 'INVALID_REVISION', 'Expected revision must be a nonnegative integer');
  canonical(request.event);
}
function applyRequest(state, request) {
  validateRequest(request, state);
  check(request.expectedRevision === state.revision, 'REVISION_CONFLICT', 'Expected revision must match the latest revision');
  check(!state.journal.some(item => item.requestId === request.requestId), 'DUPLICATE_REQUEST', 'Journal contains a duplicate request');
  check(state.revision < MAX_EVENTS, 'SESSION_LIMIT', 'Session event limit reached');
  applyEvent(state, request.event);
  state.journal.push(clone(request)); state.revision += 1;
}
/** Validate all projections against the append-only journal, not caller claims. */
export function validateDesignSession(session) {
  keys(session, ['schemaVersion', 'scope', 'revision', 'phase', 'sources', 'entries', 'journal'], 'session');
  check([LEGACY_DESIGN_SCHEMA_VERSION, DESIGN_SCHEMA_VERSION].includes(session.schemaVersion) && Array.isArray(session.journal) && session.journal.length <= MAX_EVENTS, 'INVALID_SESSION', 'Unsupported or oversized session');
  const rebuilt = empty(session.scope, initialVersion(session));
  session.journal.forEach(request => applyRequest(rebuilt, request));
  check(canonical(session) === canonical(rebuilt), 'SESSION_TAMPERED', 'Session projections do not match their journal');
  return freeze(rebuilt);
}
function initialVersion(session) { return session.journal.some(request => request?.event?.type === 'schema_migrated') ? LEGACY_DESIGN_SCHEMA_VERSION : session.schemaVersion; }
function archiveLineage(session) {
  return session.journal.flatMap((request, index) => ['revision_opened', 'schema_migrated'].includes(request.event.type) && request.event.parentArchiveRevision !== null
    ? [{ parentArchiveRevision: request.event.parentArchiveRevision, appendedRevision: index + 1, kind: request.event.type }]
    : []);
}
/** Explicit migration preserves every original request and confirmation revision. */
export function migrateDesignSession(session, request) {
  const checked = validateDesignSession(session);
  keys(request, ['requestId', 'expectedRevision', 'scope'], 'migration request');
  const previous = checked.journal.find(item => item.requestId === request.requestId);
  const parentArchiveRevision = previous?.event?.type === 'schema_migrated' ? previous.event.parentArchiveRevision : checked.phase === 'archive' ? checked.revision : null;
  return appendDesignEvent(checked, { ...request, event: { type: 'schema_migrated', targetVersion: DESIGN_SCHEMA_VERSION, parentArchiveRevision } });
}
/** Identical retries succeed even after later events; changed retries conflict. */
export function appendDesignEvent(session, request) {
  const checked = validateDesignSession(session); validateRequest(request, checked);
  const previous = checked.journal.find(item => item.requestId === request.requestId);
  if (previous) {
    check(canonical(previous) === canonical(request), 'IDEMPOTENCY_CONFLICT', 'Request ID was already used for a different payload');
    return freeze({ session: checked, replayed: true, appliedRevision: checked.journal.indexOf(previous) + 1 });
  }
  const next = clone(checked); applyRequest(next, request);
  return freeze({ session: freeze(next), replayed: false, appliedRevision: next.revision });
}
/** Unknown is explicit for every technical field in all six zones. Never copy plan to actual. */
export function getDesignView(session) {
  const checked = validateDesignSession(session);
  const latest = checked.entries.filter(entry => latestEntry(checked, entry).id === entry.id);
  function tracks(entries) {
    return Object.fromEntries(['planned', 'actual'].map(track => [track, Object.fromEntries(DESIGN_TECHNIQUE_FIELDS.map(field => [field,
      entries.find(entry => entry.track === track && entry.field === field) || { value: null, status: 'unknown', sources: [], confirmation: null }]))]));
  }
  const zones = Object.fromEntries(DESIGN_ZONES.map(zone => {
    const entries = latest.filter(entry => entry.category === 'technique' && entry.zone === zone);
    if (checked.schemaVersion === LEGACY_DESIGN_SCHEMA_VERSION) return [zone, tracks(entries)];
    const groups = new Map();
    for (const entry of entries) {
      const key = canonical([entry.groupId, entry.service, entry.side]);
      if (!groups.has(key)) groups.set(key, { groupId: entry.groupId, service: entry.service, side: entry.side, entries: [] });
      groups.get(key).entries.push(entry);
    }
    return [zone, { groups: [...groups.values()].map(group => ({ groupId: group.groupId, service: group.service, side: group.side, ...tracks(group.entries) })) }];
  }));
  return freeze({ schemaVersion: checked.schemaVersion, scope: clone(checked.scope), revision: checked.revision, phase: checked.phase, sources: clone(checked.sources), entries: clone(latest), zones, archiveLineage: archiveLineage(checked) });
}
/** Validate model candidates only. This never confirms, applies, saves, or archives them. */
export function validateDesignPilotResult(result, session) {
  const checked = validateDesignSession(session);
  keys(result, ['phase', 'entries', 'questions', 'warnings'], 'model result');
  check(result.phase === checked.phase && checked.phase !== 'archive', 'PHASE_VIOLATION', 'Model result must match the current writable phase');
  check(Array.isArray(result.entries) && result.entries.length <= 100, 'RESULT_LIMIT', 'At most 100 candidate entries per response');
  const trial = clone(checked);
  result.entries.forEach(entry => { validateEntry(entry, trial); trial.entries.push({ ...clone(entry), confirmation: null }); });
  for (const field of ['questions', 'warnings']) {
    check(Array.isArray(result[field]) && result[field].length <= 20, 'RESULT_LIMIT', `At most 20 ${field} per response`);
    result[field].forEach(value => text(value, field, 1000));
  }
  return freeze(clone(result));
}
/** Local archive envelope only; production must implement scoped durable storage and auth. */
export function createDesignArchive(session, requestedScope) {
  const checked = validateDesignSession(session); sameScope(checked.scope, requestedScope);
  check(checked.phase === 'archive', 'PHASE_VIOLATION', 'Advance through completed review before archiving');
  const archive = { schemaVersion: checked.schemaVersion, kind: 'local_design_archive', scope: clone(checked.scope), revision: checked.revision, snapshot: checked };
  if (checked.schemaVersion === DESIGN_SCHEMA_VERSION) archive.previousArchiveRevision = archiveLineage(checked).at(-1)?.parentArchiveRevision ?? null;
  return freeze(archive);
}
export function validateDesignArchive(archive, requestedScope) {
  record(archive, 'archive');
  keys(archive, ['schemaVersion', 'kind', 'scope', 'revision', 'snapshot', ...(archive.schemaVersion === DESIGN_SCHEMA_VERSION ? ['previousArchiveRevision'] : [])], 'archive');
  sameScope(archive.scope, requestedScope); const expected = createDesignArchive(archive.snapshot, archive.scope);
  check(canonical(archive) === canonical(expected), 'ARCHIVE_MISMATCH', 'Archive envelope must match its exact snapshot');
  return expected;
}
/**
 * Continue the same session with a linked append-only revision. The service must
 * supply its latest stored session and atomically compare expectedRevision.
 */
export function createDesignRevision(session, archive, request) {
  keys(request, ['requestId', 'expectedRevision', 'scope', 'resumePhase', 'reasonSource'], 'revision request');
  const checked = validateDesignSession(session);
  const parent = validateDesignArchive(archive, request.scope);
  sameScope(checked.scope, parent.scope);
  check(request.expectedRevision === parent.revision && parent.revision <= checked.revision, 'ARCHIVE_MISMATCH', 'Expected revision must identify the exact parent archive checkpoint');
  const checkpoint = empty(checked.scope, initialVersion(checked));
  checked.journal.slice(0, parent.revision).forEach(item => applyRequest(checkpoint, item));
  check(canonical(checkpoint) === canonical(parent.snapshot), 'ARCHIVE_MISMATCH', 'Archive must be the exact immutable checkpoint in this session history');
  return appendDesignEvent(checked, {
    requestId: request.requestId, expectedRevision: request.expectedRevision, scope: request.scope,
    event: { type: 'revision_opened', parentArchiveRevision: parent.revision, resumePhase: request.resumePhase, reasonSource: request.reasonSource },
  });
}
/** Explicit employee submissions only. No archive/customer-mining entry point exists. */
export function createKnowledgeCandidate(submission) {
  keys(submission, ['submissionKind', 'redactionConfirmed', 'experience'], 'knowledge submission');
  check(submission.submissionKind === 'employee_submitted_experience', 'KNOWLEDGE_DISABLED', 'Automatic customer/archive mining is disabled');
  check(submission.redactionConfirmed === true, 'REDACTION_REQUIRED', 'An employee must explicitly confirm personal information was removed');
  keys(submission.experience, ['situation', 'action', 'observedOutcome', 'limits'], 'experience');
  Object.values(submission.experience).forEach(value => {
    text(value, 'experience', 2000);
    check(!/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|(?:\+?\d[\d ()-]{8,}\d)|https?:\/\//i.test(value), 'IDENTIFYING_CONTENT', 'Remove contact details, long identifiers and links before review');
  });
  return freeze({ schemaVersion: DESIGN_SCHEMA_VERSION, kind: 'knowledge_candidate', status: 'needs_human_review', origin: 'employee_submitted_experience', automaticMiningEnabled: false, experience: clone(submission.experience) });
}
