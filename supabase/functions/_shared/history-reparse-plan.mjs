import { parseHistoricalWorkbook, historicalCellSnapshot, historicalSourceProvenance } from './zysyr-history-import.mjs';

export const HISTORY_REPARSE_PARSER = 'historical-source-semantics-v2';

export function stableHistoryJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableHistoryJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableHistoryJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function historyEffectiveRows(rows, generation) {
  if (!generation) return rows;
  const decisions = generation.decisions;
  if (!Array.isArray(decisions) || decisions.length !== rows.length) throw Error('HISTORY_REPARSE_GENERATION_INCOMPLETE');
  const byId = new Map();
  for (const decision of decisions) {
    if (byId.has(decision.import_row_id)) throw Error('HISTORY_REPARSE_GENERATION_DUPLICATE');
    byId.set(decision.import_row_id, decision);
  }
  return rows.flatMap(row => {
    const decision = byId.get(row.id);
    if (!decision || decision.source_locator !== row.source_locator || decision.source_row_hash !== row.row_hash) throw Error('HISTORY_REPARSE_GENERATION_SOURCE_CHANGED');
    if (decision.disposition === 'exclude_merged_slave') return [];
    if (decision.disposition !== 'include') throw Error('HISTORY_REPARSE_GENERATION_DISPOSITION_INVALID');
    return [{ ...row, original_mapped_json: row.mapped_json, mapped_json: decision.effective_mapped,
      validation_status: decision.validation_status, validation_issues: decision.validation_issues,
      reparse_generation_id: generation.id, reparse_generation_version: generation.version }];
  });
}

export function historyGenerationLedgerBindings(entries, generation) {
  return entries.map(entry => {
    const decision = Array.isArray(generation?.decisions)
      ? generation.decisions.find(item => item.import_row_id === entry.import_row_id && item.disposition === 'include') : null;
    if (!decision || entry.source_locator !== decision.source_locator
        || stableHistoryJson(entry.posted_payload) !== stableHistoryJson(decision.effective_mapped)) return entry;
    return { ...entry, generation_id: generation.id, generation_version: generation.version };
  });
}

