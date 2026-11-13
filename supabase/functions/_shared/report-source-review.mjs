// Read-only views of existing originals. No staging, corrections, approval or posting.
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => value == null ? '' : String(value);
function identity(value) { if (!UUID.test(value || '')) throw Error('原件身份信息无效'); return value; }
function savedCell(cell) {
  const raw = cell.value;
  if (raw == null) return { value: null, formula: null };
  if (raw instanceof Date) return { value: raw.toISOString().slice(0, 10), formula: null };
  if (typeof raw !== 'object') return { value: raw, formula: null };
  if ('formula' in raw || 'sharedFormula' in raw) return {
    value: Object.hasOwn(raw, 'result') ? raw.result : null,
    formula: raw.formula || null, shared_formula: raw.sharedFormula || null,
  };
  if (Array.isArray(raw.richText)) return { value: raw.richText.map(part => part.text || '').join(''), formula: null };
  if ('text' in raw) return { value: raw.text, formula: null };
  if ('error' in raw) return { value: raw.error, formula: null, source_error: true };
  throw Error('原工作表含未支持的单元格类型，未生成不完整视图');
}
const xmlText = value => value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, entity) => entity[0] === '#'
  ? String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10))
  : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
const attributes = tag => Object.fromEntries(Array.from(tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), match => [match[1], xmlText(match[2] ?? match[3])]));
async function boundedXml(zip, path) {
  const entry = zip.file(path);
  if (!entry || typeof entry.internalStream !== 'function') throw Error('原工作表 XML 不可读取');
  const chunks = []; let length = 0;
  await new Promise((resolve, reject) => {
    const stream = entry.internalStream('uint8array');
    stream.on('data', chunk => { length += chunk.length; if (length > 2 * 1024 * 1024) { stream.pause(); reject(Error('原工作表 XML 超出范围')); } else chunks.push(chunk); });
    stream.on('error', reject); stream.on('end', resolve); stream.resume();
  });
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('原工作表 XML 类型无效');
  return xml;
}
async function originalFormulaCaches(bytes, worksheet, deps) {
  const zip = await deps.loadZip(bytes);
  const workbookXml = await boundedXml(zip, 'xl/workbook.xml');
  const relationXml = await boundedXml(zip, 'xl/_rels/workbook.xml.rels');
  const sheets = Array.from(workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g), match => attributes(match[0]));
  const selected = sheets.filter(sheet => sheet.name === worksheet);
  if (selected.length !== 1) throw Error('原 XML 工作表身份不唯一');
  const relations = Array.from(relationXml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g), match => attributes(match[0]));
  const relation = relations.find(item => item.Id === selected[0]['r:id']);
  const path = relation?.Target?.startsWith('/') ? relation.Target.slice(1) : 'xl/' + relation?.Target;
  if (!relation || relation.TargetMode || !/^xl\/worksheets\/[^/]+\.xml$/.test(path) || path.includes('..')) throw Error('原 XML 工作表路径无效');
  const sheetXml = await boundedXml(zip, path), result = new Map();
  for (const match of sheetXml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
    const cell = attributes(match[1]), content = match[2] || '';
    const formula = content.match(/<(?:\w+:)?f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?f>)/);
    if (!formula) continue;
    const cache = content.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/), fattrs = attributes(formula[1]);
    let value = null;
    if (cache && cache[1] !== '') {
      const raw = xmlText(cache[1]);
      if (!cell.t || cell.t === 'n') { value = Number(raw); if (!Number.isFinite(value)) throw Error('原公式缓存数值无效'); }
      else if (cell.t === 'b') value = raw === '1';
      else if (cell.t === 'str' || cell.t === 'e') value = raw;
      else throw Error('原公式缓存类型未支持');
    }
    result.set(cell.r, { value, formula: formula[2] ? xmlText(formula[2]) : null,
      ...(fattrs.t === 'shared' ? { shared_formula_index: fattrs.si, shared_formula_range: fattrs.ref || null } : {}),
      ...(cell.t === 'e' ? { source_error: true } : {}) });
  }
  return result;
}
export function sourceWorksheetGrid(sheet, formulaCaches = new Map()) {
  const rowCount = Math.max(sheet.rowCount || 0, sheet.actualRowCount || 0);
  const columnCount = Math.max(sheet.columnCount || 0, sheet.actualColumnCount || 0);
  if (!rowCount || !columnCount || rowCount > 300 || columnCount > 60) throw Error('原工作表为空或超出展示范围');
  const rows = [];
  for (let row = 1; row <= rowCount; row++) {
    const cells = [];
    for (let column = 1; column <= columnCount; column++) {
      const cell = sheet.getCell(row, column);
      // ExcelJS repeats a merged master's value in its other coordinates.
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;
      const saved = formulaCaches.get(cell.address) || savedCell(cell);
      cells.push({ column, address: cell.address, ...saved, number_format: cell.numFmt || null });
    }
    rows.push({ row, cells });
  }
  const at = (row, column) => rows[row - 1].cells.find(cell => cell.column === column)?.value;
  const starts = rows.filter(row => at(row.row, 1) === '支出' && at(row.row, 2) === '支出类别');
  const ends = rows.filter(row => at(row.row, 2) === '合计' && starts.length === 1 && row.row > starts[0].row);
  const expenseRows = starts.length === 1 && ends.length === 1
    ? rows.filter(row => row.row > starts[0].row && row.row < ends[0].row)
      .map(row => ({ row: row.row, cells: row.cells.filter(cell => cell.column <= 3) })) : [];
  return { rows, row_count: rowCount, column_count: columnCount, merges: list(sheet.model?.merges),
    column_widths: Array.from({ length: columnCount }, (_, i) => Math.max(6, Math.min(40, sheet.getColumn(i + 1).width || 10))),
    row_heights: Array.from({ length: rowCount }, (_, i) => Math.max(18, Math.min(96, sheet.getRow(i + 1).height || 24))),
    expense_rows: expenseRows, expense_layout_identified: expenseRows.length > 0,
    values_kind: 'original_saved_values', formulas_recalculated: false };
}
function selectionKey(selection) {
  return JSON.stringify([selection.id, selection.source_request_id, selection.worksheet_name, selection.selection_version]);
}
async function monthlySource(month, session, store, deps) {
  const rpc = (action, requestId = null) => deps.archiveRpc({ p_actor_user_id: identity(session.auth_account_id),
    p_company_id: identity(store.company_id), p_store_id: identity(store.id), p_action: action,
    p_request_id: requestId, p_metadata: action === 'list' ? { month, offset: 0 } : {} });
  const before = await rpc('list');
  if (!before.current_selection) return { monthly_status: 'missing', message: '本月尚未指定核对原件' };
  const selected = record(before.current_selection);
  if (selected.company_id !== store.company_id || selected.store_id !== store.id || selected.period_month !== month + '-01') throw Error('核对原件月份或门店不匹配');
  identity(selected.id); identity(selected.source_request_id);
  if (typeof selected.worksheet_name !== 'string' || !selected.worksheet_name || !Number.isSafeInteger(selected.selection_version) || selected.selection_version < 1) throw Error('核对工作表信息无效');
  const state = await rpc('view', selected.source_request_id), archive = record(state.archive);
  if (state.status !== 'archived' || archive.request_id !== selected.source_request_id || state.request_id !== selected.source_request_id) throw Error('核对原件尚未完成或无权读取');
  if (archive.bucket_id !== 'zysyr-reports' || !/^[a-f0-9]{64}$/.test(archive.sha256 || '') || !Number.isSafeInteger(archive.size_bytes) || archive.size_bytes <= 0 || archive.size_bytes > MAX_BYTES) throw Error('核对原件元数据无效');
  if (typeof archive.object_path !== 'string' || !archive.object_path.startsWith(store.company_id + '/' + store.id + '/') || archive.object_path.includes('..') || archive.object_path.includes('\\')) throw Error('核对原件路径不属于当前门店');
  const bytes = await deps.object(archive.object_path);
  if (!(bytes instanceof Uint8Array) || bytes.length !== archive.size_bytes || await deps.hash(bytes) !== archive.sha256) throw Error('核对原件字节校验未通过');
  const names = await deps.validateWorkbook(bytes);
  if (JSON.stringify(names) !== JSON.stringify(archive.worksheet_names) || !names.includes(selected.worksheet_name)) throw Error('原工作表清单不匹配');
  const workbook = await deps.loadWorkbook(bytes);
  const sheets = list(workbook.worksheets).filter(sheet => sheet.name === selected.worksheet_name);
  if (sheets.length !== 1) throw Error('核对工作表不存在或重复');
  const monthly = sourceWorksheetGrid(sheets[0], await originalFormulaCaches(bytes, selected.worksheet_name, deps));
  const after = await rpc('list');
  if (!after.current_selection || selectionKey(record(after.current_selection)) !== selectionKey(selected)) throw Error('核对原件已变化，请重新读取');
  return { monthly_status: 'ready', source: { source_request_id: selected.source_request_id,
    filename: archive.original_filename, sha256: archive.sha256, worksheet_name: selected.worksheet_name,
    selection_id: selected.id, selection_version: selected.selection_version }, monthly };
}
function sourceDate(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 30000 && value <= 70000) return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).toISOString().slice(0, 10);
  if (typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value) return value;
  return null;
}
function pettyRows(data, batch, month) {
  const output = [], ids = new Set();
  for (const row of list(data.rows)) {
    if (row.import_batch_id !== batch.id) throw Error('开支来源行不属于选中批次');
    const mapped = record(row.mapped_json);
    if (mapped.period_month !== month + '-01') continue;
    const raw = record(row.raw_json), cells = list(raw.cells);
    const rowNumber = row.source_row_number;
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > 500 || typeof row.source_sheet !== 'string') throw Error('开支来源坐标无效');
    const get = column => cells.find(cell => cell.address === column + rowNumber)?.value ?? null;
    if (cells.length > 8 || new Set(cells.map(cell => cell.address)).size !== cells.length) throw Error('开支原单元格重复或超限');
    if (ids.has(row.id)) throw Error('开支来源行重复'); ids.add(row.id);
    const date = sourceDate(get('A'));
    if (date && !date.startsWith(month + '-')) throw Error('开支日期与来源月份不匹配');
    const inflow = number(get('D')), outflow = number(get('E'));
    const both = inflow !== null && outflow !== null && inflow !== 0 && outflow !== 0;
    const direction = both ? 'ambiguous' : outflow !== null && outflow !== 0 ? 'outflow'
      : inflow !== null && inflow !== 0 ? 'inflow' : outflow !== null ? 'outflow' : inflow !== null ? 'inflow' : 'unknown';
    output.push({ id: row.id, import_batch_id: batch.id, date, summary: text(get('C')), category: text(get('F')),
      voucher_number: get('B'), amount: both ? null : direction === 'outflow' ? outflow : inflow, direction, inflow, outflow,
      source_sheet: row.source_sheet, source_locator: row.source_locator, source_row_number: rowNumber,
      review_status: row.review_status, import_status: row.import_status, validation_status: row.validation_status,
      validation_issues: list(row.validation_issues), corrected_value_present: row.corrected_json != null,
      original_cells: cells, values_kind: 'original_saved_values' });
  }
  return output;
}
/** Dependencies expose only existing read routes and private-object GET. */
export async function reportSourceReview(payload, session, deps) {
  deps.requireFinance(session);
  if (!MONTH.test(payload.month || '') || !['monthly', 'expenses'].includes(payload.kind)) throw Error('请选择有效月份和来源页面');
  const store = await deps.selectedStore(session, { store: payload.store });
  identity(store.id); identity(store.company_id);
  const base = { kind: payload.kind, month: payload.month, store_id: store.id, financial_records_unchanged: true };
  const monthly = await monthlySource(payload.month, session, store, deps);
  if (payload.kind === 'monthly') return { ...base, ...monthly, status: monthly.monthly_status };
  const scopedPayload = { store: payload.store };
  const index = await deps.historyRead(scopedPayload, session);
  const batches = list(index.batches);
  if (batches.length > 100) throw Error('历史来源批次超限');
  const candidates = batches.filter(batch => ['petty_cash', 'monthly_profit_loss'].includes(batch.import_type)
    && batch.period_start <= payload.month + '-01' && batch.period_end >= payload.month + '-01');
  const groups = ['petty_cash', 'monthly_profit_loss'].map(kind => candidates.filter(batch => batch.import_type === kind));
  if (groups.some(items => items.length > 1)) return { ...base, status: 'conflict',
    message: '同月存在多个开支来源批次，请先核对来源，未自动选择',
    batches: candidates.map(batch => ({ id: batch.id, filename: batch.source_filename, import_type: batch.import_type })) };
  const expenses = [], evidence = [], selectedBatches = [];
  for (const group of groups) {
    if (!group.length) continue;
    const batch = group[0]; identity(batch.id);
    const data = index.selected_batch_id === batch.id ? index : await deps.historyRead({ ...scopedPayload, import_batch_id: batch.id }, session);
    if (data.selected_batch_id !== batch.id || list(data.rows).length > 5000 || list(data.evidence).length > 1000) throw Error('开支来源批次不匹配或超限');
    selectedBatches.push({ id: batch.id, filename: batch.source_filename, sha256: batch.source_sha256,
      import_type: batch.import_type, status: batch.status, imported_row_count: batch.imported_row_count });
    if (batch.import_type === 'petty_cash') expenses.push(...pettyRows(data, batch, payload.month));
    for (const item of list(data.evidence)) {
      if (item.import_batch_id !== batch.id) throw Error('凭证包不属于选中批次');
      if (item.period_month !== payload.month + '-01') continue;
      evidence.push({ id: item.id, filename: item.original_filename, period_month: item.period_month,
        level: 'month', import_batch_id: batch.id, import_type: batch.import_type, sha256: item.sha256,
        matches_current_monthly_source: batch.import_type === 'monthly_profit_loss' ? batch.source_sha256 === monthly.source?.sha256 : null });
    }
  }
  return { ...base, ...monthly, expenses, evidence, batches: selectedBatches,
    status: monthly.monthly_status === 'ready' || expenses.length || evidence.length ? 'ready' : 'missing',
    petty_cash_status: groups[0].length ? 'ready' : 'missing',
    message: '原件保存值供核对；整月凭证包尚不代表逐笔已匹配或审核。' };
}
