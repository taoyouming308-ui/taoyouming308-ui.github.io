// Pure offline synthetic financial policy regression; never reads credentials.
import assert from 'node:assert/strict';
import {dailyCashCandidate,CASH_POLICY} from '../supabase/functions/_shared/daily-cash-policy.mjs';
const heads=['日期','总额','现金','银联','支付宝','微信支付','大众点评','商场卡','合作券','口碑','抖音','总额','划卡','划赠送金','划分期赠送金','总额','代金券','欠款','免单','红包','优惠券','商城订单','线上积分抵扣','门店积分抵扣'];
function fixture(scope,overrides={}) {
  const day='2026-01-29',shop='1837032',ts=Date.parse(day+'T00:00:00Z');
  const row=[day,...Array(23).fill('0')];row[1]='100';row[4]='70';row[5]='20';row[6]='10';row[11]='879';row[12]='879';
  return {source_scope:scope,shop_id:shop,business_date:day,snapshot_id:scope==='operating_daily_summary'?'00000000-0000-0000-0000-000000000001':'00000000-0000-0000-0000-000000000002',source_sha256:'a'.repeat(64),fetched_at:'2026-01-30T00:00:00Z',
    source:{shop_id:shop,business_date:day,query:{parentShopId:1103470,shopId:'1103470',shopIds:[shop],period:`${ts}_${ts}`,incomeType:scope==='operating_daily_summary'?['1','2']:['1','2','3','4','5'],depcode:'-1'},
      content:{head:heads.slice(),headTop:[{text:'日期',rowspan:2},{text:'现金类',colspan:10},{text:'划卡类',colspan:4},{text:'其他非现类',colspan:9}],columns:Array(24).fill(null),config:{title:'门店营业日汇总'},data:[row]}},...overrides};
}
const opScope='operating_daily_summary',allScope='all_business_daily_summary';
function cardFixture(amount='0') {
  const s=fixture(allScope,{source_scope:'card_sales_daily_summary',snapshot_id:'00000000-0000-0000-0000-000000000003'});
  s.source.query.incomeType=['3','4','5'];s.source.content.data[0].fill('0',1);
  s.source.content.data[0][1]=amount;s.source.content.data[0][4]=amount;return s;
}
const project=(o,a,c=cardFixture())=>dailyCashCandidate(o,a,c);
const value=(r,section,code)=>r.cells.find(c=>c.section_code===section&&c.column_code===code)?.value_cents;
let checks=0;const test=(name,fn)=>{fn();console.log(`ok ${++checks} - ${name}`)};
test('cash includes WeChat, Alipay and platforms, never 879 stored-value drawdown',()=>{
  const o=fixture(opScope),a=fixture(allScope),before=JSON.stringify([o,a]),r=project(o,a);
  assert.equal(r.policy,CASH_POLICY);assert.equal(value(r,'summary','actual_total'),10000);
  assert.equal(value(r,'payment','cash_flow'),10000);assert.equal(value(r,'payment','total'),10000);
  assert.equal(value(r,'summary','card_subtotal'),0);assert(!r.cells.some(c=>c.column_code==='card_consumption'));
  assert.equal(JSON.stringify([o,a]),before);assert.equal(r.automatic_posting_allowed,false);assert.equal(r.scope_verified,false);
});
test('new recharge/package/year-card cash separately adds grand total, not 实做',()=>{
  const a=fixture(allScope);a.source.content.data[0][1]='400';a.source.content.data[0][4]='370';
  const r=project(fixture(opScope),a,cardFixture('300'));
  assert.equal(value(r,'summary','actual_total'),10000);assert.equal(value(r,'summary','card_subtotal'),30000);
  assert.equal(value(r,'summary','grand_total'),40000);assert.equal(value(r,'payment','cash_flow'),10000);
  assert.equal(value(r,'payment','total'),40000);assert.equal(value(r,'payment','alipay'),7000);
  assert(!r.cells.some(c=>['treatment_card','qualification_card','membership_card'].includes(c.column_code)));
  assert(r.gaps.some(g=>g.code==='card_sales_category_split_unavailable'));
  assert.equal(r.cells.find(c=>c.column_code==='card_subtotal').lineage[0].source_scope,'card_sales_daily_summary');
});
test('operating retail cash is included, employee performance is not substituted',()=>{
  const o=fixture(opScope),a=fixture(allScope);for(const e of[o,a]){e.source.content.data[0][1]='159.90';e.source.content.data[0][4]='129.90';}
  assert.equal(value(project(o,a),'summary','actual_total'),15990);
});
test('unknown cash totals stay null, never reconstructed from employees or zero',()=>{
  const o=fixture(opScope);o.source.content.data[0][1]='';const r=project(o,fixture(allScope));
  assert.equal(value(r,'summary','actual_total'),null);assert.equal(value(r,'summary','card_subtotal'),0);
  assert(r.gaps.some(g=>g.code==='cash_total_unknown'));
});
test('known total with missing channel is only a review candidate, null preserved',()=>{
  const o=fixture(opScope);o.source.content.data[0][4]='';const r=project(o,fixture(allScope));
  assert.equal(value(r,'payment','alipay'),null);assert.equal(value(r,'summary','actual_total'),10000);
  assert(r.gaps.some(g=>g.code==='cash_channels_unknown'));
});
test('unionpay maps only to independent bank card, excluded account columns untouched',()=>{
  const o=fixture(opScope),a=fixture(allScope);for(const e of[o,a]){e.source.content.data[0][1]='110';e.source.content.data[0][3]='10';}
  const r=project(o,a);assert(!r.gaps.some(g=>g.code==='unmapped_external_cash_channel'));
  assert.equal(value(r,'payment','bank_card'),1000);
  assert.equal(r.cells.find(c=>c.column_code==='bank_card').lineage[0].json_pointer,'/content/data/0/3');
  assert.equal(value(r,'payment','alipay'),7000);assert.equal(value(r,'payment','wechat'),2000);
  assert(!r.cells.some(c=>['public_card','public_qr','private_card','private_qr'].includes(c.column_code)));
});
test('bank blank remains unknown and unsupported other channels still require review',()=>{
  const o=fixture(opScope),a=fixture(allScope);o.source.content.data[0][3]='';
  assert.equal(value(project(o,a),'payment','bank_card'),null);
  for(const e of[o,a]){e.source.content.data[0][1]='110';e.source.content.data[0][3]='0';e.source.content.data[0][7]='10';}
  assert(project(o,a).gaps.some(g=>g.code==='unmapped_external_cash_channel'));
});
test('known zero is not confused with missing evidence',()=>{const o=fixture(opScope),a=fixture(allScope);for(const e of[o,a]) e.source.content.data[0].fill('0',1);assert.equal(value(project(o,a),'summary','actual_total'),0)});
test('same-store/day paired evidence required',()=>{
  for(const key of['shop_id','business_date']){const a=fixture(allScope,{[key]:key==='shop_id'?'1009951':'2026-01-28'});assert.throws(()=>project(fixture(opScope),a),/scope_mismatch/)}
});
test('time-zone-less or widely separated captures rejected',()=>{
  assert.throws(()=>project(fixture(opScope),fixture(allScope,{fetched_at:'2026-01-30T00:02:01Z'})),/not_contemporaneous/);
  assert.throws(()=>project(fixture(opScope),fixture(allScope,{fetched_at:'2026-01-30T00:00:00'})),/invalid_fetched/);
});
test('all-business channels cannot decrease even when aggregate is larger',()=>{
  const a=fixture(allScope);a.source.content.data[0][4]='60';a.source.content.data[0][5]='30';
  assert.throws(()=>project(fixture(opScope),a),/decreasing_cash/);
});
test('cash group contradictions, negative, fractions of cents rejected',()=>{
  for(const val of['101','-1','100.001',null,true,'1e2']){const o=fixture(opScope);o.source.content.data[0][1]=val;assert.throws(()=>project(o,fixture(allScope)),/invalid_amount|cash_group_mismatch/)}
});
test('query type, header, source scope changes rejected',()=>{
  for(const mutate of[e=>e.source.query.incomeType=['1'],e=>e.source.content.head[4]='其他',e=>e.source_scope='projects_daily_summary',e=>e.source_sha256='bad']){
    const o=fixture(opScope);mutate(o);assert.throws(()=>project(o,fixture(allScope)));
  }
});
test('missing card-sale source or intervening project receipt is never guessed as a sale',()=>{
  assert.throws(()=>dailyCashCandidate(fixture(opScope),fixture(allScope)),/invalid_evidence/);
  const all=fixture(allScope);all.source.content.data[0][1]='120';all.source.content.data[0][4]='90';
  assert.throws(()=>project(fixture(opScope),all,cardFixture()),/partition_mismatch/);
  const cards=cardFixture();cards.source.content.data[0][1]='';
  assert.equal(value(project(fixture(opScope),fixture(allScope),cards),'summary','card_subtotal'),null);
});
test('empty rows, parser failure and HTTP error are not trusted no-sales evidence',()=>{
 for(const mode of ['no_rows','parse_failure','403']){
  const card=cardFixture();
  if(mode==='no_rows')card.source.content.data=[];
  if(mode==='parse_failure')card.source.content.data[0][1]='not-a-number';
  if(mode==='403')card.source={code:403};
  assert.throws(()=>project(fixture(opScope),fixture(allScope),card));
 }
});
console.log(`${checks} daily cash policy checks passed; candidate only, no database writes`);
