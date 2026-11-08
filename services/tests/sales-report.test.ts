import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHub } from '../src/hub.js';

const scratchRoot = fileURLToPath(new URL('../../scratch/sales-report-tests/', import.meta.url));
const endpoint = '/api/v1/admin/sales';
const password = 'Fixture-Sales-Admin-Password!';
const deviceSecret = 'Fixture-Sales-Device-Secret-2026!';

type Order = { id: string; version: number; paidCentavos: number; ready: boolean };
type SalesReport = {
  from: string;
  through: string;
  settledOrderCount: number;
  settledSalesCentavos: number;
  dailySales: { businessDate: string; settledOrderCount: number; settledSalesCentavos: number }[];
  unattributedLegacySettlements: number;
  enteredExpensesCentavos: number;
  finalIngredientCostCentavos: number;
  estimatedIngredientCostCentavos: number;
  ordersWithUnknownIngredientCost: number;
  wasteCostCentavos: number;
  wasteEntriesWithUnknownCost: number;
  estimatedGrossProfitCentavos: number | null;
  estimatedGrossMarginBps: number | null;
  estimatedOperatingProfitCentavos: number | null;
  expenseCoverageConfirmed: boolean;
};

function ok<T>(response: { statusCode: number; body: string; json(): unknown }): T {
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as T;
}

