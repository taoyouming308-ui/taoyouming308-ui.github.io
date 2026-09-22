function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function allText(filename, sheetName, values) {
  const cells = Array.isArray(values)
    ? values.flatMap((row) => Array.isArray(row) ? row : []).map(text).filter(Boolean)
    : [];
  return {
    filename: text(filename),
    sheetName: text(sheetName),
    cells,
    joined: [text(filename), text(sheetName), ...cells].join(" | "),
  };
}

function fullDates(source) {
  const matches = [];
  const patterns = [
    /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g,
    /(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      const candidate = new Date(Date.UTC(year, month - 1, day));
      if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() + 1 !== month || candidate.getUTCDate() !== day) continue;
      matches.push(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }
  return unique(matches);
}

function years(source) {
  return unique(Array.from(source.matchAll(/(?:^|\D)(20\d{2})(?:\D|$)/g), (match) => match[1]));
}

function sheetMonths(sheetName) {
  const name = text(sheetName);
  const exact = name.match(/^(\d{1,2})月$/);
  if (exact) return [Number(exact[1])].filter((month) => month >= 1 && month <= 12);
  return unique(Array.from(name.matchAll(/(?:^|\D)(\d{1,2})月(?:\D|$)/g), (match) => Number(match[1])))
    .filter((month) => month >= 1 && month <= 12);
}

function contentMonths(cells) {
  const leading = cells.slice(0, 30).join(" | ");
  return unique(Array.from(leading.matchAll(/(?:^|\D)(\d{1,2})月(?:\D|$)/g), (match) => Number(match[1])))
    .filter((month) => month >= 1 && month <= 12);
}

function score(joined, markers) {
  return markers.reduce((total, marker) => total + (joined.includes(marker) ? 1 : 0), 0);
}

function detectType(joined, dates) {
  const monthly = score(joined, ["盈亏统计", "收入类别", "美发收入"]);
  const salary = score(joined, ["工资表", "基本工资", "应发", "实发"]);
  const daily = score(joined, ["业绩报表", "现金", "支付", "总计"]) + (dates.length === 1 ? 1 : 0);
  const candidates = [
    { type: "monthly_profit_loss", label: "月报原表", score: monthly, minimum: 3 },
    { type: "salary", label: "工资原表", score: salary, minimum: 3 },
    { type: "daily", label: "日报原表", score: daily, minimum: 4 },
  ].filter((item) => item.score >= item.minimum).sort((left, right) => right.score - left.score);
  if (!candidates.length) throw new Error("无法从文件内容判断这是日报、工资表还是月报，请检查文件是否为原始 XLSX / DOCX 报表");
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) throw new Error("文件同时出现多种报表特征，无法安全判断报表类型，请检查是否上传了正确原表");
  return candidates[0];
}

function assertStore(joined, storeName) {
  const selected = text(storeName);
  if (!selected) return;
  const selectedXiangli = /向里/.test(selected);
  const selectedFreelance = /自由手艺人/.test(selected);
  const sourceXiangli = /向里造型/.test(joined);
  const sourceFreelance = /自由手艺人/.test(joined);
  if ((selectedXiangli && sourceFreelance && !sourceXiangli) || (selectedFreelance && sourceXiangli && !sourceFreelance)) {
    throw new Error(`文件中的门店与当前选择的“${selected}”不一致，请切换到正确门店后再上传`);
  }
}

function reportPeriod(type, filename, sheetName, cells, dates) {
  if (type === "daily") {
    if (dates.length !== 1) throw new Error(dates.length ? "文件中出现多个日报日期，无法安全确定归属日期" : "未在日报原表中识别到完整日期");
    return { report_date: dates[0], month: dates[0].slice(0, 7) };
  }
  const filenameYears = years(filename);
  const sourceYears = filenameYears.length ? filenameYears : years([sheetName, ...cells.slice(0, 30)].join(" | "));
  if (sourceYears.length !== 1) throw new Error(sourceYears.length ? "文件中出现多个年份，无法安全确定归属月份" : "未识别到报表年份，请保留文件名或表头中的年份");
  const directMonths = sheetMonths(sheetName);
  const sourceMonths = directMonths.length ? directMonths : contentMonths(cells);
  if (sourceMonths.length !== 1) throw new Error(sourceMonths.length ? "当前工作表出现多个月份，无法安全确定归属月份" : "未识别到报表月份，请确认当前工作表名称或表头包含月份");
  const month = `${sourceYears[0]}-${String(sourceMonths[0]).padStart(2, "0")}`;
  return { report_date: `${month}-01`, month };
}

export function detectReportMetadata({ filename = "", sheetName = "", values = [], storeName = "" } = {}) {
  const source = allText(filename, sheetName, values);
  assertStore(source.joined, storeName);
  const dates = fullDates(source.joined);
  const detected = detectType(source.joined, dates);
  const period = reportPeriod(detected.type, source.filename, source.sheetName, source.cells, dates);
  return {
    report_type: detected.type,
    type_label: detected.label,
    report_date: period.report_date,
    month: period.month,
    sheet_name: source.sheetName || "Word表格",
    evidence: detected.type === "monthly_profit_loss"
      ? ["盈亏统计", "收入类别", "美发收入"]
      : detected.type === "salary"
        ? ["工资表", "基本工资", "应发/实发"]
        : ["业绩报表", "支付/现金", "完整日期"],
  };
}
