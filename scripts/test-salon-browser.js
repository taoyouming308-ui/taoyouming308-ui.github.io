/* Local synthetic-data browser acceptance; blocks external traffic and never touches production. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const expectedModules = ['经营桌面','顾客会员','预约排客','开单收银','服务现场','项目商品','库存管理','员工组织','业绩工资','财务报表','作品评价','营销顾客端','系统设置'];
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, bytes) => {
    if (error) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    res.end(bytes);
  });
});

let browser;
async function verifyViewport(origin, width) {
  const mobile = width === 390;
  const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin + '/salon-app.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  assert.deepEqual(await page.locator('#nav button').allTextContents(), expectedModules);
  for (const name of expectedModules) {
    await page.getByRole('button', { name, exact: true }).click();
    assert.equal(await page.locator('#title').textContent(), name, name + ' navigation title');
    assert.equal(await page.locator('#nav button.on').textContent(), name, name + ' active navigation');
    assert.ok(await page.locator('#workspace').innerText(), name + ' must render content');
    if (mobile) {
      const geometry = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
        controls: [...document.querySelectorAll('#workspace button, #workspace input:not([type="checkbox"]):not([type="radio"]), #workspace select')].filter(el => {
          const style = getComputedStyle(el), box = el.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0;
        }).map(el => ({ tag: el.tagName, height: el.getBoundingClientRect().height, right: el.getBoundingClientRect().right }))
      }));
      assert.ok(geometry.doc <= geometry.viewport + 1, name + ' must not cause page-level horizontal overflow');
      const undersized = geometry.controls.filter(x => x.height < 40);
      assert.ok(!undersized.length, name + ' controls must be touch-sized: ' + JSON.stringify(undersized));
      assert.ok(geometry.controls.every(x => x.right <= geometry.viewport + 1), name + ' controls must remain in viewport');
    }
  }

  await page.getByRole('button', { name: '顾客会员', exact: true }).click();
  await page.locator('#customer-form input[name="name"]').fill('离线验收顾客');
  await page.locator('#customer-form input[name="phone"]').fill('13800000000');
  await page.locator('#customer-form button[type="submit"]').click();
  await page.getByText('顾客档案已保存到离线测试数据').waitFor();
  assert.equal(await page.locator('.customer-row').count(), 1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('salon-core-offline-v1')).customers.length), 1);

  await page.getByRole('button', { name: '服务现场', exact: true }).click();
  await page.locator('#service-create input[name="customerName"]').fill('离线验收顾客');
  await page.locator('#service-create input[name="staffName"]').fill('手艺人甲');
  await page.locator('#service-create input[name="service"]').fill('剪发');
  await page.locator('#service-create button').click();
  await page.getByRole('button', { name: '开始服务', exact: true }).click();
  await page.getByRole('button', { name: '完成并创建回访任务', exact: true }).click();
  assert.match(await page.locator('#service-list').innerText(), /completed/);
  assert.match(await page.locator('#service-list').innerText(), /已创建回访任务/);

  assert.deepEqual(errors, []);
  console.log('salon browser passed: ' + width + 'px, 13 modules, touch layout, customer write, service lifecycle');
  await page.close();
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await verifyViewport(origin, 1280);
  await verifyViewport(origin, 390);
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
