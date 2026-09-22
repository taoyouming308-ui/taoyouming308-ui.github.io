#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');

assert.match(page, /上传文件（自动识别报表类型和所属月份）/);
assert.match(page, /id="monthly-material-vouchers"[^>]*multiple[^>]*accept="image\/jpeg,image\/png,application\/pdf"/);
assert.doesNotMatch(page, /id="monthly-material-type"|id="monthly-material-date"/);
assert.match(page, /api\('report_upload_auto',\{store:currentStore\(\),filename:file\.name,mime_type:mime,base64:await fileBase64\(file\),require_monthly:vouchers\.length>0\}\)/);
assert.match(page, /正式财务账未自动改变/);
assert.match(page, /美发收入仍只按已确认日报累计，不会因上传月报重复统计/);

assert.match(api, /detectReportMetadata/);
assert.match(api, /activeTab="\(\\d\+\)"/);
assert.match(api, /operation === "report_upload_auto"/);
assert.match(api, /payload\.require_monthly === true && reportType !== "monthly_profit_loss"/);
assert.match(api, /reportDate = autoDetect \? cleanText\(detection\?\.report_date/);
assert.match(api, /formal_ledger_changed: false/);

assert.match(api, /const dailyIncome = Number\(daily\?\.confirmed_days \|\| 0\) > 0 && isDailyIncomeCell\(cell\)/);
assert.match(api, /const effective = dailyIncome \? Number\(daily\?\.amount\)/);
assert.match(api, /const adjustment = dailyIncome \? 0/);
assert.match(api, /美发收入已由已确认日报自动累计，不能在月报重复入账/);

console.log('ZYSYR v524 auto upload: UI, server-side detection, safe period routing and no-double-count guards passed');
