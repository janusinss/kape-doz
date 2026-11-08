import assert from 'node:assert/strict';
import test from 'node:test';
import { api, commandAction, HubError, refreshCommand, validateCommandStatus, validateStockCounts, type Mutation, type Session } from '../src/api';
import { AdminRecoveryError, pendingAdminCommand } from '../src/admin_recovery';

const countId = '88755b9e-b282-4516-adc8-562336d54cd6';
const commandId = '9cce8488-4531-4c38-8fc0-eab62d6a32cb';
const path = '/api/v1/inventory/counts';
const session: Session = {
  token: 'fixture-token', expiresAt: Date.now() + 60_000,
  authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
  actor: { id: 'manager', displayName: 'Fixture manager', branchId: 'branch', role: 'manager' },
};
const scope = { hubOrigin: session.hubOrigin, authorityId: session.authorityId, actorId: 'manager', branchId: 'branch', role: 'manager' as const };
const opened = {
  id: countId, ingredientId: 'beans', unit: 'g', status: 'open', version: 1,
  snapshotMilli: 100_000, snapshotStockVersion: 7, liveOnHandMilli: 100_000, liveStockVersion: 7,
  observedMilli: null, varianceMilli: null, reason: null, costStatus: 'not_required',
  totalCostCentavos: null, costReference: null, canRevalue: false,
  balanceCostCentavos: null, balanceCostReference: null,
};
const submitted = { ...opened, status: 'submitted', version: 2, observedMilli: 110_000, varianceMilli: 10_000 };
const approved = {
  ...submitted, status: 'approved', version: 3, reason: 'Extra beans on shelf', costStatus: 'pending',
  liveOnHandMilli: 110_000, liveStockVersion: 8,
};
const costConfirmed = {
  ...approved, version: 4, costStatus: 'confirmed', totalCostCentavos: 2300, costReference: 'Supplier docket', canRevalue: true,
};
const revalued = {
  ...costConfirmed, version: 5, canRevalue: false, balanceCostCentavos: 25_000, balanceCostReference: 'Reviewed all remaining packs',
};

function command(suffix: string, data: Record<string, unknown>): Mutation {
  return { id: commandId, path: path + suffix, data, label: 'Stock count change recorded.', actorId: scope.actorId, branchId: scope.branchId };
}

test('the journal binds every stock count route to exact values and the authority', () => {
  const actions = [
    [command('', { ingredientId: 'beans' }), 'inventory.count.start'],
    [command(`/${countId}/observe`, { expectedVersion: 1, unit: 'g', observedMilli: 0 }), 'inventory.count.observe'],
    [command(`/${countId}/decide`, { expectedVersion: 2, decision: 'approve', reason: 'Reviewed' }), 'inventory.count.decide'],
    [command(`/${countId}/confirm-cost`, { expectedVersion: 3, totalCostCentavos: 2300, reference: 'Supplier docket' }), 'inventory.count.confirm_cost'],
    [command(`/${countId}/revalue`, { expectedVersion: 4, expectedStockVersion: 8, totalCostCentavos: 25_000, reference: 'Reviewed all remaining packs' }), 'inventory.count.revalue'],
  ] as const;
  for (const [mutation, action] of actions) {
    const saved = pendingAdminCommand(mutation, scope, 1000);
    assert.equal(commandAction(saved), action);
    const accepted = { commandId, status: 'accepted', action, acceptedAt: 1000 };
    assert.deepEqual(validateCommandStatus(accepted, saved), accepted);
    assert.throws(() => validateCommandStatus({ ...accepted, action: 'inventory.receive' }, saved), HubError);
    assert.throws(() => pendingAdminCommand({ ...mutation, data: { ...mutation.data, extra: 'field' } }, scope, 1000), AdminRecoveryError);
  }
  for (const invalid of [
    command('', { ingredientId: '../beans' }),
    command(`/${countId}/observe`, { expectedVersion: 1, unit: 'kg', observedMilli: 0 }),
    command(`/${countId}/observe`, { expectedVersion: 1, unit: 'g', observedMilli: 0.5 }),
    command(`/${countId}/observe`, { expectedVersion: 1, unit: 'g', observedMilli: 1_000_000_000_001 }),
    command(`/${countId}/decide`, { expectedVersion: 2, decision: 'approve', reason: ' ' }),
    command(`/${countId}/confirm-cost`, { expectedVersion: 3, totalCostCentavos: 2300, reference: 'x'.repeat(161) }),
    command(`/${countId}/revalue`, { expectedVersion: 4, totalCostCentavos: 25_000, reference: 'Reviewed' }),
  ]) assert.throws(() => pendingAdminCommand(invalid, scope, 1000), AdminRecoveryError);
});

