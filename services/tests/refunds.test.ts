import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const priceCentavos = 16_500;
const openingCashCentavos = 100_000;
const initialStockMilli = 1_000_000;
const recipeQuantityMilli = 18_000;
const recipeCostCentavos = 1_800;
const originalBusinessDate = '2026-11-05';
const followingBusinessDate = '2026-11-06';
const firstTime = Date.UTC(2026, 10, 5, 15, 55);
const secondTime = Date.UTC(2026, 10, 5, 16);
const password = 'Refund-Fixture-Admin-Password!';
const deviceSecret = 'Refund-Fixture-Device-Secret-2026!';
const pin = '5921';

type Order = {
  id: string; version: number; totalCentavos: number; paidCentavos: number;
  released: boolean; ready: boolean; cancelled: boolean;
};
type Payment = {
  id: string; method: 'cash' | 'gcash' | 'card'; amountCentavos: number;
  status: 'pending' | 'confirmed' | 'rejected'; reference: string | null;
};
type Shift = {
  id: string; version: number; drawerId: string;
  status: 'open' | 'awaiting_review' | 'recount_required' | 'closed';
};
type Sales = {
  settledOrderCount: number; settledSalesCentavos: number;
  finalIngredientCostCentavos: number; estimatedIngredientCostCentavos: number;
  cancelledPaymentsAwaitingRefundCentavos: number;
  refundCentavos: number; returnedUnsettledCentavos: number; netSalesCentavos: number;
  refundsWithUnknownAttribution: number; estimatedGrossProfitCentavos: number | null;
};
type Refund = {
  id: string; orderId: string; orderNo: number; orderVersion: number;
  amountCentavos: number; reason: string; requesterId: string; requesterName: string; requestedAt: number;
  status: 'pending' | 'stale' | 'denied' | 'approved'; decidedAt: number | null; decisionReason: string | null;
  lines: { lineNo: number; name: string; quantity: number; unitPriceCentavos: number }[];
  tenders: { paymentId: string; method: Payment['method']; amountCentavos: number; reference: string | null; refundableCentavos: number }[];
  legs: RefundLeg[];
};
type RefundLeg = {
  id: string; paymentId: string; method: Payment['method']; amountCentavos: number; version: number;
  status: 'pending' | 'unknown' | 'failed' | 'completed' | 'voided'; reference: string | null; note: string | null; completedAt: number | null;
};
type RefundReply = { refund: Refund; commandId: string };
type Allocation = { paymentId: string; amountCentavos: number };
const requestPath = (order: Order) => `/api/v1/orders/${order.id}/refunds`;
const decisionPath = (refund: Refund) => `/api/v1/refunds/${refund.id}/decision`;
const legPath = (refund: Refund, leg: RefundLeg) => `/api/v1/refunds/${refund.id}/legs/${leg.id}`;
const requestBody = (order: Order, amountCentavos: number) => ({
  expectedVersion: order.version, amountCentavos, lineNumbers: [0], reason: 'Fixture partial refund',
});
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
  const folder = await mkdtemp(join(tempRoot, 'kape-doz-refunds-'));
  const databasePath = join(folder, 'hub.sqlite');
  let currentTime = firstTime;
  const now = () => currentTime;
  let hub = await createHub({ databasePath, now });
  const inspector = new DatabaseSync(databasePath);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(join(tempRoot, 'kape-doz-refunds-')));
    await rm(target, { recursive: true, force: true });
  });

  for (const [id, role, branchId] of [
    ['owner-a', 'owner', 'branch-a'], ['manager-a', 'manager', 'branch-a'],
    ['manager-b', 'manager', 'branch-b'], ['cashier-a', 'cashier', 'branch-a'],
    ['cashier-a2', 'cashier', 'branch-a'], ['cashier-b', 'cashier', 'branch-b'],
    ['barista-a', 'barista', 'branch-a'],
  ] as const) {
    await hub.provisionAccount({ id, displayName: id, role, branchId, secret: role === 'cashier' || role === 'barista' ? pin : password });
  }
  await hub.provisionDevice({ id: 'tablet-a', branchId: 'branch-a', secret: deviceSecret });
  await hub.provisionDevice({ id: 'tablet-a2', branchId: 'branch-a', secret: deviceSecret });
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
  const payingCashier = await signIn('cashier-a2', 'tablet-a2');
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
  ok(await post(owner, '/api/v1/products', {
    productId: 'latte', name: 'Fixture latte', priceCentavos,
    recipe: [{ ingredientId: 'beans', quantityMilli: recipeQuantityMilli }],
  }));
  ok(await post(owner, '/api/v1/drawers', { drawerId: 'sale-counter', name: 'Fixture original counter', deviceIds: ['tablet-a'] }));
  ok(await post(owner, '/api/v1/drawers', { drawerId: 'payout-counter', name: 'Fixture payout counter', deviceIds: ['tablet-a2'] }));

  async function openShift(token = cashier, openingCash = openingCashCentavos) {
    return ok<{ shift: Shift }>(await post(token, '/api/v1/shifts/open', { openingCashCentavos: openingCash })).shift;
  }
  async function currentShift(token = cashier) {
    return ok<{ shift: Shift | null }>(await get(token, '/api/v1/shifts/current')).shift;
  }
  async function countShift(token: string, shift: Shift, countedCashCentavos: number) {
    return ok<{ shift: Shift }>(await post(token, `/api/v1/shifts/${shift.id}/submit-count`, {
      expectedVersion: shift.version, countedCashCentavos, note: 'Fixture blind count',
    })).shift;
  }
  async function reviewShift(shift: Shift, decision: 'approve' | 'recount' = 'approve') {
    return ok<{ shift: Shift; expectedCashCentavos: number; varianceCentavos: number }>(await post(manager, `/api/v1/shifts/${shift.id}/review`, {
      expectedVersion: shift.version, decision,
    }));
  }
  async function order(dineIn = false) {
    return ok<{ order: Order }>(await post(cashier, '/api/v1/orders', {
      dineIn, ...(dineIn ? { table: '04' } : {}), items: [{ productId: 'latte', quantity: 1 }],
    })).order;
  }
  async function readOrder(id: string) {
    return ok<{ order: Order }>(await get(cashier, `/api/v1/orders/${id}`)).order;
  }
  async function pay(order: Order, method: Payment['method'], amountCentavos: number, verified = true) {
    return ok<{ order: Order; payment: Payment }>(await post(cashier, `/api/v1/orders/${order.id}/payments`, {
      expectedVersion: order.version, method, amountCentavos, verified,
      ...(method === 'cash' ? { cashReceivedCentavos: amountCentavos } : { reference: `Fixture ${method} ${randomUUID()}` }),
    }));
  }
  async function ready(order: Order) {
    ok(await post(barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: order.version }));
    return readOrder(order.id);
  }
  async function splitOrder() {
    const cash = await pay(await order(), 'cash', 10_000);
    const gcash = await pay(cash.order, 'gcash', 4_000);
    const card = await pay(gcash.order, 'card', 2_500);
    assert.equal(card.order.paidCentavos, priceCentavos);
    return { order: card.order, cash: cash.payment, gcash: gcash.payment, card: card.payment };
  }
  async function sales(from = originalBusinessDate, through = from) {
    return ok<Sales>(await get(owner, `/api/v1/admin/sales?from=${from}&through=${through}`));
  }
  async function request(order: Order, amountCentavos: number, commandId = randomUUID()) {
    return ok<RefundReply>(await post(cashier, requestPath(order), requestBody(order, amountCentavos), commandId));
  }
  async function approve(refund: Refund, allocations: Allocation[], commandId = randomUUID()) {
    return ok<RefundReply>(await post(manager, decisionPath(refund), { decision: 'approve', allocations }, commandId));
  }
  async function list(token = cashier) {
    return ok<{ refunds: Refund[] }>(await get(token, '/api/v1/refunds')).refunds;
  }

  return {
    owner, manager, otherManager, cashier, payingCashier, otherCashier, barista, get, post, inspector,
    openShift, currentShift, countShift, reviewShift, order, readOrder, pay, ready, splitOrder, sales, request, approve, list,
    advanceTo(timestamp: number) { currentTime = timestamp; },
    async reopen() { await hub.close(); hub = await createHub({ databasePath, now }); },
  };
}