test('sales are attributed once to the Manila settlement date across verification, preparation and restart', async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'sales-'));
  const databasePath = join(folder, 'hub.sqlite');
  const midnight = Date.UTC(2026, 10, 4, 16);
  let now = midnight - 1;
  let hub = await createHub({ databasePath, now: () => now });
  t.after(async () => {
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), resolve(scratchRoot));
    await rm(target, { recursive: true, force: true });
  });

  for (const branch of ['a', 'b']) {
    await hub.provisionAccount({ id: `owner-${branch}`, displayName: 'Fixture owner', role: 'owner', branchId: `branch-${branch}`, secret: password });
    await hub.provisionAccount({ id: `cashier-${branch}`, displayName: 'Fixture cashier', role: 'cashier', branchId: `branch-${branch}`, secret: '4826' });
    await hub.provisionDevice({ id: `tablet-${branch}`, branchId: `branch-${branch}`, secret: deviceSecret });
  }
  await hub.provisionAccount({ id: 'manager-a', displayName: 'Fixture manager', role: 'manager', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'barista-a', displayName: 'Fixture barista', role: 'barista', branchId: 'branch-a', secret: '5937' });
  const login = async (accountId: string, staff?: { pin: string; deviceId: string }) => ok<{ token: string }>(await hub.app.inject({
    method: 'POST', url: `/api/v1/auth/${staff ? 'staff' : 'admin'}`,
    payload: staff ? { accountId, ...staff, deviceSecret } : { accountId, password },
  })).token;
  const owner = await login('owner-a');
  const manager = await login('manager-a');
  const cashier = await login('cashier-a', { pin: '4826', deviceId: 'tablet-a' });
  const barista = await login('barista-a', { pin: '5937', deviceId: 'tablet-a' });
  const otherOwner = await login('owner-b');
  const otherCashier = await login('cashier-b', { pin: '4826', deviceId: 'tablet-b' });
  const headers = (token?: string) => token ? { authorization: `Bearer ${token}` } : {};
  const post = (url: string, token: string, payload: Record<string, unknown>, commandId: string = randomUUID()) => hub.app.inject({
    method: 'POST', url, headers: headers(token), payload: { commandId, ...payload },
  });
  const get = (url: string, token?: string) => hub.app.inject({ method: 'GET', url, headers: headers(token) });
  const period = (from: string, through = from) => `${endpoint}?from=${from}&through=${through}`;
  const report = async (token: string, from: string, through = from) => ok<SalesReport>(await get(period(from, through), token));
  const createOrder = async (token: string, dineIn: boolean) => ok<{ order: Order }>(await post('/api/v1/orders', token, {
    dineIn, items: [{ productId: 'latte', quantity: 1 }],
  })).order;
  for (const [token, priceCentavos] of [[owner, 16500], [otherOwner, 43200]] as const) {
    ok(await post('/api/v1/ingredients', token, { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
    ok(await post('/api/v1/inventory/receipts', token, {
      ingredientId: 'beans', quantityMilli: 1000000, totalCostCentavos: 80000, reference: 'Fixture receipt',
    }));
    ok(await post('/api/v1/products', token, {
      productId: 'latte', name: 'Fixture latte', priceCentavos, recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }],
    }));
  }
  ok(await post('/api/v1/drawers', owner, { drawerId: 'counter', name: 'Counter', deviceIds: ['tablet-a'] }));
  ok(await post('/api/v1/shifts/open', cashier, { openingCashCentavos: 50000 }));
  ok(await post('/api/v1/admin/expenses', owner, {
    category: 'Utilities', description: 'Fixture one-time expense', amountCentavos: 1250,
    startsOn: '2026-11-05', endsOn: '2026-11-05',
  }));
  let dineIn = await createOrder(cashier, true);
  dineIn = ok<{ order: Order }>(await post(`/api/v1/orders/${dineIn.id}/send`, cashier, { expectedVersion: dineIn.version })).order;
  dineIn = ok<{ order: Order }>(await post(`/api/v1/orders/${dineIn.id}/ready`, barista, { expectedVersion: dineIn.version })).order;
  assert.equal(dineIn.ready, true);
  dineIn = ok<{ order: Order }>(await post(`/api/v1/orders/${dineIn.id}/payments`, cashier, {
    expectedVersion: dineIn.version, method: 'cash', amountCentavos: 10000, cashReceivedCentavos: 20000, verified: true,
  })).order;
  const pending = ok<{ order: Order; payment: { id: string; status: string } }>(await post(`/api/v1/orders/${dineIn.id}/payments`, cashier, {
    expectedVersion: dineIn.version, method: 'gcash', amountCentavos: 6500, verified: false, reference: 'Fixture midnight verification',
  }));
  assert.equal(pending.payment.status, 'pending');
  assert.equal(pending.order.paidCentavos, 10000);

  const before = await report(owner, '2026-11-04');
  assert.equal(before.settledOrderCount, 0);
  assert.equal(before.settledSalesCentavos, 0, 'prepared and partially funded tickets do not count as sales');
  now = midnight;
  const verifyPath = `/api/v1/orders/${dineIn.id}/payments/${pending.payment.id}/verify`;
  const verification = { expectedVersion: pending.order.version };
  const verifyCommand = randomUUID();
  const confirmed = ok<{ order: Order }>(await post(verifyPath, cashier, verification, verifyCommand));
  assert.equal(confirmed.order.paidCentavos, 16500);
  const otherOrder = await createOrder(otherCashier, false);
  ok(await post(`/api/v1/orders/${otherOrder.id}/payments`, otherCashier, {
    expectedVersion: otherOrder.version, method: 'card', amountCentavos: 43200, verified: true, reference: 'Fixture branch B terminal',
  }));

  const oldDay = await report(owner, '2026-11-04');
  assert.equal(oldDay.settledOrderCount, 0);
  assert.equal(oldDay.settledSalesCentavos, 0, 'the original pending timestamp does not attribute the later sale');
  const newDay = await report(manager, '2026-11-05');
  assert.equal(newDay.from, '2026-11-05');
  assert.equal(newDay.through, '2026-11-05');
  assert.equal(newDay.settledOrderCount, 1);
  assert.equal(newDay.settledSalesCentavos, 16500, 'sale excludes cash change, opening float and other branches');
  assert.equal(newDay.enteredExpensesCentavos, 1250);
  assert.equal(newDay.unattributedLegacySettlements, 0);
  const combined = await report(owner, '2026-11-04', '2026-11-05');
  assert.equal(combined.settledOrderCount, 1);
  assert.equal(combined.settledSalesCentavos, 16500);
  assert.deepEqual(combined.dailySales, [{ businessDate: '2026-11-05', settledOrderCount: 1, settledSalesCentavos: 16500 }]);
  const other = await report(otherOwner, '2026-11-05');
  assert.equal(other.settledOrderCount, 1);
  assert.equal(other.settledSalesCentavos, 43200);
  assert.equal(other.enteredExpensesCentavos, 0);

  for (const [token, expected] of [[cashier, 403], [barista, 403], [undefined, 401]] as const) {
    const denied = await get(period('2026-11-05'), token);
    assert.equal(denied.statusCode, expected);
    assert.doesNotMatch(denied.body, /settledSales|ingredientCost|operatingProfit|enteredExpenses|sqlite/i);
  }
  for (const invalid of [period('2026-02-29'), period('2026-11-05', '2026-11-04'), `${period('2026-11-05')}&branchId=branch-b`]) {
    const failed = await get(invalid, owner);
    assert.equal(failed.statusCode, 400);
    assert.equal(failed.json().error.code, 'invalid_request');
    assert.doesNotMatch(failed.body, /sqlite|stack|settledSales/i);
  }

  await hub.close();
  hub = await createHub({ databasePath, now: () => now });
  assert.deepEqual(ok(await post(verifyPath, cashier, verification, verifyCommand)), confirmed);
  const reopened = await report(owner, '2026-11-05');
  assert.equal(reopened.settledOrderCount, 1);
  assert.equal(reopened.settledSalesCentavos, 16500);
});

