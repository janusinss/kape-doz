import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const priceCentavos = 16_500;
const initialStockMilli = 1_000_000;
const recipeQuantityMilli = 18_000;
const recipeCostCentavos = 3_150;
const businessDate = '2026-11-05';
const initialTime = Date.UTC(2026, 10, 5, 8);
const sessionLifetimeMs = 86_400_000;
const password = 'Cancellation-Fixture-Admin-Password!';
const deviceSecret = 'Cancellation-Fixture-Device-Secret-2026!';
const pin = '5347';

type Order = {
  id: string;
  version: number;
  totalCentavos: number;
  paidCentavos: number;
  released: boolean;
  ready: boolean;
  kitchenState: string;
  paymentState: string;
  cancelled: boolean;
  preparing: boolean;
  preparingAt: number | null;
  cancellation: null | {
    approvalId: string; reason: string; status: 'awaiting_disposition' | 'resolved';
    cancelledAt: number; resolvedAt: number | null; outcome: null | 'unprepared' | 'used' | 'already_consumed';
    dispositionNote: string; actualUsed: { ingredientId: string; quantityMilli: number }[];
    recipe: { ingredientId: string; quantityMilli: number }[];
    confirmedPaymentCentavos?: number; pendingPaymentCentavos?: number;
  };
};

type Approval = {
  id: string; orderId: string; orderVersion: number; action: 'cancel'; amountCentavos: number;
  requestedKitchenState: string; requestedPaymentState: string; collectedCentavos: number;
  pendingCentavos: number; cancellationStatus: null | 'awaiting_disposition' | 'resolved';
  status: 'pending' | 'approved' | 'denied' | 'stale';
};

type Sales = {
  settledOrderCount: number; settledSalesCentavos: number; finalIngredientCostCentavos: number;
  estimatedIngredientCostCentavos: number; ordersWithUnknownIngredientCost: number;
  wasteCostCentavos: number; cancellationCostCentavos: number; cancellationsWithUnresolvedCost: number;
  cancelledOrdersAwaitingDisposition: number; cancelledPaymentsAwaitingRefundCentavos: number;
  cancelledPendingPaymentCentavos: number; estimatedGrossProfitCentavos: number | null;
  estimatedOperatingProfitCentavos: number | null;
};

const requestPath = (order: Order) => `/api/v1/orders/${order.id}/approvals`;
const decisionPath = (approval: Approval) => `/api/v1/approvals/${approval.id}/decision`;
const dispositionPath = (order: Order) => `/api/v1/orders/${order.id}/cancellation/disposition`;
const cancellationRequest = (order: Order) => ({ expectedVersion: order.version, action: 'cancel', reason: 'Fixture customer cancellation' });

type Response = { statusCode: number; body: string; json(): unknown };

function ok<T>(response: Response): T {
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as T;
}

function status(response: Response, code: number) {
  assert.equal(response.statusCode, code, response.body);
}

