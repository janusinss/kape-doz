import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const scratchRoot = fileURLToPath(new URL('../../scratch/service-loop-tests/', import.meta.url));
const password = 'Fixture-Service-Admin-Password!';
const deviceSecret = 'Fixture-Service-Device-Secret-2026!';

function result(response: { statusCode: number; body: string; json(): any }, status = 200): any {
  assert.equal(response.statusCode, status, response.body);
  return response.json();
}

function noFinancialInternals(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!/cost|margin|profit|expectedCash|variance|credential|secret|hash/i.test(key), `staff response exposed ${key}`);
    noFinancialInternals(child);
  }
}

async function fixture(t: TestContext) {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'loop-'));
  const databasePath = join(folder, 'hub.sqlite');
  let hub = await createHub({ databasePath });
  await hub.provisionAccount({ id: 'owner-a', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'manager-a', displayName: 'Fixture manager', role: 'manager', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'cashier-a', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: '4826' });
  await hub.provisionAccount({ id: 'barista-a', displayName: 'Fixture barista', role: 'barista', branchId: 'branch-a', secret: '5937' });
  for (const id of ['cashier-tablet-a', 'cashier-tablet-b', 'barista-tablet']) {
    await hub.provisionDevice({ id, branchId: 'branch-a', secret: deviceSecret });
  }
  t.after(async () => {
    await hub.close();
    const target = resolve(folder);
    assert.ok(target.startsWith(resolve(scratchRoot) + sep));
    assert.equal(dirname(target), resolve(scratchRoot));
    await rm(target, { recursive: true, force: true });
  });
  const call = (token: string, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => hub.app.inject({
    method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}),
  });
  const mutate = (token: string, url: string, payload: Record<string, unknown>, commandId: string = randomUUID()) => call(token, 'POST', url, { commandId, ...payload });
  const owner = result(await hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner-a', password } })).token as string;
  const manager = result(await hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'manager-a', password } })).token as string;
  async function login(accountId: string, pin: string, deviceId: string) {
    return result(await hub.app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { accountId, pin, deviceId, deviceSecret } })).token as string;
  }
  const cashier = await login('cashier-a', '4826', 'cashier-tablet-a');
  const secondCashier = await login('cashier-a', '4826', 'cashier-tablet-b');
  const barista = await login('barista-a', '5937', 'barista-tablet');
  async function configure() {
    for (const [ingredientId, name, unit, quantityMilli, totalCostCentavos] of [
      ['beans', 'Fixture espresso beans', 'g', 1_000_000, 80000],
      ['milk', 'Fixture whole milk', 'ml', 2_000_000, 18000],
    ] as const) {
      result(await mutate(owner, '/api/v1/ingredients', { ingredientId, name, unit }));
      result(await mutate(owner, '/api/v1/inventory/receipts', { ingredientId, quantityMilli, totalCostCentavos, reference: `Fixture-${ingredientId}-receipt` }));
    }
    result(await mutate(owner, '/api/v1/products', {
      productId: 'spanish-latte', name: 'Fixture Iced Spanish Latte', priceCentavos: 16500,
      recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }, { ingredientId: 'milk', quantityMilli: 150000 }],
    }));
    result(await mutate(owner, '/api/v1/drawers', {
      drawerId: 'counter-drawer', name: 'Fixture counter drawer', deviceIds: ['cashier-tablet-a', 'cashier-tablet-b'],
    }));
  }
  const createOrder = async (dineIn: boolean, commandId: string = randomUUID()) => result(await mutate(cashier, '/api/v1/orders', {
    dineIn, ...(dineIn ? { table: '04' } : {}), items: [{ productId: 'spanish-latte', quantity: 1, note: 'Less sweet' }],
  }, commandId));
  return {
    get hub() { return hub; }, owner, manager, cashier, secondCashier, barista, call, mutate, configure, createOrder,
    async reopen() { await hub.close(); hub = await createHub({ databasePath }); },
  };
}

