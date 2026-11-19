/** Pure injected tests by default; --postgres adds only the isolated synthetic PG17 fixture. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVisitScopeResolver } from '../packages/design-production-adapter/visit-scope-resolver.mjs';
import { ProductionEmployeeError } from '../packages/design-production-adapter/employee-adapter.mjs';

const credential = 'synthetic-visit-scope-' + '0'.repeat(64);
const store = '自由手艺人', date = '2026-11-15', now = Date.UTC(2026, 10, 15);
const uuid = '00000000-0000-4000-8000-000000000003';
const appointment = { assignmentSource: 'appointment', visitId: 'booking:101' };
const frontdesk = { assignmentSource: 'frontdesk', visitId: `frontdesk:${uuid}` };
const copy = value => structuredClone(value);
const tests = [];
const test = (name, run) => tests.push({ name, run });
const denies = (run, code) => assert.rejects(run, error => error instanceof ProductionEmployeeError && (!code || error.code === code) && error.message === error.code && !Object.hasOwn(error, 'cause'));

function fixture(visit = appointment) {
  const a = visit.assignmentSource === 'appointment';
  const state = {
    now, session: { username: 'alice', store, position: 'stylist', expires_at: new Date(now + 3600000).toISOString() },
    staff: { username: 'alice', store, position: 'stylist', active: true, employment_status: 'active' },
    source: a ? { id: 101, barber_name: 'alice', shop_name: store, date, status: 0 } : { id: uuid, barber_name: 'alice', store, business_date: date, status: 'in_service' },
    profile: { id: 11, shop_name: store, card_packages: [], service_history: [] },
    binding: { ...visit, customerProfileId: '11', store, bookingDate: date, visitKey: a ? visit.visitId : `manual:${date}:${uuid}`, active: true, revision: 'binding:1' },
    sourceRows: 1, sessionRows: 1, staffRows: 1, profileRows: 1, bindingRows: 1, transactions: 0, paths: [], calls: [],
  };
  const many = (value, count) => Array.from({ length: count }, () => copy(value));
  const executor = {
    async readTransaction(work) {
      state.transactions++;
      await state.beforeTransaction?.(state.transactions);
      const tx = {
        clock: () => state.now,
        async restRows(path) {
          state.paths.push(path);
          if (path.startsWith('employee_booking_sessions?')) {
            assert(path.includes('token_hash=eq.' + createHash('sha256').update(credential).digest('hex')));
            return many(state.session, state.sessionRows);
          }
          if (path.startsWith('staff?')) return many(state.staff, state.staffRows);
          if (path.startsWith('bookings?') || path.startsWith('frontdesk_today_customers?')) return many(state.source, state.sourceRows);
          if (path.startsWith('customer_profiles?')) return many(state.profile, state.profileRows);
          assert.fail('Unexpected read');
        },
        async resolveVisitBinding(row) {
          state.calls.push(copy(row));
          assert.deepEqual(Object.keys(row).sort(), ['source', 'visitId', 'id', 'staffUsername', 'store', 'bookingDate', 'status'].sort());
          assert.equal(Object.isFrozen(row), true);
          await state.onBinding?.();
          return many(state.binding, state.bindingRows);
        },
        async rpc(name, args) {
          assert.equal(name, 'customer_design_resolve_context');
          await state.onRpc?.();
          return { customer_profile_id: args.p_customer_profile_id, booking_id: args.p_booking_id, booking_date: args.p_booking_date, visit_key: args.p_visit_key, store: state.profile.shop_name, name: 'Synthetic Customer', phone: '13000000000', ...state.contextPatch };
        },
      };
      if (state.missingMethod) delete tx[state.missingMethod];
      const result = await work(tx);
      await state.afterWork?.(state.transactions);
      return result;
    },
    writeTransaction() { assert.fail('Resolver must never use a write transaction'); },
  };
  const resolve = createVisitScopeResolver({ executor });
  return { state, executor, resolve, request: { credential, visit: copy(visit) } };
}

for (const visit of [appointment, frontdesk]) test(`${visit.assignmentSource}: actual employee gate, minimal frozen result and two independent reads`, async () => {
  const f = fixture(visit), result = await f.resolve(f.request);
  assert.deepEqual(result, { scope: { customerProfileId: '11', ...visit } });
  assert(Object.isFrozen(result) && Object.isFrozen(result.scope));
  assert.equal(f.state.transactions, 2);
  assert(f.state.calls.length >= 2);
  assert(f.state.paths.some(path => path.startsWith('customer_profiles?')));
  assert(!JSON.stringify(result).includes('alice'));
  assert(!JSON.stringify(result).includes('phone'));
  assert(!f.state.paths.some(path => path.includes(credential)));
});
test('default and incomplete transaction dependencies fail closed', async () => {
  await denies(() => createVisitScopeResolver()({ credential, visit: appointment }), 'EMPLOYEE_ADAPTER_NOT_CONFIGURED');
  for (const missingMethod of ['restRows', 'rpc', 'resolveVisitBinding']) {
    const f = fixture(); f.state.missingMethod = missingMethod;
    await denies(() => f.resolve(f.request), 'EMPLOYEE_ADAPTER_NOT_CONFIGURED');
  }
});
test('exact request and locator reject all identity/profile/store hints before reads', async () => {
  for (const field of ['customerProfileId', 'customerId', 'name', 'phone', 'store', 'staffUsername', 'scope', 'owner', 'credential']) {
    const f = fixture(); f.request.visit[field] = 'untrusted';
    await denies(() => f.resolve(f.request), 'INVALID_SCOPE'); assert.equal(f.state.transactions, 0);
  }
  for (const input of [null, [], { visit: appointment }, { credential, visit: appointment, scope: {} }, { credential, visit: { ...appointment, [Symbol('extra')]: true } }]) {
    const f = fixture(); await denies(() => f.resolve(input), 'INVALID_SCOPE'); assert.equal(f.state.transactions, 0);
  }
});
test('canonical source and ID formats only; no cross-source guessing or parser sentinel returned', async () => {
  for (const visit of [
    { ...appointment, visitId: 'booking:01' }, { ...appointment, visitId: 'booking:0' }, { ...appointment, visitId: 'booking:9007199254740992' },
    { ...appointment, visitId: 'booking:101&phone=eq.1' }, { ...appointment, visitId: frontdesk.visitId }, { ...frontdesk, visitId: appointment.visitId },
    { ...frontdesk, visitId: 'frontdesk:' + uuid.slice(0, -1) + 'A' }, { ...appointment, assignmentSource: 'customer' },
  ]) {
    const f = fixture(); await denies(() => f.resolve({ credential, visit }), 'INVALID_SCOPE'); assert.equal(f.state.transactions, 0);
  }
  const f = fixture(); f.state.binding.customerProfileId = '42'; f.state.profile.id = 42;
  assert.equal((await f.resolve(f.request)).scope.customerProfileId, '42');
});
test('session revocation, ambiguity, expiry and inactive staff deny before assignment', async () => {
  for (const mutate of [s => s.sessionRows = 0, s => s.sessionRows = 2, s => s.staffRows = 2, s => s.staff.active = false, s => s.staff.employment_status = 'inactive', s => s.staff.store = '向里造型', s => s.now += 3600000]) {
    const f = fixture(); mutate(f.state); await denies(() => f.resolve(f.request), 'AUTHENTICATION_REQUIRED'); assert.equal(f.state.calls.length, 0);
  }
});
test('assignment is one exact current stylist/store row with valid date and admitted status', async () => {
  for (const mutate of [s => s.sourceRows = 0, s => s.sourceRows = 2, s => s.source.id = 102, s => s.source.barber_name = 'bob', s => s.source.shop_name = '向里造型', s => s.source.date = '2026-02-30', s => s.source.status = 9, s => s.source.status = '0']) {
    const f = fixture(); mutate(f.state); await denies(() => f.resolve(f.request)); assert.equal(f.state.calls.length, 0);
  }
  const f = fixture(frontdesk); f.state.source.status = 'cancelled'; await denies(() => f.resolve(f.request), 'ASSIGNMENT_STATUS_UNSUPPORTED');
});
test('binding must be unique, active, exact, current and authoritative', async () => {
  for (const mutate of [s => s.bindingRows = 0, s => s.bindingRows = 2, s => s.binding.active = false, s => s.binding.customerProfileId = '01', s => s.binding.customerProfileId = '9007199254740992', s => s.binding.assignmentSource = 'frontdesk', s => s.binding.visitId = 'booking:102', s => s.binding.store = '向里造型', s => s.binding.bookingDate = '2026-11-16', s => s.binding.visitKey = 'booking:102', s => s.binding.revision = '', s => s.binding.phone = '13000000000', s => delete s.binding.active]) {
    const f = fixture(); mutate(f.state); await denies(() => f.resolve(f.request));
  }
});
test('trusted binding lifecycle denial is not replaced by admitted source status', async () => {
  const f = fixture(); f.state.onBinding = () => { throw new Error('unapproved lifecycle'); };
  await denies(() => f.resolve(f.request), 'CUSTOMER_BINDING_UNAVAILABLE');
});
test('actual shared profile/context gates reject store mismatch, duplicate or wrong profile and RPC mismatch', async () => {
  for (const mutate of [s => s.profile.shop_name = '向里造型', s => s.profileRows = 2, s => s.profile.id = 12, s => s.contextPatch = { customer_profile_id: 12 }, s => s.contextPatch = { visit_key: 'booking:102' }]) {
    const f = fixture(); mutate(f.state); await denies(() => f.resolve(f.request));
  }
});
test('fresh return transaction withholds revoked, expired, reassigned, changed-actor or changed-scope data', async () => {
  for (const mutate of [
    s => s.sessionRows = 0, s => s.staff.active = false, s => s.now += 3600000, s => s.source.barber_name = 'bob', s => s.binding.active = false,
    s => { s.session.username = s.staff.username = s.source.barber_name = 'bob'; },
    s => { s.binding.customerProfileId = '12'; s.profile.id = 12; },
    s => s.binding.revision = 'binding:2',
    s => s.source.status = 1,
    s => { s.source.date = s.binding.bookingDate = '2026-11-16'; },
    s => s.onBinding = () => { throw new Error('lifecycle revoked'); },
  ]) {
    const f = fixture(); f.state.beforeTransaction = n => { if (n === 2) mutate(f.state); };
    await denies(() => f.resolve(f.request)); assert.equal(f.state.transactions, 2);
  }
});
test('authorization changes during shared context resolution are caught by real delayed-read checks', async () => {
  const f = fixture(); let changed = false;
  f.state.onRpc = () => { if (!changed) { changed = true; f.state.staff.active = false; } };
  await denies(() => f.resolve(f.request));
});
test('request locator is captured before asynchronous source work', async () => {
  const f = fixture(); f.state.beforeTransaction = () => { f.request.visit.visitId = 'booking:999'; f.request.credential = 'different'; };
  assert.deepEqual(await f.resolve(f.request), { scope: { customerProfileId: '11', ...appointment } });
});
test('executor bypass, replay and swapped result fail closed', async () => {
  const f = fixture();
  await denies(() => createVisitScopeResolver({ executor: { readTransaction: async () => ({ scope: { customerProfileId: '1', ...appointment } }) } })(f.request), 'CUSTOMER_BINDING_UNAVAILABLE');
  await denies(() => createVisitScopeResolver({ executor: { readTransaction: work => f.executor.readTransaction(async tx => { await work(tx); return work(tx); }) } })(f.request));
  await denies(() => createVisitScopeResolver({ executor: { readTransaction: async work => { await f.executor.readTransaction(work); return {}; } } })(f.request));
});
test('arbitrary dependency diagnostics and forged class codes are never returned', async () => {
  for (const error of [new Error('secret token, SQL and phone'), new ProductionEmployeeError('secret token, SQL and phone')]) {
    const f = fixture();
    await denies(() => createVisitScopeResolver({ executor: { readTransaction: async () => { throw error; } } })(f.request), 'CUSTOMER_BINDING_UNAVAILABLE');
  }
});
test('optional expected binding revision is exact, bounded and captured before asynchronous reads', async () => {
  for (const invalid of [undefined, null, '', ' ', ' binding:1', 'binding:1\n', 'x'.repeat(161), 1, {}]) {
    const f = fixture();
    await denies(() => f.resolve({ ...f.request, expectedBindingRevision: invalid }), 'INVALID_SCOPE');
    assert.equal(f.state.transactions, 0);
  }
  const f = fixture(); f.request.expectedBindingRevision = 'binding:1';
  f.state.beforeTransaction = () => { f.request.expectedBindingRevision = 'binding:2'; };
  assert.deepEqual(await f.resolve(f.request), { scope: { customerProfileId: '11', ...appointment } });
  assert.equal(f.state.transactions, 2);
});
test('selected revision must match in each actual read and never substitutes for authentication', async () => {
  const first = fixture(); first.request.expectedBindingRevision = 'binding:older';
  await denies(() => first.resolve(first.request), 'CUSTOMER_BINDING_CHANGED'); assert.equal(first.state.transactions, 1);
  const second = fixture(); second.request.expectedBindingRevision = 'binding:1';
  second.state.beforeTransaction = n => { if (n === 2) second.state.binding.revision = 'binding:2'; };
  await denies(() => second.resolve(second.request), 'CUSTOMER_BINDING_CHANGED'); assert.equal(second.state.transactions, 2);
  const revoked = fixture(); revoked.request.expectedBindingRevision = 'binding:1'; revoked.state.sessionRows = 0;
  await denies(() => revoked.resolve(revoked.request), 'AUTHENTICATION_REQUIRED');
});

async function postgresTests() {
  const { createDesignPostgresFixture } = await import('./fixtures/design-postgres-fixture.mjs');
  const { createDesignPostgresExecutor } = await import('../packages/design-production-adapter/postgres-executor.mjs');
  const { createVisitBindingAdapter } = await import('../packages/design-production-adapter/visit-binding.mjs');
  const f = await createDesignPostgresFixture();
  try {
    const executor = createDesignPostgresExecutor({ acquireClient: f.acquireClient, lifecyclePolicy: f.lifecyclePolicy });
    const resolve = createVisitScopeResolver({ executor });
    const request = visit => ({ credential: f.credential, visit });
    let count = 0;
    const check = async (name, run) => { await run(); count++; console.log(`ok pg ${count} - ${name}`); };
    await check('appointment scope from actual unique binding and shared RPC, exactly two read transactions', async () => {
      const at = f.observed.length;
      assert.deepEqual(await resolve(request(appointment)), { scope: f.scopeA });
      const observed = f.observed.slice(at);
      assert.equal(observed.filter(row => row.command === 'BEGIN').length, 2);
      assert.equal(observed.filter(row => row.command === 'COMMIT').length, 2);
      assert(!observed.some(row => ['INSERT', 'UPDATE'].includes(row.command)));
    });
    await check('frontdesk source remains distinct with canonical visit key', async () => {
      const scope = await f.seedSource(uuid, { sourceName: 'frontdesk' });
      assert.deepEqual(await resolve(request(frontdesk)), { scope });
    });
    await check('equal synthetic names and phones never choose another profile', async () => {
      assert.deepEqual(await resolve(request(f.visit(102))), { scope: f.scopeB });
      await denies(() => resolve(request(f.visit(999))));
    });
    await check('existing source without authoritative binding denies', async () => {
      f.sql(`insert into public.bookings values(301,'alice','${f.store}','2026-11-15',0,'Synthetic Customer','13000000000');`);
      f.lifecycle(f.sourceRow(301));
      await denies(() => resolve(request(f.visit(301))));
    });
    await check('different current stylist denies', async () => {
      await f.seedSource(302, { staffUsername: 'bob' });
      await denies(() => resolve(request(f.visit(302))));
    });
    await check('lifecycle denied, expired, unapproved and stale decisions all deny', async () => {
      await f.seedSource(303);
      for (const patch of [{ allowed: false }, { expires_at: new Date(Date.now() - 1000).toISOString() }, { policy_revision: 'unapproved' }]) {
        f.lifecycle(f.sourceRow(303), patch); await denies(() => resolve(request(f.visit(303))));
      }
      f.lifecycle(f.sourceRow(303)); f.sql('update public.bookings set status=1 where id=303;');
      await denies(() => resolve(request(f.visit(303))));
    });
    await check('binding revocation between released first read and fresh return read denies', async () => {
      await f.seedSource(304); let transactions = 0;
      const binding = createVisitBindingAdapter(executor);
      const guarded = createVisitScopeResolver({ executor: { async readTransaction(work) {
        if (++transactions === 2) {
          const command = f.command(304, { expectedRevision: 1, action: 'revoke' });
          await binding.applyChange(f.approve(command, f.sourceRow(304)));
        }
        return executor.readTransaction(work);
      } } });
      await denies(() => guarded(request(f.visit(304)))); assert.equal(transactions, 2);
    });
    await check('source reassignment between independent transactions denies', async () => {
      await f.seedSource(305); let transactions = 0;
      const guarded = createVisitScopeResolver({ executor: { async readTransaction(work) {
        if (++transactions === 2) { f.sql("update public.bookings set barber_name='bob' where id=305;"); f.lifecycle(f.sourceRow(305, 'bob')); }
        return executor.readTransaction(work);
      } } });
      await denies(() => guarded(request(f.visit(305)))); assert.equal(transactions, 2);
    });
    await check('session revocation after first read prevents final result', async () => {
      let transactions = 0;
      const guarded = createVisitScopeResolver({ executor: { async readTransaction(work) {
        if (++transactions === 2) f.sql("delete from public.employee_booking_sessions where username='alice';");
        return executor.readTransaction(work);
      } } });
      await denies(() => guarded(request(appointment))); f.session('alice');
    });
    console.log(`PostgreSQL visit scope tests passed: ${count}`);
  } finally { await f.cleanup(); console.log('Isolated PostgreSQL visit-scope fixture cleanup verified'); }
}

for (let i = 0; i < tests.length; i++) { await tests[i].run(); console.log(`ok ${i + 1} - ${tests[i].name}`); }
console.log(`Pure visit scope tests passed: ${tests.length}`);
if (process.argv.includes('--postgres')) await postgresTests();
