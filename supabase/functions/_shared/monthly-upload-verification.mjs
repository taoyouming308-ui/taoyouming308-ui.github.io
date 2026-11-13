// Independent XLSX source audit. Never calculates, corrects, approves or posts amounts.
const MAX_XML = 2 * 1024 * 1024;
const text = value => String(value ?? '').trim();
const round = value => Number(Number(value).toFixed(4));
const list = value => Array.isArray(value) ? value : [];
const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => entity[0] === '#'
  ? String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10))
  : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity.toLowerCase()]);
const attrs = tag => Object.fromEntries(Array.from(tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), m => [m[1], decode(m[2] ?? m[3])]));
const tags = (xml, name) => Array.from(xml.matchAll(new RegExp('<(?:\\w+:)?' + name + '\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:\\w+:)?' + name + '>)', 'g')),
  m => ({ attributes: attrs(m[1]), content: m[2] || '' }));
const strings = xml => tags(xml, 't').map(t => decode(t.content)).join('').replace(/_x([\da-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
function coordinates(address) {
  const m = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/.exec(address || '');
  if (!m) throw Error('原件单元格地址无法核对');
  return { row: Number(m[2]), column: Array.from(m[1]).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) };
}
function letters(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; }
function range(ref) { const ends = String(ref).split(':'); return [coordinates(ends[0]), coordinates(ends[1] || ends[0])]; }
async function xmlFile(zip, path) {
  const entry = zip.file(path);
  if (!entry) throw Error('原件 XML 不完整，需人工核对');
  const chunks = []; let size = 0;
  await new Promise((resolve, reject) => {
    const stream = entry.internalStream('uint8array');
    stream.on('data', chunk => { size += chunk.length; if (size > MAX_XML) { stream.pause(); reject(Error('原件 XML 超出核对范围')); } else chunks.push(chunk); });
    stream.on('error', reject); stream.on('end', resolve); stream.resume();
  });
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('原件 XML 类型不支持');
  return xml;
}
// String literals and quoted sheet names must not be translated as references.
export function translateSharedFormula(formula, from, to) {
  if (/\[|\]|(?:^|[^\w])\$?[A-Z]+:\$?[A-Z]+|(?:^|[^\w])\$?\d+:\$?\d+/.test(formula)) throw Error('共享公式含暂未支持的引用');
  const a = coordinates(from), b = coordinates(to);
  return formula.split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/g).map((part, i) => i % 2 ? part : part.replace(
    /(?<![\w.])(?<ac>\$?)(?<col>[A-Z]{1,3})(?<ar>\$?)(?<row>[1-9]\d*)(?![\w.(]|!)/g,
    (all, ac, col, ar, row) => {
      const c = coordinates(col + row), column = c.column + (ac ? 0 : b.column - a.column), r = c.row + (ar ? 0 : b.row - a.row);
      if (column < 1 || column > 16384 || r < 1 || r > 1048576) throw Error('共享公式引用超出范围');
      return ac + letters(column) + ar + r;
    })).join('');
}
function periodIssues(filename, sheet, cells, month) {
  const issues = [], values = [filename, sheet, ...cells.filter(c => c.row <= 2 && typeof c.value === 'string').map(c => c.value)];
  const years = new Set(), months = new Set();
  for (const value of values) {
    for (const m of String(value).matchAll(/(?:^|[^\d])(20\d{2})(?:年|[-_/]|$)/g)) years.add(Number(m[1]));
    for (const m of String(value).matchAll(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*月/g)) months.add(Number(m[1]));
    for (const m of String(value).matchAll(/(?:^|[^\d])20\d{2}[-_/](0?[1-9]|1[0-2])(?:[^\d]|$)/g)) months.add(Number(m[1]));
  }
  if (!years.size || !months.size) issues.push({ code: 'period_unverified', message: '原件年份或月份不明确，请人工核对', severity: 'review' });
  if ([...years].some(y => y !== Number(month.slice(0, 4))) || [...months].some(m => m !== Number(month.slice(5, 7))))
    issues.push({ code: 'period_mismatch', message: '原件标示的年月与保存月份不一致', expected: values.slice(0, 2).join(' / '), actual: month, severity: 'error' });
  return issues;
}
export async function captureMonthlySource(bytes, metadata, deps) {
  const base = { schema_version: 1, filename: metadata.filename, sha256: metadata.sha256, sheet_name: metadata.sheet_name,
    month: String(metadata.report_date).slice(0, 7), captured_at: new Date().toISOString() };
  if (!/\.xlsx$/i.test(metadata.filename)) return { ...base, available: false, reason: '当前仅能完整核对 XLSX；Word、照片和 PDF 需人工核对原件' };
  try {
    const zip = await deps.loadZip(bytes), workbook = await xmlFile(zip, 'xl/workbook.xml');
    const sheets = tags(workbook, 'sheet').filter(s => text(s.attributes.name) === metadata.sheet_name);
    if (sheets.length !== 1) throw Error('无法唯一定位原件工作表');
    const rels = tags(await xmlFile(zip, 'xl/_rels/workbook.xml.rels'), 'Relationship');
    const rel = rels.find(r => r.attributes.Id === sheets[0].attributes['r:id'])?.attributes;
    const path = rel?.Target?.startsWith('/') ? rel.Target.slice(1) : 'xl/' + rel?.Target;
    if (!rel || rel.TargetMode || !/^xl\/worksheets\/[^/]+\.xml$/.test(path) || path.includes('..')) throw Error('原件工作表路径不支持');
    const xml = await xmlFile(zip, path);
    const shared = zip.file('xl/sharedStrings.xml') ? tags(await xmlFile(zip, 'xl/sharedStrings.xml'), 'si').map(s => strings(s.content)) : [];
    const styles = zip.file('xl/styles.xml') ? await xmlFile(zip, 'xl/styles.xml') : '';
    const formats = new Map(tags(styles, 'numFmt').map(t => [Number(t.attributes.numFmtId), t.attributes.formatCode]));
    const xfs = tags(tags(styles, 'cellXfs')[0]?.content || '', 'xf').map(t => Number(t.attributes.numFmtId || 0));
    const date1904 = ['1', 'true'].includes(tags(workbook, 'workbookPr')[0]?.attributes.date1904);
    const cells = [], issues = [], masters = new Map(), seen = new Set();
    for (const item of tags(xml, 'c')) {
      const at = item.attributes, address = at.r, pos = coordinates(address);
      if (seen.has(address)) throw Error('原件含重复单元格'); seen.add(address);
      if (pos.row > 120 || pos.column > 30) throw Error('原件超出 120 行、30 列核对范围');
      const f = tags(item.content, 'f')[0], v = tags(item.content, 'v')[0];
      let value = null, numeric = null, isDate = false;
      if (at.t === 'inlineStr') value = strings(item.content);
      else if (v && v.content !== '') {
        const raw = decode(v.content);
        if (!at.t || at.t === 'n') {
          if (!Number.isFinite(Number(raw))) throw Error('原件数值无效');
          numeric = Number(raw); value = numeric;
          const formatId = xfs[Number(at.s || 0)] || 0, format = formats.get(formatId) || '';
          isDate = (formatId >= 14 && formatId <= 22) || (formatId >= 45 && formatId <= 47) || /[ymdhis]/i.test(format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ''));
          if (isDate) { value = new Date(Math.round((numeric - 25569 + (date1904 ? 1462 : 0)) * 86400000)).toISOString().slice(0, 10); numeric = null; }
        } else if (at.t === 's') { value = shared[Number(raw)]; if (value === undefined) throw Error('原件共享文本缺失'); }
        else if (at.t === 'b') value = raw === '1';
        else if (at.t === 'str' || at.t === 'e') value = raw;
        else throw Error('原件单元格类型暂不支持');
      }
      const cell = { address, ...pos, value, numeric: numeric === null ? null : round(numeric), is_date: isDate, formula: f ? decode(f.content) : null };
      if (f?.attributes.t === 'shared') {
        cell.shared_index = f.attributes.si;
        if (cell.formula) { if (masters.has(cell.shared_index)) throw Error('共享公式主格不唯一'); masters.set(cell.shared_index, cell); }
      }
      if (f && (!v || v.content === '')) issues.push({ code: 'missing_formula_cache', address, message: '原件公式没有缓存结果，不能视为零', severity: 'review' });
      if (at.t === 'e') issues.push({ code: 'source_formula_error', address, message: '原件自身含公式错误', expected: value, severity: 'review' });
      if (f && !['', 'normal', 'shared'].includes(f.attributes.t || '')) issues.push({ code: 'formula_type', address, message: '特殊公式需人工核对', severity: 'review' });
      if (text(value).length > 500) issues.push({ code: 'long_text', address, message: '原件文本超过展示长度，需查看原件', severity: 'review' });
      cells.push(cell);
    }
    for (const cell of cells) if (cell.shared_index !== undefined && !cell.formula) {
      const master = masters.get(cell.shared_index);
      if (!master) throw Error('共享公式缺少主格');
      cell.formula = translateSharedFormula(master.formula, master.address, cell.address);
    }
    const merges = tags(xml, 'mergeCell').map(t => {
      const [a, b] = range(t.attributes.ref);
      if (a.row > b.row || a.column > b.column || b.row > 120 || b.column > 30) throw Error('合并范围无法核对');
      return { start_row: a.row - 1, start_col: a.column - 1, end_row: b.row - 1, end_col: b.column - 1 };
    });
    const aliases = new Set();
    for (const m of merges) for (let r = m.start_row; r <= m.end_row; r++) for (let c = m.start_col; c <= m.end_col; c++)
      if (r !== m.start_row || c !== m.start_col) aliases.add(letters(c + 1) + (r + 1));
    const originals = cells.filter(c => !aliases.has(c.address));
    if (!originals.some(c => c.numeric !== null || c.formula)) throw Error('原件没有可核对的数值');
    issues.push(...periodIssues(base.filename, base.sheet_name, originals, base.month));
    return { ...base, available: true, cells: originals, merges, aliases: [...aliases], issues };
  } catch (error) { return { ...base, available: false, reason: text(error.message).slice(0, 160) || '原件读取未完成，请人工核对' }; }
}
export function unavailableMonthlyVerification(reason = '原件核对未完成，请刷新核验，不要重复上传') {
  return { status: 'needs_review', checked_cells: 0, checked_formulas: 0, issue_count: 1,
    issues: [{ code: 'verification_unavailable', message: reason, severity: 'review' }], formal_ledger_changed: false, scope: 'original_upload' };
}
// Called both after registration and on overview, before any user amount revisions.
export function verifyMonthlyUpload(snapshot, report, savedCells) {
  if (!snapshot || snapshot.schema_version !== 1 || !snapshot.available)
    return unavailableMonthlyVerification(snapshot?.reason || '此版本没有自动核对记录，请人工核对原件');
  const display = report?.display_data || {}, values = list(display.values), issues = [...list(snapshot.issues)];
  const add = (code, address, message, expected, actual) => issues.push({ code, address, message, expected, actual, severity: 'error' });
  if (snapshot.month !== String(report.report_date).slice(0, 7)) add('month', '', '保存月份与原件核对记录不一致', snapshot.month, report.report_date);
  if (snapshot.sheet_name !== display.sheet_name) add('sheet', '', '工作表名称不一致', snapshot.sheet_name, display.sheet_name);
  if (report.sha256 !== snapshot.sha256) add('hash', '', '原件文件校验值不一致', snapshot.sha256, report.sha256);
  const merger = m => [m.start_row, m.start_col, m.end_row, m.end_col].join(':');
  if (list(snapshot.merges).map(merger).sort().join('|') !== list(display.merges).map(merger).sort().join('|')) add('merges', '', '合并单元格范围不一致', '原件合并范围', '保存的合并范围');
  const saved = new Map(), sources = new Map(list(snapshot.cells).map(c => [c.address, c]));
  for (const cell of list(savedCells)) {
    if (saved.has(cell.cell_address)) add('duplicate', cell.cell_address, '单元格重复保存', '1 个', '多个');
    saved.set(cell.cell_address, cell);
  }
  let checked = 0, formulas = 0;
  for (const source of sources.values()) {
    const actualText = text(values[source.row - 1]?.[source.column - 1]), expectedText = text(source.value).slice(0, 500);
    // No-cache formulas have already been marked for review, not converted to zero.
    if (source.value !== null && actualText !== expectedText) add('display', source.address, '显示值与原件不同', expectedText, actualText);
    if (source.value === null && !source.formula && actualText) add('extra_display', source.address, '原件空白位置出现内容', '', actualText);
    const cell = saved.get(source.address);
    if (source.numeric === null && !source.formula) continue;
    checked++; if (source.formula) formulas++;
    // Only explicit ID/date columns can be omitted from the financial cell set;
    // their original display value was still compared above.
    const identifier = !source.formula && sources.size && Array.from(sources.values()).some(c => c.column === source.column && c.row < source.row && source.row - c.row <= 15 && /^(编号|序号|员工号|日期)$/.test(text(c.value)));
    if (!cell && identifier) continue;
    if (!cell) { add('missing_cell', source.address, '原件数值未保存', source.numeric, null); continue; }
    const actualNumber = cell.numeric_value == null ? null : Number(cell.numeric_value);
    if (source.numeric !== actualNumber) add('amount', source.address, '金额与原件不同', source.numeric, actualNumber);
    if ((source.formula || null) !== (cell.formula || null)) add('formula', source.address, '公式与原件不同', source.formula, cell.formula || null);
    if (cell.sheet_name !== snapshot.sheet_name) add('cell_sheet', source.address, '单元格所属工作表不一致', snapshot.sheet_name, cell.sheet_name);
    if (cell.row_number !== source.row || cell.column_number !== source.column) add('position', source.address, '金额保存位置不一致', source.address, `${cell.row_number}:${cell.column_number}`);
    if (cell.cell_kind !== (source.formula ? 'formula' : 'input')) add('kind', source.address, '单元格类型不一致', source.formula ? '公式' : '输入', cell.cell_kind);
    if (source.value !== null && text(cell.display_value) !== expectedText) add('cell_display', source.address, '保存的单元格显示值与原件不同', expectedText, cell.display_value);
  }
  const aliases = new Set(list(snapshot.aliases));
  values.forEach((row, r) => list(row).forEach((value, c) => {
    const address = letters(c + 1) + (r + 1);
    if (text(value) && !sources.has(address) && !aliases.has(address)) add('extra_display', address, '原件空白位置出现内容', '', text(value));
  }));
  for (const [address, cell] of saved) {
    const source = sources.get(address);
    if (aliases.has(address)) add('merged_alias', address, '合并单元格被重复保存为金额', '仅保存主格', cell.numeric_value);
    else if ((!source || (source.numeric === null && !source.formula)) && (cell.formula || Number(cell.numeric_value || 0) !== 0))
      add('extra_amount', address, '原件中没有这笔金额或公式', null, cell.numeric_value);
  }
  return { status: issues.some(i => i.severity === 'error') ? 'mismatch' : issues.length ? 'needs_review' : 'matched',
    checked_cells: checked, checked_formulas: formulas, issue_count: issues.length, issues: issues.slice(0, 40),
    source_sha256: snapshot.sha256, captured_at: snapshot.captured_at, scope: 'original_upload', formal_ledger_changed: false };
}

export async function verifySavedMonthlyUpload(saved, scope, snapshot, deps) {
  try {
    if (![saved?.id, scope.company_id, scope.store_id].every(v => /^[0-9a-f-]{36}$/i.test(v || ''))) throw Error('invalid scope');
    const filter = `company_id=eq.${scope.company_id}&store_id=eq.${scope.store_id}`;
    const [reports, cells] = await Promise.all([
      deps.rows(`zysyr_report_uploads?select=id,report_date,sha256,display_data&${filter}&id=eq.${saved.id}&limit=1`),
      deps.rowsAll(`zysyr_report_cells?select=sheet_name,cell_address,row_number,column_number,cell_kind,display_value,numeric_value,formula&${filter}&report_id=eq.${saved.id}&order=row_number.asc,column_number.asc`, 5000),
    ]);
    if (reports.length !== 1 || reports[0].id !== saved.id || !cells.length) throw Error('readback incomplete');
    return verifyMonthlyUpload(snapshot, reports[0], cells);
  } catch { return unavailableMonthlyVerification('草稿已保存，但保存后核对暂未完成；请刷新核验，不要重复上传'); }
}
