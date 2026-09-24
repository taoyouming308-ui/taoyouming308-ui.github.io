const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const names = ['cleanText','uuidIn','effectiveCellValue','columnLetters','formulaPrecedents','mergeCoordinates',
  'reportCellLabel','monthlyEditableNameCells','safeFormulaValue','latestMonthlyCellRevisionMap','isDailyIncomeCell',
  'monthlyItemCategory','monthlyAdjustmentForSource','effectiveMonthlyDisplay','effectiveHistoryMonthlyEntries','confirmedDailyRollup','monthlySummary'];
const code = names.map(name => {
  const start = source.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert(start >= 0, name); return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hist = (month, address, amount, label, formula) => ({ id: month + address, period_month: month + '-01', source_sheet: '原表',
  current_payload: {cell_address: address, amount, label, formula, cell_kind: formula ? 'formula' : 'input'}, posted_payload: {amount} });
(async () => {
  const { monthlySummaryMonths, buildMonthlySummary } = await import('../supabase/functions/_shared/monthly-summary.mjs');
  assert.deepEqual(monthlySummaryMonths('2025-12','2026-02'), ['2025-12','2026-01','2026-02']);
  for (const [start,end] of [['2026-00','2026-01'],['2026-01','2026-13'],['2026-02','2026-01'],['2025-01','2026-01'],['2026-01-extra','2026-02']])
    assert.throws(() => monthlySummaryMonths(start,end));
  assert.equal(monthlySummaryMonths('2026-01','2026-12').length,12);
  let uploads = [], cells = [], revisions = [], textRevisions = [], history = [
    hist('2026-01','C3',900,'主营 / 美发收入 / Nov.'), hist('2026-01','C4',10.1,'主营 / 产品收入 / Nov.'),
    hist('2026-01','C8',910.1,'小计 / Nov.','SUM(C3:C4)'), hist('2026-01','G3',50,'技术人员 / 甲 / 底薪'),
    hist('2026-02','C3',200,'主营 / 美发收入 / 2月'), hist('2026-02','C4',0.2,'主营 / 产品收入 / 2月'),
    hist('2026-02','G3',80,'技术人员 / 乙 / 底薪'), hist('2026-02','C9',20,'新增费用'),
    hist('2026-01','F3',123,'技术人员 / 编号'), hist('2026-02','F3',123,'技术人员 / 编号'),
    hist('2026-01','R28',30,null), hist('2026-02','R28',40,null),
  ];
  const originals = JSON.stringify(history), calls = []; let failed = false, duplicateDaily = false;
  const context = vm.createContext({ monthlySummaryMonths, buildMonthlySummary,
    selectedStoreInfo: async (session,payload) => { if (payload.store !== '甲店') throw Error('无门店权限'); return {id:id(1),company_id:id(2)}; },
    restRowsAll: async (path, maxRows) => {
      calls.push(path);
      assert(path.includes('company_id=eq.' + id(2)) && path.includes('store_id=eq.' + id(1)), 'every read scoped');
      if (failed) throw Error('read unavailable');
      if (path.startsWith('zysyr_report_uploads?')) return uploads;
      if (path.startsWith('zysyr_report_cells?')) return cells;
      if (path.startsWith('zysyr_monthly_cell_revisions?')) return revisions;
      if (path.startsWith('zysyr_monthly_text_revisions?')) return textRevisions;
      if (path.startsWith('zysyr_history_ledger_entries?')) { assert(path.includes('status=eq.posted')); assert(maxRows>=5000,'full year must paginate beyond 1000 cells'); return history; }
      if (path.startsWith('zysyr_monthly_income_adjustments?')) return [{source_id:'2026-01C3',period_month:'2026-01-01',adjustment_delta:999,created_at:'2026-09-01T00:00:00Z'}];
      if (path.startsWith('zysyr_daily_sheet_drafts?')) return path.includes('report_date=gte.2026-01-01')
        ? (duplicateDaily ? [1,2] : [1]).map(n => ({id:id(20+n),report_date:'2026-01-01',edit_revision:3,confirmed_at:'2026-09-20T00:00:00Z'})) : [];
      if (path.startsWith('zysyr_daily_sheet_cells?')) return [{draft_id:id(21),manual_override:true,corrected_numeric:100}];
      throw Error(path);
    }
  });
  vm.runInContext(stripTypeScriptTypes(code), context);
  const payload = {store:'甲店',start_month:'2026-01',end_month:'2026-03'};
  let result = await context.monthlySummary(payload,{});
  assert.equal(result.months.length,2); assert.deepEqual(Array.from(result.missing_months),['2026-03']);
  const find = address => result.lines.filter(line => line.address === address);
  assert.equal(find('C3')[0].total,300,'confirmed daily replaces original and obsolete adjustment, never added twice');
  assert.equal(find('C4')[0].total,10.3,'decimal totals');
  assert.equal(find('C8')[0].total,110.1,'derived historical formulas match single-month effective values');
  assert.equal(find('C9')[0].total,20,'later-only amount included');
  assert.equal(find('G3').length,2,'different employees never mixed');
  assert.equal(find('R28').length,2,'unnamed financial cells not silently combined');
  assert.equal(find('F3').length,0,'IDs excluded');
  assert.equal(JSON.stringify(history), originals,'no source mutations');
  assert(!calls.some(path=>path.includes('report_id=in.()')));
  assert.equal(calls.filter(path=>path.startsWith('zysyr_history_ledger_entries?')).length,1,'batched history read');
  // A new upload supersedes the historical source for that month, not added to it.
  uploads = [{id:id(40),report_date:'2026-02-01',version:2,display_data:{values:[[],['','','2月'],['主营','美发收入',500]]}}, {id:id(41),report_date:'2026-02-01',version:1,display_data:{values:[]}}];
  cells = [{id:id(50),report_id:id(40),cell_address:'C3',row_number:3,column_number:3,cell_kind:'input',numeric_value:500,label:'主营 / 美发收入 / 2月'}];
  revisions = [{source_cell_id:id(50),report_id:id(40),revision:1,after_amount:550}];
  result = await context.monthlySummary(payload,{});
  assert.equal(find('C3')[0].total,650,'latest upload and revision used once');
  assert.equal(result.sources.find(row=>row.month==='2026-02').source,'monthly_report');
  duplicateDaily = true; await assert.rejects(()=>context.monthlySummary(payload,{}),/重复汇总/); duplicateDaily = false;
  const before = calls.length; await assert.rejects(()=>context.monthlySummary({...payload,store:'乙店'},{}),/无门店权限/); assert.equal(calls.length,before);
  failed = true; await assert.rejects(()=>context.monthlySummary(payload,{}),/read unavailable/); failed=false;
  history=[];uploads=[]; result=await context.monthlySummary(payload,{});
  assert.equal(result.lines.length,0);assert.equal(result.missing_months.length,3);
  assert.throws(()=>buildMonthlySummary(['2026-01'],[{month:'2026-01',cells:[{cell_address:'C3',numeric_value:1},{cell_address:'C3',numeric_value:2}]}]),/重复/);
  const edge = buildMonthlySummary(['2026-01'],[{month:'2026-01',cells:[
    {cell_address:'C1',label:'盈亏',numeric_value:-12.25}, {cell_address:'C2',label:'零金额',numeric_value:0},
    {cell_address:'C3',label:'空金额',numeric_value:null}, {cell_address:'C4',label:'空格',numeric_value:0,editable_blank:true}
  ]}]);
  assert.equal(edge.lines.length,2);assert.equal(edge.lines[0].total,-12.25);assert.equal(edge.lines[1].total,0);
  console.log('Monthly summary: history fallback, source precedence, revisions, daily de-duplication, formulas, range, nulls, names, IDs and store isolation passed');
})().catch(error => {console.error(error); process.exitCode=1;});
