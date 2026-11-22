// Explicit evidence-only attachment; the existing RPC preserves amounts and old links.
import { expenseComponents } from './expense-voucher-matching.mjs';
import { combinationTotal, voucherCents } from '../../../voucher-combination-core.js';
import { readMonthlyVoucherTargets } from './monthly-voucher-targets.mjs';
import { parsePettyCashBatchNote } from './petty-cash-batch.mjs';
const text = value => String(value ?? '').trim();
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(value));
const archiveMonth = voucher => {
  const batch = parsePettyCashBatchNote(voucher.note);
  return batch && uuid(batch.batch_id) ? batch.month : null;
};
const archiveError = () => Error('凭证未归档到当前报表月份，请从本月凭证列表选择；原件和已有凭证关联不变');
export async function monthlyCellVoucherLibrary(payload, session, deps) {
  if (!deps.canUpload(session)) throw Error('只有财务账号可以补充凭证');
  if (!deps.canRead(session)) throw Error('当前账号没有凭证查看权限');
  const store = await deps.store(session, payload), company = text(store.company_id), storeId = text(store.id);
  const reportId = text(payload.report_id), cellId = text(payload.cell_id), month = text(payload.month);
  if (!uuid(reportId) || !uuid(cellId) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw Error('月报或单元格信息无效');
  const workspace = payload.context === 'expense_workspace';
  if (payload.context != null && !workspace) throw Error('凭证库入口无效');
  let workspaceTarget = null;
  if (workspace) {
    if (!['list', 'attach'].includes(payload.action) || Object.hasOwn(payload, 'component_index') || Object.hasOwn(payload, 'items')) {
      throw Error('月报栏目仅支持人工关联整张原图佐证，不支持图内分项或组合');
    }
    const projection = await readMonthlyVoucherTargets(store, month, deps);
    if (!['ready', 'partial'].includes(projection.status) || projection.id !== reportId) throw Error('月报版本已变化或暂不可读，请刷新');
    workspaceTarget = projection.targets.find(target => target.cell_id === cellId && target.report_id === reportId);
    if (!workspaceTarget || !workspaceTarget.can_attach) throw Error(workspaceTarget?.disabled_reason || '请选择当前月报可关联的栏目');
  }
  const scope = `company_id=eq.${company}&store_id=eq.${storeId}`;
  const reports = await deps.rows(`zysyr_report_uploads?select=id&${scope}&id=eq.${reportId}&report_type=eq.monthly_profit_loss&report_date=eq.${month}-01&limit=1`);
  if (!reports.length) throw Error('月报不存在或不属于当前门店和月份');
  const cells = await deps.rows(`zysyr_report_cells?select=id,label,cell_kind,cell_address&${scope}&report_id=eq.${reportId}&id=eq.${cellId}&limit=1`);
  if (!cells.length || (!workspaceTarget && deps.category(cells[0]) !== 'expense')) throw Error('请选择需要凭证的月报明细金额');
  const revisions = workspaceTarget ? [] : await deps.rows(`zysyr_monthly_cell_revisions?select=id&${scope}&source_cell_id=eq.${cellId}&order=revision.desc&limit=1`);
  const links = workspaceTarget ? workspaceTarget.linked_vouchers.map(voucher_id => ({ voucher_id }))
    : revisions[0] ? await deps.all(`zysyr_monthly_cell_revision_vouchers?select=voucher_id&${scope}&revision_id=eq.${revisions[0].id}&limit=200`, 200) : [];
  if (workspace && payload.action === 'list') {
    const voucherId = text(payload.voucher_id);
    if (!uuid(voucherId)) throw Error('请选择需要回读的原图');
    const vouchers = await deps.rows(`zysyr_voucher_attachments?select=id&${scope}&id=eq.${voucherId}&limit=1`);
    if (!vouchers.some(voucher => text(voucher.id) === voucherId)) throw Error('凭证不存在或不属于当前门店');
    return { evidence_only: true, whole_original: true, target: workspaceTarget,
      items: [{ id: voucherId, source_voucher_id: voucherId, already_linked: links.some(link => link.voucher_id === voucherId) }], truncated: false };
  }
  if (payload.action === 'attach_combination') {
    if (payload.confirmed !== true || !Array.isArray(payload.items) || payload.items.length < 2 || payload.items.length > 20) throw Error('请逐张核对并确认组合凭证');
    if (payload.items.some(item => !item || !uuid(item.voucher_id))) throw Error('组合凭证编号无效');
    const selected = payload.items.map(item => ({ id: text(item.voucher_id).toLowerCase(), candidate_fields: { amount: item.amount } }));
    const total = combinationTotal(selected);if(total===null)throw Error('请选择金额明确的独立凭证，不能重复计入同一原图');
    const selectedIds = selected.map(item => item.id);
    const originals = await deps.rows(`zysyr_voucher_attachments?select=id,note&${scope}&id=in.(${selectedIds.join(',')})&limit=20`);
    const archived = new Set(originals.filter(voucher => archiveMonth(voucher) === month).map(voucher => voucher.id));
    if (selectedIds.some(id => !archived.has(id))) throw archiveError();
    // Monthly evidence can include orders, summaries and chat originals; this does not confirm a payment.
    const context = await deps.effective(store, month, reportId);
    const target = context.cells.find(cell => cell.id === cellId);
    if (total === null || !target || total !== voucherCents(target.numeric_value)) throw Error('组合金额合计必须与当前月报金额一致');
    const saved = await deps.save('rpc/zysyr_attach_monthly_voucher_combination', {
      p_actor: session.auth_account_id, p_company: company, p_store: storeId, p_cell: cellId,
      p_expected_amount: total / 100, p_expected_versions: context.versions,
      p_expected_adjustments: context.adjustments.map(row => row.id).sort(),
      p_items: selected.map(item => ({ voucher_id: item.id, amount: Number(item.candidate_fields.amount) })),
      p_reason: '人工逐张核对组合凭证，合计 ' + (total / 100).toFixed(2),
    });
    return { ...saved, combination_saved: true, cell_linked: true, combination_total: total / 100, amount_changed: false, posted: false };
  }
  if (payload.action === 'attach') {
    const voucherId = text(payload.voucher_id).toLowerCase(), reason = text(payload.reason).slice(0, 500);
    if (!uuid(voucherId) || payload.confirmed !== true || !reason) throw Error('请先核对原图并确认关联');
    const vouchers = await deps.rows(`zysyr_voucher_attachments?select=id,note&${scope}&id=eq.${voucherId}&limit=1`);
    const original = vouchers.find(voucher => voucher.id === voucherId);
    if (!original) throw Error('凭证不存在或不属于当前门店');
    const alreadyLinked = links.some(link => link.voucher_id === voucherId);
    if (!alreadyLinked && archiveMonth(original) !== month) throw archiveError();
    if (!alreadyLinked) await deps.save('rpc/zysyr_attach_monthly_cell_voucher', {
      p_actor_user_id: session.auth_account_id, p_company_id: company, p_store_id: storeId,
      p_source_cell_id: cellId, p_voucher_id: voucherId, p_reason: reason,
    });
    return { cell_linked: true, already_linked: alreadyLinked, amount_changed: false, posted: false,
      ...(workspace ? { evidence_only: true, whole_original: true, target_kind: 'monthly_cell', report_id: reportId, cell_id: cellId } : {}) };
  }
  if (payload.action !== 'list') throw Error('凭证库操作无效');
  // Use the server-written batch designation, not the filename, OCR date,
  // upload timestamp or mutable report association. Existing links remain visible in the trace.
  const path = `zysyr_voucher_attachments?select=id,original_filename,mime_type,uploaded_at,note&${scope}&note=like.${encodeURIComponent('petty_cash_batch|'+month+'|*')}&order=uploaded_at.desc,id.asc`;
  const vouchers = [];
  for (let offset = 0; offset <= 2000; offset += 1000) {
    const limit = Math.min(1000, 2001 - offset);
    const page = await deps.rows(`${path}&limit=${limit}&offset=${offset}`);
    if (page.length > limit) throw Error('凭证库返回条数异常，请刷新重试');
    vouchers.push(...page);
    if (page.length < limit) break;
  }
  const visible = vouchers.filter(voucher => archiveMonth(voucher) === month).slice(0, 2000), tasks = [], reviews = [];
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
  return { archive_month: month, items: visible.map(v => {
    const candidate = taskMap.get(v.id)?.candidate_fields || {}, corrected = reviewMap.get(v.id)?.corrected_fields || {};
    return { id:v.id, original_filename:v.original_filename, mime_type:v.mime_type, uploaded_at:v.uploaded_at,
      archive_month:month, source_voucher_id: v.id, candidate_fields: { ...candidate, ...corrected },
      recognized_amounts: Object.hasOwn(corrected, 'amount') ? [corrected.amount] : expenseComponents(candidate).map(component => component.amount),
      already_linked: linked.has(v.id) };
  }), truncated: vouchers.length > 2000 };
}
