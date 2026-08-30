const SALARY_FIELDS = [
  "position", "employee_name", "base_salary", "seniority_salary", "position_salary",
  "meal_allowance", "performance_commission", "delivery_card_commission",
  "overtime_activity_allowance", "supplemental_adjustment", "gross_pay", "product_cost",
  "late_early_deduction", "shooting_deduction", "leave_deduction", "growth_deduction",
  "employee_purchase_deduction", "social_security", "total_deduction", "net_pay", "notes",
];

const MONEY_FIELDS = new Set(SALARY_FIELDS.slice(2, 20));

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalized(value) {
  return text(value, 120).replace(/[\s·•._\-（）()\/]+/g, "").toLowerCase();
}

function rounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function resolvedCellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "result")) {
    return value.result;
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? null;
}

function formulaText(cell) {
  const value = cell?.value;
  return value && typeof value === "object" ? text(value.formula ?? value.sharedFormula, 4000) : "";
}

function displayValue(cell) {
  const value = resolvedCellValue(cell);
  if (value && typeof value === "object") return text(cell?.text ?? JSON.stringify(value), 1000);
  return value;
}

function numericValue(cell) {
  const value = resolvedCellValue(cell);
  return typeof value === "number" && Number.isFinite(value) ? rounded(value) : null;
}

function excelDate(cell, fallbackMonth) {
  const value = resolvedCellValue(cell);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value >= 30000 && value <= 70000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const short = text(value, 30).match(/^(\d{1,2})[.\/-](\d{1,2})$/);
  if (short) return `${fallbackMonth.slice(0, 4)}-${String(short[1]).padStart(2, "0")}-${String(short[2]).padStart(2, "0")}`;
  return null;
}

function monthFromSheet(name, year) {
  const source = text(name, 80);
  const explicit = source.match(/(?:^|\D)(20\d{2})[.年\/-]\s*(1[0-2]|0?[1-9])(?:\D|$)/);
  const plain = source.match(/(?:^|\D)(1[0-2]|0?[1-9])\s*月?(?:\D|$)/);
  const month = explicit ? Number(explicit[2]) : plain ? Number(plain[1]) : null;
  const resolvedYear = explicit ? Number(explicit[1]) : Number(year);
  if (!month || !Number.isInteger(resolvedYear) || resolvedYear < 2000 || resolvedYear > 2100) return null;
  return `${resolvedYear}-${String(month).padStart(2, "0")}-01`;
}

function sheetTitle(sheet) {
  const rowLimit = Math.min(sheet.actualRowCount || sheet.rowCount || 0, 4);
  const columnLimit = Math.min(sheet.actualColumnCount || sheet.columnCount || 0, 12);
  const candidates = [];
  for (let row = 1; row <= rowLimit; row += 1) {
    for (let column = 1; column <= columnLimit; column += 1) {
      const value = text(displayValue(sheet.getCell(row, column)), 200);
      if (!value || value === "[object Object]" || candidates.includes(value)) continue;
      candidates.push(value);
    }
  }
  return candidates.find((value) => /(工资|盈亏|备用金|自购|清单|统计|记录|报表)/.test(value))
    || candidates.find((value) => value.length >= 4)
    || candidates[0]
    || null;
}

function sourceSheetTitles(workbook, year) {
  return workbook.worksheets.map((sheet) => ({
    sheet_name: text(sheet.name, 120),
    period_month: monthFromSheet(sheet.name, year),
    title: sheetTitle(sheet),
  })).filter((item) => item.period_month && item.title);
}

function rowRaw(sheet, rowNumber, columnCount) {
  const cells = [];
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = sheet.getCell(rowNumber, column);
    const value = displayValue(cell);
    const formula = formulaText(cell);
    if (value !== null && value !== "" || formula) {
      cells.push({ address: cell.address, value, formula: formula || null });
    }
  }
  return { sheet_name: text(sheet.name, 120), sheet_title: sheetTitle(sheet), row_number: rowNumber, cells };
}

function issue(code, message, field = null) {
  return { code, message, field };
}

function statusFor(issues) {
  if (issues.some((item) => item.severity === "invalid")) return "invalid";
  return issues.length ? "warning" : "valid";
}

function withSeverity(item, severity = "warning") {
  return { ...item, severity };
}

function nameMap(rows, key = "name") {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const name = normalized(row?.[key]);
    if (name && !map.has(name)) map.set(name, row);
  });
  return map;
}

