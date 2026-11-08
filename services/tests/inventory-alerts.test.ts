import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';
import { HubDatabase } from '../src/database.js';

const branchId = 'alerts-north';
const alertsPath = '/api/v1/inventory/alerts';
const password = 'Inventory-Alerts-Fixture-2026!';
const deviceSecret = 'Inventory-Alerts-Fixture-Device-2026!';
const now = () => Date.UTC(2026, 10, 6, 8);
type Response = { statusCode: number; body: string; json(): unknown };
type Alert = {
  id: string; branchId: string; ingredientId: string; kind: 'low_stock' | 'shortage';
  status: 'open' | 'acknowledged' | 'resolved'; version: number; onHandMilli: number;
  reservedMilli: number; availableMilli: number; thresholdMilli: number | null;
  openedAt: number; lastEvaluatedAt: number; acknowledgedBy: string | null;
  acknowledgedAt: number | null; acknowledgmentNote: string | null; resolvedAt: number | null;
  resolution: 'stock_recovered' | 'threshold_changed' | null;
};
type Threshold = { ingredientId: string; thresholdMilli: number | null; version: number };
type Listing = { thresholds: Threshold[]; alerts: Alert[]; nextCursor: string | null; evaluatedAt: number };
type Order = { id: string; version: number };

function ok<T>(response: Response): T {
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as T;
}