async function fixture(t: TestContext) {
  const tempRoot = resolve(tmpdir());
  const folder = await mkdtemp(join(tempRoot, 'kape-doz-cancellations-'));
  const databasePath = join(folder, 'hub.sqlite');
  let currentTime = initialTime;
  const now = () => currentTime;
  let hub = await createHub({ databasePath, now, sessionLifetimeMs });
  const inspector = new DatabaseSync(databasePath);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(join(tempRoot, 'kape-doz-cancellations-')));
    await rm(target, { recursive: true, force: true });
  });
  for (const [id, role, branchId] of [
    ['owner-a', 'owner', 'branch-a'], ['manager-a', 'manager', 'branch-a'],
    ['manager-b', 'manager', 'branch-b'], ['cashier-a', 'cashier', 'branch-a'],
    ['cashier-b', 'cashier', 'branch-b'], ['barista-a', 'barista', 'branch-a'],
  ] as const) {
    await hub.provisionAccount({ id, displayName: id, role, branchId, secret: role === 'cashier' || role === 'barista' ? pin : password });
  }
  await hub.provisionDevice({ id: 'tablet-a', branchId: 'branch-a', secret: deviceSecret });
  await hub.provisionDevice({ id: 'tablet-b', branchId: 'branch-b', secret: deviceSecret });
  async function signIn(accountId: string, deviceId?: string) {
    return ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: `/api/v1/auth/${deviceId ? 'staff' : 'admin'}`,
      payload: deviceId ? { accountId, pin, deviceId, deviceSecret } : { accountId, password },
    })).token;
  }
  const owner = await signIn('owner-a');
  const manager = await signIn('manager-a');
  const otherManager = await signIn('manager-b');
  const cashier = await signIn('cashier-a', 'tablet-a');
  const otherCashier = await signIn('cashier-b', 'tablet-b');
  const barista = await signIn('barista-a', 'tablet-a');
  const get = (token: string | undefined, url: string) => hub.app.inject({
    method: 'GET', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
  const post = (token: string, url: string, payload: Record<string, unknown>, commandId = randomUUID()) => hub.app.inject({
    method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { commandId, ...payload },
  });
  ok(await post(owner, '/api/v1/ingredients', { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
  ok(await post(owner, '/api/v1/inventory/receipts', {
    ingredientId: 'beans', quantityMilli: initialStockMilli, totalCostCentavos: 100_000, reference: 'Fixture-stock',
  }));
  ok(await post(owner, '/api/v1/ingredients', { ingredientId: 'milk', name: 'Fixture milk', unit: 'ml' }));
  ok(await post(owner, '/api/v1/inventory/receipts', {
    ingredientId: 'milk', quantityMilli: 2_000_000, totalCostCentavos: 18_000, reference: 'Fixture-milk',
  }));
  ok(await post(owner, '/api/v1/products', {
    productId: 'latte', name: 'Fixture latte', priceCentavos,
    recipe: [{ ingredientId: 'beans', quantityMilli: recipeQuantityMilli }, { ingredientId: 'milk', quantityMilli: 150_000 }],
  }));
  ok(await post(owner, '/api/v1/drawers', { drawerId: 'counter', name: 'Fixture counter', deviceIds: ['tablet-a'] }));
  ok(await post(cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000 }));
  async function order(dineIn = true) {
    return ok<{ order: Order }>(await post(cashier, '/api/v1/orders', {
      dineIn, ...(dineIn ? { table: '04' } : {}), items: [{ productId: 'latte', quantity: 1 }],
    })).order;
  }
  async function readOrder(id: string) {
    return ok<{ order: Order }>(await get(cashier, `/api/v1/orders/${id}`)).order;
  }
  async function stock() {
    return ok<{ ingredients: { id: string; onHandMilli: number; reservedMilli: number }[] }>(
      await get(cashier, '/api/v1/ingredients'),
    ).ingredients.find((ingredient) => ingredient.id === 'beans')!;
  }
  async function send(order: Order) {
    return ok<{ order: Order }>(await post(cashier, `/api/v1/orders/${order.id}/send`, { expectedVersion: order.version })).order;
  }
  async function ready(order: Order) {
    ok(await post(barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version }));
    return readOrder(order.id);
  }
  async function prepare(order: Order, commandId = randomUUID()) {
    ok(await post(barista, `/api/v1/orders/${order.id}/prepare`, { expectedVersion: order.version }, commandId));
    return readOrder(order.id);
  }
  async function request(order: Order, commandId = randomUUID()) {
    return ok<{ approval: Approval; commandId: string }>(await post(cashier, requestPath(order), cancellationRequest(order), commandId));
  }
  async function cancel(order: Order, commandId = randomUUID()) {
    const requested = await request(order);
    const decision = ok<{ approval: Approval; commandId: string }>(await post(manager, decisionPath(requested.approval), { decision: 'approve' }, commandId));
    return { requested, decision, order: await readOrder(order.id) };
  }
  async function dispose(order: Order, outcome: string, used: { ingredientId: string; quantityMilli: number }[] = [], commandId = randomUUID()) {
    ok(await post(barista, dispositionPath(order), { expectedVersion: order.version, outcome, used, note: 'Fixture actual preparation disposition' }, commandId));
    return readOrder(order.id);
  }
  async function sales(from = businessDate, through = from) {
    return ok<Sales>(await get(owner, `/api/v1/admin/sales?from=${from}&through=${through}`));
  }
  async function queue(status = 'active') {
    return ok<{ orders: Order[] }>(await get(barista, `/api/v1/orders?status=${status}`)).orders;
  }
  return {
    owner, manager, otherManager, cashier, otherCashier, barista, get, post, order, readOrder, stock, send, ready, prepare,
    request, cancel, dispose, sales, queue, inspector,
    advanceTo(timestamp: number) { currentTime = timestamp; },
    async reopen() { await hub.close(); hub = await createHub({ databasePath, now, sessionLifetimeMs }); },
  };
}

test('unsent cancellation resolves without preparation, payment, stock or sale effects and survives restart', async (t) => {
  const f = await fixture(t);
  const order = await f.order(false);
  const requestCommand = randomUUID();
  const requested = await f.request(order, requestCommand);
  assert.equal(requested.approval.action, 'cancel');
  assert.equal(requested.approval.amountCentavos, priceCentavos);
  assert.equal(requested.approval.requestedKitchenState, order.kitchenState);
  assert.equal(requested.approval.requestedPaymentState, 'unpaid');
  assert.equal(requested.approval.collectedCentavos, 0);
  assert.equal(requested.approval.pendingCentavos, 0);
  assert.deepEqual(await f.readOrder(order.id), order);
  const decisionCommand = randomUUID();
  const decision = ok<{ approval: Approval }>(await f.post(f.manager, decisionPath(requested.approval), { decision: 'approve' }, decisionCommand));
  const cancelled = await f.readOrder(order.id);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.version, order.version + 1);
  assert.equal(cancelled.cancellation?.status, 'resolved');
  assert.equal(cancelled.cancellation?.outcome, 'unprepared');
  assert.equal(cancelled.cancellation?.approvalId, requested.approval.id);
  assert.equal(decision.approval.cancellationStatus, 'resolved');
  assert.equal((await f.stock()).onHandMilli, initialStockMilli);
  assert.equal((await f.stock()).reservedMilli, 0);
  assert.deepEqual(await f.queue(), []);
  for (const suffix of ['send', 'prepare', 'ready']) {
    status(await f.post(suffix === 'send' ? f.cashier : f.barista, `/api/v1/orders/${order.id}/${suffix}`, { expectedVersion: cancelled.version }), suffix === 'send' ? 409 : 404);
  }
  status(await f.post(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: cancelled.version, method: 'cash', amountCentavos: priceCentavos, cashReceivedCentavos: priceCentavos, verified: true,
  }), 409);
  assert.equal((await f.sales()).settledOrderCount, 0);
  assert.equal((await f.sales()).cancellationCostCentavos, 0);
  await f.reopen();
  assert.deepEqual(await f.readOrder(order.id), cancelled);
  assert.deepEqual(ok(await f.post(f.manager, decisionPath(requested.approval), { decision: 'approve' }, decisionCommand)), decision);
  assert.deepEqual(await f.request(order, requestCommand), requested);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE order_id=?').get(order.id)!.count, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments WHERE order_id=?').get(order.id)!.count, 0);
});