test('manager authorizes a partial refund across original split tenders and every leg survives restart', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  const order = await f.ready(split.order);
  const requestCommand = randomUUID();
  const requested = await f.request(order, 6_500, requestCommand);
  assert.equal(requested.commandId, requestCommand);
  assert.equal(requested.refund.status, 'pending');
  assert.equal(requested.refund.orderVersion, order.version);
  assert.deepEqual(requested.refund.lines.map(({ lineNo, quantity, unitPriceCentavos }) => ({ lineNo, quantity, unitPriceCentavos })), [
    { lineNo: 0, quantity: 1, unitPriceCentavos: priceCentavos },
  ]);
  assert.deepEqual(requested.refund.legs, []);
  assert.deepEqual(requested.refund.tenders.map(({ paymentId, amountCentavos, refundableCentavos }) => ({ paymentId, amountCentavos, refundableCentavos }))
    .sort((a, b) => a.amountCentavos - b.amountCentavos), [split.card, split.gcash, split.cash]
      .map((tender) => ({ paymentId: tender.id, amountCentavos: tender.amountCentavos, refundableCentavos: tender.amountCentavos })));
  await f.reopen();
  assert.deepEqual(await f.request(order, 6_500, requestCommand), requested);
  assert.deepEqual(await f.list(f.manager), [requested.refund]);
  const allocations = [
    { paymentId: split.cash.id, amountCentavos: 4_000 },
    { paymentId: split.gcash.id, amountCentavos: 2_000 },
    { paymentId: split.card.id, amountCentavos: 500 },
  ];
  const approvalCommand = randomUUID();
  const approved = await f.approve(requested.refund, allocations, approvalCommand);
  assert.equal(approved.refund.status, 'approved');
  assert.equal(approved.refund.amountCentavos, 6_500);
  assert.equal(approved.refund.legs.length, 3);
  assert.ok(approved.refund.legs.every((leg) => leg.status === 'pending'));
  const cash = approved.refund.legs.find((leg) => leg.method === 'cash')!;
  const gcash = approved.refund.legs.find((leg) => leg.method === 'gcash')!;
  const card = approved.refund.legs.find((leg) => leg.method === 'card')!;
  const unknownInput = { expectedVersion: gcash.version, action: 'mark_unknown', note: 'Merchant response was inconclusive' };
  const unknownCommand = randomUUID();
  const unknown = ok<RefundReply>(await f.post(f.manager, legPath(approved.refund, gcash), unknownInput, unknownCommand));
  const unknownLeg = unknown.refund.legs.find((leg) => leg.id === gcash.id)!;
  assert.equal(unknownLeg.status, 'unknown');
  assert.equal(unknownLeg.version, gcash.version + 1);
  assert.equal(unknown.refund.legs.find((leg) => leg.id === card.id)?.status, 'pending');
  assert.equal(unknown.refund.legs.find((leg) => leg.id === cash.id)?.status, 'pending');
  await f.reopen();
  assert.deepEqual(ok(await f.post(f.manager, legPath(approved.refund, gcash), unknownInput, unknownCommand)), unknown);
  assert.deepEqual(await f.approve(requested.refund, allocations, approvalCommand), approved);
  status(await f.post(f.manager, legPath(approved.refund, gcash), { expectedVersion: gcash.version, action: 'mark_failed', note: 'Stale result' }), 409);
  assert.equal((await f.list()).find((refund) => refund.id === approved.refund.id)?.legs.find((leg) => leg.id === gcash.id)?.status, 'unknown');
});