// An allowlisted repair plan, not a general accounting correction API.
export function buildHistoryReparsePlan(workbook, batch, rows) {
  if (!['monthly_profit_loss', 'salary', 'petty_cash'].includes(batch.import_type) || batch.status !== 'needs_review'
      || batch.confirmed_at || Number(batch.imported_row_count || 0) !== 0) throw Error('HISTORY_REPARSE_BATCH_NOT_PRISTINE');
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw Error('HISTORY_REPARSE_ROWS_INVALID');
  const sheets = new Map();
  for (const sheet of workbook.worksheets) {
    const name = String(sheet.name).trim();
    if (sheets.has(name)) throw Error('HISTORY_REPARSE_SHEET_AMBIGUOUS');
    sheets.set(name, sheet);
  }
  const employees = rows.filter(row => row.mapped_json?.employee_id && row.mapped_json?.employee_name).map(row => ({id:row.mapped_json.employee_id,name:row.mapped_json.employee_name}));
  const parsed = parseHistoricalWorkbook(workbook, {
    import_type: batch.import_type, year: Number(String(batch.period_start).slice(0, 4)),
    period_start: String(batch.period_start).slice(0, 7), period_end: String(batch.period_end).slice(0, 7),
    target_store_label: batch.target_store_label, employees, products: [],
  });
  const current = new Map(), candidate = new Map();
  for (const row of rows) {
    if (!row.id || current.has(row.source_locator) || row.corrected_json != null
        || (row.review_status && row.review_status !== 'pending') || row.reviewed_at || row.reviewed_snapshot
        || row.imported_at || row.target_business_id || row.target_business_type
        || (row.import_status && row.import_status !== 'pending')) throw Error('HISTORY_REPARSE_ROW_NOT_PRISTINE');
    current.set(row.source_locator, row);
  }
  for (const row of parsed.rows) {
    if (candidate.has(row.source_locator) || !current.has(row.source_locator)) throw Error('HISTORY_REPARSE_NEW_OR_DUPLICATE_ROW');
    candidate.set(row.source_locator, row);
  }
  const provenance = batch.import_type === 'monthly_profit_loss' ? null : historicalSourceProvenance(workbook, batch, rows);
  if (provenance && provenance.status !== 'verified') throw Error('HISTORY_REPARSE_SOURCE_PROVENANCE_UNAVAILABLE');
  const decisions = [];
  for (const row of [...rows].sort((a, b) => a.source_locator.localeCompare(b.source_locator))) {
    const old = row.mapped_json;
    if (batch.import_type !== 'monthly_profit_loss') {
      const next = candidate.get(row.source_locator);
      if (!next || !old || Object.hasOwn(old, '_source_provenance')) throw Error('HISTORY_REPARSE_UNEXPLAINED_SOURCE');
      const fields = (provenance.fields || []).filter(item => item.import_row_id === row.id);
      if (fields.some(item => ['unavailable', 'source_non_numeric'].includes(item.status))) throw Error('HISTORY_REPARSE_SOURCE_PROVENANCE_UNAVAILABLE');
      const missing = fields.filter(item => ['missing_column', 'blank', 'missing_formula_cache'].includes(item.status));
      const comparable = { ...next.mapped };
      for (const item of missing) {
        if (old[item.field] !== 0 && old[item.field] !== null) throw Error('HISTORY_REPARSE_UNAPPROVED_MISSING_AMOUNT');
        if (old[item.field] === null) comparable[item.field] = null;
      }
      if (stableHistoryJson(old) !== stableHistoryJson(comparable)) throw Error(`HISTORY_REPARSE_UNAPPROVED_CHANGE:${row.source_locator}`);
      const sourceMeta = batch.import_type === 'salary'
        ? { fields: missing.map(({field,status,source_locator}) => ({field,status,source_locator})) }
        : { scope: provenance.scope };
      const effective = { ...old, _source_provenance: sourceMeta };
      for (const item of missing) effective[item.field] = null;
      const issues = [...(row.validation_issues || [])];
      for (const issue of next.issues || []) if (!issues.some(oldIssue => stableHistoryJson(oldIssue) === stableHistoryJson(issue))) issues.push(issue);
      const appendIssue = (code,message,field=null,severity='warning') => { if (!issues.some(item => item.code === code && item.field === field)) issues.push({code,message,field,severity}); };
      for (const item of missing) appendIssue('source_amount_unprovided', '原表未提供金额，保留未知而非零值', item.field,
        ['gross_pay','total_deduction','net_pay'].includes(item.field) ? 'invalid' : 'warning');
      if (batch.import_type === 'petty_cash') appendIssue('dated_details_only', '仅带日期交易明细；不含期初及无日期报销，不代表完整现金账');
      const invalid = row.validation_status === 'invalid' || next.validation_status === 'invalid' || issues.some(item => item.severity === 'invalid');
      decisions.push({ import_row_id:row.id,source_locator:row.source_locator,source_row_hash:row.row_hash,
        original_mapped:old,original_raw:row.raw_json,
        source_snapshot:{import_type:batch.import_type,source_provenance:{status:'verified',...sourceMeta}},
        disposition:'include',effective_mapped:effective,validation_status:invalid?'invalid':issues.length||row.validation_status==='warning'?'warning':'valid',
        validation_issues:issues,reason:batch.import_type==='salary'?'source_missing_preserved':'dated_details_scope' });
      continue;
    }
    if (!old || old.cell_address == null || row.source_locator !== `${String(row.source_sheet).trim()}!${old.cell_address}`) throw Error('HISTORY_REPARSE_SOURCE_IDENTITY_INVALID');
    const sheet = sheets.get(String(row.source_sheet).trim());
    if (!sheet) throw Error('HISTORY_REPARSE_SOURCE_SHEET_MISSING');
    const cell = sheet.getCell(old.cell_address), source = historicalCellSnapshot(cell);
    const next = candidate.get(row.source_locator);
    const base = { import_row_id: row.id, source_locator: row.source_locator, source_row_hash: row.row_hash,
      original_mapped: old, original_raw: row.raw_json,
      source_snapshot: { cell_address: cell.address, cached_value: typeof cell.result === 'number' ? cell.result : null,
        cache_present: cell.result !== undefined, formula: source.formula,
        shared_formula_reference: cell.value?.sharedFormula || null,
        merged_master: source.merged_slave ? cell.master.address : null } };
    if (source.merged_slave) {
      const master = candidate.get(`${String(row.source_sheet).trim()}!${cell.master.address}`);
      if (next || !master) throw Error('HISTORY_REPARSE_MERGED_MASTER_MISSING');
      decisions.push({ ...base, disposition: 'exclude_merged_slave', effective_mapped: old,
        validation_status: row.validation_status, validation_issues: row.validation_issues || [], reason: 'merged_slave' });
      continue;
    }
    if (!next) throw Error('HISTORY_REPARSE_UNEXPLAINED_REMOVAL');
    const changes = [];
    for (const key of new Set([...Object.keys(old), ...Object.keys(next.mapped)])) {
      if (stableHistoryJson(old[key]) === stableHistoryJson(next.mapped[key])) continue;
      if (key === 'amount' && old.amount === null && next.mapped.amount === 0 && cell.result === 0 && source.formula) changes.push('cached_zero');
      else if (key === 'formula' && cell.value?.sharedFormula && old.formula === cell.value.sharedFormula && next.mapped.formula === cell.formula) changes.push('shared_formula');
      else throw Error(`HISTORY_REPARSE_UNAPPROVED_CHANGE:${row.source_locator}:${key}`);
    }
    // Reparse never clears a business warning or upgrades human review.
    const issues = [...(row.validation_issues || [])];
    for (const issue of next.issues || []) if (!issues.some(oldIssue => stableHistoryJson(oldIssue) === stableHistoryJson(issue))) issues.push(issue);
    const validation = row.validation_status === 'invalid' || next.validation_status === 'invalid' ? 'invalid'
      : issues.length || row.validation_status === 'warning' || next.validation_status === 'warning' ? 'warning' : 'valid';
    decisions.push({ ...base, disposition: 'include', effective_mapped: next.mapped,
      validation_status: validation, validation_issues: issues, reason: changes.join('+') || 'unchanged' });
  }
  return { parser_version: HISTORY_REPARSE_PARSER, decisions,
    counts: { original: rows.length, included: decisions.filter(row => row.disposition === 'include').length,
      excluded: decisions.filter(row => row.disposition !== 'include').length,
      changed: decisions.filter(row => row.disposition === 'include' && row.reason !== 'unchanged').length },
    formal_ledger_written: false, financial_acceptance_performed: false };
}
