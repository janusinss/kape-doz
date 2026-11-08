import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const branchId = 'count-branch-a';
const otherBranchId = 'count-branch-b';
const countsPath = '/api/v1/inventory/counts';
const priceCentavos = 12_000;
const recipeMilli = 1_000;
const initialStockMilli = 100_000;
const initialCostCentavos = 10_000;
const microcentavos = 1_000_000;
const password = 'Inventory-Count-Fixture-Admin-2026!';
const deviceSecret = 'Inventory-Count-Fixture-Device-2026!';
const pin = '5928';
const now = () => Date.UTC(2026, 10, 6, 8);

type Count = {
  id: string; ingredientId: string; unit: 'g' | 'ml' | 'piece'; status: 'open' | 'submitted' | 'approved' | 'discarded';
  version: number; snapshotMilli: number; snapshotStockVersion: number; observedMilli: number | null; varianceMilli: number | null;
  reason: string | null; costStatus: 'not_required' | 'pending' | 'confirmed'; totalCostCentavos: number | null; costReference: string | null;
  liveOnHandMilli: number; liveStockVersion: number; canRevalue: boolean; balanceCostCentavos: number | null; balanceCostReference: string | null;
};
type CountReply = { commandId: string; count: Count };
type Order = { id: string; version: number; ready: boolean; released: boolean };
type Stock = { id: string; onHandMilli: number; reservedMilli: number };
type Response = { statusCode: number; body: string; json(): unknown };

function status(response: Response, expected: number): void {
  assert.equal(response.statusCode, expected, response.body);
}

function ok<T>(response: Response): T {
  status(response, 200);
  return response.json() as T;
}