test('sent cancellation notifies the station, blocks stale ready and keeps reservations until actual unprepared disposition', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order());
  const cancelled = (await f.cancel(sent)).order;
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.cancellation?.status, 'awaiting_disposition');
  assert.equal((await f.stock()).reservedMilli, recipeQuantityMilli);
  assert.equal((await f.sales()).cancelledOrdersAwaitingDisposition, 1);
  assert.equal((await f.sales()).estimatedOperatingProfitCentavos, null);
  const station = (await f.queue()).find((item) => item.id === sent.id)!;
  assert.equal(station.cancelled, true);
  assert.equal(station.cancellation?.status, 'awaiting_disposition');
  assert.ok(!('confirmedPaymentCentavos' in station.cancellation!));
  assert.ok(!('pendingPaymentCentavos' in station.cancellation!));
  status(await f.post(f.barista, `/api/v1/orders/${sent.id}/ready`, { expectedVersion: sent.version }), 409);
  status(await f.post(f.barista, `/api/v1/orders/${sent.id}/ready`, { expectedVersion: cancelled.version }), 409);
  status(await f.post(f.barista, dispositionPath(cancelled), { expectedVersion: cancelled.version, outcome: 'already_consumed', used: [], note: 'Incorrect for an unready ticket' }), 409);
  const resolved = await f.dispose(cancelled, 'unprepared');
  assert.equal(resolved.version, cancelled.version + 1);
  assert.equal(resolved.cancellation?.status, 'resolved');
  assert.equal(resolved.cancellation?.outcome, 'unprepared');
  assert.equal((await f.stock()).reservedMilli, 0);
  assert.equal((await f.stock()).onHandMilli, initialStockMilli);
  assert.deepEqual(await f.queue(), []);
  assert.equal((await f.queue('ready')).find((item) => item.id === sent.id)?.cancelled, true);
  assert.equal((await f.sales()).cancelledOrdersAwaitingDisposition, 0);
  assert.equal((await f.sales()).wasteCostCentavos, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE kind<>\'receipt\'').get()!.count, 0);
});

