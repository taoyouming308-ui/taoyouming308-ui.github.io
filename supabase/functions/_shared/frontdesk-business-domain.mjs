// Shared source projection. Employee performance and payments are separate totals.
const knownSum = values => {
  if (values.some(value => value === null || !Number.isSafeInteger(value))) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Number.isSafeInteger(sum) ? sum : null;
};
const isTechnician = role => /技师|技工/.test(String(role || ''));
// MGJ's depcodename is only "美发部" for the observed bills. Count only
// unambiguous project names; ambiguous names remain review items, not dye.
const serviceCategory = name => {
  const value = String(name || '').trim();
  const matches = [/(?:烫)/.test(value), /(?:染)/.test(value), /(?:护理|护发|酸护|发膜)/.test(value)];
  if (matches.filter(Boolean).length !== 1) {
    if (!matches.some(Boolean) && /^(?:洗发|洗头|剪发|吹风|造型)/.test(value)) return 'other';
    return 'review';
  }
  return ['perm', 'dye', 'care'][matches.indexOf(true)];
};
const technicianCounts = lines => {
  const counts = { perm: 0, dye: 0, care: 0, other: 0, review: 0 };
  for (const line of lines) {
    const category = serviceCategory(line.item?.item_name);
    const count = line.source_project_count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      counts.review = null;
      if (category !== 'review') counts[category] = null;
    } else {
      if (counts[category] !== null) counts[category] += count;
    }
  }
  return counts;
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
    employees: [...staff.values()].map(group => {
      const technician = isTechnician(group.source_role);
      return { employee_id: group.employee_id, source_role: group.source_role,
        employee_names: [...group.names].sort(), allocation_count: group.lines.length,
        metric_kind: technician ? 'service_count' : 'performance_amount',
        service_counts: technician ? technicianCounts(group.lines) : null,
        performance_cents: technician ? null : knownSum(group.lines.map(row => row.performance_cents)),
        project_count: technician ? null : (group.lines.every(row => Number.isFinite(row.source_project_count)) ? group.lines.reduce((sum,row)=>sum+row.source_project_count,0) : null),
        lines: technician ? group.lines.map(({performance_cents,cash_performance_cents,card_performance_cents,other_performance_cents,...line}) =>
          ({...line, service_category: serviceCategory(line.item?.item_name)})) : group.lines };
    }).sort((a,b)=>String(a.employee_id).localeCompare(String(b.employee_id))),
    payments: [...payments.values()].map(group => ({ source_field: group.source_field, source_labels: [...group.labels].sort(),
      amount_cents: knownSum(group.values), source_label_changed: group.labels.size > 1 })).sort((a,b)=>a.source_field.localeCompare(b.source_field)),
    report_ready: false,
  };
}