async function fixture(t: TestContext) {
  const tempRoot = resolve(tmpdir());
  const prefix = join(tempRoot, 'kape-doz-inventory-alerts-');
  const folder = await mkdtemp(prefix);
  const databasePath = join(folder, 'hub.sqlite');
  let time = now();
  const clock = () => time;
  let hub = await createHub({ databasePath, now: clock });
  const inspector = new DatabaseSync(databasePath);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  for (const [id, role, branch] of [
    ['owner-a', 'owner', branchId], ['manager-a', 'manager', branchId],
    ['owner-b', 'owner', 'alerts-south'], ['cashier-a', 'cashier', branchId], ['barista-a', 'barista', branchId],
  ] as const) {
    await hub.provisionAccount({ id, displayName: id, role, branchId: branch, secret: ['cashier', 'barista'].includes(role) ? '5928' : password });
  }
  await hub.provisionDevice({ id: 'alerts-tablet', branchId, secret: deviceSecret });
  const tokens: Record<string, string> = {};
  for (const id of ['owner-a', 'manager-a', 'owner-b', 'cashier-a', 'barista-a']) {
    const staff = id === 'cashier-a' || id === 'barista-a';
    tokens[id] = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: `/api/v1/auth/${staff ? 'staff' : 'admin'}`,
      payload: staff ? { accountId: id, pin: '5928', deviceId: 'alerts-tablet', deviceSecret } : { accountId: id, password },
    })).token;
  }
  const owner = tokens['owner-a']!;
  const manager = tokens['manager-a']!;
  const otherOwner = tokens['owner-b']!;
  const cashier = tokens['cashier-a']!;
  const barista = tokens['barista-a']!;
  const get = (url: string, token: string | null = owner) => hub.app.inject({
    method: 'GET', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
  const post = (url: string, payload: Record<string, unknown>, token: string | null = owner, commandId: string = randomUUID()) => hub.app.inject({
    method: 'POST', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), payload: { commandId, ...payload },
  });
  const list = async (status = 'active', token = owner) => ok<Listing>(await get(`${alertsPath}?status=${status}`, token));
  const threshold = async (thresholdMilli: number | null, expectedVersion: number, commandId = randomUUID()) => ok<{ threshold: Threshold }>(
    await post('/api/v1/inventory/thresholds/beans', { thresholdMilli, expectedVersion, reason: 'Fixture stock threshold review' }, owner, commandId),
  ).threshold;
  const receive = async (quantityMilli: number) => ok(await post('/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli, totalCostCentavos: 100, reference: 'Fixture receiving' }));
  const waste = async (quantityMilli: number) => ok(await post('/api/v1/waste', { ingredientId: 'beans', quantityMilli, reason: 'Fixture dial-in', note: '' }, barista));
  const rows = (sql: string, ...values: SQLInputValue[]) => inspector.prepare(sql).all(...values).map(row => ({ ...row }));
  ok(await post('/api/v1/ingredients', { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
  await receive(1000);
  ok(await post('/api/v1/products', { productId: 'drink', name: 'Fixture drink', priceCentavos: 12000, recipe: [{ ingredientId: 'beans', quantityMilli: 600 }] }));
  return {
    owner, manager, otherOwner, cashier, barista, get, post, list, threshold, receive, waste, rows,
    fault(sql: string) { inspector.exec(sql); },
    advanceMinute() { time += 60_000; },
    rewindMinute() { time -= 60_000; },
    async reopen() { await hub.close(); hub = await createHub({ databasePath, now: clock }); },
    async send(commandId = randomUUID()) {
      const created = ok<{ order: Order }>(await post('/api/v1/orders', { dineIn: true, table: '04', items: [{ productId: 'drink', quantity: 1 }] }, cashier)).order;
      const input = { expectedVersion: created.version };
      const path = `/api/v1/orders/${created.id}/send`;
      const order = ok<{ order: Order }>(await post(path, input, cashier, commandId)).order;
      return { order, path, input, commandId };
    },
  };
}

test('inventory alerts are administrator-only and default every ingredient threshold to unconfigured', async t => {
  const f = await fixture(t);
  const listing = ok<Listing>(await f.get(alertsPath));
  assert.deepEqual(listing.thresholds, [{ ingredientId: 'beans', thresholdMilli: null, version: 0 }]);
  assert.deepEqual(listing.alerts, []);
  assert.equal(listing.nextCursor, null);
  assert.equal(listing.evaluatedAt, now());
  assert.equal((await f.get(alertsPath, null)).statusCode, 401);
  for (const token of [f.cashier, f.barista]) {
    assert.equal((await f.get(alertsPath, token)).statusCode, 403);
    assert.equal((await f.post('/api/v1/inventory/thresholds/beans', { expectedVersion: 0, thresholdMilli: 100, reason: 'Forbidden threshold' }, token)).statusCode, 403);
  }
  assert.deepEqual((await f.list('active', f.otherOwner)).thresholds, []);
});

test('low-stock equality opens one incident, acknowledgment survives updates, and recovery allows a fresh incident', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.threshold(500, 0), { ingredientId: 'beans', thresholdMilli: 500, version: 1 });
  assert.deepEqual((await f.list()).alerts, []);
  await f.waste(500);
  const initial = (await f.list()).alerts;
  assert.equal(initial.length, 1);
  const opened = initial[0]!;
  assert.match(opened.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(opened.kind, 'low_stock');
  assert.equal(opened.status, 'open');
  assert.equal(opened.onHandMilli, 500);
  assert.equal(opened.thresholdMilli, 500);
  assert.equal(opened.version, 1);
  assert.equal(opened.resolution, null);
  const historyBefore = f.rows('SELECT * FROM inventory_alert_events WHERE alert_id=? ORDER BY version', opened.id);
  await f.list();
  assert.deepEqual(f.rows('SELECT * FROM inventory_alert_events WHERE alert_id=? ORDER BY version', opened.id), historyBefore);

  const ackId = randomUUID();
  const path = `${alertsPath}/${opened.id}/acknowledge`;
  const input = { expectedVersion: opened.version, note: 'Bar team informed' };
  const acknowledged = ok<{ alert: Alert }>(await f.post(path, input, f.manager, ackId)).alert;
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.version, 2);
  assert.equal(acknowledged.acknowledgedBy, 'manager-a');
  assert.equal(acknowledged.acknowledgmentNote, 'Bar team informed');
  await f.waste(1);
  const updated = (await f.list()).alerts[0]!;
  assert.equal(updated.id, opened.id);
  assert.equal(updated.status, 'acknowledged');
  assert.equal(updated.version, 3);
  assert.equal(updated.onHandMilli, 499);
  await f.reopen();
  assert.deepEqual(ok<{ alert: Alert }>(await f.post(path, input, f.manager, ackId)).alert, acknowledged);
  await f.receive(2);
  assert.deepEqual((await f.list()).alerts, []);
  const resolved = (await f.list('resolved')).alerts[0]!;
  assert.equal(resolved.id, opened.id);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolution, 'stock_recovered');
  assert.equal(resolved.acknowledgedBy, 'manager-a');
  assert.equal(resolved.acknowledgmentNote, 'Bar team informed');
  const history = ok<{ events: { type: string; version: number }[]; shortages: unknown[] }>(await f.get(`${alertsPath}/${opened.id}/history`));
  assert.deepEqual(history.events.map(event => event.type), ['opened', 'acknowledged', 'updated', 'resolved']);
  assert.deepEqual(history.events.map(event => event.version), [1, 2, 3, 4]);
  assert.deepEqual(history.shortages, []);
  await f.waste(1);
  const reopened = (await f.list()).alerts[0]!;
  assert.notEqual(reopened.id, opened.id);
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.version, 1);
  assert.equal(reopened.acknowledgedBy, null);
  assert.equal(reopened.acknowledgmentNote, null);
});

test('clock rollback preserves one incident and nondecreasing alert event times', async t => {
  const f = await fixture(t);
  await f.threshold(500, 0);
  await f.waste(500);
  const opened = (await f.list()).alerts[0]!;
  f.rewindMinute();
  await f.waste(1);
  const updated = (await f.list()).alerts;
  assert.equal(updated.length, 1);
  assert.equal(updated[0]!.id, opened.id);
  assert.equal(updated[0]!.status, 'open');
  assert.equal(updated[0]!.onHandMilli, 499);
  const acknowledgment = ok<{ alert: Alert }>(await f.post(`${alertsPath}/${opened.id}/acknowledge`,
    { expectedVersion: updated[0]!.version, note: 'Clock changed during service' }, f.manager)).alert;
  assert.equal(acknowledgment.id, opened.id);
  assert.equal(acknowledgment.status, 'acknowledged');
  assert.ok(acknowledgment.acknowledgedAt! >= opened.openedAt);
  assert.ok(acknowledgment.lastEvaluatedAt >= opened.openedAt);
  const events = f.rows('SELECT version,at FROM inventory_alert_events WHERE alert_id=? ORDER BY version', opened.id);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(event => event.version), [1, 2, 3]);
  for (let index = 1; index < events.length; index++) {
    assert.ok(Number(events[index]!.at) >= Number(events[index - 1]!.at));
  }
  await f.receive(2);
  const resolved = (await f.list('resolved')).alerts[0]!;
  assert.equal(resolved.id, opened.id);
  assert.ok(resolved.resolvedAt! >= acknowledgment.acknowledgedAt!);
  await f.waste(1);
  const reopened = (await f.list()).alerts;
  assert.equal(reopened.length, 1);
  assert.notEqual(reopened[0]!.id, opened.id);
  assert.ok(reopened[0]!.openedAt > resolved.resolvedAt!, 'new incidents sort after the prior resolution');
});

