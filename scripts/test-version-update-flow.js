#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

function fail(message) {
  console.error('VERSION UPDATE FLOW TEST FAILED: ' + message);
  process.exit(1);
}

const html = fs.readFileSync('perm-app.html', 'utf8');
const marker = html.indexOf('<!-- 版本更新提示 -->');
const scriptStart = html.indexOf('<script>', marker);
const scriptEnd = html.indexOf('</script>', scriptStart);
if (marker < 0 || scriptStart < 0 || scriptEnd < 0) fail('version update script not found');
const source = html.slice(scriptStart + '<script>'.length, scriptEnd);

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); },
  };
}

function response(version) {
  return {
    ok: true,
    status: 200,
    text: async () => '<!doctype html><html data-version="' + version + '"></html>',
  };
}

function createScenario(currentVersion, storedVersion, serverVersion, search) {
  const bannerAttrs = new Map();
  const banner = {
    style: { display: 'none' },
    textContent: '',
    onclick: null,
    getAttribute(name) { return bannerAttrs.get(name) || null; },
    setAttribute(name, value) { bannerAttrs.set(name, String(value)); },
    removeAttribute(name) { bannerAttrs.delete(name); },
  };
  const local = storage({ 'app-version': String(storedVersion), 'app-max-version': String(storedVersion) });
  const fetches = [];
  const replacements = [];
  let unregisters = 0;
  const fakeFetch = async (url, options) => {
    fetches.push({ url: String(url), options: options || {} });
    return response(serverVersion);
  };
  class FakeXHR {
    open() {}
    send() {
      this.status = 200;
      this.responseText = String(serverVersion);
      setImmediate(() => this.onload());
    }
  }
  const context = {
    Promise,
    URLSearchParams,
    XMLHttpRequest: FakeXHR,
    console: { info() {}, warn() {} },
    document: {
      documentElement: { getAttribute: () => String(currentVersion) },
      getElementById: (id) => id === 'update-banner' ? banner : null,
      createElement: () => ({ style: {}, parentNode: { removeChild() {} } }),
      body: { appendChild() {} },
    },
    fetch: fakeFetch,
    window: { fetch: fakeFetch },
    navigator: {
      serviceWorker: {
        getRegistrations: async () => [{ unregister: async () => { unregisters += 1; return true; } }],
      },
    },
    location: {
      search: search || '',
      hash: '',
      pathname: '/perm-app.html',
      replace: (url) => replacements.push(String(url)),
    },
    localStorage: local,
    sessionStorage: storage(),
    setTimeout() {},
    setImmediate,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { banner, fetches, replacements, local, getUnregisters: () => unregisters };
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await new Promise(setImmediate);
}

(async () => {
  const oldPage = createScenario(401, 401, 402, '');
  await settle();
  if (!oldPage.banner.textContent.includes('v402')) fail('old page did not offer v402 update');
  if (oldPage.local.value('app-version') !== '401') fail('old page marked v402 installed before user update');
  oldPage.banner.onclick();
  await settle();
  if (oldPage.local.value('app-version') !== '401') fail('update click marked v402 installed before new document loaded');
  if (!oldPage.fetches.some((item) => item.url.includes('_v=402') && item.options.cache === 'reload')) {
    fail('update click did not reload-fetch the v402 document');
  }
  if (!oldPage.replacements.some((url) => url.includes('_v=402'))) fail('verified update did not navigate to v402');
  if (oldPage.getUnregisters() < 1) fail('update did not unregister old service worker control');

  const newPage = createScenario(402, 401, 402, '?_v=402&_t=test');
  await settle();
  if (newPage.local.value('app-version') !== '402') fail('loaded v402 page did not record successful update');
  if (!newPage.fetches.some((item) => item.url === '/perm-app.html' && item.options.cache === 'reload')) {
    fail('loaded v402 page did not refresh canonical entry cache');
  }

  console.log('version update flow test ok: verify-before-install and canonical-cache refresh');
})().catch((error) => fail(error.message));
