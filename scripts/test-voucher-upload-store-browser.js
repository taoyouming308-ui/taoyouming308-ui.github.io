const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  fs.readFile(file, (error, bytes) => {
    if (error) return response.writeHead(404).end();
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
    response.setHeader('Content-Type', type[path.extname(file)] || 'application/octet-stream');
    response.end(bytes);
  });
});

const store = '向里造型';
const otherStore = '自由手艺人';
const uploadOps = ['voucher_upload', 'petty_cash_batch_upload', 'history_import_evidence_upload',
  'history_ledger_evidence_upload', 'history_monthly_attachment_upload'];
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 820 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/operations.html?preview=1&role=finance&store=' + encodeURIComponent(store));
    await page.waitForFunction(() => !!state.user);
    await page.evaluate(({ store, otherStore }) => {
      state.user.stores = [store, otherStore];
      document.getElementById('store-select').replaceChildren(new Option(store, store), new Option(otherStore, otherStore));
      window.uploadCalls = [];
      const originalFetch = window.fetch;
      window.fetch = function (url, options) {
        if (url !== API) return originalFetch(url, options);
        uploadCalls.push(JSON.parse(options.body));
        if (window.uploadDenied) {
          return Promise.resolve(new Response('{"error":"登录已过期","code":"AUTH_SESSION_INVALID"}', { status: 401 }));
        }
        return Promise.resolve(new Response('{"saved":true}', { status: 200 }));
      };
      window.startUploads = jobs => {
        window.uploadResults = Promise.all(jobs.map(([op, name]) => api(op, {
          store, filename: name, base64: 'ZmFrZQ==', source_store: otherStore
        }).then(() => 'saved', error => error.code)));
      };
    }, { store, otherStore });

    const dialog = page.locator('#upload-source-store-dialog');
    const select = dialog.locator('#upload-source-store-select');
    const confirm = dialog.getByRole('button', { name: '确认上传' });
    const cancel = dialog.getByRole('button', { name: '取消', exact: true });
    const calls = () => page.evaluate(() => uploadCalls);
    async function chooseMatching(filename) {
      await dialog.waitFor();
      assert.match(await dialog.innerText(), new RegExp(filename));
      assert.match(await dialog.innerText(), /向里造型/);
      assert.equal(await select.inputValue(), '');
      assert.equal(await confirm.isEnabled(), false);
      await select.selectOption(store);
      await confirm.click();
    }
    await page.evaluate(() => startUploads([['voucher_upload', '错店.jpg']]));
    await dialog.waitFor();
    assert.equal(await select.inputValue(), '');
    await select.selectOption(otherStore);
    assert.match(await dialog.innerText(), /不一致/);
    assert.equal(await confirm.isEnabled(), false);
    assert.equal((await calls()).length, 0);
    await cancel.click();
    assert.deepEqual(await page.evaluate(() => uploadResults), ['UPLOAD_SOURCE_NOT_CONFIRMED']);
    assert.equal((await calls()).length, 0);

    await page.evaluate(ops => startUploads(ops.map((op, index) => [op, '文件' + index + '.jpg'])), uploadOps);
    for (const [index, operation] of uploadOps.entries()) {
      await chooseMatching('文件' + index + '[.]jpg');
      await page.waitForFunction(op => uploadCalls.some(call => call.operation === op), operation);
      assert.equal((await calls()).length, index + 1, 'the next file must wait for its own selection');
    }
    assert.deepEqual(await page.evaluate(() => uploadResults), uploadOps.map(() => 'saved'));
    for (const request of await calls()) {
      assert.equal(request.source_store, store);
      assert.equal(request.store, store);
    }

    await page.evaluate(() => startUploads([['voucher_upload', '旧账号.jpg']]));
    await dialog.waitFor();
    await select.selectOption(store);
    await page.evaluate(() => { state.user = { ...state.user }; });
    await confirm.click();
    assert.deepEqual(await page.evaluate(() => uploadResults), ['UPLOAD_SOURCE_NOT_CONFIRMED']);
    assert.equal((await calls()).length, uploadOps.length);

    // A pending auth refresh must never authorize a saved choice for a new session.
    await page.evaluate(() => {
      state.auth = {};
      authBridge.ensureFresh = () => new Promise(resolve => { window.resumeUploadAuth = resolve; });
      startUploads([['voucher_upload', '旧会话.jpg']]);
    });
    await chooseMatching('旧会话[.]jpg');
    await page.waitForFunction(() => !!window.resumeUploadAuth);
    await page.evaluate(() => { state.session = 'new-synthetic-session'; window.resumeUploadAuth({ stale: true }); });
    assert.deepEqual(await page.evaluate(() => uploadResults), ['UPLOAD_SOURCE_NOT_CONFIRMED']);
    assert.equal((await calls()).length, uploadOps.length);
    assert.equal(await page.evaluate(() => Boolean(state.auth.stale)), false);

    // When auth is denied the upload is not replayed.
    await page.evaluate(() => {
      authBridge.ensureFresh = () => Promise.resolve(null);
      authBridge.forceRefresh = () => { window.replayed = true; return Promise.resolve(null); };
      window.uploadDenied = true;
      startUploads([['voucher_upload', '授权失败.jpg']]);
    });
    await chooseMatching('授权失败[.]jpg');
    assert.deepEqual(await page.evaluate(() => uploadResults), ['AUTH_SESSION_INVALID']);
    assert.equal((await calls()).length, uploadOps.length + 1);
    assert.equal(await page.evaluate(() => Boolean(window.replayed)), false);

    // Daily/report forms have their own pre-upload choice, so the common API checks it without another dialog.
    await page.evaluate(() => { window.uploadDenied = false; state.auth = null; });
    assert.deepEqual(await page.evaluate(store => api('report_upload_auto', { store, source_store: store, base64: 'ZmFrZQ==' }), store), { saved: true });
    await assert.rejects(page.evaluate(({store, otherStore}) => api('daily_sheet_attachment_upload', {
      store, source_store: otherStore, base64: 'ZmFrZQ=='
    }), {store, otherStore}), /文件未上传/);
    assert.equal((await calls()).length, uploadOps.length + 2);
    assert.deepEqual(await page.evaluate(store => api('report_upload', { store, report_type: 'salary', base64: 'ZmFrZQ==' }), store), { saved: true });
    assert.deepEqual(await page.evaluate(() => api('monthly_cell_save', { amount: 42 })), { saved: true });
    assert.equal(await dialog.count(), 0);
    assert.equal((await calls()).at(-1).amount, 42);
    await page.close();
  }
  console.log('Voucher uploads (390/1280): no defaults, wrong-store rejection, per-file queue and proof, stale-account cancellation, ordinary edits bypass chooser.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