test('threshold commands preserve replay, strict versions and branch privacy when disabling low-stock alerts', async t => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const saved = await f.threshold(1000, 0, commandId);
  const opened = (await f.list()).alerts[0]!;
  assert.equal((await f.post('/api/v1/inventory/thresholds/beans', { expectedVersion: 0, thresholdMilli: 1001, reason: 'Stale edit' })).statusCode, 409);
  const disabled = await f.threshold(null, saved.version);
  assert.equal(disabled.version, 2);
  assert.deepEqual(await f.threshold(1000, 0, commandId), saved);
  assert.deepEqual((await f.list()).alerts, []);
  const resolved = (await f.list('resolved')).alerts[0]!;
  assert.equal(resolved.id, opened.id);
  assert.equal(resolved.resolution, 'threshold_changed');
  assert.equal(resolved.thresholdMilli, null);
  for (const payload of [
    { expectedVersion: 2, thresholdMilli: -1, reason: 'Bad value' },
    { expectedVersion: 2, thresholdMilli: 1000000000001, reason: 'Bad value' },
    { expectedVersion: 2, thresholdMilli: 1.5, reason: 'Bad value' },
    { expectedVersion: 2, thresholdMilli: 1, reason: ' ' },
    { expectedVersion: 2, thresholdMilli: 1, reason: 'Valid reason', unexpected: true },
  ]) assert.equal((await f.post('/api/v1/inventory/thresholds/beans', payload)).statusCode, 400);
  assert.equal((await f.get(`${alertsPath}?status=invalid`)).statusCode, 400);
  assert.equal((await f.get(`${alertsPath}?before=bad-id`)).statusCode, 400);
  assert.equal((await f.get(`${alertsPath}/${opened.id}/history`, f.otherOwner)).statusCode, 404);
  assert.equal((await f.post(`${alertsPath}/${opened.id}/acknowledge`, { expectedVersion: resolved.version, note: 'Cross-branch request' }, f.otherOwner)).statusCode, 404);
  for (const token of [f.cashier, f.barista]) {
    assert.equal((await f.get(`${alertsPath}/${opened.id}/history`, token)).statusCode, 403);
    assert.equal((await f.post(`${alertsPath}/${opened.id}/acknowledge`, { expectedVersion: 1, note: 'Forbidden request' }, token)).statusCode, 403);
  }
});