test('unknown and failed external legs hold their original tender cap until completed or explicitly voided', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  const requested = await f.request(split.order, 5_000);
  const approved = await f.approve(requested.refund, [
    { paymentId: split.gcash.id, amountCentavos: 4_000 }, { paymentId: split.card.id, amountCentavos: 1_000 },
  ]);
  let gcash = approved.refund.legs.find((leg) => leg.method === 'gcash')!;
  const card = approved.refund.legs.find((leg) => leg.method === 'card')!;
  const update = async (leg: RefundLeg, action: string, note: string) => ok<RefundReply>(await f.post(f.manager, legPath(approved.refund, leg), {
    expectedVersion: leg.version, action, note,
  }));
  const unknown = await update(gcash, 'mark_unknown', 'Fixture merchant returned no definitive result');
  gcash = unknown.refund.legs.find((leg) => leg.id === gcash.id)!;
  status(await f.post(f.manager, legPath(approved.refund, gcash), { expectedVersion: gcash.version, action: 'retry', note: 'Cannot retry uncertainty' }), 409);
  status(await f.post(f.manager, legPath(approved.refund, gcash), { expectedVersion: gcash.version, action: 'void', note: 'Cannot release uncertainty' }), 409);
  const nextRequest = await f.request(await f.readOrder(split.order.id), 100);
  status(await f.post(f.manager, decisionPath(nextRequest.refund), { decision: 'approve', allocations: [{ paymentId: split.gcash.id, amountCentavos: 100 }] }), 409);
  const failed = await update(gcash, 'mark_failed', 'Fixture merchant confirms no money returned');
  gcash = failed.refund.legs.find((leg) => leg.id === gcash.id)!;
  assert.equal(gcash.status, 'failed');
  status(await f.post(f.manager, decisionPath(nextRequest.refund), { decision: 'approve', allocations: [{ paymentId: split.gcash.id, amountCentavos: 100 }] }), 409);
  const retry = await update(gcash, 'retry', 'Fixture retry after confirmed failure');
  gcash = retry.refund.legs.find((leg) => leg.id === gcash.id)!;
  assert.equal(gcash.status, 'pending');
  const failedAgain = await update(gcash, 'mark_failed', 'Fixture merchant confirms second attempt failed');
  gcash = failedAgain.refund.legs.find((leg) => leg.id === gcash.id)!;
  const released = await update(gcash, 'void', 'Manager ends the unexecuted refund allocation');
  assert.equal(released.refund.legs.find((leg) => leg.id === gcash.id)?.status, 'voided');
  assert.equal(released.refund.legs.find((leg) => leg.id === card.id)?.status, 'pending');
  const replacement = await f.request(await f.readOrder(split.order.id), 4_000);
  const newlyAllocated = await f.approve(replacement.refund, [{ paymentId: split.gcash.id, amountCentavos: 4_000 }]);
  assert.equal(newlyAllocated.refund.legs[0]?.status, 'pending');
  assert.equal((await f.sales()).refundCentavos, 0, 'authorization, uncertainty, failure, retry and void are not money returned');
});

