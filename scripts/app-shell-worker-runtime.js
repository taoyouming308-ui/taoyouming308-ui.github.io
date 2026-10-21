/* SHELL is generated from the explicit public-file allowlist; never cache runtime fetches. */
'use strict';
const ROOT = new URL('./', self.location.href);
const CACHE = 'zysyr-public-shell-' + SHELL.version + '-' + SHELL.id;
const FILES = new Map(SHELL.files.map(file => [new URL(file.path, ROOT).pathname, file]));
const keyFor = file => new URL(file.path, ROOT).href;
const COMPLETE = new URL('__zysyr_public_shell_complete__', ROOT).href;
async function verifiedDownload(file) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(keyFor(file), { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: abort.signal });
    if (response.status !== 200 || response.type === 'opaque' || response.redirected) throw new Error('Static response unavailable');
    const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim();
    if (!file.types.includes(mime)) throw new Error('Static content type mismatch');
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== file.sha256) throw new Error('Static release hash mismatch');
    // Only immutable public bytes plus a tiny safe header set; never persist response cookies.
    return new Response(bytes, { status: 200, headers: { 'Content-Type': mime, 'X-Zysyr-Shell': String(SHELL.version), 'Cache-Control': 'no-store' } });
  } finally { clearTimeout(timer); }
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // A completed newer shell is a durable version floor until browser storage is cleared.
    for (const name of await caches.keys()) {
      if (!name.startsWith('zysyr-public-shell-')) continue;
      const completed = await (await caches.open(name)).match(COMPLETE);
      if (completed && Number(await completed.text()) > SHELL.version) throw new Error('Static shell downgrade refused');
    }
    const cache = await caches.open(CACHE);
    const alreadyComplete = !!(await cache.match(COMPLETE));
    if (alreadyComplete && (await Promise.all(SHELL.files.map(file => cache.match(keyFor(file))))).every(Boolean)) return;
    try {
      // Bounded concurrency; a partial release can never become an active worker.
      let next = 0;
      const downloads = await Promise.allSettled(Array.from({ length: 3 }, async () => {
        while (next < SHELL.files.length) {
          const file = SHELL.files[next++];
          await cache.put(keyFor(file), await verifiedDownload(file));
        }
      }));
      if (downloads.some(result => result.status === 'rejected')) throw new Error('Incomplete static release');
      await cache.put(COMPLETE, new Response(String(SHELL.version), { headers: { 'Content-Type': 'text/plain' } }));
    } catch (error) {
      // All downloads settled before deleting only this incomplete release.
      if (!alreadyComplete) await caches.delete(CACHE);
      throw error;
    }
  })());
});
// Natural activation only. Retain the previous complete shell, not unrelated caches.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const complete = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('zysyr-public-shell-') || name === CACHE) continue;
      if (await (await caches.open(name)).match(COMPLETE)) complete.push(name);
      else await caches.delete(name); // abandoned partial install after process termination
    }
    await Promise.all(complete.slice(0, -1).map(name => caches.delete(name)));
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization') || request.headers.has('Range')) return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin) return;
  const file = FILES.get(url.pathname);
  if (!file) return; // Includes all APIs, auth, private downloads, version.txt and unknown assets.
  const html = file.path.endsWith('.html');
  // Query values are never cache keys or stored. HTML parameters remain in the page URL for existing scope logic.
  event.respondWith((async () => {
    // Root scope also covers admin/academy. Never reinterpret their shared asset versions.
    if (request.mode !== 'navigate') {
      const client = event.clientId ? await self.clients.get(event.clientId) : null;
      const owner = client && FILES.get(new URL(client.url).pathname);
      if (!owner || !owner.path.endsWith('.html')) return fetch(request);
    }
    if (!html && Array.from(url.searchParams.keys()).some(k => k !== 'v')) return new Response('Unrecognized static query', { status: 409 });
    if (!html && url.searchParams.has('v') && !file.versions.includes(url.searchParams.get('v'))) {
      return new Response('Static version mismatch. Save work and close all app pages before updating.', { status: 409 });
    }
    const cache = await caches.open(CACHE);
    const hit = await cache.match(keyFor(file));
    if (hit) return hit;
    try {
      // Eviction recovery must still match this exact release, never mix with latest network bytes.
      const response = await verifiedDownload(file);
      await cache.put(keyFor(file), response.clone());
      return response;
    } catch (_) {
      return new Response('界面资源暂不可用。请联网后重试；未执行任何业务保存。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