test('started cancellation posts actual multi-ingredient waste once, releases reservations and preserves historical cost', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order());
  const prepareCommand = randomUUID();
  const preparing = await f.prepare(sent, prepareCommand);
  assert.equal(preparing.preparing, true);
  assert.equal(preparing.preparingAt, initialTime);
  assert.equal(preparing.version, sent.version + 1);
  assert.deepEqual(await f.prepare(sent, prepareCommand), preparing);
  const cancelled = (await f.cancel(preparing)).order;
  const used = [{ ingredientId: 'beans', quantityMilli: 20_000 }, { ingredientId: 'milk', quantityMilli: 100_000 }];
  const command = randomUUID();
  const resolved = await f.dispose(cancelled, 'used', used, command);
  assert.equal(resolved.cancellation?.outcome, 'used');
  assert.deepEqual(resolved.cancellation?.actualUsed.map(({ ingredientId, quantityMilli }) => ({ ingredientId, quantityMilli })), used);
  assert.equal((await f.stock()).onHandMilli, initialStockMilli - 20_000);
  assert.equal((await f.stock()).reservedMilli, 0);
  const counts = f.inspector.prepare('SELECT COUNT(*) AS count FROM waste_entries WHERE command_id=?').get(command)!;
  assert.equal(counts.count, 2, 'one disposition command may post more than one actual ingredient');
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE kind=\'consumption\' AND order_id=?').get(sent.id)!.count, 0);
  assert.equal((await f.sales()).wasteCostCentavos, 2_900);
  assert.equal((await f.sales()).cancellationCostCentavos, 0, 'actual waste is not also charged as cancellation cost');
  await f.reopen();
  assert.deepEqual(await f.dispose(cancelled, 'used', used, command), resolved);
  status(await f.post(f.barista, dispositionPath(resolved), { expectedVersion: resolved.version, outcome: 'used', used, note: 'A repeated new command' }), 409);
  ok(await f.post(f.owner, '/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli: 100_000, totalCostCentavos: 80_000, reference: 'Later cost change' }));
  assert.equal((await f.sales()).wasteCostCentavos, 2_900);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM waste_entries WHERE command_id=?').get(command)!.count, 2);
});

test('ready unpaid cancellation classifies existing consumption once without another stock removal', async (t) => {
  const f = await fixture(t);
  const ready = await f.ready(await f.send(await f.order()));
  const beforeStock = await f.stock();
  const cancelled = (await f.cancel(ready)).order;
  assert.equal(cancelled.cancellation?.status, 'awaiting_disposition');
  assert.equal((await f.sales()).cancellationCostCentavos, recipeCostCentavos);
  status(await f.post(f.barista, dispositionPath(cancelled), { expectedVersion: cancelled.version, outcome: 'used', used: [{ ingredientId: 'beans', quantityMilli: recipeQuantityMilli }], note: 'Would double consume' }), 409);
  const command = randomUUID();
  const resolved = await f.dispose(cancelled, 'already_consumed', [], command);
  assert.deepEqual(await f.stock(), beforeStock);
  assert.equal(resolved.cancellation?.outcome, 'already_consumed');
  assert.equal((await f.sales()).wasteCostCentavos, 0);
  assert.equal((await f.sales()).cancellationCostCentavos, recipeCostCentavos);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE kind=\'consumption\' AND order_id=?').get(ready.id)!.count, 2);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM waste_entries WHERE command_id=?').get(command)!.count, 0);
  await f.reopen();
  assert.deepEqual(await f.dispose(cancelled, 'already_consumed', [], command), resolved);
  assert.equal((await f.sales()).cancellationCostCentavos, recipeCostCentavos);
});