test('complete service loop configures stock, prepares dine-in, settles split tenders and closes a blind-count shift', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const opened = result(await f.mutate(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100000 }));
  noFinancialInternals(opened);
  let order = (await f.createOrder(true)).order;
  assert.equal(order.totalCentavos, 16500);
  assert.equal(order.released, false);
  order = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/send`, { expectedVersion: order.version })).order;
  assert.equal(order.released, true);
  const reserved = result(await f.call(f.cashier, 'GET', '/api/v1/ingredients'));
  noFinancialInternals(reserved);
  assert.equal(reserved.ingredients.find((row: any) => row.id === 'beans').onHandMilli, 1_000_000);
  assert.equal(reserved.ingredients.find((row: any) => row.id === 'beans').reservedMilli, 18000);
  const queue = result(await f.call(f.barista, 'GET', '/api/v1/orders'));
  assert.equal(queue.orders.length, 1);
  assert.equal(queue.orders[0].id, order.id);
  assert.equal(queue.orders[0].lines[0].note, 'Less sweet');
  assert.ok(!('totalCentavos' in queue.orders[0]));
  assert.ok(!('paidCentavos' in queue.orders[0]));
  assert.ok(!('unitPriceCentavos' in queue.orders[0].lines[0]));
  noFinancialInternals(queue);

  const readyCommand = randomUUID();
  const ready = result(await f.mutate(f.barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version }, readyCommand));
  assert.equal(ready.order.ready, true);
  assert.deepEqual(result(await f.mutate(f.barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version }, readyCommand)), ready);
  order = result(await f.call(f.cashier, 'GET', `/api/v1/orders/${order.id}`)).order;
  order = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'cash', amountCentavos: 10000, cashReceivedCentavos: 20000, verified: true,
  })).order;
  assert.equal(order.paidCentavos, 10000);
  assert.equal((await f.mutate(f.cashier, `/api/v1/orders/${order.id}/receipt`, { expectedVersion: order.version })).statusCode, 409);
  order = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'gcash', amountCentavos: 6500, verified: true, reference: 'Fixture-GCash-Complete-1',
  })).order;
  assert.equal(order.paidCentavos, 16500);
  const receiptCommand = randomUUID();
  const receipt = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/receipt`, { expectedVersion: order.version }, receiptCommand));
  assert.equal(receipt.job.orderId, order.id);
  assert.equal(receipt.job.type, 'receipt');
  assert.equal(receipt.job.status, 'unconfigured');
  assert.deepEqual(result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/receipt`, { expectedVersion: order.version }, receiptCommand)), receipt);
  const stock = result(await f.call(f.cashier, 'GET', '/api/v1/ingredients')).ingredients;
  assert.equal(stock.find((row: any) => row.id === 'beans').onHandMilli, 982000);
  assert.equal(stock.find((row: any) => row.id === 'beans').reservedMilli, 0);
  assert.equal(stock.find((row: any) => row.id === 'milk').onHandMilli, 1850000);

  const current = result(await f.call(f.cashier, 'GET', '/api/v1/shifts/current')).shift;
  const counted = result(await f.mutate(f.cashier, `/api/v1/shifts/${current.id}/submit-count`, {
    expectedVersion: current.version, countedCashCentavos: 110000, note: 'Fixture blind count',
  }));
  noFinancialInternals(counted);
  assert.equal(counted.shift.countedCashCentavos, 110000);
  const reviewed = result(await f.mutate(f.manager, `/api/v1/shifts/${current.id}/review`, { expectedVersion: counted.shift.version, decision: 'approve' }));
  assert.equal(reviewed.expectedCashCentavos, 110000, 'cash change and GCash must not inflate the drawer');
  assert.equal(reviewed.varianceCentavos, 0);
});

test('takeout stays hidden from the barista until full confirmed payment and preserves the pending external balance', async (t) => {
  const f = await fixture(t);
  await f.configure();
  result(await f.mutate(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 0 }));
  let order = (await f.createOrder(false)).order;
  assert.equal((await f.mutate(f.cashier, `/api/v1/orders/${order.id}/send`, { expectedVersion: order.version })).statusCode, 409);
  assert.equal((await f.call(f.barista, 'GET', `/api/v1/orders/${order.id}`)).statusCode, 404);
  const pending = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'gcash', amountCentavos: 6500, verified: false, reference: 'Fixture-Pending-GCash',
  }));
  assert.equal(pending.payment.status, 'pending');
  order = pending.order;
  assert.equal(order.paidCentavos, 0);
  assert.equal(order.released, false);
  order = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'cash', amountCentavos: 10000, cashReceivedCentavos: 10000, verified: true,
  })).order;
  assert.equal(order.paidCentavos, 10000);
  assert.equal(order.released, false);
  assert.deepEqual(result(await f.call(f.barista, 'GET', '/api/v1/orders')).orders, []);
  await f.reopen();
  order = result(await f.call(f.cashier, 'GET', `/api/v1/orders/${order.id}`)).order;
  assert.equal(order.paidCentavos, 10000);
  order = result(await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments/${pending.payment.id}/verify`, {
    expectedVersion: order.version,
  })).order;
  assert.equal(order.paidCentavos, 16500);
  assert.equal(order.released, true);
  assert.equal(result(await f.call(f.barista, 'GET', '/api/v1/orders')).orders[0].id, order.id);
});

test('stable command retries across restart and concurrent stale payments have only one accepted money effect', async (t) => {
  const f = await fixture(t);
  await f.configure();
  result(await f.mutate(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 0 }));
  const createCommand = randomUUID();
  const created = await f.createOrder(false, createCommand);
  const order = created.order;
  const commands = [randomUUID(), randomUUID()];
  const pay = (commandId: string) => f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'cash', amountCentavos: 10000, cashReceivedCentavos: 10000, verified: true,
  }, commandId);
  const results = await Promise.all(commands.map(pay));
  assert.deepEqual(results.map(response => response.statusCode).sort(), [200, 409]);
  const acceptedIndex = results.findIndex(response => response.statusCode === 200);
  const accepted = result(results[acceptedIndex]!);
  await f.reopen();
  assert.deepEqual(result(await pay(commands[acceptedIndex]!)), accepted);
  assert.deepEqual(await f.createOrder(false, createCommand), created);
  const current = result(await f.call(f.cashier, 'GET', `/api/v1/orders/${order.id}`)).order;
  assert.equal(current.paidCentavos, 10000);
  assert.equal(current.released, false);
  assert.equal((await f.mutate(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: current.version, method: 'cash', amountCentavos: 5000, cashReceivedCentavos: 5000, verified: true,
  }, commands[acceptedIndex]!)).statusCode, 409, 'changed-payload reuse must not apply a second amount');
});