function scanStoreLabel(workbook) {
  for (const sheet of workbook.worksheets.slice(0, 4)) {
    const rowLimit = Math.min(sheet.actualRowCount || sheet.rowCount || 0, 12);
    const columnLimit = Math.min(sheet.actualColumnCount || sheet.columnCount || 0, 12);
    for (let row = 1; row <= rowLimit; row += 1) {
      for (let column = 1; column <= columnLimit; column += 1) {
        const value = text(displayValue(sheet.getCell(row, column)), 160);
        const match = value.match(/([\u4e00-\u9fffA-Za-z0-9]{2,20}(?:中心店|门店|店))/);
        if (match) return match[1];
      }
    }
  }
  return null;
}

function nearestLabel(sheet, row, column) {
  const labels = [];
  for (let cursor = column - 1; cursor >= Math.max(1, column - 5); cursor -= 1) {
    const candidate = text(displayValue(sheet.getCell(row, cursor)), 120);
    if (candidate && !/^-?\d+(?:\.\d+)?$/.test(candidate) && !labels.includes(candidate)) labels.unshift(candidate);
    if (labels.length >= 2) break;
  }
  for (let cursor = row - 1; cursor >= Math.max(1, row - 12); cursor -= 1) {
    const candidate = text(displayValue(sheet.getCell(cursor, column)), 120);
    if (candidate && !/^-?\d+(?:\.\d+)?$/.test(candidate) && !labels.includes(candidate)) {
      labels.push(candidate);
      break;
    }
  }
  return labels.join(" / ");
}

function salaryFieldForHeader(value) {
  const label = normalized(value).replace(/[：:]/g, "");
  const aliases = [
    ["职位", "position"], ["姓名", "employee_name"], ["基本工资", "base_salary"],
    ["工龄工资", "seniority_salary"], ["岗位工资", "position_salary"], ["饭补", "meal_allowance"],
    ["业绩提成", "performance_commission"], ["外卖办卡提成", "delivery_card_commission"],
    ["加班费／活动津贴", "overtime_activity_allowance"], ["加班费活动津贴", "overtime_activity_allowance"],
    ["补发补扣", "supplemental_adjustment"], ["应发", "gross_pay"], ["成本", "product_cost"],
    ["迟到／早退", "late_early_deduction"], ["迟到早退", "late_early_deduction"],
    ["拍摄", "shooting_deduction"], ["请假", "leave_deduction"], ["成长", "growth_deduction"],
    ["自购", "employee_purchase_deduction"], ["社保员工缴", "social_security"],
    ["应扣", "total_deduction"], ["实发", "net_pay"], ["备注／签字", "notes"], ["备注签字", "notes"],
  ];
  return aliases.find(([alias]) => normalized(alias) === label)?.[1] || null;
}

function salaryColumns(sheet, rowNumber) {
  const columnCount = Math.min(sheet.actualColumnCount || sheet.columnCount || 21, 40);
  for (let headerRow = rowNumber - 1; headerRow >= Math.max(1, rowNumber - 4); headerRow -= 1) {
    const columns = new Map();
    for (let column = 1; column <= columnCount; column += 1) {
      const field = salaryFieldForHeader(displayValue(sheet.getCell(headerRow, column)));
      if (field && !columns.has(field)) columns.set(field, column);
    }
    if (columns.has("position") && columns.has("employee_name") && columns.has("gross_pay")
        && columns.has("total_deduction") && columns.has("net_pay")) return { columns, columnCount };
  }
  return { columns: new Map(SALARY_FIELDS.map((field, index) => [field, index + 1])), columnCount };
}

