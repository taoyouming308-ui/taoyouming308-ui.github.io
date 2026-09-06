function text(value) {
  return String(value == null ? '' : value).trim();
}

export function normalizedEmployeeBookingPhone(value) {
  var digits = text(value).replace(/\D/g, '');
  return digits.length > 11 ? digits.slice(-11) : digits;
}

function normalizedName(value) {
  return text(value).replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
}

function normalizedTime(value) {
  var match = text(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return String(Number(match[1])).padStart(2, '0') + ':' + match[2];
}

function visibleCustomer(row) {
  var name = text(row && row.customer_name);
  var phone = normalizedEmployeeBookingPhone(row && row.customer_phone);
  return !!phone || (!!name && name !== '待定' && name !== '未登记');
}

function frontdeskTimestamp(date, time) {
  var label = normalizedTime(time);
  if (!label) return null;
  var value = Date.parse(text(date) + 'T' + label + ':00+08:00');
  return Number.isFinite(value) ? value : null;
}

function mapBooking(row) {
  return {
    id: String(row.id),
    customer_name: text(row.customer_name),
    customer_phone: text(row.customer_phone),
    barber_name: text(row.barber_name),
    shop_name: text(row.shop_name),
    time_label: normalizedTime(row.time_label),
    reservation_time: Number(row.reservation_time) || null,
    service_name: text(row.service_name),
    notes: text(row.notes),
    status: row.status,
    date: text(row.date),
    source: 'meiguanjia',
    source_label: '美管加预约',
  };
}

function mapFrontdesk(row) {
  var date = text(row.business_date);
  var time = normalizedTime(row.arrival_time);
  return {
    id: 'frontdesk:' + String(row.id),
    customer_name: text(row.customer_name),
    customer_phone: text(row.customer_phone),
    barber_name: text(row.barber_name),
    shop_name: text(row.store),
    time_label: time,
    reservation_time: frontdeskTimestamp(date, time),
    service_name: text(row.service_intent),
    notes: text(row.reception_notes),
    status: text(row.status),
    date: date,
    source: 'frontdesk',
    source_label: '前台到店',
  };
}

function sameCustomer(booking, reception) {
  var bookingPhone = normalizedEmployeeBookingPhone(booking.customer_phone);
  var receptionPhone = normalizedEmployeeBookingPhone(reception.customer_phone);
  if (bookingPhone && receptionPhone) return bookingPhone === receptionPhone;
  var bookingTime = normalizedTime(booking.time_label);
  var receptionTime = normalizedTime(reception.time_label);
  return !!bookingTime && bookingTime === receptionTime &&
    !!normalizedName(booking.customer_name) &&
    normalizedName(booking.customer_name) === normalizedName(reception.customer_name) &&
    normalizedName(booking.barber_name) === normalizedName(reception.barber_name);
}

function rowSortValue(row) {
  var timestamp = Number(row.reservation_time);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  var time = normalizedTime(row.time_label);
  if (!time) return Number.MAX_SAFE_INTEGER;
  var parts = time.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

export function mergeEmployeeBookingRows(bookingRows, frontdeskRows) {
  var bookings = (Array.isArray(bookingRows) ? bookingRows : [])
    .map(mapBooking)
    .filter(visibleCustomer);
  var frontdesk = (Array.isArray(frontdeskRows) ? frontdeskRows : [])
    .map(mapFrontdesk)
    .filter(visibleCustomer);
  var uniqueFrontdesk = frontdesk.filter(function(reception) {
    return !bookings.some(function(booking) { return sameCustomer(booking, reception); });
  });
  var rows = bookings.concat(uniqueFrontdesk).sort(function(a, b) {
    return rowSortValue(a) - rowSortValue(b) || String(a.id).localeCompare(String(b.id));
  });
  return {
    rows: rows,
    counts: {
      meiguanjia: bookings.length,
      frontdesk_received: frontdesk.length,
      frontdesk_added: uniqueFrontdesk.length,
      duplicates_removed: frontdesk.length - uniqueFrontdesk.length,
    },
  };
}