test('cancelled external verification is retained for refund attention and never settles or re-releases the order', async (t) => {
  const f = await fixture(t);
  const order = await f.order(false);
  const payment = ok<{ order: Order; payment: { id: string } }>(await f.post(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'gcash', amountCentavos: priceCentavos, verified: false, reference: 'Fixture pending cancelled tender',
  }));
  const secondPending = ok<{ order: Order; payment: { id: string } }>(await f.post(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: payment.order.version, method: 'card', amountCentavos: 1_500, verified: false, reference: 'Fixture second cancelled tender',
  }));
  const cancelled = (await f.cancel(secondPending.order)).order;
  assert.equal(cancelled.cancellation?.pendingPaymentCentavos, priceCentavos + 1_500);
  assert.equal((await f.sales()).cancelledPendingPaymentCentavos, priceCentavos + 1_500);
  const verification = { expectedVersion: cancelled.version };
  const command = randomUUID();
  const path = `/api/v1/orders/${order.id}/payments/${payment.payment.id}/verify`;
  const verified = ok<{ order: Order }>(await f.post(f.cashier, path, verification, command));
  assert.equal(verified.order.cancelled, true);
  assert.equal(verified.order.released, false);
  assert.equal(verified.order.paidCentavos, priceCentavos);
  assert.equal((await f.sales()).cancelledPendingPaymentCentavos, 1_500);
  assert.equal((await f.sales()).cancelledPaymentsAwaitingRefundCentavos, priceCentavos);
  assert.equal((await f.sales()).settledOrderCount, 0);
  assert.equal((await f.sales()).estimatedOperatingProfitCentavos, null);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM order_settlements WHERE order_id=?').get(order.id)!.count, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM print_jobs WHERE order_id=?').get(order.id)!.count, 0);
  assert.deepEqual(ok(await f.post(f.cashier, path, verification, command)), verified);
  ok(await f.post(f.cashier, `/api/v1/orders/${order.id}/payments/${secondPending.payment.id}/reject`, {
    expectedVersion: verified.order.version, reason: 'Fixture merchant rejected second attempt',
  }));
  assert.equal((await f.sales()).cancelledPendingPaymentCentavos, 0);
  assert.equal((await f.sales()).cancelledPaymentsAwaitingRefundCentavos, priceCentavos);
  assert.equal((await f.sales()).settledOrderCount, 0);
});

test('cancellation approval and disposition enforce roles, branch, version and reason without erasing denied history', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order());
  const requested = await f.request(sent);
  status(await f.post(f.cashier, requestPath(sent), { ...cancellationRequest(sent), amountCentavos: 1 }), 400);
  status(await f.post(f.otherCashier, requestPath(sent), cancellationRequest(sent)), 404);
  status(await f.post(f.manager, requestPath(sent), cancellationRequest(sent)), 403);
  status(await f.post(f.cashier, decisionPath(requested.approval), { decision: 'approve' }), 403);
  status(await f.post(f.otherManager, decisionPath(requested.approval), { decision: 'approve' }), 404);
  status(await f.post(f.manager, decisionPath(requested.approval), { decision: 'deny' }), 400);
  const preparing = await f.prepare(sent);
  status(await f.post(f.manager, decisionPath(requested.approval), { decision: 'approve' }), 409);
  const denied = await f.request(preparing);
  const before = await f.readOrder(sent.id);
  ok(await f.post(f.owner, decisionPath(denied.approval), { decision: 'deny', reason: 'Fixture denial with reason' }));
  assert.deepEqual(await f.readOrder(sent.id), before);
  const cancelled = (await f.cancel(preparing)).order;
  const input = { expectedVersion: cancelled.version, outcome: 'unprepared', used: [], note: 'Fixture actual state' };
  status(await f.post(f.cashier, dispositionPath(cancelled), input), 403);
  status(await f.post(f.manager, dispositionPath(cancelled), input), 403);
  status(await f.post(f.barista, dispositionPath(cancelled), { ...input, note: '' }), 400);
  status(await f.post(f.barista, dispositionPath(cancelled), { ...input, expectedVersion: sent.version }), 409);
  status(await f.post(f.barista, dispositionPath(cancelled), { ...input, outcome: 'used', used: [{ ingredientId: 'beans', quantityMilli: 1 }, { ingredientId: 'beans', quantityMilli: 2 }] }), 400);
  status(await f.post(f.barista, dispositionPath(cancelled), { ...input, outcome: 'used', used: [{ ingredientId: 'unrelated', quantityMilli: 1 }] }), 400);
  assert.deepEqual(await f.readOrder(sent.id), cancelled);
});

