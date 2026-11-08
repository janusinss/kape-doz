import assert from 'node:assert/strict';
import test from 'node:test';
import { api, commandAction, HubError, refreshCommand, validateInventoryAlertHistory, validateInventoryAlerts, validateThresholdHistory, type Mutation, type Session } from '../src/api';
import { AdminRecoveryError, pendingAdminCommand } from '../src/admin_recovery';

const alertId = 'a878b063-63ba-4128-a030-d5d25c7b7a7d';
const commandId = 'ec01b535-bda3-4d4f-a383-9d6e6930ebd8';
const eventId = 'ddc42dd1-19fe-4785-8f91-3fc306fe837d';
const base = '/api/v1/inventory';
const session: Session = {
  token: 'fixture-token', expiresAt: Date.now() + 60_000,
  authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
  actor: { id: 'manager', displayName: 'Fixture manager', branchId: 'branch', role: 'manager' },
};
const scope = { hubOrigin: session.hubOrigin, authorityId: session.authorityId, actorId: 'manager', branchId: 'branch', role: 'manager' as const };
const lowStock = {
  id: alertId, branchId: 'branch', ingredientId: 'beans', kind: 'low_stock', status: 'open', version: 1,
  onHandMilli: 5_000, reservedMilli: 3_000, availableMilli: 2_000, thresholdMilli: 5_000,
  openedAt: 1000, lastEvaluatedAt: 1100, acknowledgedBy: null, acknowledgedAt: null, acknowledgmentNote: null,
  resolvedAt: null, resolution: null,
};
const acknowledged = { ...lowStock, status: 'acknowledged', version: 2, acknowledgedBy: 'manager', acknowledgedAt: 1200, acknowledgmentNote: 'Restock requested' };
const resolved = { ...acknowledged, status: 'resolved', version: 3, lastEvaluatedAt: 1300, onHandMilli: 10_000, availableMilli: 7_000, resolvedAt: 1300, resolution: 'stock_recovered' };
const threshold = { ingredientId: 'beans', thresholdMilli: 5_000, version: 1 };
const listing = { thresholds: [threshold], alerts: [lowStock], nextCursor: null, evaluatedAt: 1400 };
const openedEvent = {
  id: eventId, alertId, version: 1, type: 'opened', commandId: null, actorId: null, at: 0, note: null,
  onHandMilli: 5_000, reservedMilli: 3_000, availableMilli: 2_000, thresholdMilli: 5_000,
};
const shortage = {
  id: eventId, orderId: 'order-1', ingredientId: 'beans', phase: 'release', requiredMilli: 10_000,
  availableMilli: -2_000, shortfallMilli: 12_000, commandId, at: 1100,
};
const history = { events: [openedEvent], shortages: [shortage] };
const validators = { validateInventoryAlertHistory, validateInventoryAlerts };

test('threshold history retains null transitions, actor, reason and a scoped descending cursor', () => {
  const first = { commandId, ingredientId: 'beans', version: 2, previousMilli: 5_000, thresholdMilli: null, reason: 'No threshold needed', actorId: 'manager', at: 1500 };
  const second = { ...first, commandId: eventId, version: 1, previousMilli: null, thresholdMilli: 5_000, reason: 'Monitor beans' };
  const history = { events: [first, second], nextBeforeVersion: null };
  assert.deepEqual(validateThresholdHistory(history, 'beans'), history);
  assert.deepEqual(validateThresholdHistory({ events: [second], nextBeforeVersion: null }, 'beans', 2), { events: [second], nextBeforeVersion: null });
  for (const invalid of [
    { ...history, events: [{ ...first, ingredientId: 'milk' }] },
    { ...history, events: [second, first] },
    { ...history, events: [first, first] },
    { ...history, events: [{ ...first, reason: ' ' }] },
    { ...history, events: [{ ...first, previousMilli: -1 }] },
    { ...history, nextBeforeVersion: 1 },
  ]) assert.throws(() => validateThresholdHistory(invalid, 'beans'), HubError);
  assert.throws(() => validateThresholdHistory(history, 'beans', 2), HubError);
});
function command(path: string, data: Record<string, unknown>): Mutation {
  return { id: commandId, path: base + path, data, label: 'Inventory change recorded.', actorId: scope.actorId, branchId: scope.branchId };
}

test('saved threshold and acknowledgment commands bind exact fields, version and action', () => {
  for (const [mutation, action] of [
    [command('/thresholds/beans', { expectedVersion: 0, thresholdMilli: 0, reason: 'Monitor depletion' }), 'inventory.threshold.set'],
    [command('/thresholds/beans', { expectedVersion: 3, thresholdMilli: null, reason: 'Disable low-stock notification' }), 'inventory.threshold.set'],
    [command(`/alerts/${alertId}/acknowledge`, { expectedVersion: 1, note: 'Restock requested' }), 'inventory.alert.acknowledge'],
  ] as const) {
    assert.equal(commandAction(pendingAdminCommand(mutation, scope, 1000)), action);
    assert.throws(() => pendingAdminCommand({ ...mutation, data: { ...mutation.data, extra: 1 } }, scope, 1000), AdminRecoveryError);
  }
  for (const invalid of [
    command('/thresholds/beans', { expectedVersion: -1, thresholdMilli: 1, reason: 'Reviewed' }),
    command('/thresholds/beans', { expectedVersion: 0, thresholdMilli: 1_000_000_000_001, reason: 'Reviewed' }),
    command('/thresholds/beans', { expectedVersion: 0, thresholdMilli: 0.5, reason: 'Reviewed' }),
    command('/thresholds/beans', { expectedVersion: 0, thresholdMilli: 1, reason: ' ' }),
    command(`/alerts/${alertId}/acknowledge`, { expectedVersion: 0, note: 'Reviewed' }),
    command(`/alerts/${alertId}/acknowledge`, { expectedVersion: 1, note: 'x'.repeat(161) }),
    command(`/alerts/${alertId}/resolve`, { expectedVersion: 1, note: 'Reviewed' }),
  ]) assert.throws(() => pendingAdminCommand(invalid, scope, 1000), AdminRecoveryError);
});

