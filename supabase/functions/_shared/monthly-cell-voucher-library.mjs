// Explicit evidence-only attachment; the existing RPC preserves amounts and old links.
import { expenseComponents } from './expense-voucher-matching.mjs';
const text = value => String(value ?? '').trim();
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(value));
export async function monthlyCellVoucherLibrary(payload, session, deps) {
  if (!deps.canUpload(session)) throw Error('只有财务账号可以补充凭证');
  const store = await deps.store(session, payload), company = text(store.company_id), storeId = text(store.id);
  const reportId = text(payload.report_id), cellId = text(payload.cell_id), month = text(payload.month);
  if (!uuid(reportId) || !uuid(cellId) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw Error('月报或单元格信息无效');
  const scope = `company_id=eq.${company}&store_id=eq.${storeId}`;
  const reports = await deps.rows(`zysyr_report_uploads?select=id&${scope}&id=eq.${reportId}&report_type=eq.monthly_profit_loss&report_date=eq.${month}-01&limit=1`);
  if (!reports.length) throw Error('月报不存在或不属于当前门店和月份');
  const cells = await deps.rows(`zysyr_report_cells?select=id,label,cell_kind,cell_address&${scope}&report_id=eq.${reportId}&id=eq.${cellId}&limit=1`);
  if (!cells.length || deps.category(cells[0]) !== 'expense') throw Error('请选择需要凭证的月报明细金额');
  const revisions = await deps.rows(`zysyr_monthly_cell_revisions?select=id&${scope}&source_cell_id=eq.${cellId}&order=revision.desc&limit=1`);
  const links = revisions[0] ? await deps.all(`zysyr_monthly_cell_revision_vouchers?select=voucher_id&${scope}&revision_id=eq.${revisions[0].id}&limit=200`, 200) : [];
  if (payload.action === 'attach') {
    const voucherId = text(payload.voucher_id), reason = text(payload.reason).slice(0, 500);
    if (!uuid(voucherId) || payload.confirmed !== true || !reason) throw Error('请先核对原图并确认关联');
    const vouchers = await deps.rows(`zysyr_voucher_attachments?select=id&${scope}&id=eq.${voucherId}&limit=1`);
    if (!vouchers.length) throw Error('凭证不存在或不属于当前门店');
    const alreadyLinked = links.some(link => link.voucher_id === voucherId);
    if (!alreadyLinked) await deps.save('rpc/zysyr_attach_monthly_cell_voucher', {
      p_actor_user_id: session.auth_account_id, p_company_id: company, p_store_id: storeId,
      p_source_cell_id: cellId, p_voucher_id: voucherId, p_reason: reason,
    });
    return { cell_linked: true, already_linked: alreadyLinked, amount_changed: false, posted: false };
  }
  if (payload.action !== 'list') throw Error('凭证库操作无效');
  // Upload month is not accounting month: July originals can be uploaded in November.
  const vouchers = await deps.all(`zysyr_voucher_attachments?select=id,original_filename,mime_type,uploaded_at&${scope}&order=uploaded_at.desc,id.asc&limit=2001`, 2001);
  const visible = vouchers.slice(0, 2000), tasks = [], reviews = [];
  // Bound URL length even when the store has thousands of originals.
  for (let offset = 0; offset < visible.length; offset += 100) {
    const ids = '(' + visible.slice(offset, offset + 100).map(v => v.id).join(',') + ')';
    const [t, r] = await Promise.all([
      deps.all(`zysyr_voucher_ocr_tasks?select=voucher_id,candidate_fields,attempt&${scope}&voucher_id=in.${ids}&review_only=eq.false&order=attempt.desc&limit=10000`, 10000),
      deps.all(`zysyr_voucher_reviews?select=voucher_id,corrected_fields,review_version&${scope}&voucher_id=in.${ids}&order=review_version.desc&limit=10000`, 10000),
    ]);
    tasks.push(...t); reviews.push(...r);
  }
  const latest = rows => { const map = new Map(); for (const row of rows) if (!map.has(row.voucher_id)) map.set(row.voucher_id, row); return map; };
  const taskMap = latest(tasks), reviewMap = latest(reviews), linked = new Set(links.map(link => link.voucher_id));
  return { items: visible.map(v => {
    const candidate = taskMap.get(v.id)?.candidate_fields || {}, corrected = reviewMap.get(v.id)?.corrected_fields || {};
    return { ...v, source_voucher_id: v.id, candidate_fields: { ...candidate, ...corrected },
      recognized_amounts: Object.hasOwn(corrected, 'amount') ? [corrected.amount] : expenseComponents(candidate).map(component => component.amount),
      already_linked: linked.has(v.id) };
  }), truncated: vouchers.length > visible.length };
}