function parseSalary(workbook, context) {
  const employees = nameMap(context.employees);
  const rows = [];
  for (const sheet of workbook.worksheets) {
    const periodMonth = monthFromSheet(sheet.name, context.year);
    if (!periodMonth) continue;
    const rowCount = Math.min(sheet.actualRowCount || sheet.rowCount || 0, 300);
    for (let rowNumber = 2; rowNumber <= rowCount; rowNumber += 1) {
      const employeeName = text(displayValue(sheet.getCell(rowNumber, 2)), 120);
      const position = text(displayValue(sheet.getCell(rowNumber, 1)), 120);
      if (!employeeName || /姓名|合计|小计/.test(employeeName) || !position) continue;
      const layout = salaryColumns(sheet, rowNumber);
      const mapped = { period_month: periodMonth };
      SALARY_FIELDS.forEach((field) => {
        const column = layout.columns.get(field);
        const value = column ? displayValue(sheet.getCell(rowNumber, column)) : null;
        mapped[field] = MONEY_FIELDS.has(field) ? (rounded(value) ?? 0) : text(value, field === "notes" ? 1000 : 160) || null;
      });
      const matchedEmployee = employees.get(normalized(employeeName));
      mapped.employee_id = matchedEmployee?.id || null;
      const issues = [];
      if (!matchedEmployee) issues.push(withSeverity(issue("employee_unmatched", `员工“${employeeName}”尚未匹配基础资料`, "employee_name")));
      const expectedGross = rounded([
        "base_salary", "seniority_salary", "position_salary", "meal_allowance",
        "performance_commission", "delivery_card_commission", "overtime_activity_allowance",
        "supplemental_adjustment",
      ].reduce((sum, field) => sum + Number(mapped[field] || 0), 0));
      const expectedDeduction = rounded([
        "product_cost", "late_early_deduction", "shooting_deduction", "leave_deduction",
        "growth_deduction", "employee_purchase_deduction", "social_security",
      ].reduce((sum, field) => sum + Number(mapped[field] || 0), 0));
      const expectedNet = rounded(Number(mapped.gross_pay || 0) - Number(mapped.total_deduction || 0));
      if (Math.abs(Number(mapped.gross_pay || 0) - Number(expectedGross || 0)) > 0.01) {
        issues.push(withSeverity(issue("gross_formula_mismatch", `应发工资与组成项相差 ${rounded(Number(mapped.gross_pay || 0) - Number(expectedGross || 0))}`, "gross_pay")));
      }
      if (Math.abs(Number(mapped.total_deduction || 0) - Number(expectedDeduction || 0)) > 0.01) {
        issues.push(withSeverity(issue("deduction_formula_mismatch", `扣款合计与组成项相差 ${rounded(Number(mapped.total_deduction || 0) - Number(expectedDeduction || 0))}`, "total_deduction")));
      }
      if (Math.abs(Number(mapped.net_pay || 0) - Number(expectedNet || 0)) > 0.01) {
        issues.push(withSeverity(issue("net_formula_mismatch", `实发工资与应发减扣款相差 ${rounded(Number(mapped.net_pay || 0) - Number(expectedNet || 0))}`, "net_pay")));
      }
      rows.push({
        source_sheet: text(sheet.name, 120), source_row_number: rowNumber,
        source_locator: `${text(sheet.name, 120)}!A${rowNumber}:${sheet.getCell(rowNumber, layout.columnCount).address}`,
        raw: rowRaw(sheet, rowNumber, layout.columnCount), mapped,
        validation_status: statusFor(issues), issues,
      });
    }
  }
  return rows;
}

function parsePettyCash(workbook, context) {
  const rows = [];
  for (const sheet of workbook.worksheets) {
    const periodMonth = monthFromSheet(sheet.name, context.year);
    if (!periodMonth) continue;
    const rowCount = Math.min(sheet.actualRowCount || sheet.rowCount || 0, 500);
    for (let rowNumber = 2; rowNumber <= rowCount; rowNumber += 1) {
      const transactionDate = excelDate(sheet.getCell(rowNumber, 1), periodMonth);
      const summary = text(displayValue(sheet.getCell(rowNumber, 3)), 500);
      const inflow = rounded(numericValue(sheet.getCell(rowNumber, 4))) ?? 0;
      const outflow = rounded(numericValue(sheet.getCell(rowNumber, 5))) ?? 0;
      if (!transactionDate || !summary || (!inflow && !outflow)) continue;
      const sequence = text(displayValue(sheet.getCell(rowNumber, 2)), 40) || null;
      const mapped = {
        period_month: periodMonth, transaction_date: transactionDate, source_sequence: sequence,
        summary, direction: outflow > 0 ? "outflow" : "inflow", amount: outflow > 0 ? outflow : inflow,
        category: text(displayValue(sheet.getCell(rowNumber, 6)), 120) || null,
        handled_by_name: text(displayValue(sheet.getCell(rowNumber, 7)), 120) || null,
        notes: text(displayValue(sheet.getCell(rowNumber, 8)), 500) || null,
      };
      const issues = [];
      if (inflow > 0 && outflow > 0) issues.push(withSeverity(issue("both_inflow_outflow", "同一行同时填写收入和支出", "amount"), "invalid"));
      if (sequence && (!/^\d+$/.test(sequence) || Number(sequence) > 999)) {
        issues.push(withSeverity(issue("sequence_unusual", `原表编号“${sequence}”异常，已原样保留`, "source_sequence")));
      }
      if (!mapped.category) issues.push(withSeverity(issue("category_missing", "支出分类为空，需要财务确认", "category")));
      rows.push({
        source_sheet: text(sheet.name, 120), source_row_number: rowNumber,
        source_locator: `${text(sheet.name, 120)}!A${rowNumber}:H${rowNumber}`,
        raw: rowRaw(sheet, rowNumber, 8), mapped,
        validation_status: statusFor(issues), issues,
      });
    }
  }
  return rows;
}

