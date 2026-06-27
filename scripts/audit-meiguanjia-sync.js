#!/usr/bin/env node
const SUPABASE_URL = 'https://pdssrmpeiuwvxzsgschm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t';
const headers = { apikey: SUPABASE_KEY };

async function get(path) {
  const res = await fetch(SUPABASE_URL + path, { headers });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getAll(path, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await get(`${path}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += pageSize;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}(\s\d{2}:\d{2})?$/.test(String(value || ''));
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] == null || row[key] === '' ? '(empty)' : String(row[key]);
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

const profiles = await getAll('/rest/v1/customer_profiles?select=id,phone,name,shop_name,barber_name,total_visits,total_consumption,last_visit_date,card_packages,service_history,notes,last_updated&order=id.asc');
const bookings = await getAll('/rest/v1/bookings?select=id,date,shop_name,barber_name,customer_name,customer_phone,time_label,reservation_time,service_name,notes,status&order=date.desc');

const profileStats = {
  total_rows: profiles.length,
  no_phone: profiles.filter(row => !row.phone).length,
  iso_last_visit: profiles.filter(row => isIsoDate(row.last_visit_date)).length,
  relative_or_invalid_last_visit: profiles.filter(row => row.last_visit_date && !isIsoDate(row.last_visit_date)).length,
  has_any_service_history: profiles.filter(row => asArray(row.service_history).length > 0).length,
  visits_but_no_service_history: profiles.filter(row => (Number(row.total_visits) || 0) > 0 && asArray(row.service_history).length === 0).length,
  consumption_but_no_service_history: profiles.filter(row => (Number(row.total_consumption) || 0) > 0 && asArray(row.service_history).length === 0).length,
  has_any_packages: profiles.filter(row => asArray(row.card_packages).length > 0).length,
  has_active_packages: profiles.filter(row => asArray(row.card_packages).some(pkg => (Number(pkg.left ?? pkg.remaining ?? pkg.leavetimes) || 0) > 0)).length,
  by_shop: countBy(profiles, 'shop_name')
};

const bookingStats = {
  total_rows: bookings.length,
  no_phone: bookings.filter(row => !row.customer_phone).length,
  no_name: bookings.filter(row => !row.customer_name).length,
  no_barber: bookings.filter(row => !row.barber_name).length,
  no_time_label: bookings.filter(row => !row.time_label).length,
  no_service_name: bookings.filter(row => !row.service_name).length,
  by_shop: countBy(bookings, 'shop_name'),
  by_status: countBy(bookings, 'status')
};

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  customer_profiles: profileStats,
  bookings: bookingStats,
  notes: [
    'This is a read-only audit; it does not modify Supabase data.',
    'last_visit_date should be ISO text such as 2026-06-26 14:30, not relative text such as 8小时前.',
    'service_history should contain recent real consumption/visit records when total_visits or total_consumption is non-zero.',
    'card_packages should contain active package rows with stable ids, remaining count, total count, shop, and expiry when available.'
  ]
}, null, 2));