test('cash refund belongs to the actual paying shift and respects count locks, available cash and atomic retry', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  const request = await f.request(split.order, 6_000);
  const approved = await f.approve(request.refund, [{ paymentId: split.cash.id, amountCentavos: 6_000 }]);
  const cash = approved.refund.legs[0]!;
  const record = { expectedVersion: cash.version, action: 'record_cash' };
  const original = (await f.currentShift())!;
  const originalCount = await f.countShift(f.cashier, original, openingCashCentavos + split.cash.amountCentavos);
  assert.equal((await f.reviewShift(originalCount)).varianceCentavos, 0);
  status(await f.post(f.cashier, legPath(approved.refund, cash), record), 409);
  status(await f.post(f.manager, legPath(approved.refund, cash), record), 403);

  const counted = await f.countShift(f.payingCashier, await f.openShift(f.payingCashier, 10_000), 10_000);
  status(await f.post(f.payingCashier, legPath(approved.refund, cash), record), 409);
  const recount = (await f.reviewShift(counted, 'recount')).shift;
  status(await f.post(f.payingCashier, legPath(approved.refund, cash), record), 409);
  const submittedAgain = await f.countShift(f.payingCashier, recount, 10_000);
  await f.reviewShift(submittedAgain);
  const insufficient = await f.openShift(f.payingCashier, 2_000);
  status(await f.post(f.payingCashier, legPath(approved.refund, cash), record), 409);
  await f.reviewShift(await f.countShift(f.payingCashier, insufficient, 2_000));
  const payingShift = await f.openShift(f.payingCashier, 10_000);
  const command = randomUUID();
  f.inspector.exec("CREATE TRIGGER fail_refund_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected refund outbox failure'); END;");
  try {
    const failed = await f.post(f.payingCashier, legPath(approved.refund, cash), record, command);
    status(failed, 500);
    assert.ok(!/sqlite|injected|trigger|stack/i.test(failed.body));
    assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM refund_cash_movements').get()!.count, 0);
    assert.equal((await f.list()).find((refund) => refund.id === approved.refund.id)?.legs[0]?.status, 'pending');
    assert.equal((await f.currentShift(f.payingCashier))!.version, payingShift.version);
  } finally { f.inspector.exec('DROP TRIGGER fail_refund_outbox'); }
  await f.reopen();
  const paid = ok<RefundReply>(await f.post(f.payingCashier, legPath(approved.refund, cash), record, command));
  assert.equal(paid.refund.legs[0]?.status, 'completed');
  assert.deepEqual(ok(await f.post(f.payingCashier, legPath(approved.refund, cash), record, command)), paid);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM refund_cash_movements').get()!.count, 1);
  assert.equal(f.inspector.prepare('SELECT shift_id FROM refund_cash_movements').get()!.shift_id, payingShift.id);
  const payoutCount = await f.countShift(f.payingCashier, (await f.currentShift(f.payingCashier))!, 4_000);
  const reviewed = await f.reviewShift(payoutCount);
  assert.equal(reviewed.expectedCashCentavos, 4_000);
  assert.equal(reviewed.varianceCentavos, 0);
  const originalRecord = f.inspector.prepare('SELECT expected_cash_centavos FROM shift_reviews WHERE shift_id=? AND decision=\'approve\'').get(original.id)!;
  assert.equal(originalRecord.expected_cash_centavos, openingCashCentavos + split.cash.amountCentavos);
});

