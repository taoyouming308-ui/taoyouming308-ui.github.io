'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const container = `zysyr-staff-baseline-${process.pid}`;
const migrationPath = path.join(root, 'supabase/migrations/20260729023135_staff_employment_status.sql');
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sql = text => execFileSync('docker', [
  'exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-At',
], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

async function main() {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  docker(['run', '--rm', '-d', '--network', 'none', '--name', container,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        sql('select 1;');
        ready = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    assert.equal(ready, true, 'disposable PostgreSQL 17 fixture should become ready');

    // This is a schema-only snapshot of the legacy table that predates the
    // migration. All rows below are synthetic; no production credentials/data.
    sql(`create table public.staff (
      id serial primary key,
      username text not null unique,
      password_hash text not null,
      role text not null default 'staff',
      store text default '',
      active boolean default true,
      created_at timestamptz default now(),
      position text default '发型师'
    );
    insert into public.staff (username,password_hash,active)
      values ('fixture-active','not-a-real-credential',true),
             ('fixture-inactive','not-a-real-credential',false);`);

    sql(migration);

    const columns = sql(`select count(*) from information_schema.columns
      where table_schema='public' and table_name='staff'
        and column_name='employment_status' and is_nullable='NO';`);
    assert.equal(columns, '1', 'migration should add a required employment_status column');

    const statuses = sql(`select username||'|'||employment_status from public.staff order by username;`);
    assert.equal(statuses, 'fixture-active|active\nfixture-inactive|pending',
      'migration should preserve the documented legacy active-to-status mapping');

    const constraint = sql(`select count(*) from pg_constraint
      where conrelid='public.staff'::regclass and conname='staff_employment_status_check'
        and pg_get_constraintdef(oid) like '%pending%active%departed%';`);
    assert.equal(constraint, '1', 'allowed employment states should be constrained');
    console.log('Legacy staff baseline migration: PostgreSQL 17 schema-only replay and active-state mapping passed.');
  } finally {
    try { docker(['stop', container]); } catch { /* --rm removes it if already stopped. */ }
  }
}

main().catch(error => {
  console.error(error.stderr ? String(error.stderr) : error);
  process.exitCode = 1;
});
