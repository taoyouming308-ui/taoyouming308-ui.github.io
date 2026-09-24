#!/usr/bin/env node
// Disposable PostgreSQL and synthetic revisions only. Never touches production.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const container = `zysyr-daily-revision-${process.pid}-${Date.now()}`;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const company = id(1), store = id(2), draft = id(3), actor = id(4);
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const q = text => `'${String(text).replaceAll("'", "''")}'`;
const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'];
const runSql = query => new Promise((resolve, reject) => {
  const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
  child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(stderr || `psql exited ${code}`), { stderr })));
  child.stdin.end(query);
});
const setupSql = query => execFileSync('docker', psqlArgs.slice(0, -1), { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

async function main() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        execFileSync('docker', ['exec', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-At', '-c', 'select 1'], { stdio: 'ignore' });
        break;
      } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260924010116_zysyr_daily_expected_revision_gate.sql'), 'utf8');
    setupSql(`create role anon; create role authenticated; create role service_role;
        create table public.zysyr_daily_sheet_drafts(id uuid primary key,company_id uuid,store_id uuid,status text,edit_revision integer,last_value text,confirmation_revision integer);
        insert into public.zysyr_daily_sheet_drafts values('${draft}','${company}','${store}','draft',0,null,null);
        create schema zysyr_private;
        create function zysyr_private.assert_daily_entry_scope(uuid,uuid,uuid) returns void language plpgsql as $$begin if $1 <> '${actor}' or $2 <> '${company}' or $3 <> '${store}' then raise exception 'DAILY_SCOPE_FORBIDDEN'; end if; end$$;
        create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$begin if $1 <> '${actor}' or $2 <> '${company}' or $3 <> '${store}' or $4 <> 'daily_report.write' then raise exception 'DAILY_SCOPE_FORBIDDEN'; end if; end$$;
        create function public.zysyr_save_daily_sheet_cells(uuid,uuid,uuid,uuid,jsonb,text) returns jsonb language plpgsql security definer as $$begin update public.zysyr_daily_sheet_drafts set last_value=$5->0->>'value',edit_revision=edit_revision+1 where id=$4; perform pg_sleep(0.35); return jsonb_build_object('revision',(select edit_revision from public.zysyr_daily_sheet_drafts where id=$4)); end$$;
        create function public.zysyr_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text) returns jsonb language plpgsql security definer as $$begin update public.zysyr_daily_sheet_drafts set status='confirmed',confirmation_revision=edit_revision where id=$4; return jsonb_build_object('confirmed',true,'revision',(select edit_revision from public.zysyr_daily_sheet_drafts where id=$4)); end$$;
        ${migration}`);

    // Two stale browser tabs submit the same reviewed version simultaneously.
    // The row lock allows exactly one write; the waiter must see revision 1 and conflict.
    const calls = ['101', '202'].map(value => runSql(`set role service_role;
      select public.zysyr_save_daily_sheet_cells('${actor}','${company}','${store}','${draft}',
      '[{"value":"${value}"}]'::jsonb,'parallel review',0);`));
    const results = await Promise.allSettled(calls);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'only one stale revision may save');
    assert.equal(results.filter(result => result.status === 'rejected').length, 1, 'the other stale tab must get a conflict');
    const state = docker(['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c',
      `select edit_revision||'|'||last_value from public.zysyr_daily_sheet_drafts where id='${draft}'`]).trim();
    assert.match(state, /^1\|(101|202)$/);

    await assert.rejects(() => runSql(`set role service_role; select public.zysyr_confirm_daily_sheet('${actor}','${company}','${store}','${draft}','{}'::jsonb,null,'stale confirm',0);`), /DAILY_SHEET_REVISION_CONFLICT/);
    assert.equal(docker(['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c',
      `select status||'|'||coalesce(confirmation_revision::text,'') from public.zysyr_daily_sheet_drafts where id='${draft}'`]).trim(), 'draft|');
    assert.match((await runSql(`set role service_role; select public.zysyr_confirm_daily_sheet('${actor}','${company}','${store}','${draft}','{}'::jsonb,null,'current confirm',1);`)).stdout, /confirmed/);

    const grants = docker(['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c',
      `select has_function_privilege('service_role','public.zysyr_save_daily_sheet_cells(uuid,uuid,uuid,uuid,jsonb,text,integer)','execute')||'|'||has_function_privilege('service_role','public.zysyr_save_daily_sheet_cells(uuid,uuid,uuid,uuid,jsonb,text)','execute')||'|'||has_function_privilege('authenticated','public.zysyr_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text,integer)','execute')`]).trim();
    assert.equal(grants, 'true|true|false', 'service role retains a temporary legacy overload while browser roles cannot call either overload directly');
    assert.match((await runSql(`set role service_role; select public.zysyr_save_daily_sheet_cells('${actor}','${company}','${store}','${draft}','[{"value":"legacy"}]'::jsonb,'legacy compatibility');`)).stdout, /revision/,
      'the old RPC overload must remain usable during the staged UI rollout');
    console.log('Daily expected revision: stale concurrent saves serialize to one winner; stale confirmation is rejected; current revision confirms; v529 legacy server calls remain compatible and browser roles have no direct RPC grant');
  } finally { docker(['stop', container]); }
}

main().catch(error => { console.error(error.stderr ? String(error.stderr) : error); process.exitCode = 1; });
