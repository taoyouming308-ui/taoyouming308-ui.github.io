const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const ExcelJS = require('exceljs');

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/operations-api/index.ts'), 'utf8');
const names = [
  'cleanText', 'excelCellText', 'numericCellValue', 'formulaCellText',
  'mergeCoordinates', 'columnLetters', 'formulaPrecedents', 'reportCellLabel',
  'monthlyEditableBlankCells', 'worksheetByCleanName', 'workbookDisplay',
];
const snippets = names.map((name) => {
  const start = source.indexOf(`${name === 'workbookDisplay' ? 'async ' : ''}function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start, `${name} must be available`);
  return source.slice(start, end);
}).join('\n');
const sandbox = { ExcelJS, exactArrayBuffer: (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(snippets), sandbox);

(async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('7月');
  for (let column = 1; column <= 11; column += 1) sheet.getCell(1, column).value = `列${column}`;
  sheet.getCell('B2').value = '测试月报';
  sheet.getCell('A5').value = '分隔行';
  sheet.getCell('F3').value = 100;
  sheet.getCell('F4').value = 200;
  sheet.getCell('K3').value = { formula: 'SUM(F3:J3)', result: 100, ref: 'K3:K5', shareType: 'shared' };
  sheet.getCell('K4').value = { sharedFormula: 'K3', result: 200 };
  sheet.getCell('K5').value = { sharedFormula: 'K3', result: 0 };
  sheet.getCell('K6').value = { formula: 'SUM(F6:J6)', result: 0 };
  sheet.getCell('K7').value = { formula: 'SUM(F7:J7)' };
  sheet.mergeCells('G6:H6');
  sheet.getCell('G6').value = 30;
  const display = await sandbox.workbookDisplay(new Uint8Array(await workbook.xlsx.writeBuffer()), 'monthly_profit_loss');
  const byAddress = new Map(display.cells.map((cell) => [cell.cell_address, cell]));
  assert.equal(byAddress.get('K3').numeric_value, 100);
  assert.equal(byAddress.get('K4').numeric_value, 200);
  assert.equal(byAddress.get('K4').formula, 'SUM(F4:J4)', 'shared formula must follow its own row');
  assert.deepEqual(Array.from(byAddress.get('K4').precedent_addresses), ['F4', 'G4', 'H4', 'I4', 'J4']);
  assert.equal(byAddress.get('G6').numeric_value, 30);
  assert.equal(byAddress.has('H6'), false, 'merged slave must not become another financial cell');
  for (const address of ['K5', 'K6']) {
    assert.equal(byAddress.get(address).numeric_value, 0, `${address} cached zero must remain numeric`);
    assert.equal(byAddress.get(address).display_value, '0', `${address} cached zero must remain visible`);
  }
  assert.equal(byAddress.get('K5').formula, 'SUM(F5:J5)');
  assert.equal(byAddress.get('K7').numeric_value, null, 'missing cache must not become zero');
  console.log('Monthly shared formula import: translated formula, cached amount and merged master passed');

  if (process.env.MONTHLY_REAL_WORKBOOK_DIR) {
    for (const month of [7, 8, 9]) {
      const filename = `自由手艺人_2026年${month}月盈亏报表.xlsx`;
      const bytes = fs.readFileSync(path.join(process.env.MONTHLY_REAL_WORKBOOK_DIR, filename));
      const original = new ExcelJS.Workbook();
      await original.xlsx.load(bytes);
      const actual = await sandbox.workbookDisplay(new Uint8Array(bytes), 'monthly_profit_loss');
      if (process.env.MONTHLY_REAL_ORACLE) {
        const expected = JSON.parse(fs.readFileSync(process.env.MONTHLY_REAL_ORACLE, 'utf8'))
          .filter((item) => item.month === `2026-${String(month).padStart(2, '0')}-01`);
        const indexed = new Map(actual.cells.map((item) => [item.cell_address, item]));
        assert.ok(expected.length > 0, 'independent source oracle must contain cells');
        for (const item of expected) {
          const imported = indexed.get(item.address);
          assert.ok(imported, `${month}月 ${item.address} must be imported`);
          assert.equal(imported.numeric_value, item.amount, `${month}月 ${item.address} independent source amount`);
          if (item.formula) assert.equal(imported.formula, item.formula, `${month}月 ${item.address} independent formula`);
        }
        console.log(`${month}月独立原件核对：${expected.length} 个数值全部一致`);
      }
      const realSheet = original.worksheets[0];
      let formulas = 0;
      for (const item of actual.cells) {
        if (item.editable_blank) continue;
        const cell = realSheet.getCell(item.cell_address);
        assert.notEqual(cell.type, ExcelJS.ValueType.Merge, `${month}月 ${item.cell_address} is a merged slave`);
        if (item.cell_kind === 'formula') {
          formulas += 1;
          assert.equal(item.formula, cell.formula, `${month}月 ${item.cell_address} formula translation`);
        }
        const raw = cell.value;
        const cached = typeof raw === 'number' ? raw : typeof cell.result === 'number' ? cell.result : null;
        if (cached === null) assert.equal(item.numeric_value, null, `${month}月 ${item.cell_address} unavailable cache`);
        else assert.ok(Math.abs(item.numeric_value - cached) < 0.00005, `${month}月 ${item.cell_address} cached amount`);
      }
      console.log(`${month}月真实原件：${formulas} 个公式逐格匹配，无合并格重复金额`);
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
