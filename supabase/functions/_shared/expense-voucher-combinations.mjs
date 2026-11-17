import { voucherCents, combinationTotal, sameVoucherTarget, voucherPartKey } from '../../../voucher-combination-core.js';
import { expenseMatchPlan } from './expense-voucher-workspace.mjs';

export function expenseCombinationPlan(workspace, requests) {
  if (!Array.isArray(requests) || requests.length < 2 || requests.length > 20) throw Error('请选择 2 至 20 张独立凭证');
  const first = requests[0], target = workspace.targets.find(t => t.target_kind === first.target_kind && t.id === first.target_id);
  if (!target || /(^|\/)备用金$/.test(String(target.summary || '').replace(/\s/g, ''))) throw Error('请先选择具体开支明细');
  const all = requests.map(request => {
    if (request.target_kind !== target.target_kind || request.target_id !== target.id) throw Error('组合只能对应同一笔开支');
    const item = workspace.items.find(i => voucherPartKey(i) === request.voucher_id + ':' + request.component_index);
    if (!item) throw Error('凭证已变化，请重新读取');
    if(item.candidate_fields?.evidence_kind==='monthly_summary'||['bank_summary','multiple_transactions','monthly_summary'].includes(item.candidate_fields?.document_kind)) throw Error('月度汇总或未拆分流水不能作为组合中的单笔凭证');
    const linked = Boolean(item.confirmed_target_id || item.expense_association);
    if (linked && !sameVoucherTarget(item, target)) throw Error('组合中有凭证已关联其他开支');
    const fields = linked ? item.corrected_fields : request.corrected_fields;
    if (fields?.evidence_kind === 'monthly_summary' || !/^\d{4}-\d{2}-\d{2}$/.test(fields?.document_date || '')
      || fields.document_date.slice(0, 7) !== workspace.month) throw Error('请逐张核对凭证日期，不可用月度汇总凑单笔金额');
    const day = new Date(fields.document_date + 'T00:00:00Z');
    if (!Number.isFinite(+day) || day.toISOString().slice(0, 10) !== fields.document_date) throw Error('凭证日期无效');
    return { item, request, fields, linked };
  });
  const sum = combinationTotal(all.map(row => ({ ...row.item, corrected_fields: row.fields })));
  if (sum === null || sum !== voucherCents(target.amount)) throw Error('组合金额合计必须与当前开支金额一致');
  const fresh = all.filter(row => !row.linked);
  const newPlan = fresh.length ? expenseMatchPlan(workspace, fresh.map(row => row.request), 'manual') : [];
  if (newPlan.length !== all.filter(row => !row.linked).length) throw Error('组合中有凭证状态已变化，未保存');
  const plan = all.map(row => row.linked ? { voucher_id: row.request.voucher_id, component_index: row.request.component_index,
    task_id: row.item.expense_association.source_task_id || row.request.task_id, target_kind: target.target_kind, target_id: target.id,
    target_snapshot: target, corrected_fields: row.fields, reason: '人工核对组合凭证，合计 ' + (sum / 100).toFixed(2) }
    : newPlan.find(p => p.voucher_id === row.request.voucher_id && p.component_index === row.request.component_index));
  return { plan, total: sum / 100 };
}
