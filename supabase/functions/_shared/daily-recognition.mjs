export function validateDailyCandidates(parsed, cells, date, store) {
  if (!parsed || !Array.isArray(parsed.cells) || parsed.cells.length > 1000) throw Error('识别结果格式不完整，请重新识别');
  const compact = value => String(value || '').replace(/\s/g, '');
  if (parsed.report_date && parsed.report_date !== date) throw Error('原图日期与当前日报不一致，请核对后再识别');
  if (parsed.store_name && !compact(store).includes(compact(parsed.store_name)) && !compact(parsed.store_name).includes(compact(store))) throw Error('原图门店与当前门店不一致，请核对原图');
  const allowed = new Map(cells.map(cell => [cell.id, cell]));
  const seen = new Set(), output = [];
  for (const row of parsed.cells) {
    if (!allowed.has(row.id) || seen.has(row.id)) throw Error('识别结果包含未知或重复格子，请重新核对');
    seen.add(row.id);
    if (row.value == null || row.value === '') continue;
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0 || row.value > 999999999999.99) throw Error('识别金额无效，请核对原图');
    output.push({id:row.id,value:Math.round(row.value*100)/100,confidence:Math.max(0,Math.min(1,Number(row.confidence)||0))});
  }
  return {cells:output,warnings:(Array.isArray(parsed.warnings)?parsed.warnings:[]).slice(0,30).map(value=>String(value).slice(0,300)),date_unconfirmed:!parsed.report_date,store_unconfirmed:!parsed.store_name};
}
