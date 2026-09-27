// Shared source projection. Employee performance and payments are separate totals.
const knownSum = values => {
  if (values.some(value => value === null || !Number.isSafeInteger(value))) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Number.isSafeInteger(sum) ? sum : null;
};
export function projectBusinessDay(source) {
  if (!source.available) return { ...source, employees: [], payments: [], posted_amount_cents: null };
  if (!Array.isArray(source.bills) || source.bills.length !== source.source_count) throw new Error('business_details_incomplete');
  const staff = new Map(), payments = new Map(), billIds = new Set();
  for (const bill of source.bills) {
    if (billIds.has(bill.source_bill_id) || bill.business_date !== source.date) throw new Error('business_bill_scope_mismatch');
    billIds.add(bill.source_bill_id);
    const items = new Map(bill.items.map(item => [item.source_item_id, item]));
    for (const row of bill.employee_allocations) {
      const key = JSON.stringify([row.employee_id, row.source_role]);
      const group = staff.get(key) || { employee_id: row.employee_id, source_role: row.source_role, names: new Set(), lines: [] };
      if (row.employee_name) group.names.add(row.employee_name);
      group.lines.push({ source_bill_id: bill.source_bill_id, ...row, item: items.get(row.source_item_id) || null });
      staff.set(key, group);
    }
    for (const row of bill.payments) {
      const group = payments.get(row.source_field) || { source_field: row.source_field, labels: new Set(), values: [] };
      if (row.source_label) group.labels.add(row.source_label);
      group.values.push(row.amount_cents); payments.set(row.source_field, group);
    }
  }
  return { ...source, posted_amount_cents: source.source_list_changed ? null : knownSum(source.bills.map(bill => bill.source_posted_amount_cents)),
    employees: [...staff.values()].map(group => ({ employee_id: group.employee_id, source_role: group.source_role,
      employee_names: [...group.names].sort(), allocation_count: group.lines.length,
      performance_cents: knownSum(group.lines.map(row => row.performance_cents)),
      project_count: group.lines.every(row => Number.isFinite(row.source_project_count)) ? group.lines.reduce((sum,row)=>sum+row.source_project_count,0) : null,
      lines: group.lines })).sort((a,b)=>String(a.employee_id).localeCompare(String(b.employee_id))),
    payments: [...payments.values()].map(group => ({ source_field: group.source_field, source_labels: [...group.labels].sort(),
      amount_cents: knownSum(group.values), source_label_changed: group.labels.size > 1 })).sort((a,b)=>a.source_field.localeCompare(b.source_field)),
    report_ready: false,
  };
}
