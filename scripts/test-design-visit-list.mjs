/** Pure mocks by default; --postgres uses only the existing isolated PG17 fixture. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVisitListService, VisitListError } from '../packages/design-production-adapter/visit-list-service.mjs';
import { createVisitScopeResolver } from '../packages/design-production-adapter/visit-scope-resolver.mjs';
import { ProductionEmployeeError } from '../packages/design-production-adapter/employee-adapter.mjs';

const credential = 'synthetic-visit-list-' + '0'.repeat(64);
const store = '自由手艺人', date = '2026-11-15', now = Date.UTC(2026, 10, 15);
const uuid = '00000000-0000-4000-8000-000000000003';
const appointment = { assignmentSource: 'appointment', visitId: 'booking:101' };
const frontdesk = { assignmentSource: 'frontdesk', visitId: `frontdesk:${uuid}` };
const copy = value => structuredClone(value);
const tests = [], test = (name, run) => tests.push({ name, run });
const denies = (run, code) => assert.rejects(run, error => error instanceof VisitListError && (!code || error.code === code) && error.message === error.code && !Object.hasOwn(error, 'cause'));

function fixture(visits = [appointment, frontdesk]) {
  const state = {
    now, session: { username: 'alice', store, position: 'stylist', expires_at: new Date(now + 3600000).toISOString() },
    staff: { username: 'alice', store, position: 'stylist', active: true, employment_status: 'active' },
    sessionRows: 1, staffRows: 1, transactions: 0, paths: [], listCalls: [], displayReads: [], records: new Map(),
  };
  for (const [index, visit] of visits.entries()) {
    const a = visit.assignmentSource === 'appointment', id = visit.visitId.slice(a ? 8 : 10), profileId = 11 + index;
    state.records.set(visit.visitId, {
      visit: copy(visit), source: a ? { id: Number(id), barber_name: 'alice', shop_name: store, date, status: 0 } : { id, barber_name: 'alice', store, business_date: date, status: 'in_service' },
      profile: { id: profileId, name: 'Synthetic Shared Name', shop_name: store, card_packages: [], service_history: [] },
      binding: { ...visit, customerProfileId: String(profileId), store, bookingDate: date, visitKey: a ? visit.visitId : `manual:${date}:${id}`, active: true, revision: `binding:${profileId}:1` },
      bindingRows: 1, sourceRows: 1, profileRows: 1, rpcCalls: 0,
    });
  }
  const many = (value, count) => Array.from({ length: count }, () => copy(value));
  const executor = {
    async readTransaction(work) {
      state.transactions++;
      await state.beforeTransaction?.(state.transactions);
      const tx = {
        clock: () => state.now,
        async listAssignedVisits(query) {
          state.listCalls.push(copy(query));
          assert.deepEqual(Object.keys(query).sort(), ['actor', 'date']);
          assert(Object.isFrozen(query) && Object.isFrozen(query.actor));
          if (state.listError) throw state.listError;
          await state.onList?.();
          if (Object.hasOwn(state, 'listRows')) return copy(state.listRows);
          return [...state.records.values()].filter(({ source }) => source.barber_name === query.actor.username && (source.shop_name || source.store) === query.actor.store && (source.date || source.business_date) === query.date).map(r => copy(r.visit));
        },
        async restRows(path) {
          state.paths.push(path);
          if (path.startsWith('employee_booking_sessions?')) {
            assert(path.includes('token_hash=eq.' + createHash('sha256').update(credential).digest('hex')));
            return many(state.session, state.sessionRows);
          }
          if (path.startsWith('staff?')) return many(state.staff, state.staffRows);
          const id = path.match(/&id=eq\.([^&]+)&limit=2$/)?.[1];
          if (path.startsWith('bookings?') || path.startsWith('frontdesk_today_customers?')) {
            const record = state.records.get(`${path.startsWith('bookings?') ? 'booking' : 'frontdesk'}:${id}`);
            return record ? many(record.source, record.sourceRows) : [];
          }
          if (path.startsWith('customer_profiles?')) {
            const record = [...state.records.values()].find(r => String(r.profile.id) === id);
            if (!record) return [];
            if (path.startsWith('customer_profiles?select=id,name,shop_name&')) {
              assert(record.rpcCalls > 0, 'display name is read only after exact actual authorization');
              state.displayReads.push(record.visit.visitId);
              await state.onDisplay?.(record);
              if (record.displayError) throw record.displayError;
              const { id, name, shop_name } = record.profile;
              return many({ id, name, shop_name, ...record.displayPatch }, record.profileRows);
            }
            return many(record.profile, record.profileRows);
          }
          assert.fail('Unexpected read');
        },
        async resolveVisitBinding(row) {
          const record = state.records.get(row.visitId);
          await state.onBinding?.(record);
          if (record.bindingError) throw record.bindingError;
          if (Object.hasOwn(record, 'bindingResponse')) return record.bindingResponse;
          return many(record.binding, record.bindingRows);
        },
        async rpc(name, args) {
          assert.equal(name, 'customer_design_resolve_context');
          const record = [...state.records.values()].find(r => String(r.profile.id) === String(args.p_customer_profile_id));
          record.rpcCalls++;
          await state.onRpc?.(record);
          return { customer_profile_id: args.p_customer_profile_id, booking_id: args.p_booking_id, booking_date: args.p_booking_date, visit_key: args.p_visit_key, store: record.profile.shop_name, name: 'Must Not Be Displayed', phone: '13000000000', ...record.contextPatch };
        },
      };
      if (state.missingMethod) delete tx[state.missingMethod];
      return work(tx);
    },
    writeTransaction() { assert.fail('Listing must never use a write transaction'); },
  };
  return { state, executor, list: createVisitListService({ executor }), request: { credential, date }, first: state.records.values().next().value };
}

test('minimal frozen list uses bound profile names, distinct stable visits and two actual read transactions', async () => {
  const f = fixture(), result = await f.list(f.request);
  assert.deepEqual(result, { date, visits: [appointment, frontdesk].map((visit, i) => ({ id: visit.visitId, displayName: 'Synthetic Shared Name', visit, bindingRevision: `binding:${11 + i}:1` })) });
  assert(Object.isFrozen(result) && Object.isFrozen(result.visits) && result.visits.every(row => Object.isFrozen(row) && Object.isFrozen(row.visit)));
  assert.equal(f.state.transactions, 2); assert.equal(f.state.listCalls.length, 2);
  assert.equal(f.state.displayReads.length, 4);
  assert(!/phone|13000000000|customerProfileId|scope|alice|Must Not Be Displayed/.test(JSON.stringify(result)));
});
test('default and incomplete dependencies fail closed', async () => {
  await denies(() => createVisitListService()({ credential, date }), 'VISIT_LIST_NOT_CONFIGURED');
  for (const missingMethod of ['restRows', 'rpc', 'resolveVisitBinding', 'listAssignedVisits']) {
    const f = fixture(); f.state.missingMethod = missingMethod;
    await denies(() => f.list(f.request), 'VISIT_LIST_NOT_CONFIGURED');
  }
});
test('exact request rejects identity and scope hints, symbols and missing values before reads', async () => {
  for (const field of ['actor', 'username', 'store', 'scope', 'name', 'phone', 'customerProfileId', 'visit', 'limit', 'cursor', 'timezone']) {
    const f = fixture(); await denies(() => f.list({ ...f.request, [field]: 'untrusted' }), 'VISIT_LIST_INVALID_REQUEST'); assert.equal(f.state.transactions, 0);
  }
  for (const input of [null, [], {}, { credential }, { date }, { credential, date, [Symbol('extra')]: true }, Object.assign(Object.create(null), { credential, date })]) {
    const f = fixture(); await denies(() => f.list(input), 'VISIT_LIST_INVALID_REQUEST'); assert.equal(f.state.transactions, 0);
  }
});
test('date is exact Gregorian with leap years and no inferred today or timezone', async () => {
  for (const invalid of ['', '2026-2-01', '2026-02-30', '2026-02-29', '1900-02-29', '0000-01-01', '2026-13-01', '2026-00-01', '2026-01-00', '2026-11-15T00:00:00Z', ' 2026-11-15', null, 20261115, undefined]) {
    const f = fixture(); await denies(() => f.list({ credential, date: invalid }), 'VISIT_LIST_INVALID_DATE'); assert.equal(f.state.transactions, 0);
  }
  for (const valid of ['2000-02-29', '2024-02-29', '0001-01-01', '9999-12-31']) {
    const f = fixture(); assert.deepEqual(await f.list({ credential, date: valid }), { date: valid, visits: [] });
  }
});
test('server-authenticated employee/store/date isolation and empty list still reauthenticate twice', async () => {
  const f = fixture(); f.first.source.barber_name = 'bob';
  assert.deepEqual((await f.list(f.request)).visits.map(row => row.visit), [frontdesk]);
  assert(f.state.listCalls.every(({ actor }) => actor.username === 'alice' && actor.store === store));
  const otherStore = fixture(); otherStore.first.source.shop_name = '向里造型';
  assert.deepEqual((await otherStore.list(otherStore.request)).visits.map(row => row.visit), [frontdesk]);
  const otherDay = fixture(); assert.deepEqual(await otherDay.list({ credential, date: '2026-11-16' }), { date: '2026-11-16', visits: [] });
  assert.equal(otherDay.state.transactions, 2);
});
test('only explicit missing or ambiguous binding is omitted without profile/name/locator output', async () => {
  for (const count of [0, 2]) {
    const f = fixture(); f.first.bindingRows = count;
    assert.deepEqual((await f.list(f.request)).visits.map(row => row.visit), [frontdesk]);
    assert(!f.state.displayReads.includes(appointment.visitId));
    assert(!f.state.paths.some(path => path.startsWith('customer_profiles?') && path.includes('id=eq.11&')));
  }
  const f = fixture([appointment]); f.first.bindingRows = 0;
  assert.deepEqual(await f.list(f.request), { date, visits: [] });
});
test('malformed bindings, inconsistent authority and lifecycle failures fail whole list', async () => {
  for (const mutate of [
    r => r.bindingResponse = null, r => r.bindingResponse = {}, r => r.binding.active = false,
    r => r.binding.customerProfileId = '01', r => r.binding.store = '向里造型', r => r.binding.bookingDate = '2026-11-16',
    r => r.binding.visitKey = 'booking:999', r => r.binding.revision = '', r => r.binding.phone = '13000000000',
    r => r.bindingError = new Error('SQL diagnostic lifecycle denied'), r => r.bindingError = new ProductionEmployeeError('CUSTOMER_BINDING_REQUIRED'),
    r => r.contextPatch = { customer_profile_id: 999 }, r => r.sourceRows = 2,
  ]) {
    const f = fixture(); mutate(f.first); await denies(() => f.list(f.request)); assert.equal(f.state.displayReads.length, 0);
  }
});
test('source corruption, duplicates and source widening are rejected rather than hidden', async () => {
  for (const rows of [null, {}, [appointment, appointment], [{ ...appointment, name: 'Leak' }], [{ ...appointment, visitId: 'booking:01' }], [{ ...appointment, visitId: 'booking:999' }]]) {
    const f = fixture(); f.state.listRows = rows; await denies(() => f.list(f.request));
  }
  const f = fixture(); f.first.source.date = '2026-11-16'; f.first.binding.bookingDate = '2026-11-16'; f.state.listRows = [appointment];
  await denies(() => f.list(f.request), 'VISIT_LIST_CHANGED');
  const otherStaff = fixture(); otherStaff.first.source.barber_name = 'bob'; otherStaff.state.listRows = [appointment];
  await denies(() => otherStaff.list(otherStaff.request), 'VISIT_LIST_ACCESS_DENIED');
});
test('all display data is bounded and exact, never taken from assignment or context', async () => {
  for (const mutate of [r => r.profile.name = '', r => r.profile.name = 'x'.repeat(161), r => r.profile.name = 'private\nname', r => r.profile.name = 12,
    r => r.profileRows = 2, r => r.displayPatch = { phone: '13000000000' }, r => r.displayPatch = { id: 999 }, r => r.displayPatch = { shop_name: '向里造型' }, r => r.displayError = new Error('SQL')]) {
    const f = fixture(); mutate(f.first); await denies(() => f.list(f.request));
  }
  const f = fixture(); f.first.profile.name = 'x'.repeat(160); assert.equal((await f.list(f.request)).visits[0].displayName.length, 160);
});
test('invalid credentials, revoked/ambiguous sessions, inactive staff and expiry deny all output', async () => {
  for (const mutate of [s => s.sessionRows = 0, s => s.sessionRows = 2, s => s.staffRows = 2, s => s.staff.active = false, s => s.staff.employment_status = 'inactive', s => s.staff.store = '向里造型', s => s.now += 3600000]) {
    const f = fixture(); mutate(f.state); await denies(() => f.list(f.request), 'VISIT_LIST_ACCESS_DENIED'); assert.equal(f.state.listCalls.length, 0);
  }
  const f = fixture(); await denies(() => f.list({ credential: 'short', date }), 'VISIT_LIST_ACCESS_DENIED');
});
test('reassignment, revocation, expiry and changed binding/name between independent reads withhold all stale rows', async () => {
  for (const mutate of [
    f => f.state.sessionRows = 0, f => f.state.now += 3600000, f => f.state.staff.active = false,
    f => f.first.source.barber_name = 'bob', f => f.first.bindingRows = 0, f => f.first.bindingRows = 2,
    f => f.first.binding.active = false, f => f.first.binding.revision = 'binding:new', f => f.first.profile.name = 'Changed Name',
    f => f.first.source.status = 1, f => f.first.bindingError = new Error('lifecycle revoked'),
    f => { f.first.binding.customerProfileId = '99'; f.first.profile.id = 99; },
    f => { f.state.session.username = f.state.staff.username = 'bob'; for (const r of f.state.records.values()) r.source.barber_name = 'bob'; },
    f => { f.first.source.date = f.first.binding.bookingDate = '2026-11-16'; },
  ]) {
    const f = fixture(); f.state.beforeTransaction = n => { if (n === 2) mutate(f); };
    await denies(() => f.list(f.request)); assert.equal(f.state.transactions, 2);
  }
});
test('empty and omitted results also check final actor and inter-pass source changes', async () => {
  const f = fixture([]); f.state.onList = () => { f.state.staff.active = false; };
  await denies(() => f.list(f.request), 'VISIT_LIST_ACCESS_DENIED');
  const omitted = fixture(); omitted.first.bindingRows = 0;
  omitted.state.beforeTransaction = n => { if (n === 2) omitted.state.records.delete(appointment.visitId); };
  await denies(() => omitted.list(omitted.request), 'VISIT_LIST_CHANGED');
});
test('authorization changes during context/name work are caught before final output', async () => {
  for (const hook of ['onRpc', 'onDisplay']) {
    const f = fixture(); f.state[hook] = () => { f.state.staff.active = false; };
    await denies(() => f.list(f.request));
  }
});
test('max 50 source rows is an explicit error before authorization, even when unbound', async () => {
  const f = fixture(); f.state.listRows = Array.from({ length: 51 }, (_, i) => ({ assignmentSource: 'appointment', visitId: `booking:${i + 1}` }));
  await denies(() => f.list(f.request), 'VISIT_LIST_LIMIT_EXCEEDED'); assert.equal(f.state.displayReads.length, 0);
  const propagated = fixture(); propagated.state.listError = new VisitListError('VISIT_LIST_LIMIT_EXCEEDED');
  await denies(() => propagated.list(propagated.request), 'VISIT_LIST_LIMIT_EXCEEDED');
  const fifty = fixture(Array.from({ length: 50 }, (_, i) => ({ assignmentSource: 'appointment', visitId: `booking:${i + 1}` })));
  assert.equal((await fifty.list(fifty.request)).visits.length, 50);
});
test('request is captured before async work and list selection requires matching server revision', async () => {
  const f = fixture([appointment]); f.state.beforeTransaction = () => { f.request.date = '2026-11-16'; f.request.credential = 'short'; };
  const result = await f.list(f.request); assert.equal(result.date, date);
  f.state.beforeTransaction = undefined;
  const { visit, bindingRevision } = result.visits[0], resolve = createVisitScopeResolver({ executor: f.executor });
  assert.deepEqual(await resolve({ credential, visit, expectedBindingRevision: bindingRevision }), { scope: { customerProfileId: '11', ...appointment } });
  f.first.binding.revision = 'binding:changed';
  await assert.rejects(() => resolve({ credential, visit, expectedBindingRevision: bindingRevision }), error => error instanceof ProductionEmployeeError && error.code === 'CUSTOMER_BINDING_CHANGED');
});
test('executor bypass, replay and swapped result cannot return a list', async () => {
  const f = fixture();
  await denies(() => createVisitListService({ executor: { readTransaction: async () => ({ date, visits: [] }) } })(f.request), 'VISIT_LIST_UNAVAILABLE');
  await denies(() => createVisitListService({ executor: { readTransaction: work => f.executor.readTransaction(async tx => { await work(tx); return work(tx); }) } })(f.request));
  await denies(() => createVisitListService({ executor: { readTransaction: async work => { await f.executor.readTransaction(work); return {}; } } })(f.request));
});
test('unknown and forged errors never expose raw diagnostics or masquerade as empty success', async () => {
  for (const error of [new Error('private SQL, phone and token'), new VisitListError('private SQL, phone and token'), { name: 'VisitListError', code: 'VISIT_LIST_LIMIT_EXCEEDED' }, { name: 'ProductionEmployeeError', code: 'CUSTOMER_BINDING_REQUIRED' }]) {
    const f = fixture(); f.state.listError = error; await denies(() => f.list(f.request), 'VISIT_LIST_UNAVAILABLE');
  }
});

async function postgresTests() {
  const { createDesignPostgresFixture } = await import('./fixtures/design-postgres-fixture.mjs');
  const { createDesignPostgresExecutor } = await import('../packages/design-production-adapter/postgres-executor.mjs');
  const { createVisitBindingAdapter } = await import('../packages/design-production-adapter/visit-binding.mjs');
  const f = await createDesignPostgresFixture();
  try {
    const executor = createDesignPostgresExecutor({ acquireClient: f.acquireClient, lifecyclePolicy: f.lifecyclePolicy });
    const list = createVisitListService({ executor }), request = { credential: f.credential, date };
    const binding = createVisitBindingAdapter(executor);
    let count = 0;
    const check = async (name, run) => { await run(); count++; console.log(`ok pg ${count} - ${name}`); };
    await check('two actual read transactions; fixed exact profile display; no INSERT or UPDATE', async () => {
      const at = f.observed.length, result = await list(request), observed = f.observed.slice(at);
      assert.equal(result.visits.length, 2); assert(result.visits.every(row => row.displayName === 'Synthetic Customer'));
      assert.equal(observed.filter(row => row.command === 'BEGIN').length, 2);
      assert.equal(observed.filter(row => row.command === 'COMMIT').length, 2);
      assert(!observed.some(row => ['INSERT', 'UPDATE'].includes(row.command)));
      assert(!/phone|13000000000|customerProfileId|scope/.test(JSON.stringify(result)));
    });
    await check('same name and phone stay separate with independently bound profiles and selected revisions', async () => {
      const result = await list(request), resolve = createVisitScopeResolver({ executor });
      for (const [index, row] of result.visits.entries()) {
        assert.deepEqual(await resolve({ credential: f.credential, visit: row.visit, expectedBindingRevision: row.bindingRevision }), { scope: index === 0 ? f.scopeA : f.scopeB });
      }
      assert.notEqual(result.visits[0].id, result.visits[1].id);
    });
    await check('frontdesk and appointment sources coexist without identity inference', async () => {
      await f.seedSource(uuid, { sourceName: 'frontdesk' });
      const result = await list(request); assert.equal(result.visits.length, 3); assert(result.visits.some(row => row.id === frontdesk.visitId));
    });
    await check('unbound visits omitted, other employee/store/day filtered by actual fixed SQL', async () => {
      f.sql(`insert into public.bookings values (401,'alice','${f.store}','${date}',0,'Hidden Unbound Name','13000000000'),(402,'bob','${f.store}','${date}',0,'Other Employee','13000000000'),(403,'alice','向里造型','${date}',0,'Other Store','13000000000'),(404,'alice','${f.store}','2026-11-16',0,'Other Day','13000000000');`);
      f.lifecycle(f.sourceRow(401));
      const result = await list(request); assert.equal(result.visits.length, 3); assert(!/401|402|403|404|Hidden|Other/.test(JSON.stringify(result)));
      assert.deepEqual(await list({ ...request, date: '2026-11-17' }), { date: '2026-11-17', visits: [] });
    });
    const changed = async mutate => {
      let transactions = 0;
      const guarded = createVisitListService({ executor: { async readTransaction(work) { if (++transactions === 2) await mutate(); return executor.readTransaction(work); } } });
      await denies(() => guarded(request)); assert.equal(transactions, 2);
    };
    await check('reassignment between released first read and new final read withholds stale list', async () => {
      await changed(() => { f.sql("update public.bookings set barber_name='bob' where id=101;"); f.lifecycle(f.sourceRow(101, 'bob')); });
      f.sql("update public.bookings set barber_name='alice' where id=101;"); f.lifecycle(f.sourceRow(101));
    });
    await check('binding revocation between independent reads withholds stale list', async () => {
      await changed(async () => { const command = f.command(101, { expectedRevision: 1, action: 'revoke' }); await binding.applyChange(f.approve(command, f.sourceRow(101))); });
      const command = f.command(101, { expectedRevision: 2, action: 'restore' }); await binding.applyChange(f.approve(command, f.sourceRow(101)));
    });
    await check('stale selected binding revision denied after revoke/restore', async () => {
      const listed = await list(request), row = listed.visits.find(row => row.id === appointment.visitId);
      const revoke = f.command(101, { expectedRevision: 3, action: 'revoke' }); await binding.applyChange(f.approve(revoke, f.sourceRow(101)));
      const restore = f.command(101, { expectedRevision: 4, action: 'restore' }); await binding.applyChange(f.approve(restore, f.sourceRow(101)));
      await assert.rejects(() => createVisitScopeResolver({ executor })({ credential: f.credential, visit: row.visit, expectedBindingRevision: row.bindingRevision }), error => error instanceof ProductionEmployeeError && error.code === 'CUSTOMER_BINDING_CHANGED');
    });
    await check('session revocation and expiry between independent reads deny all output', async () => {
      await changed(() => f.sql("delete from public.employee_booking_sessions where username='alice';")); f.session('alice');
      await changed(() => f.session('alice', Date.now() - 1000)); f.session('alice');
    });
    await check('lifecycle denial and corrupt bound profile fail rather than return fake empty', async () => {
      f.lifecycle(f.sourceRow(101), { allowed: false }); await denies(() => list(request)); f.lifecycle(f.sourceRow(101));
      f.sql("update public.customer_profiles set name=repeat('x',257) where id=11;"); await denies(() => list(request));
      f.sql("update public.customer_profiles set name='Synthetic Customer' where id=11;");
    });
    await check('51 combined source rows fail explicitly, including unbound rows and frontdesk', async () => {
      // 101,102,401 + one frontdesk + 47 new rows = 51; other staff/store/day do not count.
      f.sql(`insert into public.bookings select id,'alice','${f.store}','${date}',0,'Unbound Limit Fixture','13000000000' from generate_series(500,546) id;`);
      await denies(() => list(request), 'VISIT_LIST_LIMIT_EXCEEDED');
    });
    console.log(`PostgreSQL visit list tests passed: ${count}`);
  } finally { await f.cleanup(); console.log('Isolated PostgreSQL visit-list fixture cleanup verified'); }
}

for (let i = 0; i < tests.length; i++) { await tests[i].run(); console.log(`ok ${i + 1} - ${tests[i].name}`); }
console.log(`Pure visit list tests passed: ${tests.length}`);
if (process.argv.includes('--postgres')) await postgresTests();