test('sales report distinguishes reserved and posted ingredient cost and requires current expense coverage', async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'profit-'));
  const databasePath = join(folder, 'hub.sqlite');
  const midnight = Date.UTC(2026, 10, 5, 16);
  let now = midnight - 60000;
  const hub = await createHub({ databasePath, now: () => now });
  t.after(async () => {
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), resolve(scratchRoot));
    await rm(target, { recursive: true, force: true });
  });

  await hub.provisionAccount({ id: 'owner', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'manager', displayName: 'Fixture manager', role: 'manager', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'cashier', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: '4826' });
  await hub.provisionAccount({ id: 'barista', displayName: 'Fixture barista', role: 'barista', branchId: 'branch-a', secret: '5937' });
  await hub.provisionDevice({ id: 'tablet', branchId: 'branch-a', secret: deviceSecret });
  const login = async (accountId: string, pin?: string) => ok<{ token: string }>(await hub.app.inject({
    method: 'POST', url: `/api/v1/auth/${pin ? 'staff' : 'admin'}`,
    payload: pin ? { accountId, pin, deviceId: 'tablet', deviceSecret } : { accountId, password },
  })).token;
  const owner = await login('owner');
  const manager = await login('manager');
  const cashier = await login('cashier', '4826');
  const barista = await login('barista', '5937');
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  const post = (url: string, token: string, payload: Record<string, unknown>, commandId: string = randomUUID()) => hub.app.inject({
    method: 'POST', url, headers: headers(token), payload: { commandId, ...payload },
  });
  const get = (url: string, token = owner) => hub.app.inject({ method: 'GET', url, headers: headers(token) });
  const day = '2026-11-05';
  const nextDay = '2026-11-06';
  const coveragePath = '/api/v1/admin/expense-coverage';
  const report = async (from = day, through = from) => ok<SalesReport>(await get(`${endpoint}?from=${from}&through=${through}`));
  const stock = async () => ok<{ ingredients: { onHandMilli: number; reservedMilli: number }[] }>(await get('/api/v1/ingredients', barista)).ingredients[0]!;
  const receipt = (reference: string, totalCostCentavos: number) => post('/api/v1/inventory/receipts', owner, {
    ingredientId: 'beans', quantityMilli: 1000000, totalCostCentavos, reference,
  });
  const expense = (description: string, amountCentavos: number, startsOn = day, endsOn = startsOn) => post('/api/v1/admin/expenses', owner, {
    category: 'Utilities', description, amountCentavos, startsOn, endsOn,
  });
  const settledOrder = async (reference: string) => {
    const created = ok<{ order: Order }>(await post('/api/v1/orders', cashier, {
      dineIn: false, items: [{ productId: 'latte', quantity: 1 }],
    })).order;
    return ok<{ order: Order }>(await post(`/api/v1/orders/${created.id}/payments`, cashier, {
      expectedVersion: created.version, method: 'card', amountCentavos: 16500, verified: true, reference,
    })).order;
  };
  const ready = (order: Order, commandId?: string) => post(`/api/v1/orders/${order.id}/ready`, barista, { expectedVersion: order.version }, commandId);

  ok(await post('/api/v1/ingredients', owner, { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
  ok(await receipt('First kilo', 80000));
  ok(await receipt('Second kilo', 100000));
  ok(await post('/api/v1/products', owner, {
    productId: 'latte', name: 'Fixture latte', priceCentavos: 16500, recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }],
  }));
  ok(await expense('Entered operating expense', 1000));
  const zero = await report('2026-11-04');
  assert.equal(zero.settledOrderCount, 0);
  assert.equal(zero.estimatedGrossMarginBps, null);
  const order = await settledOrder('Fixture known cost');
  assert.equal(order.ready, false);
  assert.equal((await stock()).reservedMilli, 18000);
  const pending = await report();
  assert.equal(pending.settledSalesCentavos, 16500);
  assert.equal(pending.finalIngredientCostCentavos, 0);
  assert.equal(pending.estimatedIngredientCostCentavos, 1620);
  assert.equal(pending.ordersWithUnknownIngredientCost, 0);
  assert.equal(pending.estimatedGrossProfitCentavos, 14880);
  assert.equal(pending.estimatedOperatingProfitCentavos, null);
  assert.equal(pending.expenseCoverageConfirmed, false);

  ok(await post('/api/v1/waste', barista, { ingredientId: 'beans', quantityMilli: 10000, reason: 'Fixture dial-in' }));
  const readyCommand = randomUUID();
  const completed = ok(await ready(order, readyCommand));
  assert.equal((await stock()).reservedMilli, 0);
  assert.equal((await stock()).onHandMilli, 1972000);
  assert.equal((await post(coveragePath, cashier, { from: day, through: day })).statusCode, 403);
  assert.equal((await post(coveragePath, owner, { from: day, through: nextDay })).statusCode, 400);
  const coverageCommand = randomUUID();
  const coverageInput = { from: day, through: day };
  const confirmation = ok(await post(coveragePath, manager, coverageInput, coverageCommand));
  assert.deepEqual(confirmation, { commandId: coverageCommand, coverage: { ...coverageInput, confirmedAt: now } });
  const posted = await report();
  assert.equal(posted.finalIngredientCostCentavos, 1620);
  assert.equal(posted.estimatedIngredientCostCentavos, 0);
  assert.equal(posted.estimatedGrossProfitCentavos, 14880);
  assert.equal(posted.wasteCostCentavos, 900);
  assert.equal(posted.wasteEntriesWithUnknownCost, 0);
  assert.equal(posted.estimatedOperatingProfitCentavos, 12980);
  assert.equal(posted.expenseCoverageConfirmed, true);
  assert.equal((await report('2026-11-04', day)).expenseCoverageConfirmed, false);

  ok(await receipt('Later higher-cost kilo', 200000));
  assert.deepEqual(ok(await ready(order, readyCommand)), completed);
  assert.deepEqual(await report(), posted);
  ok(await expense('Nonoverlapping expense', 100, nextDay));
  assert.deepEqual(await report(), posted);
  ok(await expense('Additional overlapping expense', 500));
  assert.deepEqual(ok(await post(coveragePath, manager, coverageInput, coverageCommand)), confirmation);
  const reopenedCoverage = await report();
  assert.equal(reopenedCoverage.enteredExpensesCentavos, 1500);
  assert.equal(reopenedCoverage.expenseCoverageConfirmed, false);
  assert.equal(reopenedCoverage.estimatedOperatingProfitCentavos, null);
  ok(await post(coveragePath, owner, coverageInput));
  assert.equal((await report()).estimatedOperatingProfitCentavos, 12480);

  now = midnight;
  ok(await post('/api/v1/waste', barista, { ingredientId: 'beans', quantityMilli: 2962000, reason: 'Fixture stock depletion' }));
  assert.equal((await stock()).onHandMilli, 10000);
  ok(await post('/api/v1/ingredients', owner, { ingredientId: 'unvalued-stock', name: 'Unvalued fixture stock', unit: 'g' }));
  ok(await post('/api/v1/waste', barista, { ingredientId: 'unvalued-stock', quantityMilli: 1000, reason: 'Fixture unknown-cost waste' }));
  ok(await post(coveragePath, manager, { from: nextDay, through: nextDay }));
  const wasteOnly = await report(nextDay);
  assert.equal(wasteOnly.settledOrderCount, 0);
  assert.equal(wasteOnly.ordersWithUnknownIngredientCost, 0);
  assert.equal(wasteOnly.wasteEntriesWithUnknownCost, 1);
  assert.equal(wasteOnly.expenseCoverageConfirmed, true);
  assert.equal(wasteOnly.estimatedGrossProfitCentavos, 0);
  assert.equal(wasteOnly.estimatedOperatingProfitCentavos, null);
  const previousDay = await report();
  assert.equal(previousDay.wasteCostCentavos, 900, 'waste is dated by its accepted Manila day rather than a sale settlement');
  assert.equal(previousDay.wasteEntriesWithUnknownCost, 0);
  assert.equal(previousDay.estimatedOperatingProfitCentavos, 12480);
  const shortage = await settledOrder('Fixture shortage');
  assert.equal((await report(nextDay)).ordersWithUnknownIngredientCost, 1);
  ok(await ready(shortage));
  assert.equal((await stock()).onHandMilli, -8000);
  ok(await post(coveragePath, manager, { from: nextDay, through: nextDay }));
  const unresolved = await report(nextDay);
  assert.equal(unresolved.settledSalesCentavos, 16500);
  assert.equal(unresolved.ordersWithUnknownIngredientCost, 1);
  assert.equal(unresolved.expenseCoverageConfirmed, true);
  assert.equal(unresolved.estimatedGrossProfitCentavos, null);
  assert.equal(unresolved.estimatedGrossMarginBps, null);
  assert.equal(unresolved.estimatedOperatingProfitCentavos, null);
});