test('completed refunds use payout business dates and preserve original settled sales, consumption and costs', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  const order = await f.ready(split.order);
  const requested = await f.request(order, 5_000);
  const approved = await f.approve(requested.refund, [
    { paymentId: split.cash.id, amountCentavos: 3_000 }, { paymentId: split.gcash.id, amountCentavos: 2_000 },
  ]);
  const before = await f.sales();
  assert.equal(before.settledSalesCentavos, priceCentavos);
  assert.equal(before.refundCentavos, 0);
  assert.equal(before.netSalesCentavos, priceCentavos);
  f.advanceTo(secondTime);
  const cash = approved.refund.legs.find((leg) => leg.method === 'cash')!;
  const gcash = approved.refund.legs.find((leg) => leg.method === 'gcash')!;
  ok(await f.post(f.cashier, legPath(approved.refund, cash), { expectedVersion: cash.version, action: 'record_cash' }));
  assert.equal((await f.sales(followingBusinessDate)).refundCentavos, 3_000);
  const completion = { expectedVersion: gcash.version, action: 'confirm_external', note: 'Fixture merchant confirmed refund', reference: 'Fixture GCash refund proof' };
  const command = randomUUID();
  const completed = ok<RefundReply>(await f.post(f.manager, legPath(approved.refund, gcash), completion, command));
  assert.equal(completed.refund.legs.find((leg) => leg.id === gcash.id)?.completedAt, secondTime);
  await f.reopen();
  assert.deepEqual(ok(await f.post(f.manager, legPath(approved.refund, gcash), completion, command)), completed);
  const oldDay = await f.sales();
  assert.equal(oldDay.refundCentavos, 0);
  assert.equal(oldDay.netSalesCentavos, priceCentavos);
  assert.equal(oldDay.finalIngredientCostCentavos, recipeCostCentavos);
  const payoutDay = await f.sales(followingBusinessDate);
  assert.equal(payoutDay.settledOrderCount, 0);
  assert.equal(payoutDay.settledSalesCentavos, 0);
  assert.equal(payoutDay.refundCentavos, 5_000);
  assert.equal(payoutDay.netSalesCentavos, -5_000);
  const combined = await f.sales(originalBusinessDate, followingBusinessDate);
  assert.equal(combined.settledSalesCentavos, priceCentavos);
  assert.equal(combined.refundCentavos, 5_000);
  assert.equal(combined.netSalesCentavos, priceCentavos - 5_000);
  assert.equal(combined.finalIngredientCostCentavos, recipeCostCentavos);
  assert.equal(f.inspector.prepare('SELECT SUM(quantity_milli) AS quantity FROM stock_movements WHERE ingredient_id=\'beans\'').get()!.quantity, initialStockMilli - recipeQuantityMilli);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE order_id=?').get(order.id)!.count, 1);
});

