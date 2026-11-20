"""Fail-closed source shape validation; no I/O."""
from datetime import datetime, timezone, timedelta
CHINA = timezone(timedelta(hours=8))
PAGINATION = {'total','totalCount','page','pageNo','pageSize','pages','hasNext','hasMore','nextPage','nextCursor','cursor','offset','limit'}

def integer(value, label):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('invalid_' + label)
    if isinstance(value, str) and (not value or not value.isdecimal()):
        raise ValueError('invalid_' + label)
    return int(value)

def complete_reservations(result, shop_id, day):
    if not isinstance(result, dict) or type(result.get('code')) is not int or result['code'] != 0:
        raise ValueError('source_not_success')
    content = result.get('content')
    if not isinstance(content, dict) or not isinstance(content.get('reservations'), list):
        raise ValueError('missing_explicit_list')
    if PAGINATION.intersection(result) or PAGINATION.intersection(content):
        raise ValueError('pagination_unverified')
    if content.get('rvlist') is not None:
        raise ValueError('secondary_list_unmerged')
    rows = content['reservations']
    if len(rows) > 500:
        raise ValueError('source_size_unverified')
    ids = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('invalid_row')
        bid = integer(row.get('id'), 'id')
        status = integer(row.get('status'), 'status')
        stamp = integer(row.get('reservationTime'), 'time')
        if not 0 < bid <= 9007199254740991 or bid in ids:
            raise ValueError('invalid_or_duplicate_id')
        if status not in (0,1,2,3,4):
            raise ValueError('unknown_status')
        if stamp <= 0 or datetime.fromtimestamp(stamp/1000, CHINA).date().isoformat() != day:
            raise ValueError('row_date_mismatch')
        if row.get('shopId') is not None and str(row['shopId']) != shop_id:
            raise ValueError('row_shop_mismatch')
        for field in ('barberName','custName','memmobile','categoryName','comment'):
            value = row.get(field)
            if value is not None and not isinstance(value,str):
                raise ValueError('invalid_text_field')
            if isinstance(value,str) and len(value)>2000:
                raise ValueError('oversize_text_field')
        ids.add(bid)
    return rows
