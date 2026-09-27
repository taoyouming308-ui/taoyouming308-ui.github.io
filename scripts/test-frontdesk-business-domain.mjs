import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {projectBusinessDay} from '../supabase/functions/_shared/frontdesk-business-domain.mjs';
const bill=JSON.parse(execFileSync('/usr/bin/python3',['-c','import json;from scripts.test_mgj_business_detail import normalized;print(json.dumps(normalized()))'],{encoding:'utf8'}));
const source={available:true,date:'2026-01-01',source_count:1,source_list_changed:false,bills:[bill]};
const result=projectBusinessDay(source);
assert.equal(result.posted_amount_cents,10000);
assert.equal(result.employees.find(row=>row.source_role==='设计师').performance_cents,10000);
const tech=result.employees.find(row=>row.source_role==='C级技师');
assert.equal(tech.metric_kind,'service_count');
assert.equal(tech.performance_cents,null);
assert.equal(tech.service_counts.other,1);
assert.equal(tech.lines[0].performance_cents,undefined);
for(const [name,expected] of [['健康烫发980','perm'],['健康染699','dye'],['歌薇酸护680','care'],['褪色','review']]){
  const changed=structuredClone(bill);
  changed.items[0].item_name=name;
  const projected=projectBusinessDay({...source,bills:[changed]});
  assert.equal(projected.employees.find(row=>row.source_role==='C级技师').service_counts[expected],1);
}
assert.equal(result.payments.find(row=>row.source_field==='cash').amount_cents,8000);
assert.equal(result.payments.find(row=>row.source_field==='weixin').amount_cents,null);
assert.equal(projectBusinessDay({...source,source_list_changed:true}).posted_amount_cents,null);
assert.throws(()=>projectBusinessDay({...source,source_count:2,bills:[bill,bill]}));
assert.throws(()=>projectBusinessDay({...source,date:'2026-01-02'}));
assert.equal(projectBusinessDay({available:false}).posted_amount_cents,null);
assert.equal(result.employees[0].lines[0].item.item_name,'剪发');
console.log('Business projection: independent staff/payments, no double income, gaps and source freshness passed');
