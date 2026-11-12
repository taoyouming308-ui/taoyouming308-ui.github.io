// Source-only XLSX registration. No workbook amount parser, financial writes or reserialization.
type Row = Record<string, unknown>;
type ZipEntry = { internalStream(type: string): { on(event: string, callback: (data: Uint8Array) => void): unknown; pause(): void; resume(): void } };
type Zip = { file(path: string): ZipEntry | null };
export type MonthlySourceDeps = {
  selectedStore: (session: Row, payload: Row) => Promise<Row>;
  requireFinance: (session: Row) => void;
  hasCapability: (session: Row, capability: string) => boolean;
  rpc: (args: Row) => Promise<Row>;
  decode: (value: string) => Uint8Array;
  hash: (bytes: Uint8Array) => Promise<string>;
  loadZip: (bytes: Uint8Array) => Promise<unknown>;
  object: (method: 'GET' | 'POST', path: string, bytes?: Uint8Array) => Promise<Response>;
  signedUrl: (path: string) => Promise<string>;
};
export const MONTHLY_SOURCE_OPERATIONS = new Set(['upload', 'resume', 'status', 'list', 'url', 'select', 'selection_status'].map(s => 'monthly_source_archive_' + s));
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 10485760;
const uuid = (v: unknown): string => { if (typeof v !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)) throw Error('原件请求编号无效'); return v; };
function zipDirectory(bytes: Uint8Array): Set<string> {
  if (bytes.length < 22 || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) !== 0x04034b50) throw Error('原件不是有效 XLSX');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) throw Error('不支持分卷或损坏的 XLSX');
  const count = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), offset = v.getUint32(end + 16, true);
  if (!count || count > 3000 || v.getUint16(end + 8, true) !== count || offset + size !== end) throw Error('XLSX ZIP 目录超出限制');
  let pos = offset, total = 0; const names = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > end || v.getUint32(pos, true) !== 0x02014b50) throw Error('XLSX ZIP 目录损坏');
    const flags = v.getUint16(pos + 8, true), method = v.getUint16(pos + 10, true), length = v.getUint16(pos + 28, true);
    const uncompressed = v.getUint32(pos + 24, true), compressed = v.getUint32(pos + 20, true), local = v.getUint32(pos + 42, true);
    const next = pos + 46 + length + v.getUint16(pos + 30, true) + v.getUint16(pos + 32, true);
    if (next > end || local >= offset || compressed === 0xffffffff || uncompressed === 0xffffffff || (flags & 1) || ![0, 8].includes(method)) throw Error('不支持加密或扩展 ZIP');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(pos + 46, pos + 46 + length));
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || names.has(name) || /vbaProject/i.test(name)) throw Error('XLSX 包含不支持或重复的内容');
    total += uncompressed; if (total > 50 * 1024 * 1024) throw Error('XLSX 解压内容超出限制');
    names.add(name); pos = next;
  }
  if (pos !== end) throw Error('XLSX ZIP 目录不一致'); return names;
}
async function xmlEntry(zip: Zip, name: string): Promise<string> {
  const entry = zip.file(name); if (!entry) throw Error('XLSX 缺少 ' + name);
  if (typeof entry.internalStream !== 'function') throw Error('XLSX 读取器不支持有界解压');
  const chunks: Uint8Array[] = []; let length = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = entry.internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => { length += chunk.length; if (length > 2 * 1024 * 1024) { stream.pause(); reject(Error('XLSX 元数据过大')); } else chunks.push(chunk); });
    stream.on('error', reject); stream.on('end', () => resolve()); stream.resume();
  });
  const bytes = new Uint8Array(length); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-f]+);)/i.test(xml)) throw Error('XLSX XML 实体无效'); return xml;
}
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (Object.hasOwn(out, m[1])) throw Error('XLSX XML 重复属性');
    out[m[1]] = (m[2] ?? m[3]).replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e];
    });
  } return out;
}
export async function monthlySourceWorksheetNames(bytes: Uint8Array, loadZip: MonthlySourceDeps['loadZip']): Promise<string[]> {
  const names = zipDirectory(bytes), zip = await loadZip(bytes) as Zip;
  if (!zip || typeof zip.file !== 'function') throw Error('XLSX 读取器无效');
  const [types, workbook, rels, root] = await Promise.all(['[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '_rels/.rels'].map(n => xmlEntry(zip, n)));
  if (!/<(?:\w+:)?workbook\b/.test(workbook) || !/<\/(?:\w+:)?workbook\s*>/.test(workbook)
    || !/<\/(?:\w+:)?Types\s*>/.test(types) || !/<\/(?:\w+:)?Relationships\s*>/.test(root) || !/<\/(?:\w+:)?Relationships\s*>/.test(rels)) throw Error('XLSX XML 结构无效');
  if (/macroEnabled|vbaProject/i.test(types) || !/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml/.test(types)) throw Error('仅支持无宏 XLSX 工作簿');
  const rootRels = Array.from(root.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g), m => attrs(m[0]));
  if (!rootRels.some(r => r.Type?.endsWith('/officeDocument') && r.Target === 'xl/workbook.xml' && !r.TargetMode)) throw Error('XLSX 工作簿关系无效');
  const relationships = new Map<string, string>();
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]); if (!a.Type?.endsWith('/worksheet')) continue;
    if (!a.Id || relationships.has(a.Id) || a.TargetMode || !a.Target || a.Target.includes('..') || a.Target.includes('\\')) throw Error('XLSX 工作表关系无效');
    const target = a.Target.startsWith('/') ? a.Target.slice(1) : 'xl/' + a.Target;
    if (!names.has(target) || !/^xl\/worksheets\/[^/]+\.xml$/.test(target)) throw Error('XLSX 工作表原件缺失');
    relationships.set(a.Id, target);
  }
  const sheets = Array.from(workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g), m => attrs(m[0]));
  const result = sheets.map(s => { if (!s.name || s.name.length > 120 || !relationships.has(s['r:id'])) throw Error('XLSX 工作表名称或关系无效'); return s.name; });
  if (!result.length || result.length > 300 || new Set(result.map(n => n.trim().toLocaleLowerCase())).size !== result.length) throw Error('XLSX 工作表名称为空、重复或归属不明确');
  return result;
}
export async function monthlySourceArchive(operation: string, payload: Row, session: Row, deps: MonthlySourceDeps): Promise<Row> {
  if (!MONTHLY_SOURCE_OPERATIONS.has(operation)) throw Error('月报原件操作无效');
  const action = operation.slice('monthly_source_archive_'.length), read = ['list', 'url', 'selection_status'].includes(action);
  if (read) { if (!deps.hasCapability(session, 'dashboard.store.read')) throw Error('当前账号没有报表读取权限'); } else deps.requireFinance(session);
  const store = await deps.selectedStore(session, payload);
  const rpc = (a: string, id: string | null, metadata: Row = {}) => deps.rpc({ p_actor_user_id: session.auth_account_id, p_company_id: store.company_id, p_store_id: store.id, p_action: a, p_request_id: id, p_metadata: metadata });
  const safe = (state: Row): Row => { const archive = state.archive as Row | undefined; if (!archive) return { ...state, financial_records_unchanged: true }; const { object_path: _path, ...publicArchive } = archive; return { ...state, archive: publicArchive, financial_records_unchanged: true }; };
  const reconcile = async (state: Row): Promise<Row> => {
    if (state.status !== 'pending' || !state.archive) return state;
    const a = state.archive as Row;
    try {
      const response = await deps.object('GET', String(a.object_path)); if (!response.ok) return state;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== a.size_bytes || await deps.hash(bytes) !== a.sha256) return { ...state, integrity_error: true };
      const { request_id: _id, object_path: _path, ...metadata } = a;
      return await rpc('complete', String(a.request_id), metadata);
    } catch { return state; }
  };
  if (action === 'list') {
    if (typeof payload.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.month) || !Number.isSafeInteger(payload.offset ?? 0) || Number(payload.offset ?? 0) < 0) throw Error('请选择有效月份和分页');
    return safe(await rpc('list', null, { month: payload.month, offset: payload.offset ?? 0 }));
  }
  if (action === 'selection_status') return safe(await rpc('selection_status', uuid(payload.selection_request_id)));
  if (action === 'select') {
    // Do not forward arbitrary client fields (amounts, posting, actor, paths).
    return safe(await rpc('select', uuid(payload.selection_request_id), { source_request_id: uuid(payload.source_request_id), expected_source_sha256: payload.expected_source_sha256, bindings: payload.bindings, expected_previous_selection_ids: payload.expected_previous_selection_ids, reason: payload.reason }));
  }
  const requestId = uuid(action === 'url' ? payload.source_request_id : payload.request_id);
  if (action === 'url') {
    const state = await rpc('view', requestId), a = state.archive as Row;
    if (state.status !== 'archived' || !a) throw Error('原件尚未完成或无权查看');
    return { url: await deps.signedUrl(String(a.object_path)), expires_in: 300, filename: a.original_filename };
  }
  if (action === 'status') return safe(await reconcile(await rpc('status', requestId)));
  const filename = payload.filename, mime = payload.mime_type;
  if (typeof filename !== 'string' || filename !== filename.trim() || filename.length > 200 || !/\.xlsx$/i.test(filename) || mime !== MIME || typeof payload.base64 !== 'string' || payload.base64.length > 15000000) throw Error('请选择真实 XLSX 原件');
  const bytes = deps.decode(payload.base64); if (!bytes.length || bytes.length > MAX_BYTES) throw Error('原件须大于0且不超过10MB');
  const metadata = { original_filename: filename, mime_type: MIME, size_bytes: bytes.length, sha256: await deps.hash(bytes), worksheet_names: await monthlySourceWorksheetNames(bytes, deps.loadZip), bucket_id: 'zysyr-reports' };
  const reserved = await rpc('reserve', requestId, metadata);
  if (!reserved.newly_reserved) {
    const state = await reconcile(reserved);
    if (state.status === 'archived' || action !== 'resume') return safe(state);
    // Resume only the exact original reservation, never an unknown/different file.
    const a = state.archive as Row;
    for (const [key, value] of Object.entries(metadata)) if (JSON.stringify(a[key]) !== JSON.stringify(value)) throw Error('恢复必须使用同一原件和元数据');
    try { const found = await deps.object('GET', String(a.object_path)); if (found.status !== 404) return safe(state); } catch { return safe(state); }
  }
  try {
    const a = reserved.archive as Row, response = await deps.object('POST', String(a.object_path), bytes);
    if (response.ok || response.status === 409) return safe(await reconcile(reserved));
  } catch { /* Keep immutable request for status recovery; never delete uncertain bytes. */ }
  return safe({ ...reserved, status: 'pending', newly_reserved: false });
}