test('refund authorization binds current order, selected lines, actor and branch with preserved supersession and denial', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  const firstCommand = randomUUID();
  const first = await f.request(split.order, 1_000, firstCommand);
  const replaced = await f.request(split.order, 1_500);
  assert.deepEqual(await f.request(split.order, 1_000, firstCommand), first);
  status(await f.post(f.manager, decisionPath(first.refund), { decision: 'approve', allocations: [{ paymentId: split.cash.id, amountCentavos: 1_000 }] }), 409);
  const ready = await f.ready(split.order);
  status(await f.post(f.manager, decisionPath(replaced.refund), { decision: 'approve', allocations: [{ paymentId: split.cash.id, amountCentavos: 1_500 }] }), 409);
  const requested = await f.request(ready, 2_000);
  status(await f.get(undefined, '/api/v1/refunds'), 401);
  status(await f.get(f.barista, '/api/v1/refunds'), 403);
  assert.deepEqual(await f.list(f.otherManager), []);
  assert.deepEqual(await f.list(f.payingCashier), []);
  status(await f.post(f.otherCashier, requestPath(ready), requestBody(ready, 1_000)), 404);
  status(await f.post(f.manager, requestPath(ready), requestBody(ready, 1_000)), 403);
  status(await f.post(f.barista, requestPath(ready), requestBody(ready, 1_000)), 403);
  status(await f.post(f.cashier, decisionPath(requested.refund), { decision: 'approve', allocations: [{ paymentId: split.cash.id, amountCentavos: 2_000 }] }), 403);
  status(await f.post(f.otherManager, decisionPath(requested.refund), { decision: 'deny', reason: 'Foreign branch' }), 404);
  status(await f.post(f.manager, decisionPath(requested.refund), { decision: 'deny' }), 400);
  status(await f.post(f.manager, decisionPath(requested.refund), { decision: 'deny', reason: 'Policy', allocations: [] }), 400);
  status(await f.post(f.cashier, requestPath(ready), { ...requestBody(ready, 1_000), requesterId: 'owner-a' }), 400);
  status(await f.post(f.cashier, requestPath(ready), { ...requestBody(ready, 1_000), lineNumbers: [0, 0] }), 400);
  const before = await f.readOrder(ready.id);
  const denied = ok<RefundReply>(await f.post(f.manager, decisionPath(requested.refund), { decision: 'deny', reason: 'Fixture manager denied refund' }));
  assert.equal(denied.refund.status, 'denied');
  assert.equal(denied.refund.legs.length, 0);
  assert.deepEqual(await f.readOrder(ready.id), before);
  status(await f.post(f.manager, decisionPath(requested.refund), { decision: 'approve', allocations: [{ paymentId: split.cash.id, amountCentavos: 2_000 }] }), 409);
  assert.equal((await f.list()).find((refund) => refund.id === first.refund.id)?.status, 'stale');
});

test('manager allocations reserve original tender limits atomically and pending cash void explicitly releases its allocation', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  const requested = await f.request(split.order, 10_000);
  status(await f.post(f.manager, decisionPath(requested.refund), { decision: 'approve', allocations: [{ paymentId: split.gcash.id, amountCentavos: 10_000 }] }), 409);
  const allocations = [{ paymentId: split.cash.id, amountCentavos: 10_000 }];
  const outcomes = await Promise.all([f.manager, f.owner].map((token) => f.post(token, decisionPath(requested.refund), { decision: 'approve', allocations })));
  assert.deepEqual(outcomes.map((reply) => reply.statusCode).sort(), [200, 409]);
  const approved = ok<RefundReply>(outcomes.find((reply) => reply.statusCode === 200)!);
  const cash = approved.refund.legs[0]!;
  const another = await f.request(await f.readOrder(split.order.id), 500);
  status(await f.post(f.manager, decisionPath(another.refund), { decision: 'approve', allocations: [{ paymentId: split.cash.id, amountCentavos: 500 }] }), 409);
  const voided = ok<RefundReply>(await f.post(f.manager, legPath(approved.refund, cash), { expectedVersion: cash.version, action: 'void', note: 'Fixture cash never paid out' }));
  assert.equal(voided.refund.legs[0]?.status, 'voided');
  const newRequest = await f.request(await f.readOrder(split.order.id), 10_000);
  const replacement = await f.approve(newRequest.refund, allocations);
  assert.equal(replacement.refund.legs[0]?.amountCentavos, 10_000);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM refund_cash_movements').get()!.count, 0);
});

