import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const branchId = 'count-failure-branch';
const countsPath = '/api/v1/inventory/counts';
const password = 'Inventory-Count-Failure-Fixture-2026!';
const now = () => Date.UTC(2026, 10, 6, 8);

type Count = {
  id: string; status: string; version: number; liveOnHandMilli: number; liveStockVersion: number;
  costStatus: string; canRevalue: boolean; totalCostCentavos: number | null; balanceCostCentavos: number | null;
};
type CountReply = { commandId: string; count: Count };
type Response = { statusCode: number; body: string; json(): unknown };

function ok<T>(response: Response): T {
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as T;
}

async function fixture(t: TestContext) {
  const tempRoot = resolve(tmpdir());
  const prefix = join(tempRoot, 'kape-doz-count-failures-');
  const folder = await mkdtemp(prefix);
  const databasePath = join(folder, 'hub.sqlite');
  let hub = await createHub({ databasePath, now });
  // This connection writes fault-injection triggers only inside this temporary fixture.
  const inspector = new DatabaseSync(databasePath);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });

  await hub.provisionAccount({ id: 'owner', displayName: 'Count fixture owner', role: 'owner', branchId, secret: password });
  await hub.provisionAccount({ id: 'barista', displayName: 'Count fixture barista', role: 'barista', branchId, secret: '5928' });
  await hub.provisionDevice({ id: 'tablet', branchId, secret: password });
  const owner = ok<{ token: string }>(await hub.app.inject({
    method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner', password },
  })).token;
  const barista = ok<{ token: string }>(await hub.app.inject({
    method: 'POST', url: '/api/v1/auth/staff',
    payload: { accountId: 'barista', pin: '5928', deviceId: 'tablet', deviceSecret: password },
  })).token;
  const post = (url: string, payload: Record<string, unknown>, commandId: string = randomUUID(), token = owner) => hub.app.inject({
    method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { commandId, ...payload },
  });
  const rows = (sql: string, ...parameters: SQLInputValue[]) => inspector.prepare(sql).all(...parameters).map(row => ({ ...row }));
  const carrying = () => rows('SELECT carrying_microcentavos FROM ingredient_valuation_balances WHERE branch_id=? AND ingredient_id=?', branchId, 'beans')[0]!.carrying_microcentavos;
  const movements = (id: string) => rows(`SELECT m.id,m.sequence,m.quantity_milli,m.quantity_after_milli,v.value_microcentavos
    FROM stock_movements m LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id WHERE m.count_id=? ORDER BY m.sequence`, id);
  const state = (id: string) => ({
    count: rows('SELECT * FROM inventory_counts WHERE id=?', id),
    stock: rows('SELECT sequence,quantity_after_milli FROM stock_movements WHERE branch_id=? AND ingredient_id=? ORDER BY sequence DESC LIMIT 1', branchId, 'beans'),
    carrying: carrying(), movements: movements(id),
    costs: rows('SELECT * FROM inventory_count_costs WHERE count_id=?', id),
    revaluations: rows('SELECT * FROM inventory_count_revaluations WHERE count_id=?', id),
  });
  function noCommand(id: string) {
    assert.deepEqual(rows('SELECT id FROM command_receipts WHERE id=?', id), []);
    assert.deepEqual(rows('SELECT id FROM audit_events WHERE command_id=?', id), []);
    assert.deepEqual(rows('SELECT id FROM outbox WHERE command_id=?', id), []);
  }
  function oneCommand(id: string, action: string) {
    assert.deepEqual(rows('SELECT action,outcome FROM command_receipts WHERE id=?', id), [{ action, outcome: 'accepted' }]);
    assert.deepEqual(rows('SELECT action FROM audit_events WHERE command_id=?', id), [{ action }]);
    assert.deepEqual(rows('SELECT event_type FROM outbox WHERE command_id=?', id), [{ event_type: action }]);
    assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
  }
  async function failed(url: string, input: Record<string, unknown>, id: string) {
    const response = await post(url, input, id);
    assert.equal(response.statusCode, 500, response.body);
    const body = response.json() as { error: { code: string; message: string }; requestId: string };
    assert.deepEqual(body.error, { code: 'request_failed', message: 'The request could not be completed.' });
    assert.match(body.requestId, /^[0-9a-f-]{36}$/);
    noCommand(id);
  }
  async function observed(observedMilli: number) {
    const opened = ok<CountReply>(await post(countsPath, { ingredientId: 'beans' })).count;
    return ok<CountReply>(await post(`${countsPath}/${opened.id}/observe`, { expectedVersion: opened.version, unit: 'g', observedMilli })).count;
  }
  async function approve(count: Count) {
    return ok<CountReply>(await post(`${countsPath}/${count.id}/decide`, { expectedVersion: count.version, decision: 'approve', reason: 'Measured fixture gain' })).count;
  }
  ok(await post('/api/v1/ingredients', { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
  ok(await post('/api/v1/inventory/receipts', {
    ingredientId: 'beans', quantityMilli: 100_000, totalCostCentavos: 10_000, reference: 'Initial fixture stock',
  }));
  return {
    post, rows, carrying, movements, state, failed, observed, approve, oneCommand,
    fault(sql: string) { inspector.exec(sql); },
    async waste(quantityMilli: number) {
      ok(await post('/api/v1/waste', { ingredientId: 'beans', quantityMilli, reason: 'Fixture unknown-cost waste', note: '' }, randomUUID(), barista));
    },
    async reopen() { await hub.close(); hub = await createHub({ databasePath, now }); },
  };
}

test('count approval rolls back a failed valuation insert and the same command succeeds once after recovery', async t => {
  const f = await fixture(t);
  const count = await f.observed(105_000);
  const before = f.state(count.id);
  const commandId = randomUUID();
  const url = `${countsPath}/${count.id}/decide`;
  const input = { expectedVersion: count.version, decision: 'approve', reason: 'Verified extra beans' };
  f.fault(`CREATE TRIGGER fail_count_valuation BEFORE INSERT ON stock_movement_valuations
    WHEN (SELECT kind FROM stock_movements WHERE id=NEW.movement_id)='count_adjustment'
    BEGIN SELECT RAISE(ABORT,'Injected fixture valuation failure'); END;`);

  await f.failed(url, input, commandId);
  assert.deepEqual(f.state(count.id), before);
  f.fault('DROP TRIGGER fail_count_valuation');
  await f.reopen();
  const accepted = ok<CountReply>(await f.post(url, input, commandId));
  assert.deepEqual([accepted.count.status, accepted.count.version, accepted.count.liveOnHandMilli, accepted.count.costStatus, f.carrying()],
    ['approved', count.version + 1, 105_000, 'pending', null]);
  assert.deepEqual(f.movements(count.id).map(({ quantity_milli, quantity_after_milli, value_microcentavos }) =>
    ({ quantity_milli, quantity_after_milli, value_microcentavos })),
  [{ quantity_milli: 5_000, quantity_after_milli: 105_000, value_microcentavos: null }]);
  const committed = f.state(count.id);
  assert.deepEqual(ok(await f.post(url, input, commandId)), accepted);
  assert.equal((await f.post(url, { ...input, decision: 'discard' }, commandId)).statusCode, 409);
  assert.deepEqual(f.state(count.id), committed);
  f.oneCommand(commandId, 'inventory.count.decide');
});

test('cost confirmation rolls back its evidence and version if prospective carrying restoration fails', async t => {
  const f = await fixture(t);
  const approved = await f.approve(await f.observed(105_000));
  const before = f.state(approved.id);
  const commandId = randomUUID();
  const url = `${countsPath}/${approved.id}/confirm-cost`;
  const input = { expectedVersion: approved.version, totalCostCentavos: 400, reference: 'Found stock evidence' };
  f.fault(`CREATE TRIGGER fail_count_carry BEFORE UPDATE ON ingredient_valuation_balances
    WHEN NEW.carrying_microcentavos IS NOT NULL
    BEGIN SELECT RAISE(ABORT,'Injected fixture carrying failure'); END;`);

  await f.failed(url, input, commandId);
  assert.deepEqual(f.state(approved.id), before);
  f.fault('DROP TRIGGER fail_count_carry');
  await f.reopen();
  const accepted = ok<CountReply>(await f.post(url, input, commandId));
  assert.deepEqual([accepted.count.version, accepted.count.costStatus, accepted.count.totalCostCentavos, accepted.count.liveOnHandMilli, f.carrying()],
    [approved.version + 1, 'confirmed', 400, 105_000, 10_400_000_000]);
  assert.equal(f.rows('SELECT * FROM inventory_count_costs WHERE count_id=?', approved.id).length, 1);
  assert.deepEqual(f.movements(approved.id), before.movements);
  const committed = f.state(approved.id);
  assert.deepEqual(ok(await f.post(url, input, commandId)), accepted);
  assert.equal((await f.post(url, { ...input, totalCostCentavos: 800 }, commandId)).statusCode, 409);
  assert.deepEqual(f.state(approved.id), committed);
  f.oneCommand(commandId, 'inventory.count.confirm_cost');
});

test('whole-balance revaluation rolls back ledger, carrying and command effects if the final outbox insert fails', async t => {
  const f = await fixture(t);
  const approved = await f.approve(await f.observed(110_000));
  await f.waste(1_000);
  const confirmed = ok<CountReply>(await f.post(`${countsPath}/${approved.id}/confirm-cost`, {
    expectedVersion: approved.version, totalCostCentavos: 800, reference: 'Found stock evidence before review',
  })).count;
  assert.equal(confirmed.canRevalue, true);
  assert.equal(f.carrying(), null);
  const before = f.state(approved.id);
  const commandId = randomUUID();
  const url = `${countsPath}/${approved.id}/revalue`;
  const input = {
    expectedVersion: confirmed.version, expectedStockVersion: confirmed.liveStockVersion,
    totalCostCentavos: 22_000, reference: 'Manager confirmed current whole-balance evidence',
  };
  f.fault(`CREATE TRIGGER fail_count_outbox BEFORE INSERT ON outbox WHEN NEW.event_type='inventory.count.revalue'
    BEGIN SELECT RAISE(ABORT,'Injected fixture outbox failure'); END;`);

  await f.failed(url, input, commandId);
  assert.deepEqual(f.state(approved.id), before);
  f.fault('DROP TRIGGER fail_count_outbox');
  await f.reopen();
  const accepted = ok<CountReply>(await f.post(url, input, commandId));
  assert.deepEqual([accepted.count.version, accepted.count.liveStockVersion, accepted.count.liveOnHandMilli, accepted.count.balanceCostCentavos, accepted.count.canRevalue, f.carrying()],
    [confirmed.version + 1, confirmed.liveStockVersion, 109_000, 22_000, false, 22_000_000_000]);
  assert.equal(f.rows('SELECT * FROM inventory_count_revaluations WHERE count_id=?', approved.id).length, 1);
  assert.deepEqual(f.movements(approved.id), before.movements);
  const committed = f.state(approved.id);
  assert.deepEqual(ok(await f.post(url, input, commandId)), accepted);
  assert.equal((await f.post(url, { ...input, totalCostCentavos: 30_000 }, commandId)).statusCode, 409);
  assert.deepEqual(f.state(approved.id), committed);
  f.oneCommand(commandId, 'inventory.count.revalue');
});
