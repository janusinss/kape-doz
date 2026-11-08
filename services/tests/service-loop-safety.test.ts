import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const scratchRoot = fileURLToPath(new URL('../../scratch/service-loop-tests/', import.meta.url));
const password = 'Fixture-Safety-Admin-Password-2026!';
const deviceSecret = 'Fixture-Safety-Tablet-Secret-2026!';

function result(response: { statusCode: number; body: string; json(): any }, status = 200): any {
  assert.equal(response.statusCode, status, response.body);
  return response.json();
}

async function fixture(t: TestContext) {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'safety-'));
  const databasePath = join(folder, 'hub.sqlite');
  let hub = await createHub({ databasePath });
  await hub.provisionAccount({ id: 'owner-a', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'cashier-a', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: '4826' });
  await hub.provisionAccount({ id: 'barista-a', displayName: 'Fixture barista', role: 'barista', branchId: 'branch-a', secret: '5937' });
  await hub.provisionDevice({ id: 'cashier-tablet', branchId: 'branch-a', secret: deviceSecret });
  await hub.provisionDevice({ id: 'barista-tablet', branchId: 'branch-a', secret: deviceSecret });
  const inspector = new DatabaseSync(databasePath);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.ok(target.startsWith(resolve(scratchRoot) + sep));
    assert.equal(dirname(target), resolve(scratchRoot));
    await rm(target, { recursive: true, force: true });
  });
  const call = (token: string, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => hub.app.inject({
    method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}),
  });
  const mutate = (token: string, url: string, payload: Record<string, unknown>, commandId = randomUUID()) => call(token, 'POST', url, { commandId, ...payload });
  const owner = result(await hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner-a', password } })).token as string;
  async function login(accountId: string, pin: string, deviceId: string) {
    return result(await hub.app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { accountId, pin, deviceId, deviceSecret } })).token as string;
  }
  const cashier = await login('cashier-a', '4826', 'cashier-tablet');
  const barista = await login('barista-a', '5937', 'barista-tablet');
  async function configure() {
    result(await mutate(owner, '/api/v1/ingredients', { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
    result(await mutate(owner, '/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli: 1_000_000, totalCostCentavos: 80000, reference: 'Fixture-safety-stock' }));
    result(await mutate(owner, '/api/v1/products', { productId: 'latte', name: 'Fixture latte', priceCentavos: 16500, recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }] }));
  }
  const createOrder = async (dineIn = false) => result(await mutate(cashier, '/api/v1/orders', { dineIn, items: [{ productId: 'latte', quantity: 1 }] })).order;
  const getOrder = async (id: string) => result(await call(cashier, 'GET', `/api/v1/orders/${id}`)).order;
  const getStock = async () => result(await call(cashier, 'GET', '/api/v1/ingredients')).ingredients;
  const counts = () => Object.fromEntries(['command_receipts', 'audit_events', 'outbox'].map(name => [name, Number(inspector.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()!.count)]));
  const valuationSnapshot = () => {
    const queries = {
      settlements: 'SELECT * FROM order_settlements ORDER BY branch_id,order_id',
      movementValues: 'SELECT * FROM stock_movement_valuations ORDER BY movement_id',
      balances: 'SELECT * FROM ingredient_valuation_balances ORDER BY branch_id,ingredient_id',
      estimates: 'SELECT * FROM order_recipe_valuation_estimates ORDER BY branch_id,order_id,ingredient_id',
    };
    return Object.fromEntries(Object.entries(queries).map(([name, query]) => {
      const statement = inspector.prepare(query);
      statement.setReadBigInts(true);
      return [name, statement.all()];
    }));
  };
  return {
    get hub() { return hub; }, inspector, owner, cashier, barista, call, mutate, login, configure, createOrder, getOrder, getStock, counts, valuationSnapshot,
    async reopen() { await hub.close(); hub = await createHub({ databasePath }); },
  };
}

function expectTerminalRejections(
  fixture: { counts(): Record<string, number>; inspector: DatabaseSync },
  before: Record<string, number>,
  count: number,
) {
  assert.deepEqual(fixture.counts(), Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value + count])));
  const rejected = fixture.inspector.prepare("SELECT id,action,rejection_status FROM command_receipts WHERE outcome='rejected'").all();
  assert.equal(rejected.length, count);
  for (const receipt of rejected) {
    assert.ok([400, 404, 409, 413].includes(Number(receipt.rejection_status)));
    const audit = fixture.inspector.prepare('SELECT action,payload_json FROM audit_events WHERE command_id=?').all(String(receipt.id));
    const outbox = fixture.inspector.prepare('SELECT event_type,payload_json FROM outbox WHERE command_id=?').all(String(receipt.id));
    assert.equal(audit.length, 1);
    assert.equal(outbox.length, 1);
    assert.equal(audit[0]!.action, receipt.action + '.rejected');
    assert.equal(outbox[0]!.event_type, receipt.action + '.rejected');
    assert.equal((JSON.parse(String(audit[0]!.payload_json)) as { outcome: string }).outcome, 'rejected');
    assert.equal((JSON.parse(String(outbox[0]!.payload_json)) as { outcome: string }).outcome, 'rejected');
  }
}

