// Read-only presentation. Never add identifiers or combine differently named items.
export function monthlySummaryMonths(start, end) {
  const valid = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value));
  if (!valid(start) || !valid(end) || start > end) throw Error('请选择正确的起止月份');
  const number = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
  const first = number(start), last = number(end);
  if (last - first >= 12) throw Error('一次最多汇总 12 个月，请缩短月份范围');
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const n = first + i;
    return String(Math.floor(n / 12)).padStart(4, '0') + '-' + String(n % 12 + 1).padStart(2, '0');
  });
}

function summaryLabel(value) {
  // Original templates sometimes retain an old English month header (e.g. Nov.).
  return String(value || '').split(/\s*[／/]\s*/).map(part => part.trim()).filter(part => part
    && !/^(?:\d{4}年)?(?:[1-9]|1[0-2])月$/.test(part)
    && !/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?$/i.test(part)).join(' / ');
}

export function buildMonthlySummary(requestedMonths, reports) {
  const lines = new Map(), available = new Set();
  for (const report of reports) {
    if (!requestedMonths.includes(report.month) || available.has(report.month)) throw Error('月报来源重复或超出所选范围');
    available.add(report.month);
    const addresses = new Set();
    for (const cell of report.cells || []) {
      const address = String(cell.cell_address || '').toUpperCase();
      if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
      if (addresses.has(address)) throw Error(report.month + ' 月报存在重复单元格，请先核对原表');
      addresses.add(address);
      const label = summaryLabel(cell.label);
      if (cell.editable_blank === true || cell.item_category === 'fixed' || /编号|序号|员工号/.test(label)
        || ['date', 'text'].includes(cell.cell_kind)) continue;
      const raw = cell.numeric_value;
      if (raw === null || raw === undefined || raw === '') continue;
      const amount = Number(raw);
      if (!Number.isFinite(amount)) throw Error(report.month + ' 月报 ' + address + ' 金额无效');
      // Address plus label avoids adding one employee's pay to a replacement's pay.
      // Unnamed cells stay month-specific: their business meaning is not inferred.
      const key = address + ':' + (label || report.month);
      if (!lines.has(key)) lines.set(key, { label: label || '未命名原表金额（' + report.month + '）', address, amounts: {}, total: 0 });
      const line = lines.get(key);
      line.amounts[report.month] = amount;
      line.total = Number((line.total + amount).toFixed(4));
    }
  }
  return {
    requested_months: requestedMonths,
    months: requestedMonths.filter(month => available.has(month)),
    missing_months: requestedMonths.filter(month => !available.has(month)),
    sources: reports.map(({ month, source }) => ({ month, source })),
    lines: Array.from(lines.values()),
    read_only: true,
  };
}
