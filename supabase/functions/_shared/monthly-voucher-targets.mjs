// Read-only electronic-monthly evidence targets. Never creates a source selection,
// changes a financial value, approves evidence, or writes a ledger.
const text = value => String(value ?? '').trim();
const compact = value => text(value).replace(/\s/g, '').replace(/[／·]/g, '/');
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const monthPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
const summary = value => /^(小计|合计|总计|盈亏)(?:\/|$)/.test(compact(value));
const income = value => /^(主营|收入|美发收入|营业收入|产品收入|其他收入|总收入)/.test(compact(value));
function amount(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d{1,4})?$/.test(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER / 10000 ? n : null;
}
function address(value) {
  const m = /^([A-Z]{1,2})([1-9]\d{0,2})$/.exec(text(value));
  if (!m) throw Error('invalid cell');
  const column = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), row = Number(m[2]);
  if (column > 30 || row > 120) throw Error('cell bounds');
  return { row, column };
}
function leftSection(display) {
  const values = display?.values;
  if (!Array.isArray(values) || !values.length || values.length > 120
      || values.some(row => !Array.isArray(row) || row.length > 30)) return null;
  const headers = values.flatMap((row, index) => ['支出', '开支'].includes(compact(row[0]))
    && ['支出类别', '开支类别'].includes(compact(row[1])) ? [index] : []);
  if (headers.length !== 1) return null;
  const start = headers[0];
  let end = -1;
  for (let i = start + 1; i < values.length; i++) {
    const a = compact(values[i][0]), b = compact(values[i][1]);
    if (['合计', '总计', '支出合计', '开支合计'].includes(b)) { end = i; break; }
    if (income(a) || /^盈亏|^利润/.test(a)) break;
  }
  if (end < 0) return null;
  return { values, start, end };
}
function originalKnown(cell) {
  const n = amount(cell.numeric_value);
  // Blank slots are stored with numeric zero but remain unknown until edited.
  return n !== null && !(cell.cell_kind === 'input' && text(cell.display_value) === '' && n === 0);
}
function blankResult(status, message) {
  return { status, message, id: null, sha256: null, version: null, cells: [], targets: [], evidence: [], layout_identified: false };
}