test('threshold changes preserve reasons and prior values even when no incident changes', async t => {
  const f = await fixture(t);
  const path = '/api/v1/inventory/thresholds/beans';
  const firstId = randomUUID();
  const first = { expectedVersion: 0, thresholdMilli: 500, reason: 'Initial reorder level' };
  ok(await f.post(path, first, f.owner, firstId));
  const secondId = randomUUID();
  const second = { expectedVersion: 1, thresholdMilli: 250, reason: 'Revised weekly stock level' };
  const accepted = ok(await f.post(path, second, f.manager, secondId));
  assert.deepEqual(ok(await f.post(path, second, f.manager, secondId)), accepted);
  const clearedId = randomUUID();
  ok(await f.post(path, { expectedVersion: 2, thresholdMilli: null, reason: 'Pause low stock warnings' }, f.owner, clearedId));
  assert.deepEqual((await f.list()).alerts, []);
  await f.reopen();
  const sql = `SELECT branch_id,ingredient_id,version,old_threshold_milli,new_threshold_milli,reason,actor_id,command_id
    FROM inventory_threshold_events WHERE branch_id=? AND ingredient_id=? ORDER BY version`;
  const saved = f.rows(sql, branchId, 'beans');
  assert.deepEqual(saved, [
    { branch_id: branchId, ingredient_id: 'beans', version: 1, old_threshold_milli: null, new_threshold_milli: 500, reason: first.reason, actor_id: 'owner-a', command_id: firstId },
    { branch_id: branchId, ingredient_id: 'beans', version: 2, old_threshold_milli: 500, new_threshold_milli: 250, reason: second.reason, actor_id: 'manager-a', command_id: secondId },
    { branch_id: branchId, ingredient_id: 'beans', version: 3, old_threshold_milli: 250, new_threshold_milli: null, reason: 'Pause low stock warnings', actor_id: 'owner-a', command_id: clearedId },
  ]);
  const otherId = randomUUID();
  assert.equal((await f.post(path, { expectedVersion: 0, thresholdMilli: 100, reason: 'Wrong branch' }, f.otherOwner, otherId)).statusCode, 404);
  assert.deepEqual(f.rows(sql, branchId, 'beans'), saved);
  assert.deepEqual(f.rows('SELECT * FROM inventory_threshold_events WHERE branch_id=?', 'alerts-south'), []);

  const retryId = randomUUID();
  const retry = { expectedVersion: 3, thresholdMilli: 200, reason: 'Review after write failure' };
  f.fault("CREATE TRIGGER fail_threshold_evidence BEFORE INSERT ON inventory_threshold_events BEGIN SELECT RAISE(ABORT, 'synthetic evidence failure'); END");
  assert.equal((await f.post(path, retry, f.manager, retryId)).statusCode, 500);
  assert.deepEqual((await f.list()).thresholds, [{ ingredientId: 'beans', thresholdMilli: null, version: 3 }]);
  assert.deepEqual(f.rows(sql, branchId, 'beans'), saved);
  assert.deepEqual(f.rows('SELECT id FROM command_receipts WHERE id=?', retryId), []);
  f.fault('DROP TRIGGER fail_threshold_evidence');
  const retried = ok(await f.post(path, retry, f.manager, retryId));
  assert.deepEqual(ok(await f.post(path, retry, f.manager, retryId)), retried);
  assert.equal(f.rows(sql, branchId, 'beans').length, 4);
  assert.equal(f.rows('SELECT id FROM audit_events WHERE command_id=?', retryId).length, 1);
  assert.equal(f.rows('SELECT id FROM outbox WHERE command_id=?', retryId).length, 1);
});