test('count validation distinguishes stale measurement, positive pending cost and a whole balance', () => {
  const history = [opened, { ...opened, liveStockVersion: 8, liveOnHandMilli: 90_000 }, submitted, approved, costConfirmed, revalued,
    { ...submitted, status: 'discarded', version: 3, reason: 'Recount after spill' },
    { ...opened, status: 'discarded', version: 2, reason: 'Moved before measurement' }];
  for (const count of history) assert.deepEqual(validateStockCounts({ counts: [count] }), { counts: [count] });
  assert.deepEqual(validateStockCounts({ counts: [] }), { counts: [] });
  for (const invalid of [
    { ...opened, observedMilli: 110_000 }, { ...opened, unit: 'kg' },
    { ...submitted, varianceMilli: 1_000 }, { ...submitted, liveStockVersion: 6 },
    { ...approved, costStatus: 'not_required' }, { ...approved, canRevalue: true },
    { ...costConfirmed, costReference: null }, { ...revalued, balanceCostReference: null },
    { ...revalued, canRevalue: true }, { ...opened, debug: 'unrecognized' },
  ]) assert.throws(() => validateStockCounts({ counts: [invalid] }), HubError);
  assert.throws(() => validateStockCounts({ counts: [opened, opened] }), HubError);
});

test('stock count acknowledgments bind target, version, measurement, decision and valuation before unlock', async t => {
  const cases = [
    [command('', { ingredientId: 'beans' }), opened, { ...opened, ingredientId: 'milk' }],
    [command(`/${countId}/observe`, { expectedVersion: 1, unit: 'g', observedMilli: 110_000 }), submitted, { ...submitted, observedMilli: 111_000, varianceMilli: 11_000 }],
    [command(`/${countId}/decide`, { expectedVersion: 2, decision: 'approve', reason: 'Extra beans on shelf' }), approved, { ...approved, reason: 'Wrong reason' }],
    [command(`/${countId}/confirm-cost`, { expectedVersion: 3, totalCostCentavos: 2300, reference: 'Supplier docket' }), costConfirmed, { ...costConfirmed, version: 5 }],
    [command(`/${countId}/revalue`, { expectedVersion: 4, expectedStockVersion: 8, totalCostCentavos: 25_000, reference: 'Reviewed all remaining packs' }), revalued, { ...revalued, balanceCostCentavos: 26000 }],
  ] as const;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: session.hubOrigin } } });
  t.after(() => { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  let response: unknown;
  let inventory: unknown = { counts: [revalued] };
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const route = new URL(url).pathname;
    calls.push(route);
    assert.equal(new Headers(init?.headers).get('X-Kape-Doz-Authority'), session.authorityId);
    const payload = init?.method === 'POST' ? response : route === path ? inventory :
      { ingredients: [{ id: 'beans', name: 'Beans', unit: 'g', onHandMilli: 110_000, reservedMilli: 0 }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  for (const [mutation, good, bad] of cases) {
    const saved = pendingAdminCommand(mutation, scope, 1000);
    response = { commandId, count: good };
    await api.mutate(session, saved);
    response = { commandId, count: bad };
    await assert.rejects(api.mutate(session, saved), error => error instanceof HubError && error.unknown);
  }
  calls.length = 0;
  const saved = pendingAdminCommand(cases[3][0], scope, 1000);
  await refreshCommand(session, saved);
  assert.ok(calls.includes(path));
  assert.ok(calls.includes('/api/v1/ingredients'));
  inventory = { counts: [{ ...approved, observedMilli: -1 }] };
  await assert.rejects(refreshCommand(session, saved), HubError);
});
