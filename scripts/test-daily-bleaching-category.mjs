import assert from 'node:assert/strict';
import {reportProjectCategory,REPORT_PROJECT_ROUTES} from '../supabase/functions/_shared/salon-report-catalog.mjs';
for(const shop of ['1009951','1837032']) {
  for(const name of ['漂发','漂发400','漂发800','漂发1200','漂发980元'])
    assert.equal(reportProjectCategory(shop,{item_code:'new-code',item_name:name}),'color');
  for(const name of ['漂发粉','漂发产品零售','漂发护理套餐','漂发800改名','漂发800 ','漂发-800'])
    assert.equal(reportProjectCategory(shop,{item_code:'new-code',item_name:name}),null);
  assert.equal(reportProjectCategory(shop,{item_code:'unknown',item_name:'歌薇酸护880'}),'treatment');
  assert.equal(reportProjectCategory(shop,{item_code:'unknown',item_name:'褪色'}),'color');
}
assert.equal(reportProjectCategory('other',{item_code:'430',item_name:'漂发800'}),null);
for(const [shop,code,name,category] of REPORT_PROJECT_ROUTES)
  assert.equal(reportProjectCategory(shop,{item_code:code,item_name:name}),category);
console.log('Bleaching: both stores, price variants, retail/mixed negatives and all existing routes passed');
