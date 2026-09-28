// Read-only presentation. Never merge employee IDs, move money, or edit a draft.
const XIANG_STORE = '8d057980-ff8f-4b2c-9c7f-4dd23a568f35';
const sourceRow = /^(stylist|technician)_e[0-9]+_[a-f0-9]{8}$/;
const totalRow = /^(stylist|technician)_category_total$/;

export function dailyAutofillView(draft, cells, storeId) {
  const { autofill_view: metadata, ...safeDraft } = draft;
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
  safeDraft.ocr_raw_result = { autofill: { active_staff_row_keys: active } };
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