export async function readMonthlyVoucherTargets(store, month, deps) {
  const company = text(store?.company_id), storeId = text(store?.id);
  if (!uuid(company) || !uuid(storeId) || !monthPattern.test(month || '')) throw Error('月报门店或月份无效');
  const scope = `company_id=eq.${company}&store_id=eq.${storeId}`;
  const reportQuery = `zysyr_report_uploads?select=id,company_id,store_id,report_type,report_date,status,sha256,version,display_data&${scope}&report_type=eq.monthly_profit_loss&report_date=eq.${month}-01&order=version.desc&limit=1`;
  try {
    const reports = await deps.rows(reportQuery);
    if (!Array.isArray(reports) || reports.length > 1) throw Error('report result');
    if (!reports.length) return blankResult('missing', '本月尚无电子月报，未生成月报栏目佐证目标');
    const report = reports[0];
    if (!uuid(report.id) || report.company_id !== company || report.store_id !== storeId
        || report.report_type !== 'monthly_profit_loss' || report.report_date !== month + '-01'
        || !/^[a-f0-9]{64}$/.test(report.sha256 || '') || !Number.isSafeInteger(report.version) || report.version < 1) throw Error('report scope');
    if (report.status !== 'active') return blankResult('unavailable', '最新月报不是有效版本，未回退使用旧月报');
    const [rawCells, revisions] = await Promise.all([
      deps.all(`zysyr_report_cells?select=id,company_id,store_id,report_id,sheet_name,cell_address,row_number,column_number,label,cell_kind,display_value,numeric_value,formula,precedent_addresses&${scope}&report_id=eq.${report.id}&limit=5000`, 5000),
      deps.all(`zysyr_monthly_cell_revisions?select=id,source_cell_id,revision,revision_type,after_amount&${scope}&report_id=eq.${report.id}&order=revision.desc&limit=10000`, 10000),
    ]);
    if (!Array.isArray(rawCells) || rawCells.length > 5000 || !Array.isArray(revisions) || revisions.length > 10000) throw Error('read bounds');
    const byId = new Map(), byAddress = new Map();
    for (const cell of rawCells) {
      const pos = address(cell.cell_address);
      if (!uuid(cell.id) || cell.company_id !== company || cell.store_id !== storeId || cell.report_id !== report.id
          || !['input', 'formula'].includes(cell.cell_kind) || pos.row !== cell.row_number || pos.column !== cell.column_number
          || byId.has(cell.id) || byAddress.has(cell.cell_address)) throw Error('cell scope');
      byId.set(cell.id, cell); byAddress.set(cell.cell_address, cell);
    }
    const histories = new Map();
    for (const revision of revisions) {
      if (!uuid(revision.id) || !byId.has(revision.source_cell_id) || !Number.isSafeInteger(revision.revision) || revision.revision < 1
          || !['amount_change', 'evidence_update'].includes(revision.revision_type)) throw Error('revision scope');
      const list = histories.get(revision.source_cell_id) || [];
      if (list.some(prior => prior.revision === revision.revision || prior.id === revision.id)) throw Error('revision duplicate');
      list.push(revision); histories.set(revision.source_cell_id, list);
    }
    const latest = new Map();
    for (const [id, list] of histories) latest.set(id, [...list].sort((a, b) => b.revision - a.revision)[0]);
    let display = report.display_data;
    let effectiveByAddress = null;
    if (deps.project !== undefined) {
      if (typeof deps.project !== 'function') throw Error('projection callback');
      // Delegate formulas, adjustments and editable names to the existing
      // monthly projection. Never introduce a second calculation engine here.
      const effective = await deps.project(structuredClone(report), structuredClone(rawCells), structuredClone(revisions));
      if (!effective || !Array.isArray(effective.values) || !effective.values.length || effective.values.length > 120
          || effective.values.some(row => !Array.isArray(row) || row.length > 30)
          || !Array.isArray(effective.cells) || effective.cells.length > 5000) throw Error('projection shape');
      effectiveByAddress = new Map();
      for (const cell of effective.cells) {
        const pos = address(cell.cell_address), original = byAddress.get(cell.cell_address);
        if (!original || effectiveByAddress.has(cell.cell_address) || !Object.hasOwn(cell, 'numeric_value')
            || typeof cell.label !== 'string' || cell.label.length > 2048
            || pos.row > effective.values.length || pos.column > effective.values[pos.row - 1].length
            || cell.row_number !== original.row_number || cell.column_number !== original.column_number
            || (cell.id != null && cell.id !== original.id)
            || (cell.company_id != null && cell.company_id !== company)
            || (cell.store_id != null && cell.store_id !== storeId)
            || (cell.report_id != null && cell.report_id !== report.id)) throw Error('projection identity');
        effectiveByAddress.set(cell.cell_address, cell);
      }
      if (effectiveByAddress.size !== rawCells.length) throw Error('projection incomplete');
      display = { ...report.display_data, values: effective.values };
    }
    const projected = rawCells.map(cell => {
      const history = histories.get(cell.id) || [], prior = latest.get(cell.id);
      const known = originalKnown(cell) || history.some(r => r.revision_type === 'amount_change');
      const effective = effectiveByAddress?.get(cell.cell_address);
      return { ...cell, ...(effective ? { label: effective.label, numeric_value: effective.numeric_value,
          display_value: effective.display_value ?? cell.display_value } : {}),
        amount: known ? amount(effective ? effective.numeric_value : prior ? prior.after_amount : cell.numeric_value) : null,
        revision: prior?.revision || 0, revision_id: prior?.id || null };
    });
    const projectedByAddress = new Map(projected.map(cell => [cell.cell_address, cell]));
    const links = new Map(), revisionCells = new Map([...latest].map(([cellId, r]) => [r.id, cellId]));
    const ids = [...revisionCells.keys()];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const group = ids.slice(offset, offset + 100);
      const found = await deps.all(`zysyr_monthly_cell_revision_vouchers?select=revision_id,voucher_id&${scope}&revision_id=in.(${group.join(',')})&limit=10000`, 10000);
      if (!Array.isArray(found) || found.length > 10000) throw Error('link bounds');
      for (const link of found) {
        if (!group.includes(link.revision_id) || !uuid(link.voucher_id)) throw Error('link scope');
        const cellId = revisionCells.get(link.revision_id), values = links.get(cellId) || new Set();
        values.add(link.voucher_id); links.set(cellId, values);
      }
    }
    const section = leftSection(display), targets = [], included = new Set();
    const add = (cell, label, left, sourceAddress) => {
      const id = cell?.id || null, value = cell ? cell.amount : amount(section?.values[Number(sourceAddress.slice(1)) - 1]?.[2]);
      const canAttach = Boolean(id && value !== null);
      targets.push({ id: report.id + '~' + (id || 'unregistered-' + sourceAddress), target_kind: 'monthly_cell',
        report_id: report.id, cell_id: id, source_locator: sourceAddress, cell_address: sourceAddress,
        label, summary: label, category: label, item_category: cell ? deps.category(cell) : 'source',
        period_month: month, amount: value, revision: cell?.revision || 0, revision_id: cell?.revision_id || null,
        manual_only: true, aggregate: true, left_section: left, can_attach: canAttach, disabled: !canAttach,
        disabled_reason: canAttach ? null : id ? '金额为空或未知，不能关联凭证' : '栏目金额格尚未登记，不能关联凭证',
        linked_vouchers: id ? [...(links.get(id) || [])] : [],
        electronic_cell: id ? { report_id: report.id, cell_id: id, cell_address: sourceAddress, amount: value, revision: cell.revision } : null });
      if (id) included.add(id);
    };
    if (section) {
      for (let index = section.start + 1; index < section.end; index++) {
        const a = text(section.values[index][0]), b = text(section.values[index][1]);
        const label = b || (!['支出', '开支'].includes(compact(a)) ? a : '');
        if (!label || summary(label) || income(label)) continue;
        const sourceAddress = 'C' + (index + 1), cell = projectedByAddress.get(sourceAddress);
        if (cell && deps.category(cell) === 'income') continue;
        add(cell, label, true, sourceAddress);
      }
    }
    for (const cell of projected) {
      if (included.has(cell.id) || cell.column_number <= 3 || cell.amount === null || deps.category(cell) !== 'expense'
          || !text(cell.label) || summary(cell.label) || income(cell.label)) continue;
      const row = display?.values?.[cell.row_number - 1] || [];
      const nearest = row.slice(3, cell.column_number - 1).filter(v => typeof v === 'string' && text(v)).at(-1);
      if (nearest && summary(nearest)) continue;
      add(cell, text(cell.label), false, cell.cell_address);
    }
    // A concurrent re-upload may not quietly retarget this read to an old sheet.
    const after = await deps.rows(reportQuery);
    if (!Array.isArray(after) || after.length !== 1 || after[0].id !== report.id || after[0].sha256 !== report.sha256
        || after[0].version !== report.version || after[0].status !== 'active' || after[0].company_id !== company
        || after[0].store_id !== storeId || after[0].report_type !== 'monthly_profit_loss'
        || after[0].report_date !== month + '-01') throw Error('report changed');
    return { status: section ? 'ready' : 'partial', id: report.id, sha256: report.sha256, version: report.version,
      period_month: month, cells: projected, targets, layout_identified: Boolean(section),
      evidence: targets.flatMap(target => target.linked_vouchers.map(voucherId => ({ target_id: target.id, voucher_id: voucherId }))),
      message: section ? '电子月报栏目仅供人工关联整张原图佐证，不确认付款、不入账' : '左侧支出区未能明确识别，仅显示可验证的右侧开支明细' };
  } catch {
    return blankResult('unavailable', '电子月报或已有凭证关系暂不可读，请刷新后重试');
  }
}