test('alert projections validate signed availability, lifecycle, branch and pagination', () => {
  for (const value of [listing, { ...listing, thresholds: [{ ...threshold, thresholdMilli: null, version: 0 }], alerts: [] },
    { ...listing, alerts: [acknowledged], nextCursor: alertId },
    { ...listing, alerts: [{ ...lowStock, kind: 'shortage', reservedMilli: 7_000, availableMilli: -2_000, thresholdMilli: null, openedAt: 0 }] },
  ]) assert.deepEqual(validators.validateInventoryAlerts(value, 'branch', 'active'), value);
  const closed = { ...listing, alerts: [resolved] };
  assert.deepEqual(validators.validateInventoryAlerts(closed, 'branch', 'resolved'), closed);
  const cleared = { ...listing, alerts: [{ ...resolved, thresholdMilli: null, resolution: 'threshold_changed' }] };
  assert.deepEqual(validators.validateInventoryAlerts(cleared, 'branch', 'resolved'), cleared);
  for (const value of [
    { ...listing, alerts: [{ ...lowStock, availableMilli: 1 }] },
    { ...listing, alerts: [{ ...lowStock, reservedMilli: -1, availableMilli: 5001 }] },
    { ...listing, alerts: [{ ...lowStock, status: 'acknowledged' }] },
    { ...listing, alerts: [{ ...lowStock, branchId: 'other-branch' }] },
    { ...listing, alerts: [{ ...lowStock, kind: 'shortage', reservedMilli: 7_000, availableMilli: -2_000 }] },
    { ...listing, alerts: [resolved] }, { ...listing, alerts: [lowStock, lowStock] },
    { ...listing, thresholds: [threshold, threshold] }, { ...listing, nextCursor: 'not-an-id' },
    { ...listing, evaluatedAt: NaN }, { ...listing, unexpected: true },
  ]) assert.throws(() => validators.validateInventoryAlerts(value, 'branch', 'active'), HubError);
});

test('alert history preserves legacy occurrence and validates linked exact shortfalls', () => {
  assert.deepEqual(validators.validateInventoryAlertHistory(history, alertId), history);
  for (const invalid of [
    { ...history, events: [{ ...openedEvent, alertId: eventId }] },
    { ...history, events: [openedEvent, openedEvent] },
    { ...history, shortages: [{ ...shortage, shortfallMilli: 10_000 }] },
    { ...history, shortages: [{ ...shortage, requiredMilli: 0 }] },
    { ...history, shortages: [{ ...shortage, commandId: 'invalid' }] },
  ]) assert.throws(() => validators.validateInventoryAlertHistory(invalid, alertId), HubError);
});

test('mutation receipts bind threshold values and acknowledged identity before durable unlock', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: session.hubOrigin } } });
  t.after(() => { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  let response: unknown;
  let currentList: unknown = listing;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const route = new URL(url).pathname;
    calls.push(route);
    assert.equal(new Headers(init?.headers).get('X-Kape-Doz-Authority'), session.authorityId);
    const body = init?.method === 'POST' ? response : route.endsWith('/history') ? history : route.endsWith('/alerts') ? currentList :
      { ingredients: [{ id: 'beans', name: 'Beans', unit: 'g', onHandMilli: 5_000, reservedMilli: 3_000 }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const setting = pendingAdminCommand(command('/thresholds/beans', { expectedVersion: 0, thresholdMilli: 5_000, reason: 'Reviewed' }), scope, 1000);
  response = { commandId, threshold };
  await api.mutate(session, setting);
  for (const wrong of [{ ...threshold, ingredientId: 'milk' }, { ...threshold, thresholdMilli: 5_001 }, { ...threshold, version: 2 }]) {
    response = { commandId, threshold: wrong };
    await assert.rejects(api.mutate(session, setting), error => error instanceof HubError && error.unknown);
  }
  const acknowledgment = pendingAdminCommand(command(`/alerts/${alertId}/acknowledge`, { expectedVersion: 1, note: 'Restock requested' }), scope, 1000);
  response = { commandId, alert: acknowledged };
  await api.mutate(session, acknowledgment);
  for (const wrong of [{ ...acknowledged, id: eventId }, { ...acknowledged, acknowledgmentNote: 'Wrong note' }, { ...acknowledged, acknowledgedBy: 'other' }, { ...acknowledged, version: 3 }, resolved]) {
    response = { commandId, alert: wrong };
    await assert.rejects(api.mutate(session, acknowledgment), error => error instanceof HubError && error.unknown);
  }
  calls.length = 0;
  await refreshCommand(session, acknowledgment);
  assert.ok(calls.includes(base + '/alerts'));
  assert.ok(calls.includes('/api/v1/ingredients'));
  currentList = { ...listing, alerts: [{ ...lowStock, availableMilli: 1 }] };
  await assert.rejects(refreshCommand(session, setting), HubError);
});