test('paid ready cancellation retains the original sale and COGS until refund without charging consumption again', async (t) => {
  const f = await fixture(t);
  const order = await f.order(false);
  const paid = ok<{ order: Order }>(await f.post(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'cash', amountCentavos: priceCentavos, cashReceivedCentavos: 20_000, verified: true,
  })).order;
  const ready = await f.ready(paid);
  const before = await f.stock();
  const cancelled = (await f.cancel(ready)).order;
  const resolved = await f.dispose(cancelled, 'already_consumed');
  const report = await f.sales();
  assert.equal(resolved.cancellation?.confirmedPaymentCentavos, priceCentavos);
  assert.equal(report.settledOrderCount, 1);
  assert.equal(report.settledSalesCentavos, priceCentavos);
  assert.equal(report.finalIngredientCostCentavos, recipeCostCentavos);
  assert.equal(report.cancellationCostCentavos, 0, 'settled cancellation still has its original COGS');
  assert.equal(report.wasteCostCentavos, 0);
  assert.equal(report.cancelledPaymentsAwaitingRefundCentavos, priceCentavos);
  assert.equal(report.estimatedOperatingProfitCentavos, null);
  assert.deepEqual(await f.stock(), before);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM order_settlements WHERE order_id=?').get(order.id)!.count, 1);
  assert.equal(f.inspector.prepare('SELECT SUM(amount_centavos) AS amount FROM cash_movements').get()!.amount, priceCentavos);
});

test('future cancellation leaves the previous Manila business day release estimate and recorded sale intact', async (t) => {
  const f = await fixture(t);
  const order = await f.order(false);
  const paid = ok<{ order: Order }>(await f.post(f.cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'cash', amountCentavos: priceCentavos, cashReceivedCentavos: priceCentavos, verified: true,
  })).order;
  const before = await f.sales();
  assert.equal(before.settledOrderCount, 1);
  assert.equal(before.settledSalesCentavos, priceCentavos);
  assert.equal(before.estimatedIngredientCostCentavos, recipeCostCentavos);
  assert.equal(before.ordersWithUnknownIngredientCost, 0);
  assert.equal(before.estimatedGrossProfitCentavos, priceCentavos - recipeCostCentavos);
  f.advanceTo(Date.UTC(2026, 10, 5, 16));
  const cancelled = (await f.cancel(paid)).order;
  await f.dispose(cancelled, 'used', [{ ingredientId: 'beans', quantityMilli: 9_000 }]);
  const earlier = await f.sales();
  assert.deepEqual(earlier, before, 'cancellation after the report end must not change the previous day totals or attention');
  const later = await f.sales('2026-11-06');
  assert.equal(later.settledOrderCount, 0);
  assert.equal(later.estimatedIngredientCostCentavos, 0);
  assert.equal(later.wasteCostCentavos, 900);
  assert.equal(later.cancelledPaymentsAwaitingRefundCentavos, priceCentavos);
  const combined = await f.sales(businessDate, '2026-11-06');
  assert.equal(combined.settledSalesCentavos, priceCentavos);
  assert.equal(combined.estimatedIngredientCostCentavos, 0);
  assert.equal(combined.ordersWithUnknownIngredientCost, 0);
  assert.equal(combined.wasteCostCentavos, 900);
  assert.equal(combined.cancelledPaymentsAwaitingRefundCentavos, priceCentavos);
  assert.equal(combined.estimatedGrossProfitCentavos, null);
});