test('reservation shortages persist source-order evidence once per command through ready and stock recovery', async t => {
  const f = await fixture(t);
  await f.threshold(500, 0);
  const first = await f.send();
  assert.deepEqual((await f.list()).alerts, []);
  const second = await f.send();
  const shortage = (await f.list()).alerts[0]!;
  assert.equal(shortage.kind, 'shortage');
  assert.equal(shortage.onHandMilli, 1000);
  assert.equal(shortage.reservedMilli, 1200);
  assert.equal(shortage.availableMilli, -200);
  assert.equal(shortage.thresholdMilli, null);
  let history = ok<{ events: unknown[]; shortages: { orderId: string; commandId: string; requiredMilli: number; availableMilli: number; shortfallMilli: number }[] }>(await f.get(`${alertsPath}/${shortage.id}/history`));
  assert.equal(history.shortages.length, 1);
  const source = history.shortages[0]!;
  assert.equal(source.orderId, second.order.id);
  assert.equal(source.commandId, second.commandId);
  assert.equal(source.requiredMilli, 600);
  assert.equal(source.availableMilli, 400);
  assert.equal(source.shortfallMilli, 200);
  assert.equal((await f.post(second.path, second.input, f.cashier, second.commandId)).statusCode, 200);
  assert.equal(f.rows('SELECT id FROM inventory_order_shortages WHERE command_id=?', second.commandId).length, 1);

  const readyId = randomUUID();
  const ready = ok<{ order: Order }>(await f.post(`/api/v1/orders/${first.order.id}/ready`, { expectedVersion: first.order.version }, f.barista, readyId));
  assert.ok(ready.order.version > first.order.version);
  const active = (await f.list()).alerts;
  assert.deepEqual(active.map(alert => alert.kind).sort(), ['low_stock', 'shortage']);
  assert.equal(active.find(alert => alert.kind === 'shortage')!.id, shortage.id);
  const evidence = f.rows('SELECT * FROM inventory_order_shortages WHERE alert_id=? ORDER BY id', shortage.id);
  assert.equal(evidence.length, 2);
  assert.equal(f.rows('SELECT id FROM inventory_order_shortages WHERE command_id=?', readyId).length, 1);
  await f.receive(1000);
  assert.deepEqual((await f.list()).alerts, []);
  assert.deepEqual(f.rows('SELECT * FROM inventory_order_shortages WHERE alert_id=? ORDER BY id', shortage.id), evidence);
  history = ok(await f.get(`${alertsPath}/${shortage.id}/history`));
  assert.equal(history.shortages.length, 2);
});

