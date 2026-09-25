// Content changes should only remeasure the report table they affect.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const script = fs.readFileSync(path.join(__dirname, '..', 'operations-report-fit.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent('<main id="app"><section class="sheet-scroll" id="one"><table><tbody><tr><td id="cell">A</td></tr></tbody></table></section><section class="archive-wrap" id="two"><table><tbody><tr><td>B</td></tr></tbody></table></section></main>');
    await page.evaluate(() => {
      window.fitMeasurements = [];
      const original = window.getComputedStyle.bind(window);
      window.getComputedStyle = function (element) {
        if (element.matches && element.matches('.sheet-scroll,.daily-grid-scroll,.archive-wrap,.salary-paper-scroll,.history-grid-wrap')) {
          window.fitMeasurements.push(element.id);
        }
        return original(element);
      };
    });
    await page.addScriptTag({ content: script.toString() });
    async function waitForMeasurements(count) {
      // CI can delay requestAnimationFrame beyond 100 ms. Wait for the real
      // measurement event, then drain two frames before asserting exact scope.
      await page.waitForFunction(minimum => window.fitMeasurements.length >= minimum, count);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await waitForMeasurements(2);
    const baseline = await page.evaluate(() => window.fitMeasurements.slice().sort());
    assert.deepEqual(baseline, ['one', 'two']);

    await page.evaluate(() => { window.fitMeasurements.length = 0; document.getElementById('cell').textContent = 'A longer value'; });
    await waitForMeasurements(1);
    const afterCellChange = await page.evaluate(() => window.fitMeasurements.slice());
    assert.deepEqual(afterCellChange, ['one'], 'cell mutation must not remeasure unrelated report tables');

    await page.evaluate(() => { window.fitMeasurements.length = 0; document.getElementById('app').classList.toggle('hidden'); });
    await waitForMeasurements(2);
    const afterAncestorVisibility = await page.evaluate(() => window.fitMeasurements.slice().sort());
    assert.deepEqual(afterAncestorVisibility, ['one', 'two'], 'ancestor visibility changes must remeasure descendant report tables');

    console.log('Report fit targeted remeasurement: cell changes are scoped; ancestor visibility and initial layout remain comprehensive.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