test('cash allocation without an assigned open drawer preserves order and stock with terminal rejection metadata', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const order = await f.createOrder();
  const beforeStock = await f.getStock();
  const beforeCommands = f.counts();
  const pay = () => f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: order.version, method: 'cash', amountCentavos: 16500, cashReceivedCentavos: 20000, verified: true });
  assert.equal((await pay()).statusCode, 409);
  assert.deepEqual(await f.getOrder(order.id), order);
  assert.deepEqual(await f.getStock(), beforeStock);
  expectTerminalRejections(f, beforeCommands, 1);
  result(await f.mutate(f.owner, '/api/v1/drawers', { drawerId: 'counter', name: 'Fixture drawer', deviceIds: ['cashier-tablet'] }));
  assert.equal((await pay()).statusCode, 409, 'assignment alone is insufficient without an open shift');
  assert.deepEqual(await f.getOrder(order.id), order);
});

test('rejecting a pending external tender retains confirmed funding and cannot reject a confirmed tender', async (t) => {
  const f = await fixture(t);
  await f.configure();
  let order = await f.createOrder();
  const pending = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: order.version, method: 'gcash', amountCentavos: 6500, verified: false, reference: 'Fixture-pending-rejection' }));
  const confirmed = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: pending.order.version, method: 'card', amountCentavos: 10000, verified: true, reference: 'Fixture-partial-card' }));
  const rejected = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments/${pending.payment.id}/reject`, { expectedVersion: confirmed.order.version, reason: 'Merchant transaction failed' }));
  order = rejected.order;
  assert.equal(rejected.payment.id, pending.payment.id);
  assert.equal(rejected.payment.status, 'rejected');
  assert.equal(order.paidCentavos, 10000);
  assert.equal(order.released, false);
  assert.equal(order.payments.length, 2);
  assert.deepEqual(result(await f.call(f.barista, 'GET', '/api/v1/orders')).orders, []);
  await f.reopen();
  assert.deepEqual(await f.getOrder(order.id), order);
  assert.equal((await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments/${confirmed.payment.id}/reject`, { expectedVersion: order.version, reason: 'Attempt to erase a confirmed payment' })).statusCode, 409);
  assert.deepEqual(await f.getOrder(order.id), order);
});

test('a confirmed external reference cannot settle another order or be re-added as pending', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const first = await f.createOrder();
  const reference = 'Fixture-merchant-reference-once';
  result(await f.mutate(f.cashier, `/api/v1/orders/${first.id}/payments`, { expectedVersion: first.version, method: 'gcash', amountCentavos: 16500, verified: true, reference }));
  const second = await f.createOrder();
  const before = f.counts();
  for (const verified of [true, false]) {
    assert.equal((await f.mutate(f.cashier, `/api/v1/orders/${second.id}/payments`, { expectedVersion: second.version, method: 'gcash', amountCentavos: 16500, verified, reference })).statusCode, 409);
    assert.deepEqual(await f.getOrder(second.id), second);
  }
  expectTerminalRejections(f, before, 2);
});

test('aggregate order total above the money ceiling rejects atomically although each line input is valid', async (t) => {
  const f = await fixture(t);
  await f.configure();
  result(await f.mutate(f.owner, '/api/v1/products', { productId: 'ceiling-product', name: 'Fixture maximum-priced product', priceCentavos: 100_000_000_000, recipe: [{ ingredientId: 'beans', quantityMilli: 1000 }] }));
  const before = f.counts();
  const response = await f.mutate(f.cashier, '/api/v1/orders', { dineIn: true, items: [{ productId: 'ceiling-product', quantity: 2 }] });
  assert.ok([400, 409, 422].includes(response.statusCode), response.body);
  assert.deepEqual(result(await f.call(f.cashier, 'GET', '/api/v1/orders')).orders, []);
  expectTerminalRejections(f, before, 1);
});

