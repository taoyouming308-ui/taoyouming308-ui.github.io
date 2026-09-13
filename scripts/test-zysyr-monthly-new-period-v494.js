#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const page=fs.readFileSync(path.join(root,'operations.html'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/operations-api/index.ts'),'utf8');
function expect(value,message){if(!value)throw new Error(message)}
expect(api.includes('async function createMonthlyDraft('),'monthly draft endpoint missing');
expect(api.includes('monthlyDraftWorkbook(')&&api.includes('workbook.calcProperties.fullCalcOnLoad = true'),'editable workbook generation missing');
expect(api.includes('report_date=eq.${month}-01')&&api.includes('created: false'),'idempotent exact-month guard missing');
expect(api.includes('report_date=lt.${month}-01')&&api.includes('order=report_date.desc,version.desc'),'latest store template lookup missing');
expect(api.includes('entry_type=eq.monthly_profit_loss')&&api.includes('historicalMonthlyReport(companyId, storeId, sourceMonth'),'historical formal monthly fallback missing');
expect(api.includes('select=period_month,current_payload')&&api.includes('byAddress.set(address, cell)'),'all prior monthly input positions must remain fillable');
expect(api.includes('monthlyItemCategory(sourceCell) !== "fixed"'),'fixed monthly identifiers must not be cleared');
expect(api.includes('rpc/zysyr_register_report_upload'),'draft must use the audited report registration RPC');
expect(api.includes('operation === "monthly_draft_create"'),'monthly draft route missing');
expect(page.includes('开始填写本月月报')&&page.includes("api('monthly_draft_create'"),'new-month finance action missing');
expect(page.includes('本月月报已建立，可直接填写金额并保存'),'new-month editing confirmation missing');
const scripts=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(scripts.length===1,'operations inline script missing or duplicated');
new vm.Script(scripts[0][1],{filename:'operations.html'});
console.log('ZYSYR new monthly period editing static tests passed');
