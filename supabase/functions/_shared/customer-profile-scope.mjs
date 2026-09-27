// A membership's home store is not necessarily the store that sold its packages.
const text = value => String(value ?? '').trim();
const array = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const stamp = row => `${text(row.date)} ${text(row.time)}`.trim();
export const CUSTOMER_SHARED_STORES = Object.freeze(['自由手艺人', '向里造型']);

// Explicit opt-in for new clients. This is a read scope, never a write permission.
export function customerReadStores(store, scope = 'store') {
  if (!CUSTOMER_SHARED_STORES.includes(text(store))) throw new Error('账号门店无效');
  if (!['all', 'store'].includes(scope)) throw new Error('客户查看范围无效');
  return scope === 'all' ? [...CUSTOMER_SHARED_STORES] : [text(store)];
}

export function customerRecordsStoreFilter(column, store, scope = 'store') {
  if (!['store', 'shop_name'].includes(column)) throw new Error('门店字段无效');
  const stores = customerReadStores(store, scope);
  return column + '=in.' + encodeURIComponent('(' + stores.map(JSON.stringify).join(',') + ')');
}

export function customerIdentityRows(rows, phone, name, phoneField = 'phone', nameField = 'name') {
  const normalizePhone = value => text(value).replace(/\D/g, '').replace(/^86(?=1\d{10}$)/, '');
  const normalizeName = value => text(value).replace(/\s/g, '').toLowerCase();
  const targetPhone = normalizePhone(phone), targetName = normalizeName(name);
  if (!targetPhone || targetPhone.length < 11) return [];
  const matches = rows.filter(row => normalizePhone(row[phoneField]) === targetPhone);
  const names = new Set(matches.map(row => normalizeName(row[nameField])).filter(Boolean));
  // Shared family phone numbers must not silently combine different people.
  if (names.size > 1 || (targetName && names.size && !names.has(targetName))) {
    return targetName ? matches.filter(row => normalizeName(row[nameField]) === targetName) : [];
  }
  return matches;
}

export function scopeCustomerHairRecords(rows, store, scope = 'store') {
  const stores = customerReadStores(store, scope);
  return rows.filter(row => {
    if (row.status === 'deleted') return false;
    const data = row.record_data || {};
    const origin = text(data.shopName || data.shop_name || data.store);
    return origin ? stores.includes(origin) : scope === 'all';
  }).map(row => ({...row, archive_store: text(row.record_data?.shopName || row.record_data?.shop_name || row.record_data?.store), store_unconfirmed: !text(row.record_data?.shopName || row.record_data?.shop_name || row.record_data?.store)}));
}

export function customerHairPhoneFilter(phone) {
  const value = text(phone).replace(/\D/g, '');
  if (value.length < 11) throw new Error('请提供完整手机号');
  return 'or=' + encodeURIComponent(`(customer_phone.ilike.*${value}*,record_data->>customerPhone.eq.${value},record_data->>customerPhoneNormalized.eq.${value},record_data->formFields->>hair-form-phone.eq.${value})`);
}

export function customerHairIdentityRows(rows, phone, name) {
  return customerIdentityRows(rows.map(row => ({...row,
    customer_phone: row.customer_phone || row.record_data?.customerPhone || row.record_data?.customerPhoneNormalized || row.record_data?.formFields?.['hair-form-phone'],
    customer_name: row.customer_name || row.record_data?.customerName || row.record_data?.formFields?.['hair-form-name'],
  })), phone, name, 'customer_phone', 'customer_name');
}

export function customerProfileStoreFilter(store, scope = 'store') {
  const clauses = customerReadStores(store, scope).flatMap(name => {
    const literal = JSON.stringify(name), child = JSON.stringify([{ shop: name }]);
    return [`shop_name.eq.${literal}`, `card_packages.cs.${child}`, `service_history.cs.${child}`];
  });
  return 'or=' + encodeURIComponent('(' + clauses.join(',') + ')');
}

export function scopeCustomerProfile(row, store, scope = 'store') {
  const stores = customerReadStores(store, scope);
  const home = stores.includes(text(row.shop_name));
  const belongs = item => stores.includes(text(item.shop || item.shop_name)) || (home && !text(item.shop || item.shop_name));
  const allPackages = array(row.card_packages), allHistory = array(row.service_history);
  const origin = item => ({...item, shop: text(item.shop || item.shop_name) || text(row.shop_name)});
  const packages = allPackages.filter(belongs).map(origin), history = allHistory.filter(belongs).map(origin);
  if (!home && !packages.length && !history.length) return null;
  const partial = !home || packages.length !== allPackages.length || history.length !== allHistory.length;
  const sorted = [...history].sort((a, b) => stamp(b).localeCompare(stamp(a)));
  const latest = sorted[0];
  return {
    id: row.id, phone: row.phone, name: row.name, shop_name: scope === 'all' && home ? row.shop_name : store,
    home_store: home ? row.shop_name : '', customer_scope: scope,
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
