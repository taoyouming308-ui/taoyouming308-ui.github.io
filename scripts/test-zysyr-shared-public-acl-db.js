#!/usr/bin/env node
// Disposable PostgreSQL 17 contract test. Synthetic schema/data only.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const container = `zysyr-public-acl-${process.pid}-${Date.now()}`;
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const psql = sql => docker(['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql]).trim();

async function main() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      try { psql('select 1'); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260924004040_zysyr_shared_public_table_acl.sql'), 'utf8');
    const privateMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260924040520_zysyr_customer_booking_private_acl.sql'), 'utf8');
    for (const page of ['index.html', 'perm-app.html', '自由手艺人.html', 'v2.html', 'v3.html']) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, page), 'utf8'), /\/rest\/v1\/barber_identities/, `${page} must not write device identity through the public API`);
    }
    for (const page of ['自由手艺人.html', 'v2.html', 'v3.html']) {
      assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /location\.replace\('perm-app\.html'/, `${page} must route old public entry points to the canonical protected app`);
    }
    assert.match(fs.readFileSync(path.join(root, 'perm-app.html'), 'utf8'), /\/rest\/v1\/perm_data\?select=\*/, 'active app public recipe read contract must remain');
    docker(['exec', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `create role anon; create role authenticated; create role service_role bypassrls;
        create table public.hair_types(id integer primary key, name text not null);
        create table public.perm_styles(id integer primary key, name text not null);
        create table public.perm_data(id integer primary key, hair_type text not null, style text not null, soften_ph text not null, soften_thio text not null, rod_sizes text not null, technique text not null, steps jsonb not null, created_at timestamptz, updated_at timestamptz, soften_raw jsonb, warning text);
        create table public.barber_identities(id bigint generated always as identity primary key, device_id text not null, barber_name text not null);
        create table public.bookings(id bigint primary key, shop_name text, customer_phone text);
        create table public.customer_profiles(id bigint primary key, phone text, shop_name text, notes text);
        grant all on public.hair_types, public.perm_styles, public.perm_data, public.barber_identities, public.bookings, public.customer_profiles to anon, authenticated, service_role;
        insert into public.perm_data values(1,'test','test','0','0','0','test','[]',now(),now(),null,null);
        insert into public.bookings values(1,'甲店','13800000000');
        insert into public.customer_profiles values(1,'13800000000','甲店','{}');
        ${migration}
        ${privateMigration}`]);

    const statesText = psql(`select c.relname||'|'||c.relrowsecurity||'|'||
      has_table_privilege('anon',c.oid,'select')||'|'||has_table_privilege('anon',c.oid,'insert')||'|'||has_table_privilege('anon',c.oid,'update')||'|'||has_table_privilege('anon',c.oid,'delete')||'|'||
      has_table_privilege('authenticated',c.oid,'select')||'|'||has_table_privilege('authenticated',c.oid,'insert')||'|'||has_table_privilege('authenticated',c.oid,'update')||'|'||has_table_privilege('authenticated',c.oid,'delete')||'|'||
      has_table_privilege('service_role',c.oid,'select')||'|'||has_table_privilege('service_role',c.oid,'insert')||'|'||has_table_privilege('service_role',c.oid,'update')||'|'||has_table_privilege('service_role',c.oid,'delete')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('hair_types','perm_styles','perm_data','barber_identities','bookings','customer_profiles') order by c.relname`);
    assert.notEqual(statesText, '', 'expected test tables to be present: ' + psql("select schemaname||'.'||tablename from pg_tables where schemaname='public' order by tablename"));
    const states = statesText.split('\n');
    assert.deepEqual(states, [
      'barber_identities|true|false|false|false|false|false|false|false|false|true|true|true|true',
      'bookings|true|false|false|false|false|false|false|false|false|true|true|true|true',
      'customer_profiles|true|false|false|false|false|false|false|false|false|true|true|true|true',
      'hair_types|true|false|false|false|false|false|false|false|false|true|true|true|true',
      'perm_data|true|true|false|false|false|true|false|false|false|true|true|true|true',
      'perm_styles|true|false|false|false|false|false|false|false|false|true|true|true|true',
    ]);
    assert.equal(psql('set role anon; select count(*) from public.perm_data'), 'SET\n1', 'anon may read public recipe rows');
    assert.equal(psql('set role authenticated; select count(*) from public.perm_data'), 'SET\n1', 'authenticated may read public recipe rows');
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['hair_types', 'perm_styles', 'perm_data', 'barber_identities', 'bookings', 'customer_profiles']) {
        await assert.rejects(async () => psql(`set role ${role}; insert into public.${table} default values`), /permission denied|violates not-null constraint/);
      }
      for (const table of ['hair_types', 'perm_styles', 'barber_identities', 'bookings', 'customer_profiles']) {
        await assert.rejects(async () => psql(`set role ${role}; select * from public.${table}`), /permission denied/);
      }
      await assert.rejects(async () => psql(`set role ${role}; update public.perm_data set warning='write denied'`), /permission denied/);
      await assert.rejects(async () => psql(`set role ${role}; delete from public.perm_data`), /permission denied/);
    }
    for (const table of ['bookings', 'customer_profiles']) {
      assert.equal(psql(`set role service_role; select count(*) from public.${table}`), 'SET\n1', `service_role should retain ${table} API access`);
    }
    console.log('Shared public ACL: only perm_data SELECT remains public; booking/customer/profile/config/device tables are closed; service_role retains access');
  } finally { docker(['stop', container]); }
}

main().catch(error => { console.error(error.stderr ? String(error.stderr) : error); process.exitCode = 1; });