test('confirmed money on a cancelled unsettled order is returned without becoming a settled-sale refund', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const cash = await f.pay(await f.order(), 'cash', 5_000);
  const pending = await f.pay(cash.order, 'gcash', 2_000, false);
  status(await f.post(f.cashier, requestPath(pending.order), requestBody(pending.order, 5_000)), 409);
  const cancellation = ok<{ approval: { id: string } }>(await f.post(f.cashier, `/api/v1/orders/${pending.order.id}/approvals`, {
    expectedVersion: pending.order.version, action: 'cancel', reason: 'Fixture cancellation before takeout settlement',
  }));
  ok(await f.post(f.manager, `/api/v1/approvals/${cancellation.approval.id}/decision`, { decision: 'approve' }));
  const cancelled = await f.readOrder(pending.order.id);
  const requested = await f.request(cancelled, 5_000);
  assert.deepEqual(requested.refund.tenders.map((payment) => payment.paymentId), [cash.payment.id]);
  const approved = await f.approve(requested.refund, [{ paymentId: cash.payment.id, amountCentavos: 5_000 }]);
  const leg = approved.refund.legs[0]!;
  ok(await f.post(f.cashier, legPath(approved.refund, leg), { expectedVersion: leg.version, action: 'record_cash' }));
  const report = await f.sales();
  assert.equal(report.settledOrderCount, 0);
  assert.equal(report.refundCentavos, 0);
  assert.equal(report.returnedUnsettledCentavos, 5_000);
  assert.equal(report.netSalesCentavos, 0);
  assert.equal(report.cancelledPaymentsAwaitingRefundCentavos, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM order_settlements').get()!.count, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE order_id=?').get(pending.order.id)!.count, 0);
});

test('external refund confirmation requires merchant evidence and a unique reference without repeating completed value', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  const first = await f.approve((await f.request(split.order, 2_000)).refund, [{ paymentId: split.gcash.id, amountCentavos: 2_000 }]);
  const leg = first.refund.legs[0]!;
  const path = legPath(first.refund, leg);
  status(await f.post(f.cashier, path, { expectedVersion: leg.version, action: 'confirm_external', note: 'Cashier cannot attest', reference: 'Fixture unique refund evidence' }), 403);
  status(await f.post(f.manager, path, { expectedVersion: leg.version, action: 'confirm_external', note: 'Missing reference' }), 400);
  const input = { expectedVersion: leg.version, action: 'confirm_external', note: 'Verified merchant refund', reference: 'Fixture unique refund evidence' };
  const command = randomUUID();
  const completed = ok<RefundReply>(await f.post(f.manager, path, input, command));
  const completedLeg = completed.refund.legs[0]!;
  assert.equal(completedLeg.status, 'completed');
  status(await f.post(f.manager, path, { ...input, expectedVersion: completedLeg.version }), 409);
  const second = await f.approve((await f.request(await f.readOrder(split.order.id), 1_000)).refund, [{ paymentId: split.gcash.id, amountCentavos: 1_000 }]);
  const secondLeg = second.refund.legs[0]!;
  status(await f.post(f.manager, legPath(second.refund, secondLeg), { ...input, expectedVersion: secondLeg.version }), 409);
  ok(await f.post(f.manager, legPath(second.refund, secondLeg), { ...input, expectedVersion: secondLeg.version, reference: 'Fixture second unique refund evidence' }));
  assert.deepEqual(ok(await f.post(f.manager, path, input, command)), completed);
  assert.equal((await f.sales()).refundCentavos, 3_000);
});

test('returning an extra tender confirmed after cancellation does not reduce the earlier settled sale', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const cash = await f.pay(await f.order(), 'cash', 10_000);
  const pending = await f.pay(cash.order, 'gcash', 6_500, false);
  const paid = await f.pay(pending.order, 'card', 6_500);
  const cancellation = ok<{ approval: { id: string } }>(await f.post(f.cashier, `/api/v1/orders/${paid.order.id}/approvals`, {
    expectedVersion: paid.order.version, action: 'cancel', reason: 'Fixture cancellation with an outstanding merchant attempt',
  }));
  ok(await f.post(f.manager, `/api/v1/approvals/${cancellation.approval.id}/decision`, { decision: 'approve' }));
  const cancelled = await f.readOrder(paid.order.id);
  const verified = ok<{ order: Order }>(await f.post(f.cashier, `/api/v1/orders/${paid.order.id}/payments/${pending.payment.id}/verify`, {
    expectedVersion: cancelled.version,
  })).order;
  const request = await f.request(verified, 6_500);
  const approved = await f.approve(request.refund, [{ paymentId: pending.payment.id, amountCentavos: 6_500 }]);
  const leg = approved.refund.legs[0]!;
  ok(await f.post(f.manager, legPath(approved.refund, leg), {
    expectedVersion: leg.version, action: 'confirm_external', note: 'Fixture excess collection returned', reference: 'Fixture excess tender return',
  }));
  const report = await f.sales();
  assert.equal(report.settledOrderCount, 1);
  assert.equal(report.settledSalesCentavos, priceCentavos);
  assert.equal(report.returnedUnsettledCentavos, 6_500);
  assert.equal(report.refundCentavos, 0);
  assert.equal(report.netSalesCentavos, priceCentavos);
  assert.equal(report.cancelledPaymentsAwaitingRefundCentavos, priceCentavos);
});

