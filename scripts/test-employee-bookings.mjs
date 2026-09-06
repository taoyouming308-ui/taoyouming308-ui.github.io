#!/usr/bin/env node
import fs from 'node:fs';
import { mergeEmployeeBookingRows } from '../supabase/functions/_shared/employee-booking-merge.mjs';

function expect(value, message) {
  if (!value) throw new Error(message);
}

const edge = fs.readFileSync('supabase/functions/employee-bookings-api/index.ts', 'utf8');
const app = fs.readFileSync('perm-app.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260906033501_employee_booking_sessions.sql', 'utf8');

const booking = {
  id: 101,
  customer_name: '朱小姐',
  customer_phone: '138 0000 3360',
  barber_name: '小康',
  shop_name: '自由手艺人',
  time_label: '11:00',
  reservation_time: 1788663600000,
  service_name: '剪发',
  notes: '美管加记录',
  status: 0,
  date: '2026-09-06',
};

const samePhoneReception = {
  id: 'fd-1', business_date: '2026-09-06', store: '自由手艺人', customer_name: '朱女士',
  customer_phone: '13800003360', barber_name: '小康', arrival_time: '11:30:00',
  service_intent: '洗剪吹', reception_notes: '前台记录', status: 'arrived',
};
let merged = mergeEmployeeBookingRows([booking], [samePhoneReception]);
expect(merged.rows.length === 1, 'same normalized phone must not render twice');
expect(merged.counts.duplicates_removed === 1, 'phone duplicate count is wrong');
expect(merged.rows[0].source === 'meiguanjia', 'Meiguanjia row must take precedence when duplicated');

const differentPhoneSameName = { ...samePhoneReception, id: 'fd-2', customer_name: '朱小姐', customer_phone: '13900003360', arrival_time: '11:00:00' };
merged = mergeEmployeeBookingRows([booking], [differentPhoneSameName]);
expect(merged.rows.length === 2, 'same-name customers with different phones must not be merged');

const noPhoneBooking = { ...booking, id: 102, customer_phone: '', customer_name: '王女士', time_label: '13:00' };
const noPhoneReception = { ...samePhoneReception, id: 'fd-3', customer_phone: '', customer_name: ' 王女士 ', arrival_time: '13:00:00' };
merged = mergeEmployeeBookingRows([noPhoneBooking], [noPhoneReception]);
expect(merged.rows.length === 1 && merged.counts.duplicates_removed === 1, 'no-phone fallback must use name, barber and time');

const walkIn = { ...samePhoneReception, id: 'fd-4', customer_name: '临时到店', customer_phone: '13700000001', arrival_time: '10:30:00' };
merged = mergeEmployeeBookingRows([booking], [walkIn]);
expect(merged.rows.length === 2 && merged.rows[0].id === 'frontdesk:fd-4', 'frontdesk arrivals must be mapped and sorted with bookings');
expect(merged.rows[0].source_label === '前台到店' && merged.rows[0].service_name === '洗剪吹', 'frontdesk source or service mapping failed');

expect(edge.includes('employee_booking_sessions') && edge.includes('requireEmployeeSession'), 'protected employee session missing');
expect(edge.includes('SUPABASE_SERVICE_ROLE_KEY') && !app.includes('SUPABASE_SERVICE_ROLE_KEY'), 'service key boundary is broken');
expect(edge.includes('shop_name=eq.${encodeURIComponent(store)}') && edge.includes('barber_name=eq.${encodeURIComponent(barber)}'), 'Meiguanjia query must use the session store and employee');
expect(edge.includes('store=eq.${encodeURIComponent(store)}') && edge.includes('business_date=eq.${date}'), 'frontdesk query must use the session store and date');
expect(edge.includes('sources_read_only: true') && edge.includes('bookings_untouched: true') && edge.includes('frontdesk_records_untouched: true'), 'read-only source boundary markers missing');

const loadStart = app.indexOf('function loadBookings(showLoading)');
const loadEnd = app.indexOf('function isVisibleCustomerBooking', loadStart);
const loadSource = app.slice(loadStart, loadEnd);
expect(loadStart >= 0 && loadEnd > loadStart, 'booking loader missing');
expect(loadSource.includes("employeeBookingsApi('today_bookings'"), 'booking loader does not use merged API');
expect(!loadSource.includes('/rest/v1/bookings?'), 'main booking list still bypasses the protected merged API');
const pickerStart = app.indexOf('window.loadHairBookingPickerDate = function(dateKey)');
const pickerEnd = app.indexOf('window.pickBookingCustomerFromNode', pickerStart);
const pickerSource = app.slice(pickerStart, pickerEnd);
expect(pickerStart >= 0 && pickerEnd > pickerStart, 'hair booking picker loader missing');
expect(pickerSource.includes("employeeBookingsApi('today_bookings'"), 'hair booking picker does not use merged API');
expect(!pickerSource.includes('/rest/v1/bookings?'), 'hair booking picker still reads Meiguanjia bookings directly');
expect(pickerSource.includes('source_label') && pickerSource.includes('前台到店') && pickerSource.includes('美管加预约'), 'hair booking picker source labels missing');
expect(app.includes("employeeBookingsApi('login'") && app.includes("employeeBookingsApi('session'"), 'employee login/session API flow missing');
expect(!app.slice(app.indexOf('window.doAppLogin'), app.indexOf('window.showBarberPicker')).includes('password_hash=eq.'), 'employee password proof must not be placed in a Data API URL');

expect(migration.includes('enable row level security'), 'employee session RLS missing');
expect(migration.includes('revoke all on table public.employee_booking_sessions from public, anon, authenticated'), 'employee sessions are exposed to public clients');
expect(migration.includes('grant all on table public.employee_booking_sessions to service_role'), 'employee API cannot access its session table');

console.log('employee bookings merge tests passed');
