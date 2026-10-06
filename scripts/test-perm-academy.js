const assert=require('node:assert/strict'),fs=require('node:fs');
const {build}=require('./build-perm-academy-feed');
const x=JSON.parse(fs.readFileSync('docs/perm/academy-feed.v1.json')).items[0];
assert.equal(build([x],[{...x,batchDate:'2026-10-07'}]).items.length,1);assert.equal(build([x],[{...x,batchDate:'2026-10-07'}]).items[0].batchDate,x.batchDate);
for(const change of [{reviewStatus:'pending'},{source:{...x.source,url:'javascript:alert(1)'}},{isRealCase:true,authorization:'unknown'},{isExample:true,evidence:{level:'强',basis:'test'}}])assert.throws(()=>build([],[{...x,...change}]));
assert(!Object.hasOwn(build([],[{...x,privatePayload:'omit'}]).items[0],'privatePayload'));
const source=fs.readFileSync('perm-app.html','utf8');assert(source.includes("switchPlan('academy')"));assert(source.includes("switchPlan('calc')"));assert(source.includes("switchPlan('cold')"));assert(source.includes("localStorage.getItem('perm_data_offline')"));
const legacy=source.slice(source.indexOf('  <!-- Calc Tab -->'),source.indexOf('  </section><!-- /tab-plans -->'));
assert.equal(require('node:crypto').createHash('sha256').update(legacy).digest('hex'),'bde6ac643c9eaaa4fa526663fcf5604162ff9ba8818b5f3d3c2f651ad6ef62a0','v606 legacy calculator/cold markup unchanged');
console.log('academy data safety/idempotency/legacy compatibility passed');

// Shared CI already runs this entry; include local ingestion safety without new workflow permissions.
require('./test-perm-ingestion-safety.js');