test('cash is locked across registers sharing a counted drawer while noncash settlement and blind recount remain available', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const opened = result(await f.mutate(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100000 })).shift;
  assert.equal(result(await f.call(f.secondCashier, 'GET', '/api/v1/shifts/current')).shift.id, opened.id);
  const order = (await f.createOrder(false)).order;
  const counted = result(await f.mutate(f.cashier, `/api/v1/shifts/${opened.id}/submit-count`, {
    expectedVersion: opened.version, countedCashCentavos: 100000,
  })).shift;
  for (const token of [f.cashier, f.secondCashier]) {
    assert.equal((await f.mutate(token, `/api/v1/orders/${order.id}/payments`, {
      expectedVersion: order.version, method: 'cash', amountCentavos: 16500, cashReceivedCentavos: 16500, verified: true,
    })).statusCode, 409);
  }
  const noncash = result(await f.mutate(f.secondCashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'card', amountCentavos: 16500, verified: true, reference: 'Fixture-Terminal-After-Count',
  })).order;
  assert.equal(noncash.paidCentavos, 16500);
  const recount = result(await f.mutate(f.manager, `/api/v1/shifts/${opened.id}/review`, { expectedVersion: counted.version, decision: 'recount' })).shift;
  noFinancialInternals(result(await f.call(f.cashier, 'GET', '/api/v1/shifts/current')));
  const fresh = result(await f.mutate(f.cashier, `/api/v1/shifts/${opened.id}/submit-count`, {
    expectedVersion: recount.version, countedCashCentavos: 100000,
  }));
  noFinancialInternals(fresh);
  assert.ok(fresh.shift.version > recount.version);
});

test('service mutations reject cross-role access, claimed retail fields and cross-branch objects without leaking costs', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const order = (await f.createOrder(true)).order;
  assert.equal((await f.mutate(f.barista, '/api/v1/orders', { dineIn: true, items: [{ productId: 'spanish-latte', quantity: 1 }] })).statusCode, 403);
  assert.equal((await f.mutate(f.cashier, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version })).statusCode, 403);
  assert.equal((await f.mutate(f.cashier, '/api/v1/ingredients', { ingredientId: 'spoof', name: 'Spoof', unit: 'g' })).statusCode, 403);
  assert.equal((await f.mutate(f.cashier, '/api/v1/orders', { dineIn: true, items: [{ productId: 'spanish-latte', quantity: 1, unitPriceCentavos: 1 }] })).statusCode, 400);
  noFinancialInternals(result(await f.call(f.cashier, 'GET', '/api/v1/products')));
  noFinancialInternals(result(await f.call(f.cashier, 'GET', '/api/v1/ingredients')));

  await f.hub.provisionAccount({ id: 'owner-other', displayName: 'Other branch owner', role: 'owner', branchId: 'branch-b', secret: password });
  const other = result(await f.hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner-other', password } })).token as string;
  assert.equal((await f.call(other, 'GET', `/api/v1/orders/${order.id}`)).statusCode, 404);
  assert.deepEqual(result(await f.call(other, 'GET', '/api/v1/orders')).orders, []);
});

test('raw waste validates milliunits and retries once without changing order payment or consuming a sale', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const order = (await f.createOrder(true)).order;
  const commandId = randomUUID();
  const saved = result(await f.mutate(f.barista, '/api/v1/waste', { ingredientId: 'beans', quantityMilli: 18000, reason: 'Dial-in', note: 'Fixture raw beans' }, commandId));
  assert.equal(saved.waste.quantityMilli, 18000);
  await f.reopen();
  assert.deepEqual(result(await f.mutate(f.barista, '/api/v1/waste', { ingredientId: 'beans', quantityMilli: 18000, reason: 'Dial-in', note: 'Fixture raw beans' }, commandId)), saved);
  assert.equal((await f.mutate(f.barista, '/api/v1/waste', { ingredientId: 'beans', quantityMilli: -1, reason: 'Invalid' })).statusCode, 400);
  const stock = result(await f.call(f.barista, 'GET', '/api/v1/ingredients')).ingredients;
  assert.equal(stock.find((row: any) => row.id === 'beans').onHandMilli, 982000);
  assert.equal(stock.find((row: any) => row.id === 'beans').reservedMilli, 0);
  const current = result(await f.call(f.cashier, 'GET', `/api/v1/orders/${order.id}`)).order;
  assert.equal(current.paidCentavos, 0);
  assert.equal(current.released, false);
});
