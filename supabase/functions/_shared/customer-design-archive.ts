// Design archives share the employee boundary, never the public Data API.
import { customerReadStores, scopeCustomerProfile, customerIdentityRows } from './customer-profile-scope.mjs';

type Row = Record<string, any>;
export type DesignDependencies = {
  rest: (path: string, init?: RequestInit) => Promise<Response>;
  restRows: (path: string) => Promise<Row[]>;
  storage: (path: string, init?: RequestInit) => Promise<Response>;
  supabaseUrl: string;
  now?: () => number;
};
export class CustomerDesignError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'DESIGN_INVALID') {
    super(message); this.status = status; this.code = code;
  }
}
const OPS = new Set(['customer_design_history', 'customer_design_save', 'customer_design_upload', 'customer_design_photo_urls']);
const KEYS = ['style', 'person', 'length', 'features', 'layers', 'bangs', 'curls', 'care'];
const ZONES = ['bangs', 'top', 'ear_front', 'ear_back', 'middle', 'bottom'];
const ZONE_FIELDS = ['issue', 'target', 'actions', 'check'];
const PROCESS_FIELDS = ['care_texture', 'styling', 'style_feel', 'application', 'winding', 'rod_direction', 'curl_control', 'thinning_space', 'proposal', 'technique_layers'];
const REVIEW_FIELDS = ['achieved', 'pending', 'next'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = 'customer-design-photos';
export const MAX_DESIGN_PHOTO_BYTES = 8 * 1024 * 1024;
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const enc = encodeURIComponent;
const phone = (v: unknown) => text(v).replace(/\D/g, '').replace(/^86(?=1\d{10}$)/, '');
const name = (v: unknown) => text(v).replace(/\s/g, '').toLowerCase();
function fail(message: string, status = 400, code?: string): never { throw new CustomerDesignError(message, status, code); }
function id(value: unknown, optional = false): number | null {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) fail('客户或预约编号无效');
  return n;
}
function uuid(value: unknown): string { if (!UUID.test(text(value))) fail('请求或照片编号无效'); return text(value).toLowerCase(); }
function date(value: unknown, optional = false): string | null {
  if (optional && !text(value)) return null;
  const s = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) fail('服务日期无效');
  return s;
}
function sameVisit(a: Row, b: Row): boolean {
  return Number(a.customer_profile_id) === Number(b.customer_profile_id) && a.store === b.store &&
    (a.booking_id == null ? b.booking_id == null : Number(a.booking_id) === Number(b.booking_id)) &&
    a.booking_date === b.booking_date && a.visit_key === b.visit_key;
}
async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))).map(b => b.toString(16).padStart(2, '0')).join('');
}
function contextFields(c: Row): Row {
  return { customer_profile_id: Number(c.customer_profile_id), booking_id: c.booking_id == null ? null : Number(c.booking_id), booking_date: c.booking_date, visit_key: c.visit_key, store: c.store };
}
export function isCustomerDesignOperation(operation: unknown): boolean { return OPS.has(text(operation)); }
async function rpc(deps: DesignDependencies, fn: string, body: Row): Promise<any> {
  const response = await deps.rest('rpc/' + fn, { method: 'POST', body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(result.message || '');
    if (/CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED/.test(detail)) fail('这份档案已有新的六区执行记录，请在方便时更新 App 后再保存；当前草稿和照片已保留', 409, 'DESIGN_CLIENT_UPGRADE_REQUIRED');
    if (/DESIGN_CONFLICT|latest.version|最新版本|version.conflict/i.test(detail) || result.code === '40001') fail('已有新版本，请读取最新档案后再保存', 409, 'DESIGN_CONFLICT');
    if (/IDEMPOTENCY|request.*conflict|request.*reuse|重复请求|幂等/i.test(detail)) fail('同一请求编号的内容发生变化，请核对后重试', 409, 'DESIGN_REQUEST_CONFLICT');
    if (['42501', 'P0002'].includes(result.code) || /scope|identity|binding|mismatch|not.found|denied|forbidden|expired|invalid.*grant|门店|身份|绑定|过期/i.test(detail)) fail('客户、预约或访问范围未通过核对', 403, 'DESIGN_SCOPE_DENIED');
    // Do not echo SQL details, customer data, or internal paths to callers.
    fail('设计档案保存或读取失败，请检查内容后重试', 400, 'DESIGN_DATABASE_ERROR');
  }
  return result;
}
async function actorContext(payload: Row, session: Row | null, deps: DesignDependencies): Promise<Row> {
  let grant: Row | null = null;
  const requestedId = id(payload.customer_profile_id, true);
  const booking = id(payload.booking_id, true), bookingDate = date(payload.booking_date, true);
  if (payload.ingest_token !== undefined) {
    const token = text(payload.ingest_token);
    if (token.length < 32 || token.length > 256) fail('导入授权无效', 403, 'DESIGN_INGEST_DENIED');
    grant = await rpc(deps, 'validate_customer_design_ingest_grant', { p_token_hash: await hash(new TextEncoder().encode(token)) });
    if (!grant || !Number.isFinite(Date.parse(grant.expires_at)) || Date.parse(grant.expires_at) <= (deps.now?.() ?? Date.now())) fail('导入授权已过期', 403, 'DESIGN_INGEST_DENIED');
    if (!requestedId || requestedId !== Number(grant.customer_profile_id) || booking !== (grant.booking_id == null ? null : Number(grant.booking_id)) || bookingDate !== grant.booking_date || (payload.visit_key && text(payload.visit_key) !== grant.visit_key)) fail('导入授权与客户预约不一致', 403, 'DESIGN_INGEST_DENIED');
  } else if (!session?.username || !session?.store) fail('请重新登录', 403, 'DESIGN_AUTH_REQUIRED');
  const stores = grant ? [grant.store] : customerReadStores(session!.store, text(payload.customer_scope) || 'store');
  let profiles: Row[];
  if (requestedId) {
    profiles = await deps.restRows(`customer_profiles?select=id,name,phone,shop_name,card_packages,service_history&id=eq.${requestedId}&limit=2`);
    if (payload.phone && (text(payload.phone).includes('*') || phone(payload.phone).length !== 11)) fail('请提供完整手机号，避免误关联');
    profiles = profiles.filter(p => (!payload.phone || phone(p.phone) === phone(payload.phone)) && (!payload.name || name(p.name) === name(payload.name)));
  } else {
    const p = phone(payload.phone), n = name(payload.name);
    if (text(payload.phone).includes('*') || p.length !== 11 || !n) fail('需要客户编号或完整手机号和姓名，避免误关联', 400, 'DESIGN_IDENTITY_REQUIRED');
    const values = [p, '86' + p, '+86' + p].map(value => JSON.stringify(value)).join(',');
    profiles = await deps.restRows(`customer_profiles?select=id,name,phone,shop_name,card_packages,service_history&phone=in.${enc('(' + values + ')')}&limit=100`);
    profiles = customerIdentityRows(profiles, p, payload.name);
  }
  if (!grant) profiles = profiles.filter(p => scopeCustomerProfile(p, session!.store, text(payload.customer_scope) || 'store'));
  // A concrete appointment selects its real store when identical full identities
  // have separate profiles at both shops. The client cannot supply this anchor.
  if (!requestedId && booking) {
    const bookings = await deps.restRows(`bookings?select=id,customer_name,customer_phone,shop_name,date&id=eq.${booking}&limit=2`);
    const anchor = bookings.length === 1 ? bookings[0] : null;
    if (!anchor || !stores.includes(anchor.shop_name) || phone(anchor.customer_phone).length !== 11 ||
        phone(anchor.customer_phone) !== phone(payload.phone) || name(anchor.customer_name) !== name(payload.name) ||
        (bookingDate && String(anchor.date).slice(0, 10) !== bookingDate)) {
      fail('预约与客户身份或门店不一致', 403, 'DESIGN_SCOPE_DENIED');
    }
    profiles = profiles.filter(p => p.shop_name === anchor.shop_name && phone(p.phone) === phone(anchor.customer_phone) && name(p.name) === name(anchor.customer_name));
  }
  if (profiles.length !== 1) fail(profiles.length > 1 ? '客户身份有多个匹配，请用客户编号核对' : '未找到可访问的客户档案', 403, 'DESIGN_IDENTITY_AMBIGUOUS');
  const profile = profiles[0];
  const context = await rpc(deps, 'customer_design_resolve_context', { p_customer_profile_id: Number(profile.id), p_booking_id: booking, p_booking_date: bookingDate, p_visit_key: grant?.visit_key || text(payload.visit_key) || null });
  if (!context || Number(context.customer_profile_id) !== Number(profile.id) || !stores.includes(context.store)) fail('客户预约门店超出访问范围', 403, 'DESIGN_SCOPE_DENIED');
  if (booking !== (context.booking_id == null ? null : Number(context.booking_id)) || (bookingDate && bookingDate !== context.booking_date)) fail('预约日期与档案不一致', 403, 'DESIGN_SCOPE_DENIED');
  if (grant && !sameVisit(context, grant)) fail('导入授权与档案范围不一致', 403, 'DESIGN_INGEST_DENIED');
  return { context, stores, grant, source: grant ? 'chatgpt' : 'manual', author: grant ? 'ChatGPT' : session!.username, canWrite: grant ? true : context.store === session!.store };
}
function model(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('请按八步填写设计内容');
  const v = value as Row, result: Row = { outline: '', root_flow: '', steps: {} };
  for (const key of ['outline', 'root_flow', ...KEYS]) {
    const val = KEYS.includes(key) ? v.steps?.[key] : v[key];
    if (val != null && typeof val !== 'string') fail('设计内容必须为文字');
    if (String(val || '').length > 4000) fail('单项设计内容过长');
    if (KEYS.includes(key)) result.steps[key] = text(val); else result[key] = text(val);
  }
  return result;
}
function archiveURL(value: unknown): string | null {
  if (!text(value)) return null;
  try {
    const u = new URL(text(value));
    if (u.protocol === 'https:' && u.hostname === 'chatgpt.com' && !u.username && !u.password && /^\/space\/(?:page_|[A-Za-z0-9_-])/.test(u.pathname) && !u.hash && !u.search) return u.href;
  } catch (_) { /* reject below */ }
  return fail('协作档案链接无效');
}
function workflowObject(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('执行与复盘内容的字段无效');
  return value as Row;
}
function workflowText(value: unknown, keys: string[]): Row {
  const v = workflowObject(value, keys), result: Row = {};
  for (const key of keys) {
    if (Object.hasOwn(v, key) && typeof v[key] !== 'string') fail('执行与复盘内容必须为文字');
    if (String(v[key] || '').length > 4000) fail('执行与复盘的单项内容过长');
    result[key] = text(v[key]);
  }
  return Object.values(result).some(Boolean) ? result : {};
}
function workflowExecution(value: unknown): Row {
  const v = workflowObject(value, ZONES), result: Row = {};
  let meaningful = false;
  for (const zone of ZONES) {
    const fields = workflowText(Object.hasOwn(v, zone) ? v[zone] : {}, ZONE_FIELDS);
    meaningful ||= Object.keys(fields).length > 0;
    result[zone] = Object.fromEntries(ZONE_FIELDS.map(key => [key, fields[key] || '']));
  }
  return meaningful ? result : {};
}
function snapshot(payload: Row): Row {
  const baseline = model(payload.baseline), optimized = model(payload.optimized), reasons: Row = {};
  const workflow: Row = {};
  // Keep missing distinct from an explicit empty object: old clients must not
  // erase workflow data that was entered with a newer App version.
  if (Object.hasOwn(payload, 'execution')) workflow.execution = workflowExecution(payload.execution);
  if (Object.hasOwn(payload, 'process')) workflow.process = workflowText(payload.process, PROCESS_FIELDS);
  if (Object.hasOwn(payload, 'review')) workflow.review = workflowText(payload.review, REVIEW_FIELDS);
  for (const key of ['outline', 'root_flow', ...KEYS]) {
    const a = KEYS.includes(key) ? baseline.steps[key] : baseline[key];
    const b = KEYS.includes(key) ? optimized.steps[key] : optimized[key];
    if (payload.reasons?.[key] != null && typeof payload.reasons[key] !== 'string') fail('调整理由必须为文字');
    const reason = text(payload.reasons?.[key]);
    if (reason.length > 4000) fail('调整理由过长');
    if (b && a !== b && !reason) fail('每项优化需要填写调整理由');
    reasons[key] = reason;
  }
  if (!['baseline', 'optimizing', 'confirmed', 'completed', 'followup'].includes(payload.status)) fail('设计状态无效');
  if (!Array.isArray(payload.photo_ids) || payload.photo_ids.length > 30) fail('照片列表无效');
  if (!Object.hasOwn(payload, 'expected_latest_version_id')) fail('缺少版本核对条件');
  return { baseline, optimized, reasons, ...workflow, status: payload.status, photo_ids: [...new Set(payload.photo_ids.map(uuid))], request_id: uuid(payload.request_id), expected_latest_version_id: payload.expected_latest_version_id === null ? null : uuid(payload.expected_latest_version_id), archive_url: archiveURL(payload.archive_url) };
}
const ASSET_FIELDS = 'id,request_id,customer_profile_id,booking_id,booking_date,visit_key,store,stage,angle,bucket,path,mime_type,byte_size,sha256,filename,caption,source,author,created_at';
const VERSION_FIELDS = 'id,request_id,customer_profile_id,booking_id,booking_date,visit_key,store,version_no,previous_version_id,status,baseline,optimized,reasons,execution,process,review,photo_ids,source,author,created_at,archive_url';
function storeFilter(stores: string[]): string { return 'store=in.' + enc('(' + stores.map(value => JSON.stringify(value)).join(',') + ')'); }
function isVisibleAsset(asset: Row, actor: Row): boolean {
  return Number(asset.customer_profile_id) === actor.context.customer_profile_id && actor.stores.includes(asset.store) &&
    (!actor.grant || sameVisit(asset, actor.context)) && asset.bucket === BUCKET &&
    typeof asset.path === 'string' && asset.path.startsWith(String(actor.context.customer_profile_id) + '/') && !asset.path.includes('..') && /^[A-Za-z0-9_./-]+$/.test(asset.path);
}
async function assetsByIds(ids: string[], actor: Row, deps: DesignDependencies): Promise<Row[]> {
  if (!ids.length) return [];
  const result: Row[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const part = ids.slice(offset, offset + 100);
    const rows = await deps.restRows(`customer_design_assets?select=${ASSET_FIELDS}&customer_profile_id=eq.${actor.context.customer_profile_id}&${storeFilter(actor.stores)}&id=in.${enc('(' + part.join(',') + ')')}`);
    result.push(...rows);
  }
  if (new Set(result.map(a => a.id)).size !== ids.length || result.some(a => !isVisibleAsset(a, actor))) fail('照片不属于当前客户或可访问的门店', 403, 'DESIGN_PHOTO_SCOPE_DENIED');
  return ids.map(id => result.find(a => a.id === id)!);
}
async function history(actor: Row, deps: DesignDependencies): Promise<Row> {
  const c = actor.context, versions: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await deps.restRows(`customer_design_versions?select=${VERSION_FIELDS}&customer_profile_id=eq.${c.customer_profile_id}&${storeFilter(actor.stores)}${actor.grant ? '&visit_key=eq.' + enc(c.visit_key) : ''}&order=created_at.desc,id.desc&limit=500&offset=${offset}`);
    if (rows.some(v => Number(v.customer_profile_id) !== c.customer_profile_id || !actor.stores.includes(v.store) || (actor.grant && !sameVisit(v, c)))) fail('档案范围不一致', 403, 'DESIGN_SCOPE_DENIED');
    versions.push(...rows);
    if (rows.length < 500) break;
  }
  const ids = [...new Set<string>(versions.flatMap(v => Array.isArray(v.photo_ids) ? v.photo_ids.map(uuid) : []))];
  const assets = await assetsByIds(ids, actor, deps), byId = new Map(assets.map(a => [a.id, a]));
  const selected = versions.filter(v => sameVisit(v, c)).sort((a, b) => Number(b.version_no) - Number(a.version_no));
  return { ...contextFields(c), can_write: actor.canWrite, latest_version_id: selected[0]?.id || null,
    versions: versions.map(v => ({ ...v, photos: (v.photo_ids || []).map((id: string) => byId.get(id)) })) };
}
async function save(payload: Row, actor: Row, deps: DesignDependencies): Promise<Row> {
  if (!actor.canWrite) fail('仅当前服务门店可新增设计记录', 403, 'DESIGN_WRITE_DENIED');
  const draft = snapshot(payload);
  const photos = await assetsByIds(draft.photo_ids, actor, deps);
  // Historic assets cannot silently become this visit's originals.
  if (photos.some(a => !sameVisit(a, actor.context))) fail('本版照片必须属于本次服务', 403, 'DESIGN_PHOTO_SCOPE_DENIED');
  return await rpc(deps, 'append_customer_design_version', { p_payload: { ...contextFields(actor.context), ...draft }, p_actor: actor.author, p_source: actor.source });
}
function decodePhoto(payload: Row): { bytes: Uint8Array; mime: string; extension: string } {
  const mime = text(payload.mime_type), extensions: Row = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!extensions[mime]) fail('仅支持 JPEG、PNG、WebP 原图');
  const base64 = text(payload.data_base64);
  if (base64.length > Math.ceil(MAX_DESIGN_PHOTO_BYTES / 3) * 4 || !base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail('照片编码无效或超过大小限制');
  let raw: string;
  try { raw = atob(base64); } catch (_) { return fail('照片编码无效'); }
  if (!raw.length || raw.length > MAX_DESIGN_PHOTO_BYTES) fail('照片超过大小限制');
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const actual = bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
    : bytes.length >= 24 && bytes.slice(0, 8).every((v, i) => v === [137,80,78,71,13,10,26,10][i]) && ascii(12, 16) === 'IHDR' ? 'image/png'
    : bytes.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12,16)) ? 'image/webp' : '';
  if (actual !== mime) fail('照片内容与文件类型不一致');
  return { bytes, mime, extension: extensions[mime] };
}
async function upload(payload: Row, actor: Row, deps: DesignDependencies): Promise<Row> {
  if (!actor.canWrite) fail('仅当前服务门店可上传设计照片', 403, 'DESIGN_WRITE_DENIED');
  const { bytes, mime, extension } = decodePhoto(payload), digest = await hash(bytes);
  if (payload.sha256 && text(payload.sha256).toLowerCase() !== digest) fail('照片校验值与原文件不一致');
  if (!['before', 'after', 'reference'].includes(payload.stage) || !['front', 'back', 'left', 'right', 'detail'].includes(payload.angle)) fail('照片类别或角度无效');
  if (text(payload.caption).length > 500 || text(payload.filename).length > 200) fail('照片说明或文件名过长');
  const requestId = payload.request_id ? uuid(payload.request_id) : crypto.randomUUID();
  const meta: Row = { ...contextFields(actor.context), id: requestId, request_id: requestId, stage: payload.stage, angle: payload.angle,
    bucket: BUCKET, path: `${actor.context.customer_profile_id}/${requestId}.${extension}`, mime_type: mime, byte_size: bytes.length,
    sha256: digest, filename: text(payload.filename) || 'original.' + extension, caption: text(payload.caption) };
  const existing = await deps.restRows(`customer_design_assets?select=${ASSET_FIELDS}&request_id=eq.${requestId}&limit=1`);
  if (existing.length) {
    const asset = existing[0];
    if (!sameVisit(asset, actor.context) || asset.source !== actor.source || asset.author !== actor.author || ['stage','angle','mime_type','byte_size','sha256','caption','filename'].some(k => asset[k] !== meta[k])) fail('同一请求编号的照片或说明发生变化', 409, 'DESIGN_REQUEST_CONFLICT');
    return { asset, already_applied: true };
  }
  const objectPath = '/object/' + BUCKET + '/' + meta.path;
  const stored = await deps.storage(objectPath, { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'false' }, body: Uint8Array.from(bytes).buffer });
  if (!stored.ok) {
    // A lost response or concurrent same request can leave an immutable object.
    // Verify bytes before registering it; never upsert or delete a competing write.
    if (![400, 409].includes(stored.status)) fail('原图上传失败，请保留照片后重试', 502, 'DESIGN_STORAGE_ERROR');
    const original = await deps.storage(objectPath);
    if (!original.ok) fail('原图上传失败，请重试', 502, 'DESIGN_STORAGE_ERROR');
    const readback = new Uint8Array(await original.arrayBuffer());
    if (readback.length !== bytes.length || await hash(readback) !== digest) fail('同一请求编号已经用于另一张原图', 409, 'DESIGN_REQUEST_CONFLICT');
  }
  return await rpc(deps, 'register_customer_design_asset', { p_payload: meta, p_actor: actor.author, p_source: actor.source });
}
async function photoURLs(payload: Row, actor: Row, deps: DesignDependencies): Promise<Row> {
  if (!Array.isArray(payload.asset_ids) || payload.asset_ids.length > 600) fail('照片编号列表无效');
  const ids = [...new Set<string>(payload.asset_ids.map(uuid))];
  const assets = await assetsByIds(ids, actor, deps);
  const urls: Row[] = [];
  for (const asset of assets) {
    const response = await deps.storage('/object/sign/' + BUCKET + '/' + asset.path, { method: 'POST', body: JSON.stringify({ expiresIn: 300 }), headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) fail('原图暂时无法读取，请重试', 502, 'DESIGN_STORAGE_ERROR');
    const result = await response.json(), signed = result.signedURL || result.signedUrl;
    if (typeof signed !== 'string') fail('原图访问地址无效', 502, 'DESIGN_STORAGE_ERROR');
    const url = new URL(signed.startsWith('/object/') ? '/storage/v1' + signed : signed, deps.supabaseUrl);
    if (url.origin !== new URL(deps.supabaseUrl).origin || !url.pathname.startsWith('/storage/v1/object/sign/' + BUCKET + '/') || !url.searchParams.has('token')) fail('原图访问地址无效', 502, 'DESIGN_STORAGE_ERROR');
    urls.push({ id: asset.id, url: url.href, expires_in: 300 });
  }
  return { assets: urls };
}
export async function handleCustomerDesign(payload: Row, session: Row | null, deps: DesignDependencies): Promise<Row> {
  if (!isCustomerDesignOperation(payload.operation)) fail('导入授权不可用于其他操作', 403, 'DESIGN_INGEST_DENIED');
  const actor = await actorContext(payload, session, deps);
  switch (payload.operation) {
    case 'customer_design_history': return history(actor, deps);
    case 'customer_design_save': return save(payload, actor, deps);
    case 'customer_design_upload': return upload(payload, actor, deps);
    case 'customer_design_photo_urls': return photoURLs(payload, actor, deps);
    default: return fail('不支持的设计操作');
  }
}