test('failed alert outbox writes roll back configuration, incidents and command outcomes before exact retry', async t => {
  const f = await fixture(t);
  f.fault(`CREATE TRIGGER fail_alert_outbox BEFORE INSERT ON outbox
    WHEN NEW.event_type='inventory.threshold.set' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
  const commandId = randomUUID();
  const input = { expectedVersion: 0, thresholdMilli: 1000, reason: 'Enable boundary alert' };
  const path = '/api/v1/inventory/thresholds/beans';
  assert.equal((await f.post(path, input, f.owner, commandId)).statusCode, 500);
  assert.deepEqual(f.rows('SELECT * FROM ingredient_stock_thresholds'), []);
  assert.deepEqual(f.rows('SELECT * FROM inventory_alerts'), []);
  assert.deepEqual(f.rows('SELECT * FROM inventory_alert_events'), []);
  for (const table of ['command_receipts', 'audit_events', 'outbox']) {
    const key = table === 'command_receipts' ? 'id' : 'command_id';
    assert.deepEqual(f.rows(`SELECT * FROM ${table} WHERE ${key}=?`, commandId), []);
  }
  f.fault('DROP TRIGGER fail_alert_outbox');
  const saved = ok(await f.post(path, input, f.owner, commandId));
  await f.reopen();
  assert.deepEqual(ok(await f.post(path, input, f.owner, commandId)), saved);
  assert.equal(f.rows('SELECT id FROM inventory_alerts').length, 1);
  assert.equal(f.rows('SELECT id FROM inventory_alert_events').length, 1);
  assert.equal(f.rows('SELECT id FROM audit_events WHERE command_id=?', commandId).length, 1);
  assert.equal(f.rows('SELECT id FROM outbox WHERE command_id=?', commandId).length, 1);
});

test('failed alert history writes roll back receiving and ready stock effects before the original command retries', async t => {
  const f = await fixture(t);
  await f.threshold(1500, 0);
  const order = await f.send();
  const state = () => ({
    movements: f.rows('SELECT * FROM stock_movements ORDER BY sequence'),
    values: f.rows('SELECT * FROM stock_movement_valuations ORDER BY movement_id'),
    balances: f.rows('SELECT * FROM ingredient_valuation_balances'),
    reservations: f.rows('SELECT * FROM reservations'),
    receipts: f.rows('SELECT * FROM stock_receipts'),
    orders: f.rows('SELECT * FROM orders'),
    alerts: f.rows('SELECT * FROM inventory_alerts'),
    events: f.rows('SELECT * FROM inventory_alert_events ORDER BY alert_id,version'),
  });
  const before = state();
  f.fault(`CREATE TRIGGER fail_alert_history BEFORE INSERT ON inventory_alert_events
    BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;`);
  for (const [path, payload, token] of [
    ['/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli: 10, totalCostCentavos: 1, reference: 'Retry receiving' }, f.owner],
    [`/api/v1/orders/${order.order.id}/ready`, { expectedVersion: order.order.version }, f.barista],
  ] as const) {
    const commandId = randomUUID();
    assert.equal((await f.post(path, payload, token, commandId)).statusCode, 500);
    assert.deepEqual(state(), before);
    assert.deepEqual(f.rows('SELECT * FROM command_receipts WHERE id=?', commandId), []);
    assert.deepEqual(f.rows('SELECT * FROM audit_events WHERE command_id=?', commandId), []);
    assert.deepEqual(f.rows('SELECT * FROM outbox WHERE command_id=?', commandId), []);
    f.fault('DROP TRIGGER fail_alert_history');
    const saved = ok(await f.post(path, payload, token, commandId));
    assert.deepEqual(ok(await f.post(path, payload, token, commandId)), saved);
    assert.equal(f.rows('SELECT id FROM command_receipts WHERE id=?', commandId).length, 1);
    if (path.endsWith('/receipts')) {
      // The second failure starts from this newly accepted receipt state.
      Object.assign(before, state());
      f.fault(`CREATE TRIGGER fail_alert_history BEFORE INSERT ON inventory_alert_events
        BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;`);
    }
  }
});

test('alert cursor pagination covers tied timestamps once and rejects another branch cursor', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 51; index++) {
    if (index % 20 === 0) f.advanceMinute();
    const ingredientId = `stock-${index.toString().padStart(2, '0')}`;
    ok(await f.post('/api/v1/ingredients', { ingredientId, name: ingredientId, unit: 'g' }));
    ok(await f.post(`/api/v1/inventory/thresholds/${ingredientId}`, { expectedVersion: 0, thresholdMilli: 0, reason: 'Verify zero threshold' }));
  }
  const first = await f.list();
  assert.equal(first.alerts.length, 50);
  assert.ok(first.nextCursor);
  const second = ok<Listing>(await f.get(`${alertsPath}?before=${first.nextCursor}`));
  assert.equal(second.alerts.length, 1);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.alerts, ...second.alerts].map(alert => alert.id)).size, 51);
  assert.equal((await f.get(`${alertsPath}?before=${first.nextCursor}`, f.otherOwner)).statusCode, 404);
  assert.deepEqual(ok<Listing>(await f.get(alertsPath)).alerts, first.alerts);
});

test('schema 14 seeds existing shortage history once without rewriting stock or accepted command evidence', async t => {
  const tempRoot = resolve(tmpdir());
  const prefix = join(tempRoot, 'kape-doz-alert-migration-');
  const folder = await mkdtemp(prefix);
  const databasePath = join(folder, 'hub.sqlite');
  t.after(async () => {
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  const legacy = new DatabaseSync(databasePath);
  let before: { stock: unknown; commands: unknown; reservations: unknown };
  try {
    legacy.exec('PRAGMA foreign_keys=OFF; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
    const migrationFolder = new URL('../migrations/', import.meta.url);
    const migrations = (await readdir(migrationFolder)).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().slice(0, 13);
    for (const [index, name] of migrations.entries()) {
      legacy.exec(await readFile(new URL(name, migrationFolder), 'utf8'));
      legacy.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
    }
    legacy.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(1,?)').run(randomUUID());
    legacy.exec(`PRAGMA foreign_keys=ON;
      INSERT INTO branches(id) VALUES('legacy-alerts');
      INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES('legacy-owner','legacy-alerts','Owner','owner','hash');
      INSERT INTO ingredients(branch_id,id,name,unit) VALUES('legacy-alerts','beans','Beans','g');
      INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,released_at,total_centavos)
        VALUES('legacy-order','legacy-alerts',1,1,1,'04','explicit_send',0,0,100);
      INSERT INTO reservations(branch_id,order_id,ingredient_id,quantity_milli) VALUES('legacy-alerts','legacy-order','beans',1000);`);
    before = {
      stock: legacy.prepare('SELECT * FROM stock_movements').all(),
      commands: legacy.prepare('SELECT * FROM command_receipts').all(),
      reservations: legacy.prepare('SELECT * FROM reservations').all(),
    };
  } finally { legacy.close(); }
  let hub = new HubDatabase(databasePath);
  try {
    const db = hub.connection;
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(db.prepare('SELECT * FROM stock_movements').all(), before.stock);
    assert.deepEqual(db.prepare('SELECT * FROM command_receipts').all(), before.commands);
    assert.deepEqual(db.prepare('SELECT * FROM reservations').all(), before.reservations);
    const alert = db.prepare('SELECT * FROM inventory_alerts').get()!;
    assert.equal(alert.kind, 'shortage');
    assert.equal(alert.available_milli, -1000);
    assert.equal(alert.opened_at, 0);
    assert.match(String(alert.id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const event = db.prepare('SELECT * FROM inventory_alert_events').get()!;
    assert.equal(event.alert_id, alert.id);
    assert.equal(event.command_id, null);
    assert.equal(event.actor_id, null);
    assert.equal(event.type, 'opened');
    assert.deepEqual(db.prepare('SELECT * FROM inventory_order_shortages').all(), []);
    const saved = db.prepare('SELECT * FROM inventory_alerts').all();
    hub.close();
    hub = new HubDatabase(databasePath);
    assert.deepEqual(hub.connection.prepare('SELECT * FROM inventory_alerts').all(), saved);
    assert.equal(hub.connection.prepare('SELECT COUNT(*) AS amount FROM inventory_alert_events').get()!.amount, 1);
  } finally { hub.close(); }
});
