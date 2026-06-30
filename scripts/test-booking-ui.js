#!/usr/bin/env node
const fs = require('fs');

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
const datesStart = app.indexOf('function renderDateStrip()');
const datesEnd = app.indexOf('window.pickDate', datesStart);
const dates = app.slice(datesStart, datesEnd);

assert(renderStart >= 0 && renderEnd > renderStart, 'booking renderer not found');
assert(render.includes('bi-time-column'), 'time is not the leading booking column');
assert(render.includes('预约项目') && render.includes('bi-service-text'), 'booking project is not explicitly labeled');
assert(!render.includes('<span class="bi-service-tag'), 'booking project regressed to a pill/card tag');
assert(!render.includes("bi-meta\">'+esc(r.time_label"), 'booking time is duplicated in metadata');
assert(render.includes('<button type="button" class="bi-plan-btn"'), 'plan action is not a semantic button');
assert(app.includes("target.closest('.bi-plan-btn')"), 'plan action does not handle clicks on nested arrow content');
assert(app.includes('identity-mark') && app.includes('identity-logout'), 'minimal identity header is missing');
assert(app.includes('<button type="button" class="shop-switch'), 'shop switch is not keyboard-accessible');
assert(dates.includes('var dayNames =') && dates.includes('<button type="button" class="date-chip'), 'date strip is not self-contained and button-based');
assert(app.includes('booking-date-title'), 'selected booking date heading is missing');
assert(render.includes('booking-empty') && !render.includes('📭'), 'empty booking state is not minimal');

console.log('booking UI test ok');