test('cancellation retains the safe sum of several pending external allocations above a single tender ceiling', async (t) => {
  const f = await fixture(t);
  let order = await f.order(false);
  const allocation = 100_000_000_000;
  for (const reference of ['Fixture large pending A', 'Fixture large pending B']) {
    order = ok<{ order: Order }>(await f.post(f.cashier, `/api/v1/orders/${order.id}/payments`, {
      expectedVersion: order.version, method: 'gcash', amountCentavos: allocation, verified: false, reference,
    })).order;
  }
  const requested = await f.request(order);
  assert.equal(requested.approval.pendingCentavos, allocation * 2);
  ok(await f.post(f.manager, decisionPath(requested.approval), { decision: 'approve' }));
  const cancelled = await f.readOrder(order.id);
  assert.equal(cancelled.cancellation?.pendingPaymentCentavos, allocation * 2);
  assert.equal((await f.sales()).cancelledPendingPaymentCentavos, allocation * 2);
});

test('an unpaid ready cancellation with unknown ingredient valuation keeps operating profit unavailable', async (t) => {
  const f = await fixture(t);
  ok(await f.post(f.owner, '/api/v1/products', {
    productId: 'short-stock', name: 'Fixture shortage', priceCentavos,
    recipe: [{ ingredientId: 'beans', quantityMilli: initialStockMilli + 1_000 }],
  }));
  const order = ok<{ order: Order }>(await f.post(f.cashier, '/api/v1/orders', {
    dineIn: true, table: '04', items: [{ productId: 'short-stock', quantity: 1 }],
  })).order;
  const ready = await f.ready(await f.send(order));
  assert.equal((await f.stock()).onHandMilli, -1_000);
  const cancelled = (await f.cancel(ready)).order;
  await f.dispose(cancelled, 'already_consumed');
  const report = await f.sales();
  assert.equal(report.settledOrderCount, 0);
  assert.equal(report.cancellationsWithUnresolvedCost, 1);
  assert.equal(report.estimatedOperatingProfitCentavos, null);
  assert.equal((await f.stock()).onHandMilli, -1_000);
});

test('failed disposition audit rolls back stock, carrying values, reservations and cancellation state before exact retry', async (t) => {
  const f = await fixture(t);
  const cancelled = (await f.cancel(await f.send(await f.order()))).order;
  const beforeStock = await f.stock();
  const beforeValues = f.inspector.prepare('SELECT * FROM ingredient_valuation_balances ORDER BY ingredient_id').all();
  const command = randomUUID();
  const input = { expectedVersion: cancelled.version, outcome: 'used', used: [{ ingredientId: 'beans', quantityMilli: 9_000 }], note: 'Fixture disposition retry' };
  f.inspector.exec("CREATE TRIGGER fail_cancellation_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected cancellation outbox failure'); END;");
  try {
    const failed = await f.post(f.barista, dispositionPath(cancelled), input, command);
    status(failed, 500);
    assert.ok(!/sqlite|trigger|injected|stack/i.test(failed.body));
    assert.deepEqual(await f.readOrder(cancelled.id), cancelled);
    assert.deepEqual(await f.stock(), beforeStock);
    assert.deepEqual(f.inspector.prepare('SELECT * FROM ingredient_valuation_balances ORDER BY ingredient_id').all(), beforeValues);
    assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM waste_entries WHERE command_id=?').get(command)!.count, 0);
    assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM command_receipts WHERE id=?').get(command)!.count, 0);
    assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE command_id=?').get(command)!.count, 0);
  } finally { f.inspector.exec('DROP TRIGGER fail_cancellation_outbox'); }
  await f.reopen();
  ok(await f.post(f.barista, dispositionPath(cancelled), input, command));
  assert.equal((await f.readOrder(cancelled.id)).cancellation?.status, 'resolved');
  assert.equal((await f.stock()).onHandMilli, initialStockMilli - 9_000);
  assert.equal((await f.stock()).reservedMilli, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM waste_entries WHERE command_id=?').get(command)!.count, 1);
});