function parseEmployeePurchase(workbook, context) {
  const employees = nameMap(context.employees);
  const products = nameMap(context.products);
  const rows = [];
  for (const sheet of workbook.worksheets) {
    const periodMonth = monthFromSheet(sheet.name, context.year);
    if (!periodMonth) continue;
    const rowCount = Math.min(sheet.actualRowCount || sheet.rowCount || 0, 500);
    const columnCount = Math.min(sheet.actualColumnCount || sheet.columnCount || 0, 40);
    for (let rowNumber = 2; rowNumber <= rowCount; rowNumber += 1) {
      const transactionDate = excelDate(sheet.getCell(rowNumber, 1), periodMonth);
      const productName = text(displayValue(sheet.getCell(rowNumber, 2)), 160);
      if (!transactionDate || !productName) continue;
      const retailPrice = rounded(numericValue(sheet.getCell(rowNumber, 3)));
      const retailSeller = text(displayValue(sheet.getCell(rowNumber, 4)), 120);
      const purchasePrice = rounded(numericValue(sheet.getCell(rowNumber, 5)));
      const purchaser = text(displayValue(sheet.getCell(rowNumber, 6)), 120);
      const inventoryCost = rounded(numericValue(sheet.getCell(rowNumber, 7)));
      if (retailPrice === null && purchasePrice === null && inventoryCost === null) continue;
      const kind = purchasePrice !== null && purchaser ? "employee_purchase" : "retail_sale";
      const employeeName = kind === "employee_purchase" ? purchaser : retailSeller;
      const matchedEmployee = employees.get(normalized(employeeName));
      const matchedProduct = products.get(normalized(productName));
      const mapped = {
        period_month: periodMonth, transaction_date: transactionDate, transaction_kind: kind,
        product_name: productName, product_id: matchedProduct?.id || null,
        employee_name: employeeName || null, employee_id: matchedEmployee?.id || null,
        retail_price: retailPrice, employee_purchase_price: purchasePrice, inventory_cost: inventoryCost,
      };
      const issues = [];
      if (!matchedProduct) issues.push(withSeverity(issue("product_unmatched", `产品“${productName}”尚未匹配基础资料`, "product_name")));
      if (!employeeName) issues.push(withSeverity(issue("employee_missing", "售出人/自购人为空，需要财务确认", "employee_name"), "invalid"));
      else if (!matchedEmployee) issues.push(withSeverity(issue("employee_unmatched", `员工“${employeeName}”尚未匹配基础资料`, "employee_name")));
      if (kind === "retail_sale") issues.push(withSeverity(issue("retail_sale_preserved", "此行为外卖/零售记录，先保留在预览区，不自动生成员工自购", "transaction_kind")));
      rows.push({
        source_sheet: text(sheet.name, 120), source_row_number: rowNumber,
        source_locator: `${text(sheet.name, 120)}!A${rowNumber}:${sheet.getCell(rowNumber, columnCount).address}`,
        raw: rowRaw(sheet, rowNumber, columnCount), mapped,
        validation_status: statusFor(issues), issues,
      });
    }
  }
  return rows;
}

function parseMonthlyProfitLoss(workbook, context) {
  const rows = [];
  for (const sheet of workbook.worksheets) {
    const periodMonth = monthFromSheet(sheet.name, context.year);
    if (!periodMonth) continue;
    const rowCount = Math.min(sheet.actualRowCount || sheet.rowCount || 0, 160);
    const columnCount = Math.min(sheet.actualColumnCount || sheet.columnCount || 0, 40);
    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
      for (let column = 1; column <= columnCount; column += 1) {
        const cell = sheet.getCell(rowNumber, column);
        const amount = numericValue(cell);
        const formula = formulaText(cell);
        if (amount === null && !formula) continue;
        const label = nearestLabel(sheet, rowNumber, column);
        const numberFormat = text(cell.numFmt, 100).toLowerCase();
        if (/(编号|序号|员工号|日期)/.test(label) || /(^|[^a-z])[ymdhis]+([^a-z]|$)/.test(numberFormat)) continue;
        if (!formula && amount !== null && Number.isInteger(amount) && amount >= 1 && amount <= 9999 && /编号|姓名/.test(label)) continue;
        const issues = [];
        const formulaError = /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/.test(`${formula} ${text(resolvedCellValue(cell), 100)}`);
        if (formulaError) issues.push(withSeverity(issue("formula_error", `公式错误：${formula || resolvedCellValue(cell)}`, "amount"), amount === null ? "invalid" : "warning"));
        if (!label) issues.push(withSeverity(issue("label_unresolved", "未能自动确定该数字的栏目名称，需要财务确认", "label")));
        const mapped = {
          period_month: periodMonth, sheet_name: text(sheet.name, 120), cell_address: cell.address,
          label: label || null, amount, formula: formula || null,
          cell_kind: formula ? "formula" : "input",
        };
        rows.push({
          source_sheet: text(sheet.name, 120), source_row_number: rowNumber,
          source_locator: `${text(sheet.name, 120)}!${cell.address}`,
          raw: { sheet_name: text(sheet.name, 120), sheet_title: sheetTitle(sheet), cell_address: cell.address,
            value: displayValue(cell), formula: formula || null, number_format: text(cell.numFmt, 100) || null },
          mapped, validation_status: statusFor(issues), issues,
        });
      }
    }
  }
  return rows;
}