test('outbox failure during ready rolls back consumption, reservation and order state before a safe retry', async (t) => {
  const f = await fixture(t);
  await f.configure();
  let order = await f.createOrder(true);
  order = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/send`, { expectedVersion: order.version })).order;
  const beforeStock = await f.getStock();
  const before = f.counts();
  const beforeValuation = f.valuationSnapshot();
  const commandId = randomUUID();
  f.inspector.exec("CREATE TRIGGER safety_fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected business outbox failure'); END;");
  const failed = await f.mutate(f.barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version }, commandId);
  assert.equal(failed.statusCode, 500);
  assert.ok(!/sqlite|trigger|injected|stack/i.test(failed.body));
  assert.deepEqual(await f.getOrder(order.id), order);
  assert.deepEqual(await f.getStock(), beforeStock);
  assert.deepEqual(f.counts(), before);
  assert.deepEqual(f.valuationSnapshot(), beforeValuation, 'failed ready must roll back its carrying value and cost snapshot');
  f.inspector.exec('DROP TRIGGER safety_fail_outbox;');
  await f.reopen();
  assert.deepEqual(await f.getOrder(order.id), order);
  assert.deepEqual(f.valuationSnapshot(), beforeValuation);
  const accepted = result(await f.mutate(f.barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version }, commandId));
  assert.equal(accepted.order.ready, true);
  const beans = (await f.getStock()).find((row: any) => row.id === 'beans');
  assert.equal(beans.onHandMilli, 982000);
  assert.equal(beans.reservedMilli, 0);
  const afterValuation = f.valuationSnapshot();
  assert.equal(afterValuation.movementValues!.length, beforeValuation.movementValues!.length + 1);
  assert.deepEqual(afterValuation.settlements, beforeValuation.settlements);
  assert.deepEqual(afterValuation.estimates, beforeValuation.estimates);
  assert.equal(afterValuation.balances![0]!.carrying_microcentavos, 78_560_000_000n);
  assert.deepEqual(result(await f.mutate(f.barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version }, commandId)), accepted);
  assert.equal((await f.getStock()).find((row: any) => row.id === 'beans').onHandMilli, 982000);
  assert.deepEqual(f.valuationSnapshot(), afterValuation, 'ready replay must not duplicate cost or carrying-value effects');
});

test('outbox failure during final cash payment rolls back payment, shift and automatic kitchen release', async (t) => {
  const f = await fixture(t);
  await f.configure();
  result(await f.mutate(f.owner, '/api/v1/drawers', { drawerId: 'counter', name: 'Fixture drawer', deviceIds: ['cashier-tablet'] }));
  result(await f.mutate(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100000 }));
  const order = await f.createOrder();
  const beforeStock = await f.getStock();
  const beforeShift = result(await f.call(f.cashier, 'GET', '/api/v1/shifts/current'));
  const before = f.counts();
  const beforeValuation = f.valuationSnapshot();
  const commandId = randomUUID();
  const payment = { expectedVersion: order.version, method: 'cash', amountCentavos: 16500, cashReceivedCentavos: 20000, verified: true };
  f.inspector.exec("CREATE TRIGGER safety_fail_payment_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected payment outbox failure'); END;");
  assert.equal((await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, payment, commandId)).statusCode, 500);
  assert.deepEqual(await f.getOrder(order.id), order);
  assert.deepEqual(await f.getStock(), beforeStock);
  assert.deepEqual(result(await f.call(f.cashier, 'GET', '/api/v1/shifts/current')), beforeShift);
  assert.deepEqual(f.counts(), before);
  assert.deepEqual(f.valuationSnapshot(), beforeValuation, 'failed final payment must not leave a settlement or release estimate');
  f.inspector.exec('DROP TRIGGER safety_fail_payment_outbox;');
  const accepted = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, payment, commandId));
  assert.equal(accepted.order.paidCentavos, 16500);
  assert.equal(accepted.order.released, true);
  assert.equal(accepted.payment.changeCentavos, 3500);
  const afterValuation = f.valuationSnapshot();
  assert.equal(afterValuation.settlements!.length, beforeValuation.settlements!.length + 1);
  assert.equal(afterValuation.estimates!.length, beforeValuation.estimates!.length + 1);
  assert.deepEqual(afterValuation.movementValues, beforeValuation.movementValues, 'settlement reserves rather than consumes inventory');
  assert.deepEqual(afterValuation.balances, beforeValuation.balances);
  assert.equal(afterValuation.settlements![0]!.total_centavos, 16500n);
  assert.equal(afterValuation.estimates![0]!.cost_microcentavos, 1_440_000_000n);
  await f.reopen();
  assert.deepEqual(result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, payment, commandId)), accepted);
  assert.deepEqual(f.valuationSnapshot(), afterValuation, 'payment replay must preserve one dated settlement and one recipe estimate');
});

test('cross-branch stock receipts, order release and waste cannot mutate another branch', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const order = await f.createOrder(true);
  await f.hub.provisionAccount({ id: 'owner-b', displayName: 'Other owner', role: 'owner', branchId: 'branch-b', secret: password });
  await f.hub.provisionAccount({ id: 'cashier-b', displayName: 'Other cashier', role: 'cashier', branchId: 'branch-b', secret: '6248' });
  await f.hub.provisionAccount({ id: 'barista-b', displayName: 'Other barista', role: 'barista', branchId: 'branch-b', secret: '7359' });
  await f.hub.provisionDevice({ id: 'other-tablet', branchId: 'branch-b', secret: deviceSecret });
  const owner = result(await f.hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner-b', password } })).token as string;
  const cashier = await f.login('cashier-b', '6248', 'other-tablet');
  const barista = await f.login('barista-b', '7359', 'other-tablet');
  const beforeStock = await f.getStock();
  const before = f.counts();
  assert.equal((await f.mutate(owner, '/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli: 1000, totalCostCentavos: 100, reference: 'Other-branch-spoof' })).statusCode, 404);
  assert.equal((await f.mutate(cashier, `/api/v1/orders/${order.id}/send`, { expectedVersion: order.version })).statusCode, 404);
  assert.equal((await f.mutate(barista, '/api/v1/waste', { ingredientId: 'beans', quantityMilli: 1000, reason: 'Other-branch-spoof' })).statusCode, 404);
  assert.deepEqual(await f.getOrder(order.id), order);
  assert.deepEqual(await f.getStock(), beforeStock);
  expectTerminalRejections(f, before, 3);
});

test('drawer monetary ceiling rejects one extra cent atomically instead of creating an uncountable shift', async (t) => {
  const f = await fixture(t);
  await f.configure();
  result(await f.mutate(f.owner, '/api/v1/products', { productId: 'one-cent', name: 'Fixture one cent', priceCentavos: 1, recipe: [{ ingredientId: 'beans', quantityMilli: 1000 }] }));
  result(await f.mutate(f.owner, '/api/v1/drawers', { drawerId: 'maximum-drawer', name: 'Fixture maximum drawer', deviceIds: ['cashier-tablet'] }));
  result(await f.mutate(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000_000_000 }));
  const order = result(await f.mutate(f.cashier, '/api/v1/orders', { dineIn: false, items: [{ productId: 'one-cent', quantity: 1 }] })).order;
  const beforeShift = result(await f.call(f.cashier, 'GET', '/api/v1/shifts/current'));
  const beforeStock = await f.getStock();
  const before = f.counts();
  assert.equal((await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: order.version, method: 'cash', amountCentavos: 1, cashReceivedCentavos: 1, verified: true })).statusCode, 400);
  assert.deepEqual(await f.getOrder(order.id), order);
  assert.deepEqual(result(await f.call(f.cashier, 'GET', '/api/v1/shifts/current')), beforeShift);
  assert.deepEqual(await f.getStock(), beforeStock);
  expectTerminalRejections(f, before, 1);
});

test('same cashier cannot replay another register device cash command as its own accepted payment', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.hub.provisionDevice({ id: 'second-cashier-tablet', branchId: 'branch-a', secret: deviceSecret });
  const secondCashier = await f.login('cashier-a', '4826', 'second-cashier-tablet');
  result(await f.mutate(f.owner, '/api/v1/drawers', { drawerId: 'drawer-a', name: 'Fixture drawer A', deviceIds: ['cashier-tablet'] }));
  result(await f.mutate(f.owner, '/api/v1/drawers', { drawerId: 'drawer-b', name: 'Fixture drawer B', deviceIds: ['second-cashier-tablet'] }));
  result(await f.mutate(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 0 }));
  result(await f.mutate(secondCashier, '/api/v1/shifts/open', { openingCashCentavos: 0 }));
  const order = await f.createOrder();
  const commandId = randomUUID();
  const payload = { expectedVersion: order.version, method: 'cash', amountCentavos: 16500, cashReceivedCentavos: 16500, verified: true };
  const accepted = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, payload, commandId));
  const secondShift = result(await f.call(secondCashier, 'GET', '/api/v1/shifts/current'));
  const before = f.counts();
  assert.equal((await f.mutate(secondCashier, `/api/v1/orders/${order.id}/payments`, payload, commandId)).statusCode, 409);
  assert.deepEqual(await f.getOrder(order.id), accepted.order);
  assert.deepEqual(result(await f.call(secondCashier, 'GET', '/api/v1/shifts/current')), secondShift);
  assert.deepEqual(f.counts(), before);
  assert.deepEqual(result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, payload, commandId)), accepted);
});

test('payment storage independently rejects NULL cash received or change values', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const order = await f.createOrder();
  f.inspector.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
  try {
    const insert = f.inspector.prepare("INSERT INTO payments(id,branch_id,order_id,method,amount_centavos,status,reference,cash_received_centavos,change_centavos,accepted_at,command_id) VALUES(?,?,?,'cash',100,'confirmed',NULL,?,?,?,?)");
    for (const [received, change] of [[null, null], [null, 0], [100, null]]) {
      assert.throws(() => insert.run(randomUUID(), 'branch-a', order.id, received ?? null, change ?? null, Date.now(), randomUUID()), /CHECK constraint failed/, `cash received=${received}, change=${change} must fail its CHECK before deferred foreign-key validation`);
    }
  } finally {
    f.inspector.exec('ROLLBACK;');
  }
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments WHERE order_id=?').get(order.id)!.count, 0);
});

test('payment summary distinguishes pending verification from unpaid, partial and fully paid states', async (t) => {
  const f = await fixture(t);
  await f.configure();
  let order = await f.createOrder();
  assert.equal(order.paymentState, 'unpaid');
  assert.equal(order.hasPendingPayments, false);

  const firstPending = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: order.version, method: 'gcash', amountCentavos: 6500, verified: false, reference: 'Fixture-summary-pending-one' }));
  order = firstPending.order;
  assert.equal(order.paymentState, 'pending_verification');
  assert.equal(order.hasPendingPayments, true);
  const rejectedOnly = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments/${firstPending.payment.id}/reject`, { expectedVersion: order.version, reason: 'Merchant reports failure' }));
  order = rejectedOnly.order;
  assert.equal(order.paymentState, 'unpaid');
  assert.equal(order.hasPendingPayments, false);

  order = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: order.version, method: 'card', amountCentavos: 10000, verified: true, reference: 'Fixture-summary-confirmed-part' })).order;
  assert.equal(order.paymentState, 'partially_paid');
  assert.equal(order.hasPendingPayments, false);
  const secondPending = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: order.version, method: 'gcash', amountCentavos: 6500, verified: false, reference: 'Fixture-summary-pending-two' }));
  order = secondPending.order;
  assert.equal(order.paymentState, 'pending_verification');
  assert.equal(order.hasPendingPayments, true);
  const rejectedPartial = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments/${secondPending.payment.id}/reject`, { expectedVersion: order.version, reason: 'Merchant rejects second pending attempt' }));
  order = rejectedPartial.order;
  assert.equal(order.paymentState, 'partially_paid');
  assert.equal(order.hasPendingPayments, false);

  const unresolved = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: order.version, method: 'gcash', amountCentavos: 6500, verified: false, reference: 'Fixture-summary-pending-unresolved' }));
  order = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, { expectedVersion: unresolved.order.version, method: 'card', amountCentavos: 6500, verified: true, reference: 'Fixture-summary-confirmed-rest' })).order;
  assert.equal(order.paymentState, 'paid');
  assert.equal(order.hasPendingPayments, true, 'a fully funded order must still surface an unresolved external attempt');
  const baristaOrder = result(await f.call(f.barista, 'GET', `/api/v1/orders/${order.id}`)).order;
  assert.equal(baristaOrder.paymentState, 'paid');
  assert.equal(baristaOrder.hasPendingPayments, true);
  assert.equal('payments' in baristaOrder, false);
  assert.equal('paidCentavos' in baristaOrder, false);
  assert.equal('totalCentavos' in baristaOrder, false);
});
