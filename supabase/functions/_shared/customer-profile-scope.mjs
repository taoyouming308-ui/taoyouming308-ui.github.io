// A membership's home store is not necessarily the store that sold its packages.
const text = value => String(value ?? '').trim();
const array = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const stamp = row => `${text(row.date)} ${text(row.time)}`.trim();

export function customerProfileStoreFilter(store) {
  const name = text(store);
  if (!['自由手艺人', '向里造型'].includes(name)) throw new Error('账号门店无效');
  const literal = JSON.stringify(name);
  const child = JSON.stringify([{ shop: name }]);
  return 'or=' + encodeURIComponent(`(shop_name.eq.${literal},card_packages.cs.${child},service_history.cs.${child})`);
}

export function scopeCustomerProfile(row, store) {
  const home = text(row.shop_name) === store;
  const belongs = item => text(item.shop) === store || (home && !text(item.shop));
  const allPackages = array(row.card_packages), allHistory = array(row.service_history);
  const packages = allPackages.filter(belongs), history = allHistory.filter(belongs);
  if (!home && !packages.length && !history.length) return null;
  const partial = !home || packages.length !== allPackages.length || history.length !== allHistory.length;
  const sorted = [...history].sort((a, b) => stamp(b).localeCompare(stamp(a)));
  const latest = sorted[0];
  return {
    phone: row.phone, name: row.name, shop_name: store,
    barber_name: partial ? text(latest?.barber) || (Array.isArray(latest?.staff) ? latest.staff.map(text).filter(Boolean).join('、') : '') : row.barber_name,
    last_visit_date: partial ? (latest ? stamp(latest) : null) : row.last_visit_date,
    total_visits: partial ? history.length : row.total_visits,
    total_consumption: partial ? history.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) : row.total_consumption,
    card_packages: packages, service_history: sorted,
    notes: partial ? '' : row.notes, preferences: partial ? null : row.preferences,
    last_updated: row.last_updated,
    summary_scope: partial ? 'synced_store_records' : 'customer',
  };
}