test('missing legacy refund attribution metadata is preserved as unknown instead of preventing a verified return', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  f.inspector.prepare('DELETE FROM settlement_payment_links WHERE payment_id=?').run(split.gcash.id);
  f.inspector.prepare('UPDATE command_receipts SET response_json=? WHERE id=(SELECT command_id FROM payments WHERE id=?)')
    .run('{invalid legacy receipt metadata', split.gcash.id);
  const requested = await f.request(split.order, 1_000);
  const approved = await f.approve(requested.refund, [{ paymentId: split.gcash.id, amountCentavos: 1_000 }]);
  const leg = approved.refund.legs[0]!;
  ok(await f.post(f.manager, legPath(approved.refund, leg), {
    expectedVersion: leg.version, action: 'confirm_external', note: 'Fixture merchant return confirmed with legacy attribution unresolved', reference: 'Fixture legacy return',
  }));
  const report = await f.sales();
  assert.equal(report.refundsWithUnknownAttribution, 1);
  assert.equal(report.estimatedGrossProfitCentavos, null);
  assert.equal(f.inspector.prepare('SELECT response_json FROM command_receipts WHERE id=(SELECT command_id FROM payments WHERE id=?)').get(split.gcash.id)!.response_json, '{invalid legacy receipt metadata');
  assert.equal((await f.list()).find((refund) => refund.id === approved.refund.id)?.legs[0]?.status, 'completed');
});

test('concurrent distinct cashier refund requests cannot reserve the same tender twice', async (t) => {
  const f = await fixture(t);
  await f.openShift();
  const split = await f.splitOrder();
  const beforeOrder = await f.readOrder(split.order.id);
  const beforePayments = f.inspector.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id').all(split.order.id);
  const requests = await Promise.all([f.cashier, f.payingCashier].map((token) => f.post(token, requestPath(split.order), requestBody(split.order, 10_000))));
  assert.deepEqual(requests.map((reply) => reply.statusCode), [200, 200]);
  const [first, second] = requests.map((reply) => ok<RefundReply>(reply).refund);
  assert.notEqual(first!.id, second!.id);
  const states = (await f.list(f.manager)).filter((refund) => refund.id === first!.id || refund.id === second!.id);
  assert.deepEqual(states.map((refund) => refund.status).sort(), ['pending', 'stale']);
  const approvals = await Promise.all([first!, second!].map((refund) => f.post(f.manager, decisionPath(refund), {
    decision: 'approve', allocations: [{ paymentId: split.cash.id, amountCentavos: 10_000 }],
  })));
  assert.deepEqual(approvals.map((reply) => reply.statusCode).sort(), [200, 409]);
  const accepted = ok<RefundReply>(approvals.find((reply) => reply.statusCode === 200)!).refund;
  assert.equal(accepted.legs.length, 1);
  assert.equal(accepted.legs[0]!.amountCentavos, split.cash.amountCentavos);
  assert.equal(accepted.tenders.find((tender) => tender.paymentId === split.cash.id)!.refundableCentavos, 0);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id').all(split.order.id), beforePayments);
  assert.equal(f.inspector.prepare('SELECT SUM(amount_centavos) AS amount FROM refund_legs WHERE payment_id=? AND status<>\'voided\'').get(split.cash.id)!.amount, split.cash.amountCentavos);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM refund_cash_movements').get()!.count, 0);
  const afterOrder = await f.readOrder(split.order.id);
  assert.equal(afterOrder.version, beforeOrder.version + 1);
  assert.equal(afterOrder.paidCentavos, beforeOrder.paidCentavos);
  assert.equal(afterOrder.totalCentavos, beforeOrder.totalCentavos);
});
