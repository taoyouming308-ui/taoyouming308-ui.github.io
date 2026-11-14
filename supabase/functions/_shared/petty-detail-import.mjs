// Pure parsing/validation; never fills dates or amounts from the selected month.
export const detailFields = ['transaction_date','amount','summary','category','recipient','voucher_number'];
export function parseDetailCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (quoted || !cell) quoted = !quoted; else throw new Error('CSV 引号格式无效'); }
    else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== ',') { if (c === '\r' && text[i + 1] === '\n') i++; rows.push(row); row = []; }
    } else cell += c;
    if (rows.length > 5001 || row.length > 60 || cell.length > 2000) throw new Error('文件超过 5000 行、60 列或单元格长度限制');
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function detailDate(value) {
  if (value instanceof Date && Number.isFinite(+value)) return value.toISOString().slice(0,10);
  let text = String(value ?? '').trim();
  // Explicit XLSX ISO dates are not Excel serials. Accept midnight UTC only;
  // other timestamps need a human date decision rather than a timezone guess.
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0{1,3})?Z$/.test(text)) text = text.slice(0,10);
  const m = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) return '';
  const iso = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0,10) === iso ? iso : '';
}
export function detailKey(row) {
  return JSON.stringify([row.transaction_date, Number(row.amount).toFixed(2), String(row.summary || '').trim().replace(/\s+/g,' ').toLowerCase()]);
}
export function previewDetailRows(matrix, mapping, month, headerRow = 0, existing = []) {
  if (!Array.isArray(matrix) || matrix.length > 5001 || matrix.some(r => r.length > 60)) throw new Error('文件最多 5000 行、60 列');
  if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow >= matrix.length) throw new Error('请选择表头行');
  const columns = detailFields.map(f => mapping[f]).filter(v => v !== undefined && v !== null && v !== -1);
  if (columns.some(v => !Number.isInteger(v) || v < 0 || v >= 60) || new Set(columns).size !== columns.length) throw new Error('列映射重复或无效');
  if (['transaction_date','amount','summary'].some(f => !Number.isInteger(mapping[f]) || mapping[f] < 0)) throw new Error('请映射日期、支出金额和摘要列');
  const seen = new Set(existing.map(detailKey));
  return matrix.slice(headerRow + 1).map((raw, i) => {
    if (!raw.some(v => String(v ?? '').trim())) return null;
    const read = f => String(raw[mapping[f]] ?? '').trim();
    const row = { source_row: headerRow + i + 2, transaction_date: detailDate(raw[mapping.transaction_date]),
      amount: null, summary: read('summary').slice(0,300), category: read('category').slice(0,120),
      recipient: read('recipient').slice(0,120), voucher_number: read('voucher_number').slice(0,120), raw };
    const amount = read('amount').replace(/[,，￥¥\s]/g,'');
    const errors = [];
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 999999999) errors.push('支出金额缺失或无效');
    else row.amount = Number(amount);
    if (!row.transaction_date) errors.push('缺少完整有效日期');
    else if (!row.transaction_date.startsWith(month + '-')) errors.push('日期不属于当前月份');
    if (!row.summary) errors.push('缺少摘要');
    if (/合计|总计|小计|汇总|结余|余额|期初|期末/.test(row.summary)) errors.push('汇总或余额行不能导入为单笔支出');
    const duplicate = !errors.length && seen.has(detailKey(row));
    if (!errors.length) seen.add(detailKey(row));
    return { ...row, errors, duplicate, valid: !errors.length && !duplicate };
  }).filter(Boolean);
}
