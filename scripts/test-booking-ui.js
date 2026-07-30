#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

function fail(message) {
  console.error('BOOKING UI TEST FAILED: ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const app = fs.readFileSync('perm-app.html', 'utf8');
const renderStart = app.indexOf('function renderBookings(rows, list, isOffline)');
const renderEnd = app.indexOf('function bookingNeedsHairAnalysis', renderStart);
const render = app.slice(renderStart, renderEnd);
const visibilityStart = app.indexOf('function isVisibleCustomerBooking(row)');
const visibilityEnd = app.indexOf('// ★ 独立渲染函数', visibilityStart);
const visibility = app.slice(visibilityStart, visibilityEnd);
const datesStart = app.indexOf('function renderDateStrip()');
const datesEnd = app.indexOf('window.pickDate', datesStart);
const dates = app.slice(datesStart, datesEnd);

assert(renderStart >= 0 && renderEnd > renderStart, 'booking renderer not found');
assert(visibilityStart >= 0 && visibilityEnd > visibilityStart, 'booking visibility guard not found');
assert(visibility.includes("name !== '待定'") && visibility.includes("name !== '未登记'"), 'blank Meiguanjia slots are not excluded');
assert(visibility.includes('!!phone ||'), 'named or phoned customer bookings must remain visible');
assert(render.includes('rows = (rows || []).filter(isVisibleCustomerBooking)'), 'cached placeholder slots can still render');
assert(render.includes('bi-time-column'), 'time is not the leading booking column');
assert(render.includes('预约项目') && render.includes('bi-service-text'), 'booking project is not explicitly labeled');
assert(!render.includes('<span class="bi-service-tag'), 'booking project regressed to a pill/card tag');
assert(!render.includes("bi-meta\">'+esc(r.time_label"), 'booking time is duplicated in metadata');
assert(render.includes('<button type="button" class="bi-plan-btn"'), 'plan action is not a semantic button');
assert(render.includes('data-booking-id'), 'hair-analysis tag is not bound to the booking id');
assert(render.includes('data-booking-id="\'+escAttr(r.id||\'\')+\'"'), 'plan action does not carry the booking id into the customer archive');
assert(app.includes("target.closest('.bi-plan-btn')"), 'plan action does not handle clicks on nested arrow content');
assert(app.includes('showPlanModal(phone, name, barber, bdate, bookingId)'), 'plan action drops the booking id before loading the hair record');
assert(app.includes('renderHairRecordReadOnly(phone, name, bookingId, bookingDate)'), 'appointment plan does not request a booking-specific hair record');
assert(app.includes('findHairRecordForBooking(list, bookingId, bookingDate, phone)'), 'cloud hair archive is not matched to the exact appointment');
assert(app.includes('class="hair-full-archive-btn"'), 'appointment plan is missing the complete original-form action');
assert(app.includes('window.openHairRecordArchive = function(recordId, phone, bookingId, bookingDate)'), 'complete hair archive opener is missing');
assert(app.includes('window.loadCloudRecord(recordId, false, true)'), 'complete hair archive does not load the saved cloud record in read-only mode');
assert(app.includes("banner.textContent = '只读完整档案 · 内容与保存时的发质分析原表一致'"), 'complete archive is not visibly identified as the original read-only form');
assert(app.includes('if (window._hairArchiveReadOnly) return;'), 'opening a read-only archive can still trigger an accidental save');
assert(app.includes('identity-mark') && app.includes('identity-logout'), 'minimal identity header is missing');
assert(app.includes('<button type="button" class="shop-switch'), 'shop switch is not keyboard-accessible');
assert(dates.includes('var dayNames =') && dates.includes('<button type="button" class="date-chip'), 'date strip is not self-contained and button-based');
assert(app.includes('booking-date-title'), 'selected booking date heading is missing');
assert(app.includes('window.showBookingPicker = function()') && app.includes('var dateKey = getLocalDateStr();'), 'hair booking picker must open on the current local date');
assert(!app.includes("localStorage.getItem('hair-booking-picker-date') || BOOKING_DATE"), 'hair booking picker must not reopen on a stale saved date');
assert(render.includes('booking-empty') && !render.includes('📭'), 'empty booking state is not minimal');
assert(app.includes('bookings?select=id,customer_name,customer_phone'), 'hair booking picker does not retain booking ids');
assert(app.includes("var key = r.id ? 'booking:' + r.id"), 'hair booking picker still merges separate booking ids');
assert(app.includes("var barberName = (AUTHENTICATED_STAFF && AUTHENTICATED_STAFF.username) || BOOKING_BARBER || localStorage.getItem('booking-barber') || '';"), 'hair booking picker must use the authenticated account, not the editable form barber');
assert(!app.includes("var barberName = recordBarberValueFromFields({}) || BOOKING_BARBER || localStorage.getItem('booking-barber') || '';"), 'hair booking picker must not let a stale form barber hide the current account bookings');
assert(app.includes('bookingId: String(_recordBookingContext.bookingId || \'\')'), 'hair records do not persist the booking id');
assert(app.includes('bookingDate: normalizeHairBookingDate(_recordBookingContext.bookingDate)'), 'hair records do not persist the visit date');
assert(app.includes('shouldStartNewBooking') && app.includes("window.renderHairAnalysis('', '')"), 'switching appointments does not start a fresh independent form');
assert(app.includes('data.bookingId || data.booking_id || openingBookingContext.bookingId'), 'opening a legacy same-day record drops the current booking id instead of backfilling it on save');

const matchStart = app.indexOf('function normalizeHairBookingDate');
const matchEnd = app.indexOf('window.loadHairTagStatuses', matchStart);
assert(matchStart >= 0 && matchEnd > matchStart, 'booking-specific hair matching helpers not found');
const context = {
  normalizeHairCustomerPhone(value) {
    return String(value || '').replace(/\D/g, '').slice(-11);
  },
};
vm.createContext(context);
vm.runInContext(app.slice(matchStart, matchEnd), context);

const current = {
  id: 'hair-current',
  customer_phone: '18971990010',
  created_at: '2026-07-03T02:55:08Z',
  record_data: {
    bookingId: '291662726',
    bookingDate: '2026-07-03',
    customerPhone: '18971990010',
  },
};
assert(context.hairRecordMatchesBooking(current, '291662726', '2026-07-03', '18971990010'), 'exact booking id must match its own hair record');
assert(!context.hairRecordMatchesBooking(current, '291662727', '2026-07-03', '18971990010'), 'same-day bookings must not share a booking-bound hair record');

const legacySameDay = {
  customer_phone: '18971990010',
  created_at: '2026-07-03T02:55:08Z',
  record_data: { date: '2026.7.3', customerPhone: '18971990010' },
};
assert(context.hairRecordMatchesBooking(legacySameDay, '291662726', '2026-07-03', '18971990010'), 'legacy record should match only the same phone and visit date');
assert(!context.hairRecordMatchesBooking(legacySameDay, '291662726', '2026-08-03', '18971990010'), 'historical hair record must not mark a later visit as analyzed');
assert(!context.hairQueueMatchesBooking({ phone: '18971990010', booking_id: '291662727', booking_date: '2026-07-03' }, '291662726', '2026-07-03', '18971990010'), 'queue rows from a different booking must not match');
assert(context.findHairRecordForBooking([legacySameDay, current], '291662726', '2026-07-03', '18971990010') === current, 'exact booking record must take priority over same-day legacy fallback');
const exactQueue = { phone: '18971990010', booking_id: '291662726', booking_date: '2026-07-03', status: 'pending' };
const legacyQueue = { phone: '18971990010', booking_id: null, booking_date: '2026-07-03', status: 'completed' };
assert(context.findHairQueueRowsForBooking([legacyQueue, exactQueue], '291662726', '2026-07-03', '18971990010')[0] === exactQueue, 'exact booking queue must take priority over same-day legacy fallback');

console.log('booking UI test ok');
