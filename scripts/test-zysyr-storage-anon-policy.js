#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '..',
  'supabase/migrations/20260924051925_zysyr_storage_remove_global_public_policy.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const statements = sql
  .replace(/--[^\n]*/g, '')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

assert.deepEqual(statements, ['DROP POLICY IF EXISTS anon_all ON storage.objects']);
assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
assert.doesNotMatch(sql, /\bstorage\.buckets\b/i);
assert.match(sql, /DROP POLICY IF EXISTS anon_all ON storage\.objects/i);

console.log('ZYSYR Storage anonymous-policy migration scope passed.');
