// Executes the actual hair-form loaders with synthetic DOM/transport only.
// No browser, production connection, real employee or customer data is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('perm-app.html', 'utf8');
function take(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.className = ''; this._html = ''; this._text = ''; this._value = ''; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; this._html = ''; }
  get innerHTML() { return this._html; }
  set innerHTML(value) {
    this._html = value; this._text = ''; this.children = [];
    if (this.tagName === 'select') {
      for (const m of value.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)) {
        const option = new Element('option'); option.value = m[1]; option.textContent = m[2]; this.appendChild(option);
      }
      this._value = '';
    }
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] || null; }
  get value() { return this._value; }
  set value(value) { this._value = this.tagName === 'select' && !this.options.some(o => o.value === value) ? '' : value; }
  get options() { return this.querySelectorAll('option'); }
  get classList() {
    return {
      add: name => { this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(name))].join(' '); },
      remove: name => { this.className = this.className.split(/\s+/).filter(x => x !== name).join(' '); },
      toggle: name => this.className.split(/\s+/).includes(name) ? this.classList.remove(name) : this.classList.add(name),
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }
  matches(selector) {
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.classList.contains(name));
    const attr = /^\[([^=]+)="([^"]+)"\]$/.exec(selector);
    return attr ? this.getAttribute(attr[1]) === attr[2] : this.tagName === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => (child.matches(selector) ? [child] : []).concat(child.querySelectorAll(selector)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const goodRows = (store = 'STORE-A') => [
  {username: 'STYLIST-A', store, position: '发型师', active: true, employment_status: 'active'},
  {username: 'STYLIST-B', store, position: '发型师', active: true, employment_status: 'active'},
  {username: 'TECH-A', store, position: '助理', active: true, employment_status: 'active'},
  {username: 'TECH-B', store, position: '技师', active: true, employment_status: 'active'},
];
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  let now = 0;
  const nodes = {}, staffReads = [], bookingReads = [], values = new Map(), events = new Map();
  const parent = new Element(), barber = new Element('select'), tech = new Element(), picker = new Element();
  barber.innerHTML = '<option value="STYLIST-A">STYLIST-A</option><option value="STYLIST-B">STYLIST-B</option>';
  barber.value = 'STYLIST-A'; parent.appendChild(barber);
  nodes['hair-form-barber'] = barber; nodes['hair-form-tech-container'] = tech; nodes['hair-booking-picker-list'] = picker;
  const c = {
    window: {addEventListener: (name, callback) => events.set(name, callback)},
    document: {getElementById: id => nodes[id] || null, createElement: tag => new Element(tag)},
    localStorage: {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)},
    Date: {now: () => now}, SUPABASE_URL: 'https://example.invalid', SUPABASE_KEY: 'SYNTHETIC',
    AUTHENTICATED_STAFF: {username: 'STYLIST-A', store: 'STORE-A', position: '发型师', session_token: 'TOKEN-A'},
    BOOKING_BARBER: 'STYLIST-A', _editingHairId: null, _cloudEditingId: null, _cloudRecordData: null,
    hairPickerReadGeneration: 0, getLocalDateStr: () => '2026-11-17', esc: String, escAttr: String,
    employeeReadJson: (url, options) => new Promise((resolve, reject) => staffReads.push({url, options, resolve, reject})),
    employeeBookingsApi: (operation, payload) => { assert.equal(operation, 'today_bookings'); return new Promise((resolve, reject) => bookingReads.push({payload, resolve, reject})); },
    verifiedEmployeeSession: () => c.AUTHENTICATED_STAFF,
    isEmployeeSessionInvalid: error => error.status === 403,
    clearBookingSession: () => { c.AUTHENTICATED_STAFF = null; c.sessionClears++; },
    showIdentityModal: () => { c.identityPrompts++; }, checkIdentity: async () => !!c.AUTHENTICATED_STAFF,
    sessionClears: 0, identityPrompts: 0,
  };
  vm.createContext(c);
  vm.runInContext(take('  function recordTechValueFromFields(', '  var _editingHairId ='), c);
  vm.runInContext(take('  window.loadHairBookingPickerDate =', '  window.pickBookingCustomerFromNode'), c);
  const chip = (name, selected = true) => {
    const element = new Element('span'); element.className = 'chip' + (selected ? ' active' : ''); element.setAttribute('data-value', name); element.textContent = name; tech.appendChild(element); return element;
  };
  return {c, nodes, parent, barber, tech, picker, staffReads, bookingReads, chip, events, values, tick: ms => {now += ms;}};
}
const active = box => box.querySelectorAll('.chip.active').map(chip => chip.getAttribute('data-value'));
const status = (box, kind) => box.querySelector('[data-hair-staff-status="' + kind + '"]');
const retry = box => box.querySelector('button');
(async () => {
  {
    const x = setup(); x.chip('TECH-A');
    x.c.window.populateHairBarberSelect('STYLIST-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    assert.equal(x.staffReads.length, 1, 'barber and assistant share one directory request');
    assert.match(x.staffReads[0].url, /store=eq\.STORE-A/); assert.match(x.staffReads[0].url, /employment_status=eq\.active/);
    x.staffReads[0].resolve(goodRows()); await flush();
    assert.equal(x.barber.value, 'STYLIST-A'); assert.deepEqual(active(x.tech), ['TECH-A']);
    x.c.window.populateHairBarberSelect('STYLIST-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true); await flush();
    assert.equal(x.staffReads.length, 1, 'short-lived memory result reused, not a new request');
    x.tick(60001); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true); assert.equal(x.staffReads.length, 2);
    x.staffReads[1].reject(Object.assign(Error('timeout'), {code: 'READ_TIMEOUT'})); await flush();
    assert.deepEqual(active(x.tech), ['TECH-A'], 'timeout keeps chosen technician');
    assert.match(status(x.tech, 'assistant').textContent, /暂不可用.*保留/); assert.equal(retry(x.tech).textContent, '重试');
    retry(x.tech).onclick(); assert.equal(x.staffReads.length, 3, 'explicit retry starts a fresh request');
    x.staffReads[2].resolve(goodRows()); await flush(); assert.deepEqual(active(x.tech), ['TECH-A']);
    assert.equal(x.values.size, 0, 'staff data never persisted');
  }
  for (const invalid of [{error: 'HTTP failure'}, [{...goodRows()[0], store: 'OTHER-STORE'}], [{...goodRows()[0], active: false}]]) {
    const x = setup(); x.chip('HISTORICAL-TECH'); x.c.window.populateHairBarberSelect('STYLIST-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    x.staffReads[0].resolve(invalid); await flush();
    assert.ok(retry(x.parent)); assert.ok(retry(x.tech)); assert.deepEqual(active(x.tech), ['HISTORICAL-TECH']);
    assert.equal(x.staffReads.length, 1, 'bad data cannot trigger an all-store fallback');
  }
  for (const clicked of ['barber', 'assistant']) {
    const x = setup(); x.chip('TECH-A');
    x.c.window.populateHairBarberSelect('STYLIST-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    x.staffReads[0].reject(Object.assign(Error('timeout'), {code: 'READ_TIMEOUT'})); await flush();
    assert.ok(retry(x.parent)); assert.ok(retry(x.tech));
    assert.match(status(x.parent, 'barber').style.cssText, /grid-column:1 \/ -1/, 'status spans both actual CSS grid columns');
    // Manual choices after failure must be the retry's source of truth.
    x.barber.value = 'STYLIST-B'; x.tech.querySelector('.chip.active').classList.remove('active'); x.chip('TECH-B');
    retry(clicked === 'barber' ? x.parent : x.tech).onclick();
    assert.equal(x.staffReads.length, 2, 'either retry refreshes both controls in one shared read');
    x.staffReads[1].resolve(goodRows()); await flush();
    assert.equal(x.barber.value, 'STYLIST-B'); assert.deepEqual(active(x.tech), ['TECH-B']);
    assert.equal(status(x.parent, 'barber').textContent, ''); assert.equal(status(x.tech, 'assistant').textContent, '');
    assert.equal(retry(x.parent), null); assert.equal(retry(x.tech), null);
  }
  {
    const x = setup(); x.c.AUTHENTICATED_STAFF.username = 'TECH-A'; x.c.AUTHENTICATED_STAFF.position = '助理';
    x.c._editingHairId = 'LEGACY-WITHOUT-BARBER'; x.c._cloudEditingId = 'CLOUD-LEGACY';
    const fallback = new Element('option'); fallback.value = 'TECH-A'; fallback.textContent = 'TECH-A'; x.barber.appendChild(fallback); x.barber.value = 'TECH-A';
    x.c.window.populateHairBarberSelect(''); x.staffReads[0].resolve(goodRows()); await flush();
    assert.equal(x.barber.value, '', 'missing historical barber never adopts the assistant login fallback');
    assert.equal(x.barber.options.some(o => /原填写值/.test(o.textContent)), false);
    assert.ok(source.includes("setVal('hair-form-barber', data.barber || (data.formFields && data.formFields['hair-form-barber']) || '')"), 'only explicit saved barber fields are restored');
  }
  {
    const x = setup(); x.c._editingHairId = 'RECORD-A'; x.chip('OLD-TECH'); x.c.window._pendingTechRestore = 'HISTORICAL-TECH';
    x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    assert.deepEqual(active(x.tech), ['HISTORICAL-TECH'], 'record restore applied before network completes');
    x.staffReads[0].resolve(goodRows()); await flush(); assert.deepEqual(active(x.tech), ['HISTORICAL-TECH']);
    assert.match(status(x.tech, 'assistant').textContent, /原档案助理已保留/);
    assert.equal(x.c.window._pendingTechRestore, null);
  }
  {
    const x = setup(); x.c.window._pendingTechRestore = 'PREVIOUS-CUSTOMER-TECH';
    x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true); x.staffReads[0].resolve(goodRows()); await flush();
    assert.deepEqual(active(x.tech), [], 'new blank form never consumes another record pending restore');
  }
  {
    const x = setup(); const chip = x.chip('TECH-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    chip.classList.remove('active'); x.staffReads[0].resolve(goodRows()); await flush();
    assert.deepEqual(active(x.tech), [], 'user deselection during read is not restored by a late response');
  }
  {
    const x = setup(); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    x.barber.value = 'STYLIST-B'; x.c.window.loadHairAssistantOptionsForBarber('STYLIST-B', false);
    x.c._editingHairId = 'DIFFERENT-RECORD'; x.c.hairStaffFormGeneration++; x.staffReads[0].resolve(goodRows()); await flush();
    assert.equal(x.tech.querySelectorAll('.chip').length, 0, 'old edit scope cannot populate new record');
  }
  for (const failed of [false, true]) {
    const x = setup(); x.chip('TECH-A');
    x.c.window.populateHairBarberSelect('STYLIST-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    // saveHairRecordLocal allocates a persistent ID but does not replace the form.
    x.c._editingHairId = 'NEWLY-SAVED-ID';
    x.c._cloudEditingId = 'NEWLY-SAVED-CLOUD-ID';
    if (failed) x.staffReads[0].reject(Object.assign(Error('timeout'), {code: 'READ_TIMEOUT'}));
    else x.staffReads[0].resolve(goodRows());
    await flush();
    if (failed) {
      assert.ok(retry(x.parent)); assert.ok(retry(x.tech), 'same form save cannot suppress failure recovery');
      retry(x.tech).onclick(); assert.equal(x.staffReads.length, 2); x.staffReads[1].resolve(goodRows()); await flush();
    }
    assert.equal(status(x.parent, 'barber').textContent, ''); assert.equal(status(x.tech, 'assistant').textContent, '');
    assert.deepEqual(active(x.tech), ['TECH-A'], 'same form save does not drop a successful directory response');
  }
  {
    const x = setup(); x.c._editingHairId = 'FIRST-RECORD';
    x.c.window.populateHairBarberSelect('STYLIST-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    // loadHairRecordData explicitly changes content, even when reusing the DOM.
    x.c.hairStaffFormGeneration++; x.c._editingHairId = 'SECOND-RECORD';
    x.c.window.populateHairBarberSelect('STYLIST-B'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-B', true);
    x.staffReads[0].resolve(goodRows()); await flush();
    assert.equal(x.barber.value, 'STYLIST-B'); assert.equal(status(x.parent, 'barber').textContent, '');
    assert.equal(status(x.tech, 'assistant').textContent, '');
    assert.match(take('  window.loadHairRecordData =', '    var openingBookingContext'), /hairStaffFormGeneration\+\+/);
    assert.match(take('  window.renderHairAnalysis =', '    \/\/ 重置云端编辑状态'), /hairStaffFormGeneration\+\+/);
  }
  {
    const x = setup(); x.c.window.populateHairBarberSelect('STYLIST-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    const oldTech = x.tech; x.nodes['hair-form-tech-container'] = new Element();
    x.c.AUTHENTICATED_STAFF = {username: 'STYLIST-B', store: 'STORE-B', position: '发型师', session_token: 'TOKEN-B'};
    x.events.get('staff-identity-changed')(); x.barber.value = 'STYLIST-B'; x.c.window.loadHairAssistantOptionsForBarber('STYLIST-B', true);
    assert.equal(x.staffReads.length, 2); assert.match(x.staffReads[1].url, /store=eq\.STORE-B/);
    x.staffReads[0].resolve(goodRows()); await flush(); assert.equal(oldTech.querySelectorAll('.chip').length, 0);
    x.staffReads[1].resolve(goodRows('STORE-B')); await flush(); assert.equal(x.nodes['hair-form-tech-container'].querySelectorAll('.chip').length, 2);
    assert.equal(x.barber.value, 'STYLIST-B', 'old account callback does not overwrite barber');
  }
  {
    const x = setup(); x.c.AUTHENTICATED_STAFF = null; x.c.window.populateHairBarberSelect('STYLIST-A'); x.c.window.loadHairAssistantOptionsForBarber('STYLIST-A', true);
    assert.equal(x.staffReads.length, 0); assert.match(status(x.tech, 'assistant').textContent, /恢复登录/); assert.ok(retry(x.tech));
  }
  {
    const x = setup(); x.c.window.loadHairBookingPickerDate('2026-11-17');
    x.bookingReads[0].reject(Object.assign(Error('timeout'), {code: 'READ_TIMEOUT'})); await flush();
    assert.match(x.picker.innerHTML, /超时.*保留/); assert.equal(x.c.sessionClears, 0); assert.ok(retry(x.picker));
    retry(x.picker).onclick(); assert.equal(x.bookingReads.length, 2);
    x.bookingReads[1].resolve({rows: [{id: 'SYNTHETIC-BOOKING', customer_name: 'TEST-CUSTOMER', barber_name: 'STYLIST-A'}]}); await flush();
    assert.match(x.picker.innerHTML, /TEST-CUSTOMER/); assert.equal(x.values.size, 1, 'only pre-existing date preference is persisted');
    assert.equal(x.values.get('hair-booking-picker-date'), '2026-11-17');
  }
  {
    const x = setup(); x.c.window.loadHairBookingPickerDate('2026-11-17'); x.bookingReads[0].resolve({error: 'bad shape'}); await flush();
    assert.match(x.picker.innerHTML, /失败/); assert.doesNotMatch(x.picker.innerHTML, /暂无预约/); assert.ok(retry(x.picker));
    retry(x.picker).onclick(); x.bookingReads[1].resolve({rows: []}); await flush(); assert.match(x.picker.innerHTML, /暂无预约/);
  }
  {
    const x = setup(); x.c.window.loadHairBookingPickerDate('2026-11-17'); x.c.window.loadHairBookingPickerDate('2026-11-18');
    x.bookingReads[1].resolve({rows: [{id: 'NEW', customer_name: 'CURRENT-DATE', barber_name: 'STYLIST-A'}]}); await flush();
    x.bookingReads[0].reject(Object.assign(Error('expired'), {status: 403})); await flush();
    assert.match(x.picker.innerHTML, /CURRENT-DATE/); assert.equal(x.c.sessionClears, 0);
    x.c.window.loadHairBookingPickerDate('2026-11-19'); x.c.AUTHENTICATED_STAFF.session_token = 'DIFFERENT-TOKEN';
    x.bookingReads[2].reject(Object.assign(Error('expired'), {status: 403})); await flush(); assert.equal(x.c.sessionClears, 0);
  }
  console.log('hair-form loading recovery passed: scoped shared directory/TTL, malformed data, timeout/retry, historical values, in-flight edits, record/account/DOM races, picker retry/date/identity guards; synthetic only');
})().catch(error => {console.error(error); process.exitCode = 1;});
