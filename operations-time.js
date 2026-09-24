/* Report timestamps are stored in UTC and shown consistently in China Standard Time. */
(function (root) {
  'use strict';
  var TIME_ZONE = 'Asia/Shanghai';

  function parse(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    var text = String(value || '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) text += 'Z';
    var date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parts(value) {
    var date = parse(value);
    if (!date) return null;
    var values = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).forEach(function (item) {
      if (item.type !== 'literal') values[item.type] = item.value;
    });
    return values;
  }

  function dateTime(value) {
    var valueParts = parts(value);
    return valueParts ? valueParts.year + '-' + valueParts.month + '-' + valueParts.day + ' ' + valueParts.hour + ':' + valueParts.minute : '';
  }

  function shortDateTime(value) {
    var valueParts = parts(value);
    return valueParts ? valueParts.month + '-' + valueParts.day + ' ' + valueParts.hour + ':' + valueParts.minute : '';
  }

  function today(value) {
    var valueParts = parts(value || new Date());
    return valueParts ? valueParts.year + '-' + valueParts.month + '-' + valueParts.day : '';
  }

  function time(value) {
    var valueParts = parts(value || new Date());
    return valueParts ? valueParts.hour + ':' + valueParts.minute : '';
  }

  var api = { TIME_ZONE: TIME_ZONE, parse: parse, dateTime: dateTime, shortDateTime: shortDateTime, today: today, time: time };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZysyrTime = api;
})(typeof window !== 'undefined' ? window : globalThis);
