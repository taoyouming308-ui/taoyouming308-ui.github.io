// Synthetic DOM only: no real account, API or business writes.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const html = fs.readFileSync('operations.html', 'utf8');
const get = name => {
  const line = html.split('\n').find(line => new RegExp('^\\s*function '+name+'\\(').test(line));
  assert.ok(line, name); return line;
};
let browser;
(async () => {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="daily-detail-grid"><table><tbody id="rows"></tbody></table></div>');
  await page.evaluate(code => {
    window.state = { imports: { sheet: { permissions: { write: true } }, dirty: {}, dirtyLabels: {} } };
    window.$ = id => document.getElementById(id);
    window.esc = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    window.syncDailyAmountDisplay = () => {};
    window.renderDailyDetailControls = () => {};
    (0, eval)(code);
  }, ['dailyLabelCell','bindDailyDetailInputs','collectDailySheetCells'].map(get).join('\n'));
  const result = await page.evaluate(() => {
    const rows = [
      ['stylist','stylist_1','哈维'], ['technician','technician_1','哈维'],
      ['stylist','stylist_category_total','小计'], ['technician','technician_category_total','小计'],
      ['stylist','company','公司'], ['product','product_1','产品'], ['payment','payment','支付']
    ];
    document.getElementById('rows').innerHTML = rows.map(([section,key,label]) => '<tr>'+dailyLabelCell({section,key,label,cells:{}})+'</tr>').join('');
    bindDailyDetailInputs();
    const inputs = [...document.querySelectorAll('[data-row-label-input]')];
    const attributes = inputs.map(input => ['autocomplete','autocorrect','spellcheck','autocapitalize'].map(name => input.getAttribute(name)));
    for (const input of inputs.slice(0,2)) {
      input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
      input.value='哈'; input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'哈',isComposing:true}));
      input.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'哈维'}));
      input.value='哈维'; input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'维',isComposing:true}));
      input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'哈维'}));
      input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'哈维'}));
      input.blur();
    }
    return { attributes, values: inputs.slice(0,2).map(input=>input.value), cells:collectDailySheetCells(document.getElementById('daily-detail-grid')),dirty:state.imports.dirty };
  });
  assert.deepEqual(result.attributes.slice(0,2),Array(2).fill(['off','off','false','off']));
  assert.ok(result.attributes.slice(2).every(attrs=>attrs.every(value=>value===null)), 'totals and other sections unchanged');
  assert.deepEqual(result.values,['哈维','哈维']);
  assert.deepEqual(result.cells,[{id:null,section_code:'stylist',row_key:'stylist_1',row_label:'哈维'},{id:null,section_code:'technician',row_key:'technician_1',row_label:'哈维'}]);
  assert.deepEqual(result.dirty,{});
  console.log('daily name input: scope, synthetic composition, 哈维 and actual serialization passed; OS candidate not simulated');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
