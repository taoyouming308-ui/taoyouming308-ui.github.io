// Standalone design archive module, synthetic customers/images only; no live service calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const javascript = fs.readFileSync('customer-design-archive.js','utf8');
const css = fs.readFileSync('customer-design-archive.css','utf8');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/4z8AAAAASUVORK5CYII=','base64');
let browser;
async function boot(width,overrides={}) {
  const page = await browser.newPage({viewport:{width,height:844}});
  await page.route('**/*',route=>route.request().url().startsWith('https://fixture.invalid/storage/v1/object/sign/')?route.fulfill({contentType:'image/png',body:pixel}):route.abort());
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;background:#fff} #archive{max-width:740px;margin:auto}'+css+'</style></head><body><div id="archive"></div></body></html>');
  await page.addScriptTag({content:javascript});
  await page.evaluate(settings=>{
    const fields={style:'自然知性',person:'顾客确认喜欢简洁',length:'颈部长度',features:'保留完整底线',layers:'低层次',bangs:'长刘海',curls:'原有微弯',care:'手指吹干'};
    const baseline={outline:'纵向椭圆',root_flow:'自然向前',steps:fields};
    const optimized={outline:'两侧略收的椭圆',root_flow:'自然向前',steps:{...fields,bangs:'轻薄不规则刘海'}};
    const photos=['front','back','left'].map((angle,i)=>({id:'photo-'+i,stage:'before',angle,mime_type:'image/png',byte_size:80}));
    window.fixtureVersions=[
      {id:'v1',booking_id:'visit-new',booking_date:'2026-11-08',version_no:1,created_at:'2026-11-08T02:00:00Z',status:'baseline',source:'manual',author:'合成员工甲',baseline,optimized:{},reasons:{},photos},
      {id:'v2',booking_id:'visit-new',booking_date:'2026-11-08',version_no:2,created_at:'2026-11-08T03:00:00Z',status:'confirmed',source:'chatgpt',author:{name:'合成员工乙'},baseline,optimized,reasons:{outline:'减少横向体积',bangs:'增加轻柔的变化'},photos:[...photos,{id:'after-1',stage:'after',angle:'back'}]},
      {id:'old',booking_id:'visit-old',booking_date:'2026-08-01',version_no:1,created_at:'2026-08-01T03:00:00Z',status:'completed',source:'manual',author:'历史员工',baseline,optimized:{},reasons:{},photos:[]}
    ];
    window.calls=[];window.failMode='';window.serial=0;
    window.api=async(operation,payload)=>{
      window.calls.push({operation,payload:JSON.parse(JSON.stringify(payload))});
      if(operation==='customer_design_history') {
        const visit=window.fixtureVersions.filter(v=>payload.booking_id ? v.booking_id===payload.booking_id : !v.booking_id && v.booking_date===payload.booking_date);
        return {can_write:true,customer_profile_id:'fixture-customer',latest_version_id:visit.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]?.id || null,versions:window.fixtureVersions};
      }
      if(operation==='customer_design_photo_urls')return {assets:payload.asset_ids.map(id=>({id,url:'https://fixture.invalid/storage/v1/object/sign/customer-design/'+encodeURIComponent(id)+'?token=synthetic'}))};
      if(operation==='customer_design_upload') {
        if(window.failMode==='upload')throw new Error('模拟上传失败');
        return {asset:{id:'uploaded-'+(++window.serial),stage:payload.stage,angle:payload.angle,mime_type:payload.mime_type,byte_size:80}};
      }
      if(operation==='customer_design_save') {
        if(window.failMode==='save')throw new Error('模拟保存断线');
        if(window.failMode==='conflict')return {error:'另一个员工已保存',code:'version_conflict'};
        const version={id:'saved-'+(++window.serial),version_no:3,created_at:'2026-11-08T04:00:00Z',booking_id:payload.booking_id,booking_date:payload.booking_date,status:payload.status,baseline:payload.baseline,optimized:payload.optimized,reasons:payload.reasons,photos:payload.photo_ids.map(id=>({id,stage:'before',angle:'front'})),source:'manual',author:'当前员工'};
        window.fixtureVersions.push(version);return {saved:true,version,latest_version_id:version.id};
      }
      throw new Error('Unexpected operation '+operation);
    };
    window.options={phone:'13800000000',name:'合成客户',bookingId:'visit-new',bookingDate:'2026-11-08',barberName:'当前员工',scope:'store',...settings,api:window.api};
    window.handle=CustomerDesignArchive.mount(document.querySelector('#archive'),window.options);
  },overrides);
  await page.locator('.cda-history .cda-visit').first().waitFor();
  await page.waitForFunction(()=>!document.querySelector('.cda-header button').disabled);
  return page;
}
async function fill(page,group,key,value) {
  const field=page.locator('[data-group="'+group+'"][data-key="'+key+'"]');
  await field.evaluate(el=>{let p=el.parentElement;while(p){if(p.tagName==='DETAILS')p.open=true;p=p.parentElement;}});
  await field.fill(value);
}
async function file(page,name='original.png') {
  await page.locator('[data-upload="file"]').setInputFiles({name,mimeType:'image/png',buffer:pixel});
}
(async()=>{
  browser=await chromium.launch({...(process.platform==='darwin'?{channel:'chrome'}:{}),headless:true});
  for(const width of [320,390,768]) {
    const page=await boot(width);
    const first=page.locator('.cda-visit').first();
    await first.locator('.cda-version').first().locator('img').nth(2).waitFor();
    assert((await first.locator('.cda-version').first().innerText()).includes('第 2 版'),'latest revision first');
    assert.equal(await first.locator('.cda-version').first().locator('.cda-photo-group').first().locator('img').count(),3,'three before originals');
    assert((await first.innerText()).includes('完成照片'),'after photo is distinct');
    assert((await first.innerText()).includes('初始判断') && (await first.innerText()).includes('优化方案') && (await first.innerText()).includes('减少横向体积'),'baseline, optimization and reasons visible');
    assert.equal(await first.locator('.cda-version').first().locator('.cda-eight .cda-compare').count(),8,'eight steps');
    assert((await first.innerText()).includes('合成员工乙 · ChatGPT 协作'),'source and author visible');
    await first.locator('.cda-version').nth(1).locator('summary').click();
    assert((await first.innerText()).includes('合成员工甲 · 员工手动填写'),'old author/source preserved');
    await page.locator('.cda-visit').nth(1).locator('summary').first().click();
    await page.locator('.cda-visit').nth(1).locator('.cda-version summary').click();
    assert((await page.locator('.cda-history').innerText()).includes('历史员工'),'previous visit preserved');
    await first.locator('.cda-photo-open').first().click();
    assert.equal(await page.locator('.cda-viewer[open]').count(),1,'photos open at larger size');
    await page.locator('.cda-viewer button').click();
    await page.locator('[data-action="record"]').click();
    await fill(page,'baseline','person','可手动输入的现场条件');
    assert(await page.evaluate(()=>window.handle.hasUnsavedChanges()),'dirty handle exposed');
    const layout=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,root:document.querySelector('.cda').getBoundingClientRect().right}));
    assert(layout.document<=layout.viewport+1 && layout.root<=layout.viewport+1,'no horizontal overflow at '+width+'px');
    if(width===390)await page.screenshot({path:path.join(os.tmpdir(),'customer-design-archive-editor.png'),fullPage:true});
    await page.close();
  }
  // Manual employee record requires no ChatGPT; upload bytes are the original bytes.
  const page=await boot(390,{bookingId:null});
  await page.locator('[data-action="record"]').click();
  assert.equal(await page.locator('[data-meta="booking_date"]').getAttribute('readonly'),null,'manual visit date editable');
  await fill(page,'baseline','style','知性为主');
  await fill(page,'optimized','style','知性加柔美');
  await page.locator('.cda-save-row button').click();
  assert((await page.locator('.cda-draft-feedback').innerText()).includes('填写调整理由'),'changed decision requires reason');
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.operation==='customer_design_save').length),0);
  await fill(page,'reasons','style','顾客沟通后确认柔美细节');
  await file(page);
  assert.equal(await page.locator('.cda-editor .cda-photo').count(),1,'one file event adds exactly one original');
  await page.locator('.cda-save-row button').click();
  await page.waitForFunction(()=>window.calls.some(c=>c.operation==='customer_design_save'));
  await page.locator('[data-action="record"]').waitFor();
  const writes=await page.evaluate(()=>window.calls.filter(c=>c.operation==='customer_design_save'||c.operation==='customer_design_upload'));
  assert.equal(writes[0].payload.data_base64,pixel.toString('base64'),'upload preserves original file bytes');
  assert.equal(writes[1].payload.expected_latest_version_id,null,'a new manual visit does not continue another appointment');
  assert.equal(writes[1].payload.baseline.steps.style,'知性为主');
  assert.equal(writes[1].payload.optimized.steps.style,'知性加柔美');
  assert.equal(writes[1].payload.reasons.style,'顾客沟通后确认柔美细节');
  assert.equal(await page.locator('.cda-version').count(),4,'append keeps all older versions');
  assert.equal(await page.evaluate(()=>window.handle.hasUnsavedChanges()),false);
  await page.close();
  // Upload/save failures retain fields and files, never automatically retry writes.
  for(const failure of ['upload','save','conflict']) {
    const failed=await boot(390,{bookingId:null});
    await failed.locator('[data-action="record"]').click();
    await fill(failed,'baseline','style','失败后应保留的草稿');await file(failed,'retained.png');
    await failed.evaluate(value=>{window.failMode=value;},failure);
    await failed.locator('.cda-save-row button').click();
    await failed.waitForFunction(()=>document.querySelector('.cda-draft-feedback').textContent.includes('草稿和所选照片已保留'));
    assert.equal(await failed.locator('[data-group="baseline"][data-key="style"]').inputValue(),'失败后应保留的草稿');
    assert.equal(await failed.locator('.cda-editor .cda-photo').count(),1,'failed '+failure+' keeps original');
    const count=await failed.evaluate(()=>window.calls.filter(c=>c.operation==='customer_design_save'||c.operation==='customer_design_upload').length);
    await failed.waitForTimeout(100);
    assert.equal(await failed.evaluate(()=>window.calls.filter(c=>c.operation==='customer_design_save'||c.operation==='customer_design_upload').length),count,'no automatic write retries');
    if(failure==='conflict') {
      assert(await failed.locator('.cda-save-row button').isDisabled());
      await failed.locator('[data-action="resolve"]').click();
      assert(await failed.locator('.cda-save-row button').isDisabled(),'must read latest first');
      await failed.locator('[data-action="refresh"]').last().click();
      await failed.waitForFunction(()=>window.calls.filter(c=>c.operation==='customer_design_history').length===2);
      await failed.waitForTimeout(30);
      await failed.locator('[data-action="resolve"]').click();
      assert(!(await failed.locator('.cda-save-row button').isDisabled()),'explicit reviewed resolution allows later save');
      assert.equal(await failed.locator('[data-group="baseline"][data-key="style"]').inputValue(),'失败后应保留的草稿');
    }
    await failed.evaluate(()=>window.handle.destroy());
    assert.equal(await failed.locator('.cda').count(),0,'destroy removes module');
    await failed.close();
  }
  // Injected text and arbitrary URLs cannot become markup, links, or image sources.
  const xss=await boot(320);
  await xss.evaluate(()=>{
    window.handle.destroy();window.pwned=false;
    window.fixtureVersions[1].baseline.steps.style='<img src=x onerror="window.pwned=true">';
    window.fixtureVersions[1].author={name:'<script>window.pwned=true</script>'};
    window.fixtureVersions[1].archive_url='javascript:alert(1)';
    window.fixtureVersions[1].photos=[{id:'unsafe',stage:'before',angle:'front',local_url:'https://attacker.invalid/track'}];
    const oldApi=window.api;window.options.api=(op,payload)=>op==='customer_design_photo_urls'?Promise.resolve({assets:[{id:'unsafe',url:'https://attacker.invalid/image.png'}]}):oldApi(op,payload);
    window.handle=CustomerDesignArchive.mount(document.querySelector('#archive'),window.options);
  });
  await xss.waitForFunction(()=>document.querySelector('.cda-eight')?.textContent.includes('<img'));
  assert.equal(await xss.evaluate(()=>window.pwned),false);
  assert.equal(await xss.locator('.cda-link,.cda img').count(),0,'untrusted link and image URL blocked');
  assert(!(await xss.locator('#archive').innerHTML()).includes('13800000000'),'phone never in DOM');
  await xss.close();
  console.log('customer design archive browser tests passed: responsive compare/photos/history, manual append, original bytes, failures/conflict, XSS');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
