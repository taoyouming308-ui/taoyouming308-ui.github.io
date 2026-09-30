// Read-only presentation. Never merge employee IDs, move money, or edit a draft.
const XIANG_STORE = '8d057980-ff8f-4b2c-9c7f-4dd23a568f35';
const sourceRow = /^(stylist|technician)_e[0-9]+_[a-f0-9]{8}$/;
const totalRow = /^(stylist|technician)_category_total$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function isSyncedDailySheet(sheet) {
  const d=sheet?.draft;
  return d?.template_code==='zysyr_frontdesk_project_draft'||d?.ocr_provider==='frontdesk-autofill'
    ||Boolean(d?.ocr_raw_result?.autofill)||Boolean(sheet?.cells?.some(c=>c.source_method==='frontdesk_autofill'));
}
function manualConflicts(metadata,cells) {
  if(!Array.isArray(metadata?.manual_conflicts))return [];
  const byId=new Map(cells.map(c=>[c.id,c]));
  return metadata.manual_conflicts.slice(0,1000).flatMap(item=>{
    const c=byId.get(item?.cell_id),v=item?.source_value;
    if(!c?.manual_override||!(v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0))return [];
    const current=c.corrected_numeric==null?null:Number(c.corrected_numeric);
    return current===v?[]:[{cell_id:c.id,name:c.row_label,column:c.column_label,current,source:v}];
  });
}
function cashView(metadata) {
  const cash = metadata?.cash_receipts;
  if (!cash || cash.policy !== 'operating-external-cash-v1' || cash.state !== 'candidate'
    || !uuid.test(cash.operating_snapshot_id) || !uuid.test(cash.all_snapshot_id)
    || !uuid.test(cash.card_sales_snapshot_id) || !/^[a-f0-9]{64}$/.test(cash.card_sales_sha256)
    || !/^[a-f0-9]{64}$/.test(cash.operating_sha256) || !/^[a-f0-9]{64}$/.test(cash.all_sha256)
    || typeof cash.cash_channels_complete !== 'boolean') return null;
  // Only the policy needed for independent UI checks; no private bill data.
  return { policy: cash.policy, state: 'candidate', cash_channels_complete: cash.cash_channels_complete };
}

export function dailyAutofillView(draft, cells, storeId) {
  const { autofill_view: metadata, ...safeDraft } = draft;
  const cash = draft.template_code === 'zysyr_frontdesk_project_draft' ? cashView(metadata) : null;
  const totalPolicy = metadata?.daily_total_policy === 'cash-plus-earned-card-v1'
    ? {daily_total_policy:'cash-plus-earned-card-v1'} : {};
  if (cash) safeDraft.ocr_raw_result = { autofill: { cash_receipts: cash, ...totalPolicy } };
  if (draft.template_code !== 'zysyr_frontdesk_project_draft' || draft.status !== 'draft') {
    return { draft: safeDraft, cells };
  }
  const allowedKey = key => typeof key === 'string' && (sourceRow.test(key) || totalRow.test(key));
  const sourceKeys = [...new Set(cells.filter(cell => cell.source_method === 'frontdesk_autofill'
    && ['stylist', 'technician'].includes(cell.section_code) && allowedKey(cell.row_key)).map(cell => cell.row_key))];
  const supplied = metadata && typeof metadata === 'object' ? metadata.active_staff_row_keys : null;
  const active = Array.isArray(supplied) && supplied.length <= 250 && supplied.every(allowedKey)
    ? [...new Set(supplied)].filter(key => sourceKeys.includes(key)) : sourceKeys;
  // Only this renderer contract is exposed; no raw OCR, bill payload or before-image.
  const conflicts=manualConflicts(metadata,cells);
  safeDraft.ocr_raw_result = { autofill: { active_staff_row_keys: active, ...totalPolicy, ...(cash ? { cash_receipts: cash } : {}),
    ...(conflicts.length?{manual_conflicts:conflicts}:{}) } };
  const displayCells = cells.map(cell => {
    // User-confirmed alias, exact store + source employee namespace only.
    // A manually renamed cell, another store or another employee stays unchanged.
    if (storeId === XIANG_STORE && cell.source_method === 'frontdesk_autofill'
      && /^(stylist|technician)_e21764911_[a-f0-9]{8}$/.test(cell.row_key)
      && cell.row_label === '郭小康') return { ...cell, row_label: '小康' };
    return cell;
  });
  return { draft: safeDraft, cells: displayCells };
}