async function fixture(t: TestContext) {
  const tempRoot = resolve(tmpdir());
  const folder = await mkdtemp(join(tempRoot, 'kape-doz-stock-counts-'));
  const databasePath = join(folder, 'hub.sqlite');
  let hub = await createHub({ databasePath, now });
  const inspector = new DatabaseSync(databasePath, { readOnly: true });
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(join(tempRoot, 'kape-doz-stock-counts-')));
    await rm(target, { recursive: true, force: true });
  });

  for (const [id, role, branch] of [
    ['owner-a', 'owner', branchId], ['manager-a', 'manager', branchId], ['manager-b', 'manager', otherBranchId],
    ['cashier-a', 'cashier', branchId], ['barista-a', 'barista', branchId],
  ] as const) {
    const staff = role === 'cashier' || role === 'barista';
    await hub.provisionAccount({ id, displayName: id, role, branchId: branch, secret: staff ? pin : password });
  }
  await hub.provisionDevice({ id: 'tablet-a', branchId, secret: deviceSecret });
  async function login(accountId: string, staff = false) {
    return ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: `/api/v1/auth/${staff ? 'staff' : 'admin'}`,
      payload: staff ? { accountId, pin, deviceId: 'tablet-a', deviceSecret } : { accountId, password },
    })).token;
  }
  const owner = await login('owner-a');
  const manager = await login('manager-a');
  const otherManager = await login('manager-b');
  const cashier = await login('cashier-a', true);
  const barista = await login('barista-a', true);
  const get = (token: string | undefined, url: string) => hub.app.inject({
    method: 'GET', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
  const post = (token: string | undefined, url: string, payload: Record<string, unknown>, commandId = randomUUID()) => hub.app.inject({
    method: 'POST', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), payload: { commandId, ...payload },
  });
  const receive = async (quantityMilli: number, totalCostCentavos: number, commandId = randomUUID()) =>
    ok(await post(owner, '/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli, totalCostCentavos, reference: 'Count fixture delivery' }, commandId));
  const waste = async (quantityMilli: number, commandId = randomUUID()) =>
    ok(await post(barista, '/api/v1/waste', { ingredientId: 'beans', quantityMilli, reason: 'Count fixture waste', note: '' }, commandId));
  ok(await post(owner, '/api/v1/ingredients', { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
  await receive(initialStockMilli, initialCostCentavos);
  ok(await post(owner, '/api/v1/products', {
    productId: 'fixture-drink', name: 'Fixture drink', priceCentavos, recipe: [{ ingredientId: 'beans', quantityMilli: recipeMilli }],
  }));

  const list = async (token = owner) => ok<{ counts: Count[] }>(await get(token, countsPath)).counts;
  const start = async (commandId = randomUUID()) => ok<CountReply>(await post(owner, countsPath, { ingredientId: 'beans' }, commandId));
  const observe = async (count: Count, observedMilli: number, commandId = randomUUID()) => ok<CountReply>(await post(owner,
    `${countsPath}/${count.id}/observe`, { expectedVersion: count.version, unit: 'g', observedMilli }, commandId));
  const decide = async (count: Count, decision: 'approve' | 'discard', reason: string, commandId = randomUUID()) =>
    ok<CountReply>(await post(manager, `${countsPath}/${count.id}/decide`, { expectedVersion: count.version, decision, reason }, commandId));
  const confirm = async (count: Count, totalCostCentavos: number, commandId = randomUUID()) => ok<CountReply>(await post(manager,
    `${countsPath}/${count.id}/confirm-cost`, { expectedVersion: count.version, totalCostCentavos, reference: 'Count fixture valuation evidence' }, commandId));
  const revalue = async (count: Count, totalCostCentavos: number, commandId = randomUUID()) => ok<CountReply>(await post(manager,
    `${countsPath}/${count.id}/revalue`, { expectedVersion: count.version, expectedStockVersion: count.liveStockVersion, totalCostCentavos, reference: 'Manager confirmed full current balance' }, commandId));
  async function saved(count: Count) {
    const current = (await list()).find(({ id }) => id === count.id);
    assert.ok(current, `Expected saved count ${count.id}`);
    return current;
  }
  async function stock() {
    const { ingredients } = ok<{ ingredients: Stock[] }>(await get(barista, '/api/v1/ingredients'));
    return ingredients.find(({ id }) => id === 'beans')!;
  }
  async function paidOrder() {
    const { order } = ok<{ order: Order }>(await post(cashier, '/api/v1/orders', {
      dineIn: false, items: [{ productId: 'fixture-drink', quantity: 1 }],
    }));
    return ok<{ order: Order }>(await post(cashier, `/api/v1/orders/${order.id}/payments`, {
      expectedVersion: order.version, method: 'gcash', amountCentavos: priceCentavos, verified: true, reference: randomUUID(),
    })).order;
  }
  async function ready(order: Order, commandId = randomUUID()) {
    return ok<{ order: Order }>(await post(barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version }, commandId)).order;
  }
  const rows = (sql: string, ...parameters: SQLInputValue[]) => inspector.prepare(sql).all(...parameters).map((row) => ({ ...row }));
  const carrying = () => rows('SELECT carrying_microcentavos FROM ingredient_valuation_balances WHERE branch_id=? AND ingredient_id=?', branchId, 'beans')[0]?.carrying_microcentavos;
  const movements = (commandId: string) => rows(`SELECT m.quantity_milli,v.value_microcentavos FROM stock_movements m
    LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id WHERE m.branch_id=? AND m.command_id=?`, branchId, commandId);
  const estimate = (order: Order) => rows(`SELECT cost_microcentavos FROM order_recipe_valuation_estimates
    WHERE branch_id=? AND order_id=? AND ingredient_id=?`, branchId, order.id, 'beans');
  function assertCommand(commandId: string, outcome: 'accepted' | 'rejected', rejectionStatus: number | null = null) {
    const receipts = rows('SELECT action,outcome,rejection_status FROM command_receipts WHERE id=?', commandId);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]!.outcome, outcome);
    assert.equal(receipts[0]!.rejection_status, rejectionStatus);
    const action = `${String(receipts[0]!.action)}${outcome === 'rejected' ? '.rejected' : ''}`;
    assert.deepEqual(rows('SELECT action FROM audit_events WHERE command_id=?', commandId), [{ action }]);
    assert.deepEqual(rows('SELECT event_type FROM outbox WHERE command_id=?', commandId), [{ event_type: action }]);
  }
  return {
    owner, manager, otherManager, cashier, barista, get, post, receive, waste, list, start, observe, decide, confirm, revalue, saved,
    stock, paidOrder, ready, rows, carrying, movements, estimate, assertCommand,
    async reopen() { await hub.close(); hub = await createHub({ databasePath, now }); },
  };
}

test('an equal-net receipt and waste still stale a count; discarding keeps the saved attempt and permits a fresh snapshot', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const started = await f.start(commandId);
  assert.deepEqual(await f.start(commandId), started);
  const count = started.count;
  assert.equal(count.status, 'open');
  assert.equal(count.ingredientId, 'beans');
  assert.equal(count.snapshotMilli, initialStockMilli);
  assert.equal(count.unit, 'g');
  assert.equal(count.observedMilli, null);
  assert.equal(count.varianceMilli, null);
  status(await f.post(f.manager, countsPath, { ingredientId: 'beans' }), 409);
  await f.receive(2_000, 200);
  await f.waste(2_000);
  assert.equal((await f.stock()).onHandMilli, initialStockMilli);

  const observeId = randomUUID();
  const input = { expectedVersion: count.version, unit: 'g', observedMilli: 105_000 };
  const path = `${countsPath}/${count.id}/observe`;
  const stale = await f.post(f.owner, path, input, observeId);
  status(stale, 409);
  await f.reopen();
  const replay = await f.post(f.owner, path, input, observeId);
  status(replay, 409);
  assert.deepEqual((replay.json() as { error: unknown }).error, (stale.json() as { error: unknown }).error);
  const retained = await f.saved(count);
  assert.deepEqual([retained.status, retained.version, retained.snapshotStockVersion, retained.observedMilli, retained.varianceMilli],
    ['open', count.version, count.snapshotStockVersion, null, null]);
  assert.ok(retained.liveStockVersion > count.liveStockVersion);
  f.assertCommand(commandId, 'accepted');
  f.assertCommand(observeId, 'rejected', 409);
  const abandoned = (await f.decide(count, 'discard', 'Physical stock moved while this count was open')).count;
  assert.equal(abandoned.status, 'discarded');
  assert.equal(abandoned.reason, 'Physical stock moved while this count was open');
  const fresh = (await f.start()).count;
  assert.equal(fresh.snapshotMilli, count.snapshotMilli);
  assert.ok(fresh.snapshotStockVersion > count.snapshotStockVersion);
  assert.deepEqual(new Set((await f.list()).map(({ id }) => id)), new Set([abandoned.id, fresh.id]));
});

test('approval applies the submitted negative variance to live stock and values it at the live moving average', async (t) => {
  const f = await fixture(t);
  const toFinish = await f.paidOrder();
  const open = (await f.start()).count;
  const observed = await f.observe(open, 90_000);
  assert.equal(observed.count.status, 'submitted');
  assert.equal(observed.count.snapshotMilli, initialStockMilli);
  assert.equal(observed.count.observedMilli, 90_000);
  assert.equal(observed.count.varianceMilli, -10_000);

  const readyCommand = randomUUID();
  assert.equal((await f.ready(toFinish, readyCommand)).ready, true);
  await f.receive(11_000, 5_100);
  const stillReserved = await f.paidOrder();
  assert.equal(stillReserved.released, true);
  assert.equal((await f.stock()).onHandMilli, 110_000);
  assert.equal((await f.stock()).reservedMilli, recipeMilli);
  assert.equal(f.carrying(), 15_000 * microcentavos);

  const approvalId = randomUUID();
  const reason = 'Physical count found a documented shortage';
  const approval = await f.decide(observed.count, 'approve', reason, approvalId);
  assert.equal(approval.count.status, 'approved');
  assert.equal(approval.count.reason, reason);
  assert.equal(approval.count.costStatus, 'not_required');
  assert.equal(approval.count.liveOnHandMilli, 100_000);
  assert.equal((await f.stock()).onHandMilli, 100_000);
  assert.equal((await f.stock()).reservedMilli, recipeMilli);
  assert.equal(f.carrying(), 13_636_363_637);
  assert.deepEqual(f.movements(readyCommand), [{ quantity_milli: -recipeMilli, value_microcentavos: 100 * microcentavos }]);
  assert.deepEqual(f.movements(approvalId), [{ quantity_milli: -10_000, value_microcentavos: 1_363_636_363 }]);
  assert.deepEqual(f.rows('SELECT kind,count_id FROM stock_movements WHERE command_id=?', approvalId), [{ kind: 'count_adjustment', count_id: open.id }]);
  await f.reopen();
  assert.deepEqual(await f.decide(observed.count, 'approve', reason, approvalId), approval);
  status(await f.post(f.manager, `${countsPath}/${open.id}/decide`, { expectedVersion: observed.count.version, decision: 'approve', reason }), 409);
  assert.deepEqual(f.movements(approvalId), [{ quantity_milli: -10_000, value_microcentavos: 1_363_636_363 }]);
  assert.equal((await f.saved(open)).version, approval.count.version);
  f.assertCommand(observed.commandId, 'accepted');
  f.assertCommand(approvalId, 'accepted');
});

test('positive approval updates quantity immediately, while a separate confirmation restores a known basis prospectively', async (t) => {
  const f = await fixture(t);
  const opened = (await f.start()).count;
  const observed = (await f.observe(opened, 105_000)).count;
  await f.receive(10_000, 2_500);
  const approval = await f.decide(observed, 'approve', 'Verified extra stock');
  assert.deepEqual([approval.count.status, approval.count.varianceMilli, approval.count.costStatus, approval.count.totalCostCentavos, approval.count.costReference],
    ['approved', 5_000, 'pending', null, null]);
  assert.equal((await f.stock()).onHandMilli, 115_000);
  assert.equal(f.carrying(), null);
  assert.deepEqual(f.movements(approval.commandId), [{ quantity_milli: 5_000, value_microcentavos: null }]);
  const oldOrder = await f.paidOrder();
  assert.deepEqual(f.estimate(oldOrder), [{ cost_microcentavos: null }]);
  const receiptId = randomUUID();
  await f.receive(2_000, 700, receiptId);
  assert.equal((await f.stock()).onHandMilli, 117_000);
  assert.equal(f.carrying(), null);

  const confirmationId = randomUUID();
  const confirmation = await f.confirm(approval.count, 400, confirmationId);
  assert.deepEqual([confirmation.count.costStatus, confirmation.count.totalCostCentavos, confirmation.count.costReference],
    ['confirmed', 400, 'Count fixture valuation evidence']);
  assert.equal(confirmation.count.canRevalue, false);
  assert.equal(f.carrying(), 13_600 * microcentavos);
  assert.equal((await f.stock()).onHandMilli, 117_000);
  assert.deepEqual(f.movements(confirmationId), []);
  assert.deepEqual(f.movements(approval.commandId), [{ quantity_milli: 5_000, value_microcentavos: null }]);
  assert.deepEqual(f.movements(receiptId), [{ quantity_milli: 2_000, value_microcentavos: 700 * microcentavos }]);
  assert.deepEqual(f.estimate(oldOrder), [{ cost_microcentavos: null }]);
  assert.deepEqual(f.estimate(await f.paidOrder()), [{ cost_microcentavos: 116_239_316 }]);
  await f.reopen();
  assert.deepEqual(await f.confirm(approval.count, 400, confirmationId), confirmation);
  status(await f.post(f.manager, `${countsPath}/${opened.id}/confirm-cost`, {
    expectedVersion: confirmation.count.version, totalCostCentavos: 800, reference: 'Duplicate confirmation',
  }), 409);
  assert.equal(f.rows('SELECT * FROM inventory_count_costs WHERE count_id=?', opened.id).length, 1);
  f.assertCommand(confirmationId, 'accepted');
});

test('unknown-cost preparation requires separate current whole-balance evidence without rewriting historic unknown costs', async (t) => {
  const f = await fixture(t);
  const opened = (await f.start()).count;
  const observed = (await f.observe(opened, 110_000)).count;
  const approved = (await f.decide(observed, 'approve', 'Confirmed unexpected beans')).count;
  const unknownOrder = await f.paidOrder();
  const readyId = randomUUID();
  await f.ready(unknownOrder, readyId);
  const wasteId = randomUUID();
  await f.waste(2_000, wasteId);
  assert.deepEqual(f.movements(readyId), [{ quantity_milli: -recipeMilli, value_microcentavos: null }]);
  assert.deepEqual(f.movements(wasteId), [{ quantity_milli: -2_000, value_microcentavos: null }]);

  const foundCost = await f.confirm(approved, 800);
  assert.equal(foundCost.count.costStatus, 'confirmed');
  assert.equal(foundCost.count.canRevalue, true);
  assert.equal(foundCost.count.liveOnHandMilli, 107_000);
  assert.equal(f.carrying(), null);
  await f.receive(3_000, 900);
  const staleId = randomUUID();
  status(await f.post(f.manager, `${countsPath}/${opened.id}/revalue`, {
    expectedVersion: foundCost.count.version, expectedStockVersion: foundCost.count.liveStockVersion,
    totalCostCentavos: 22_000, reference: 'Outdated count evidence',
  }, staleId), 409);
  f.assertCommand(staleId, 'rejected', 409);
  assert.equal(f.carrying(), null);
  const current = await f.saved(opened);
  assert.equal(current.liveOnHandMilli, 110_000);
  const revalueId = randomUUID();
  const revalued = await f.revalue(current, 22_000, revalueId);
  assert.equal(revalued.count.version, current.version + 1);
  assert.equal(revalued.count.liveStockVersion, current.liveStockVersion);
  assert.equal(revalued.count.canRevalue, false);
  assert.equal(revalued.count.balanceCostCentavos, 22_000);
  assert.equal(revalued.count.balanceCostReference, 'Manager confirmed full current balance');
  assert.equal(f.carrying(), 22_000 * microcentavos);
  assert.equal((await f.stock()).onHandMilli, 110_000);
  assert.deepEqual(f.movements(revalueId), []);
  assert.deepEqual(await f.revalue(current, 22_000, revalueId), revalued);
  assert.equal(f.rows('SELECT * FROM inventory_count_revaluations WHERE count_id=?', opened.id).length, 1);

  const knownOrder = await f.paidOrder();
  assert.deepEqual(f.estimate(knownOrder), [{ cost_microcentavos: 200 * microcentavos }]);
  const knownReady = randomUUID();
  await f.ready(knownOrder, knownReady);
  assert.deepEqual(f.movements(knownReady), [{ quantity_milli: -recipeMilli, value_microcentavos: 200 * microcentavos }]);
  assert.deepEqual(f.estimate(unknownOrder), [{ cost_microcentavos: null }]);
  assert.deepEqual(f.movements(readyId), [{ quantity_milli: -recipeMilli, value_microcentavos: null }]);
  assert.deepEqual(f.movements(wasteId), [{ quantity_milli: -2_000, value_microcentavos: null }]);
  const sales = ok<{ ordersWithUnknownIngredientCost: number; wasteEntriesWithUnknownCost: number }>(
    await f.get(f.manager, '/api/v1/admin/sales?from=2026-11-06&through=2026-11-06'));
  assert.deepEqual([sales.ordersWithUnknownIngredientCost, sales.wasteEntriesWithUnknownCost], [1, 1]);
  f.assertCommand(revalueId, 'accepted');
});

test('late cost confirmation after clean depletion records evidence without contaminating the new balance', async (t) => {
  const f = await fixture(t);
  const opened = (await f.start()).count;
  const observed = (await f.observe(opened, 110_000)).count;
  const approval = await f.decide(observed, 'approve', 'Found more beans in an unopened container');
  const depletedId = randomUUID();
  await f.waste(110_000, depletedId);
  assert.equal((await f.stock()).onHandMilli, 0);
  assert.equal(f.carrying(), 0);
  assert.deepEqual(f.movements(depletedId), [{ quantity_milli: -110_000, value_microcentavos: null }]);
  await f.receive(25_000, 5_000);
  assert.equal(f.carrying(), 5_000 * microcentavos);
  const late = await f.confirm(approval.count, 800);
  assert.equal(late.count.costStatus, 'confirmed');
  assert.equal(late.count.totalCostCentavos, 800);
  assert.equal(late.count.canRevalue, false);
  assert.equal((await f.stock()).onHandMilli, 25_000);
  assert.equal(f.carrying(), 5_000 * microcentavos);
  assert.deepEqual(f.movements(approval.commandId), [{ quantity_milli: 10_000, value_microcentavos: null }]);
  assert.deepEqual(f.movements(depletedId), [{ quantity_milli: -110_000, value_microcentavos: null }]);
  assert.deepEqual(f.estimate(await f.paidOrder()), [{ cost_microcentavos: 200 * microcentavos }]);
});

test('an epoch with multiple approved gains restores value only after each separate cost is confirmed', async (t) => {
  const f = await fixture(t);
  const firstOpen = (await f.start()).count;
  const firstObservation = (await f.observe(firstOpen, 105_000)).count;
  const first = await f.decide(firstObservation, 'approve', 'First positive variance');
  const secondOpen = (await f.start()).count;
  const secondObservation = (await f.observe(secondOpen, 108_000)).count;
  const second = await f.decide(secondObservation, 'approve', 'Second positive variance');
  assert.equal((await f.stock()).onHandMilli, 108_000);
  assert.equal(f.carrying(), null);
  const secondCost = await f.confirm(second.count, 600);
  assert.equal(secondCost.count.costStatus, 'confirmed');
  assert.equal(secondCost.count.canRevalue, false);
  assert.equal((await f.saved(firstOpen)).costStatus, 'pending');
  assert.equal(f.carrying(), null);

  const firstCost = await f.confirm(first.count, 400);
  assert.equal(firstCost.count.costStatus, 'confirmed');
  assert.equal(f.carrying(), 11_000 * microcentavos);
  assert.equal((await f.stock()).onHandMilli, 108_000);
  assert.deepEqual(f.movements(first.commandId), [{ quantity_milli: 5_000, value_microcentavos: null }]);
  assert.deepEqual(f.movements(second.commandId), [{ quantity_milli: 3_000, value_microcentavos: null }]);
});

test('a shortage crossing stays visible and a later gain cannot invent a known basis for negative stock', async (t) => {
  const f = await fixture(t);
  const firstOpen = (await f.start()).count;
  const firstObservation = (await f.observe(firstOpen, 80_000)).count;
  await f.waste(90_000);
  assert.equal((await f.stock()).onHandMilli, 10_000);
  const loss = await f.decide(firstObservation, 'approve', 'Preserve consumption after the observed shortage');
  assert.equal((await f.stock()).onHandMilli, -10_000);
  assert.equal(f.carrying(), null);
  assert.deepEqual(f.movements(loss.commandId), [{ quantity_milli: -20_000, value_microcentavos: null }]);

  const secondOpen = (await f.start()).count;
  assert.equal(secondOpen.snapshotMilli, -10_000);
  const secondObservation = (await f.observe(secondOpen, 5_000)).count;
  assert.equal(secondObservation.varianceMilli, 15_000);
  const gain = await f.decide(secondObservation, 'approve', 'Restated physical quantity after checking shortage');
  assert.equal((await f.stock()).onHandMilli, 5_000);
  const gainCost = await f.confirm(gain.count, 450);
  assert.equal(gainCost.count.costStatus, 'confirmed');
  assert.equal(gainCost.count.canRevalue, true);
  assert.equal(f.carrying(), null);
  assert.deepEqual(f.movements(gain.commandId), [{ quantity_milli: 15_000, value_microcentavos: null }]);
});

test('count access, canonical units, concurrent snapshots and decision history are scoped to the authorized branch', async (t) => {
  const f = await fixture(t);
  status(await f.get(undefined, countsPath), 401);
  for (const token of [f.cashier, f.barista]) {
    status(await f.get(token, countsPath), 403);
    status(await f.post(token, countsPath, { ingredientId: 'beans' }), 403);
  }
  assert.deepEqual(await f.list(f.otherManager), []);
  status(await f.post(f.otherManager, countsPath, { ingredientId: 'beans' }), 404);
  const competing = await Promise.all([f.post(f.owner, countsPath, { ingredientId: 'beans' }), f.post(f.manager, countsPath, { ingredientId: 'beans' })]);
  assert.deepEqual(competing.map(({ statusCode }) => statusCode).sort(), [200, 409]);
  const opened = ok<CountReply>(competing.find(({ statusCode }) => statusCode === 200)!).count;
  const path = `${countsPath}/${opened.id}`;
  const observation = { expectedVersion: opened.version, unit: 'g', observedMilli: 100_000 };
  status(await f.post(f.otherManager, `${path}/observe`, observation), 404);
  status(await f.post(f.cashier, `${path}/observe`, observation), 403);
  status(await f.post(f.owner, `${path}/observe`, { ...observation, unit: 'ml' }), 400);
  status(await f.post(f.owner, `${path}/observe`, { ...observation, observedMilli: -1 }), 400);
  status(await f.post(f.owner, `${path}/observe`, { ...observation, observedMilli: 2.5 }), 400);
  status(await f.post(f.owner, `${path}/observe`, { ...observation, observedMilli: '100000' }), 400);
  const submitted = (await f.observe(opened, initialStockMilli)).count;
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.varianceMilli, 0);
  status(await f.post(f.manager, countsPath, { ingredientId: 'beans' }), 409);
  const decision = { expectedVersion: submitted.version, decision: 'approve', reason: 'Verified matching quantities' };
  status(await f.post(f.otherManager, `${path}/decide`, decision), 404);
  status(await f.post(f.barista, `${path}/decide`, decision), 403);
  status(await f.post(f.manager, `${path}/decide`, { ...decision, reason: '   ' }), 400);
  const approved = await f.decide(submitted, 'approve', decision.reason);
  assert.equal(approved.count.status, 'approved');
  assert.equal(approved.count.costStatus, 'not_required');
  assert.equal(approved.count.liveStockVersion, submitted.liveStockVersion);
  assert.deepEqual(f.movements(approved.commandId), []);
  const confirmation = { expectedVersion: approved.count.version, totalCostCentavos: 250, reference: 'No gain to value' };
  status(await f.post(f.otherManager, `${path}/confirm-cost`, confirmation), 404);
  status(await f.post(f.barista, `${path}/confirm-cost`, confirmation), 403);
  status(await f.post(f.manager, `${path}/confirm-cost`, confirmation), 409);

  const second = (await f.start()).count;
  const toDiscard = (await f.observe(second, 109_000)).count;
  const discarded = await f.decide(toDiscard, 'discard', 'Observation not independently verified');
  assert.equal(discarded.count.status, 'discarded');
  assert.deepEqual([discarded.count.snapshotMilli, discarded.count.observedMilli, discarded.count.varianceMilli], [100_000, 109_000, 9_000]);
  assert.deepEqual(f.movements(discarded.commandId), []);
  assert.equal((await f.stock()).onHandMilli, initialStockMilli);
  assert.equal(f.carrying(), initialCostCentavos * microcentavos);
  await f.reopen();
  assert.deepEqual(new Set((await f.list()).map(({ status }) => status)), new Set(['approved', 'discarded']));
  assert.deepEqual(await f.list(f.otherManager), []);
  f.assertCommand(approved.commandId, 'accepted');
  f.assertCommand(discarded.commandId, 'accepted');
});