test('replenishment changes ready cost while report rounding sums fractional costs across ingredients and orders', async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'fractional-cost-'));
  const databasePath = join(folder, 'hub.sqlite');
  const hub = await createHub({ databasePath, now: () => Date.UTC(2026, 10, 5, 8) });
  const inspector = new DatabaseSync(databasePath);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), resolve(scratchRoot));
    await rm(target, { recursive: true, force: true });
  });
  await hub.provisionAccount({ id: 'owner', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'cashier', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: '4826' });
  await hub.provisionAccount({ id: 'barista', displayName: 'Fixture barista', role: 'barista', branchId: 'branch-a', secret: '5937' });
  await hub.provisionDevice({ id: 'tablet', branchId: 'branch-a', secret: deviceSecret });
  const login = async (accountId: string, pin?: string) => ok<{ token: string }>(await hub.app.inject({
    method: 'POST', url: `/api/v1/auth/${pin ? 'staff' : 'admin'}`,
    payload: pin ? { accountId, pin, deviceId: 'tablet', deviceSecret } : { accountId, password },
  })).token;
  const owner = await login('owner');
  const cashier = await login('cashier', '4826');
  const barista = await login('barista', '5937');
  const post = (url: string, token: string, payload: Record<string, unknown>) => hub.app.inject({
    method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { commandId: randomUUID(), ...payload },
  });
  const report = async () => ok<SalesReport>(await hub.app.inject({
    method: 'GET', url: `${endpoint}?from=2026-11-05&through=2026-11-05`, headers: { authorization: `Bearer ${owner}` },
  }));
  const monetarySum = (sql: string, orderId?: string) => {
    const statement = inspector.prepare(sql);
    statement.setReadBigInts(true);
    return (orderId ? statement.get(orderId) : statement.get())!.amount as bigint;
  };
  const estimateSum = (orderId: string) => monetarySum('SELECT SUM(cost_microcentavos) AS amount FROM order_recipe_valuation_estimates WHERE order_id=?', orderId);
  const movementCostSum = (orderId: string) => monetarySum(`SELECT SUM(v.value_microcentavos) AS amount FROM stock_movements m
    JOIN stock_movement_valuations v ON v.movement_id=m.id WHERE m.order_id=? AND m.kind='consumption'`, orderId);
  for (const ingredientId of ['first', 'second']) {
    ok(await post('/api/v1/ingredients', owner, { ingredientId, name: ingredientId, unit: 'piece' }));
    ok(await post('/api/v1/inventory/receipts', owner, { ingredientId, quantityMilli: 2000, totalCostCentavos: 1, reference: `Initial ${ingredientId}` }));
  }
  ok(await post('/api/v1/products', owner, {
    productId: 'fractional-latte', name: 'Fractional cost fixture', priceCentavos: 100,
    recipe: [{ ingredientId: 'first', quantityMilli: 1000 }, { ingredientId: 'second', quantityMilli: 1000 }],
  }));
  const settle = async (reference: string) => {
    const created = ok<{ order: Order }>(await post('/api/v1/orders', cashier, { dineIn: false, items: [{ productId: 'fractional-latte', quantity: 1 }] })).order;
    return ok<{ order: Order }>(await post(`/api/v1/orders/${created.id}/payments`, cashier, {
      expectedVersion: created.version, method: 'card', amountCentavos: 100, verified: true, reference,
    })).order;
  };
  const firstOrder = await settle('Fractional first payment');
  assert.equal(estimateSum(firstOrder.id), 1000000n);
  assert.equal((await report()).estimatedIngredientCostCentavos, 1);
  ok(await post('/api/v1/inventory/receipts', owner, { ingredientId: 'first', quantityMilli: 2000, totalCostCentavos: 3, reference: 'Higher price during preparation' }));
  assert.equal(estimateSum(firstOrder.id), 1000000n, 'release-time estimate remains unchanged during replenishment');
  assert.equal((await report()).estimatedIngredientCostCentavos, 1);
  ok(await post(`/api/v1/orders/${firstOrder.id}/ready`, barista, { expectedVersion: firstOrder.version }));
  assert.equal(movementCostSum(firstOrder.id), 1500000n);
  assert.equal(estimateSum(firstOrder.id), 1000000n);
  assert.equal((await report()).finalIngredientCostCentavos, 2, 'one and a half centavos rounds up after ingredient aggregation');

  const secondOrder = await settle('Fractional second payment');
  ok(await post(`/api/v1/orders/${secondOrder.id}/ready`, barista, { expectedVersion: secondOrder.version }));
  assert.equal(movementCostSum(secondOrder.id), 1500000n);
  const combined = await report();
  assert.equal(combined.settledOrderCount, 2);
  assert.equal(combined.settledSalesCentavos, 200);
  assert.equal(combined.finalIngredientCostCentavos, 3, 'sum exact movement costs before report rounding across orders');
  assert.equal(combined.estimatedIngredientCostCentavos, 0);
  assert.equal(combined.ordersWithUnknownIngredientCost, 0);
  assert.equal(combined.estimatedGrossProfitCentavos, 197);
  assert.equal(monetarySum("SELECT SUM(value_microcentavos) AS amount FROM stock_movement_valuations v JOIN stock_movements m ON m.id=v.movement_id WHERE m.kind='consumption'"), 3000000n);
  assert.equal(monetarySum('SELECT SUM(carrying_microcentavos) AS amount FROM ingredient_valuation_balances'), 2000000n);
  assert.equal(monetarySum("SELECT SUM(value_microcentavos) AS amount FROM stock_movement_valuations v JOIN stock_movements m ON m.id=v.movement_id WHERE m.kind='receipt'"), 5000000n);
});