export function parseHistoricalWorkbook(workbook, context) {
  const importType = text(context?.import_type, 60);
  const targetStoreLabel = text(context?.target_store_label, 120);
  const requestedStart = /^\d{4}-\d{2}$/.test(text(context?.period_start, 7))
    ? `${text(context.period_start, 7)}-01` : null;
  const requestedEnd = /^\d{4}-\d{2}$/.test(text(context?.period_end, 7))
    ? `${text(context.period_end, 7)}-01` : null;
  const sourceStoreLabel = scanStoreLabel(workbook);
  const sourceTitles = sourceSheetTitles(workbook, context?.year).filter((item) =>
    (!requestedStart || item.period_month >= requestedStart)
    && (!requestedEnd || item.period_month <= requestedEnd));
  const sourceWarnings = [];
  if (sourceStoreLabel && targetStoreLabel && normalized(sourceStoreLabel) !== normalized(targetStoreLabel)) {
    sourceWarnings.push(withSeverity(issue(
      "source_store_label_mismatch",
      `原文件标题为“${sourceStoreLabel}”，目标门店为“${targetStoreLabel}”；来源标题将原样保留，必须人工确认后才能继续`,
      "target_store_label",
    ), "warning"));
  }
  const titleVariants = Array.from(new Set(sourceTitles.map((item) => normalized(item.title)
    .replace(/20\d{2}/g, "").replace(/\d{1,2}月/g, "")).filter(Boolean)));
  if (titleVariants.length > 1) {
    sourceWarnings.push(withSeverity(issue(
      "source_sheet_titles_inconsistent",
      "同一工作簿的月份标题不完全一致；系统已逐月保留原始标题，必须人工确认门店归属后才能继续",
      "source_sheet_titles",
    ), "warning"));
  }
  let rows;
  if (importType === "salary") rows = parseSalary(workbook, context);
  else if (importType === "petty_cash") rows = parsePettyCash(workbook, context);
  else if (importType === "employee_purchase") rows = parseEmployeePurchase(workbook, context);
  else if (importType === "monthly_profit_loss") rows = parseMonthlyProfitLoss(workbook, context);
  else throw new Error("历史导入类型无效");
  rows = rows.filter((row) => (!requestedStart || row.mapped.period_month >= requestedStart)
    && (!requestedEnd || row.mapped.period_month <= requestedEnd));
  if (!rows.length) throw new Error("没有识别到可预览的历史明细，请核对文件类型和月份工作表");
  const months = Array.from(new Set(rows.map((row) => row.mapped.period_month))).sort();
  const duplicateCounts = new Map();
  rows.forEach((row) => {
    const key = JSON.stringify(row.mapped);
    duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  });
  rows.forEach((row) => {
    if ((duplicateCounts.get(JSON.stringify(row.mapped)) || 0) > 1) {
      row.issues.push(withSeverity(issue("possible_duplicate", "存在内容完全相同的另一行；系统保留两行并提示人工核对")));
      if (row.validation_status === "valid") row.validation_status = "warning";
    }
  });
  return {
    source_store_label: sourceStoreLabel,
    source_warnings: sourceWarnings,
    period_start: months[0], period_end: months[months.length - 1], rows,
    summary: {
      sheet_count: workbook.worksheets.length,
      month_count: months.length,
      months,
      row_count: rows.length,
      valid_count: rows.filter((row) => row.validation_status === "valid").length,
      warning_count: rows.filter((row) => row.validation_status === "warning").length,
      invalid_count: rows.filter((row) => row.validation_status === "invalid").length,
      source_warning_count: sourceWarnings.length,
      source_sheet_titles: sourceTitles,
    },
  };
}
