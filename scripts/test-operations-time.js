#!/usr/bin/env node
const assert = require('node:assert/strict');
const time = require('../operations-time.js');

assert.equal(time.TIME_ZONE, 'Asia/Shanghai');
assert.equal(time.dateTime('2026-09-22T06:14:03.381Z'), '2026-09-22 14:14');
assert.equal(time.dateTime('2026-09-22T06:14:03.381+00:00'), '2026-09-22 14:14');
assert.equal(time.dateTime('2026-09-22T06:14:03'), '2026-09-22 14:14', 'timezone-less network timestamps are treated as UTC');
assert.equal(time.shortDateTime('2026-09-22T06:14:03Z'), '09-22 14:14');
assert.equal(time.today(new Date('2026-09-21T16:30:00Z')), '2026-09-22');
assert.equal(time.time(new Date('2026-09-21T16:30:00Z')), '00:30');
assert.equal(time.dateTime(''), '');
assert.equal(time.dateTime('not-a-date'), '');

console.log('operations time: UTC timestamps, Beijing display and local form dates passed');
