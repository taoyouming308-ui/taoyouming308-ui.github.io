// Exercise the real navigation/visibility handlers with deterministic timers, no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../perm-app.html'), 'utf8');
function source(from, to) {
  const start = html.indexOf(from), end = html.indexOf(to, start);
  assert(start >= 0 && end > start, from);
  return html.slice(start, end);
}
const elements = new Map();
for (const id of ['home-page', 'app-content', 'tab-bookings', 'tab-showcase']) {
  const classes = new Set();
  elements.set(id, { style: {display: id === 'app-content' ? 'none' : 'block'}, classList: {
    contains: s => classes.has(s), add: s => classes.add(s), remove: s => classes.delete(s)
  }});
}
const timers = new Map(), listeners = {}, sessionWaiters = [];
let id = 0, galleryReads = 0, bookingReads = 0, bookingMemoryViews = 0;
const c = vm.createContext({
  document: { hidden: false, getElementById: key => elements.get(key), body: {classList: {toggle(){}, remove(){}}},
    querySelectorAll: () => [elements.get('tab-showcase'), elements.get('tab-bookings')],
    addEventListener: (event, fn) => { listeners[event] = fn; } },
  window: {}, sessionStorage: {setItem(){},removeItem(){}}, BOOKING_INTERVAL: null, bookingReadGeneration: 0,
  setInterval: fn => { timers.set(++id, fn); return id; }, clearInterval: key => timers.delete(key),
  renderDateStrip(){}, showBookingHistory(){bookingMemoryViews++;}, checkIdentity: () => new Promise(resolve => sessionWaiters.push(resolve)),
  loadShowcase: () => galleryReads++, loadBookings: () => bookingReads++
});
vm.runInContext(source('    function isForegroundFeature(', '    </script>'), c);
vm.runInContext(source('  window.openFeature = function(tabName)', '  window.closeHairAnalysisModal'), c);
vm.runInContext(source('  var _origOpenFeature =', '  // === Toast ==='), c);
function tick() { [...timers.values()].forEach(fn => fn()); }
function visibility(hidden) { c.document.hidden = hidden; listeners.visibilitychange(); }
const settle = () => new Promise(r => setImmediate(r));
(async () => {
  assert(!source('function initApp()', '  // === 导航 ===').includes('loadShowcase'), 'no 100-row gallery prefetch on boot');
  visibility(false); tick(); assert.equal(galleryReads, 0, 'home is not gallery');
  c.window.openFeature('showcase'); assert.equal(galleryReads, 1); tick(); assert.equal(galleryReads, 2);
  visibility(true); tick(); assert.equal(galleryReads, 2); visibility(false); assert.equal(galleryReads, 3);
  c.window.goHome(); visibility(true); visibility(false); tick();
  assert.equal(galleryReads, 3, 'home does not resume an invisible active tab'); assert.equal(timers.size, 0);
  c.window.openFeature('bookings'); assert.equal(bookingReads, 0, 'wait for verified identity');
  assert.equal(bookingMemoryViews,1,'same verified scope may be painted before the background read');
  c.window.goHome(); sessionWaiters.shift()(true); await settle(); tick();
  assert.equal(bookingReads, 0, 'late verification on home does not fetch bookings');
  c.window.openFeature('bookings'); sessionWaiters.shift()(true); await settle(); assert.equal(bookingReads, 1);
  visibility(true); tick(); assert.equal(bookingReads, 1);
  visibility(false); tick(); assert.equal(bookingReads, 2);
  elements.set('hair-analysis-modal', {}); tick(); assert.equal(bookingReads, 2);
  elements.delete('hair-analysis-modal'); tick(); assert.equal(bookingReads, 3);
  c.window.openFeature('showcase'); assert.equal(galleryReads, 4); tick(); assert.equal(bookingReads, 3);
  c.window.goHome(); tick(); assert.equal(timers.size, 0);
  console.log('PASS: on-demand gallery, home/hidden/modal polling suppressed, verified foreground reads and resume preserved');
})().catch(err => { console.error(err); process.exitCode = 1; });
