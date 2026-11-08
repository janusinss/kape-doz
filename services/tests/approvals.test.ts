import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const priceCentavos = 16_500;
const discountCentavos = 1_500;
const businessDate = '2026-11-05';
const now = () => Date.UTC(2026, 10, 5, 8);
const password = 'Approval-Fixture-Admin-Password!';
const deviceSecret = 'Approval-Fixture-Device-Secret-2026!';
const pin = '5347';

type Order = {
  id: string;
  version: number;
  subtotalCentavos: number;
  discountCentavos: number;
  totalCentavos: number;
  paidCentavos: number;
  released: boolean;
  ready: boolean;
  lines: { productId: string; quantity: number; unitPriceCentavos: number }[];
};

type Approval = {
  id: string;
  orderId: string;
  orderNo: number;
  orderVersion: number;
  action: 'discount';
  amountCentavos: number;
  subtotalCentavos: number;
  requesterId: string;
  requesterName: string;
  reason: string;
  requestedAt: number;
  status: 'pending' | 'approved' | 'denied' | 'stale';
  decisionReason: string | null;
  decidedAt: number | null;
};

type ApprovalResult = { approval: Approval; commandId: string };
const queue = '/api/v1/approvals';
const requestPath = (order: Order) => `/api/v1/orders/${order.id}/approvals`;
const decisionPath = (approval: Approval) => `${queue}/${approval.id}/decision`;
const requestPayload = (order: Order, amount = discountCentavos) => ({
  expectedVersion: order.version, action: 'discount', amountCentavos: amount, reason: 'Fixture service recovery',
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
  const folder = await mkdtemp(join(tempRoot, 'kape-doz-approvals-'));
  const databasePath = join(folder, 'hub.sqlite');
  let hub = await createHub({ databasePath, now });
  t.after(async () => {
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(join(tempRoot, 'kape-doz-approvals-')));
    await rm(target, { recursive: true, force: true });
  });

  await hub.provisionAccount({ id: 'owner-a', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'manager-a', displayName: 'Fixture manager', role: 'manager', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'manager-b', displayName: 'Other branch fixture manager', role: 'manager', branchId: 'branch-b', secret: password });
  await hub.provisionAccount({ id: 'cashier-a', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: pin });
  await hub.provisionAccount({ id: 'cashier-a2', displayName: 'Other fixture cashier', role: 'cashier', branchId: 'branch-a', secret: pin });
  await hub.provisionAccount({ id: 'cashier-b', displayName: 'Other branch fixture cashier', role: 'cashier', branchId: 'branch-b', secret: pin });
  await hub.provisionAccount({ id: 'barista-a', displayName: 'Fixture barista', role: 'barista', branchId: 'branch-a', secret: pin });
  await hub.provisionDevice({ id: 'tablet-a', branchId: 'branch-a', secret: deviceSecret });
  await hub.provisionDevice({ id: 'tablet-b', branchId: 'branch-b', secret: deviceSecret });

  async function signIn(accountId: string, deviceId?: string) {
    const response = await hub.app.inject({
      method: 'POST',
      url: `/api/v1/auth/${deviceId ? 'staff' : 'admin'}`,
      payload: deviceId ? { accountId, pin, deviceId, deviceSecret } : { accountId, password },
    });
    return ok<{ token: string }>(response).token;
  }

  const owner = await signIn('owner-a');
  const manager = await signIn('manager-a');
  const otherManager = await signIn('manager-b');
  const cashier = await signIn('cashier-a', 'tablet-a');
  const secondCashier = await signIn('cashier-a2', 'tablet-a');
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
    ingredientId: 'beans', quantityMilli: 1_000_000, totalCostCentavos: 100_000, reference: 'Fixture-stock',
  }));
  ok(await post(owner, '/api/v1/products', {
    productId: 'latte', name: 'Fixture latte', priceCentavos,
    recipe: [{ ingredientId: 'beans', quantityMilli: 18_000 }],
  }));
  ok(await post(owner, '/api/v1/drawers', { drawerId: 'counter', name: 'Fixture counter', deviceIds: ['tablet-a'] }));
  ok(await post(cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000 }));

  async function order(dineIn = false) {
    return ok<{ order: Order }>(await post(cashier, '/api/v1/orders', {
      dineIn, ...(dineIn ? { table: '04' } : {}), items: [{ productId: 'latte', quantity: 1 }],
    })).order;
  }

  async function readOrder(id: string) {
    return ok<{ order: Order }>(await get(cashier, `/api/v1/orders/${id}`)).order;
  }

  async function list(token = cashier) {
    return ok<{ approvals: Approval[] }>(await get(token, queue)).approvals;
  }

  async function request(order: Order, amount = discountCentavos, commandId = randomUUID()) {
    return ok<ApprovalResult>(await post(cashier, requestPath(order), requestPayload(order, amount), commandId));
  }

  return {
    owner, manager, otherManager, cashier, secondCashier, otherCashier, barista, get, post, order, readOrder, list, request,
    async reopen() {
      await hub.close();
      hub = await createHub({ databasePath, now });
    },
  };
}

test('manager discount updates the checkout and recorded sale once across restart', async (t) => {
  const f = await fixture(t);
  const order = await f.order();
  const requestCommand = randomUUID();
  const request = await f.request(order, discountCentavos, requestCommand);
  const { approval } = request;
  assert.deepEqual(approval, {
    id: approval.id, orderId: order.id, orderNo: 1, orderVersion: order.version, action: 'discount',
    amountCentavos: discountCentavos, subtotalCentavos: priceCentavos, requesterId: 'cashier-a', requesterName: 'Fixture cashier',
    reason: 'Fixture service recovery', requestedAt: now(), status: 'pending', decisionReason: null, decidedAt: null,
  });
  assert.equal(request.commandId, requestCommand);
  assert.deepEqual(await f.readOrder(order.id), order, 'a request alone must leave checkout unchanged');

  await f.reopen();
  assert.deepEqual(await f.list(f.manager), [approval]);
  assert.deepEqual(await f.request(order, discountCentavos, requestCommand), request);
  status(await f.post(f.cashier, requestPath(order), requestPayload(order, 2_000), requestCommand), 409);
  const reviewCommand = randomUUID();
  const path = decisionPath(approval);
  const decision = { decision: 'approve' };
  const reviewed = ok<ApprovalResult>(await f.post(f.manager, path, decision, reviewCommand));
  assert.equal(reviewed.commandId, reviewCommand);
  assert.equal(reviewed.approval.status, 'approved');
  assert.equal(reviewed.approval.decidedAt, now());
  assert.deepEqual(await f.list(), [reviewed.approval]);

  const discounted = await f.readOrder(order.id);
  assert.equal(discounted.version, order.version + 1);
  assert.equal(discounted.subtotalCentavos, priceCentavos);
  assert.equal(discounted.discountCentavos, discountCentavos);
  assert.equal(discounted.totalCentavos, priceCentavos - discountCentavos);
  assert.equal(discounted.paidCentavos, 0);
  assert.equal(discounted.released, false, 'approval alone must never release takeout');
  assert.deepEqual(discounted.lines, order.lines, 'a discount preserves the original line-price and quantity snapshots');
  status(await f.post(f.owner, path, decision, reviewCommand), 409);
  status(await f.post(f.manager, path, decision), 409);
  status(await f.post(f.cashier, requestPath(discounted), requestPayload(discounted)), 409);

  const paymentPath = `/api/v1/orders/${order.id}/payments`;
  const payment = { expectedVersion: discounted.version, method: 'cash', amountCentavos: discounted.totalCentavos, cashReceivedCentavos: 20_000, verified: true };
  status(await f.post(f.cashier, paymentPath, { ...payment, expectedVersion: order.version }), 409);
  status(await f.post(f.cashier, paymentPath, { ...payment, amountCentavos: priceCentavos }), 409);
  const paid = ok<{ order: Order; payment: { changeCentavos: number } }>(await f.post(f.cashier, paymentPath, payment));
  assert.equal(paid.order.paidCentavos, discounted.totalCentavos);
  assert.equal(paid.payment.changeCentavos, 20_000 - discounted.totalCentavos);
  assert.equal(paid.order.released, true);
  const baristaOrder = ok<{ order: Record<string, unknown> }>(await f.get(f.barista, `/api/v1/orders/${order.id}`)).order;
  for (const field of ['totalCentavos', 'subtotalCentavos', 'discountCentavos', 'paidCentavos']) {
    assert.ok(!(field in baristaOrder), `barista projection exposed ${field}`);
  }
  const ready = ok<{ order: Order }>(await f.post(f.barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: paid.order.version }));
  assert.equal(ready.order.ready, true);
  const receipt = ok<{ job: { orderId: string; type: string } }>(await f.post(f.cashier, `/api/v1/orders/${order.id}/receipt`, { expectedVersion: ready.order.version }));
  assert.equal(receipt.job.orderId, order.id);
  assert.equal(receipt.job.type, 'receipt');

  await f.reopen();
  assert.deepEqual(ok<ApprovalResult>(await f.post(f.manager, path, decision, reviewCommand)), reviewed);
  assert.deepEqual(await f.request(order, discountCentavos, requestCommand), request);
  assert.deepEqual(await f.list(), [reviewed.approval]);
  const sales = ok<{
    grossSalesCentavos: number; discountCentavos: number; settledSalesCentavos: number;
    settledOrderCount: number; finalIngredientCostCentavos: number; estimatedGrossProfitCentavos: number;
  }>(await f.get(f.owner, `/api/v1/admin/sales?from=${businessDate}&through=${businessDate}`));
  assert.equal(sales.settledOrderCount, 1);
  assert.equal(sales.grossSalesCentavos, priceCentavos);
  assert.equal(sales.discountCentavos, discountCentavos);
  assert.equal(sales.settledSalesCentavos, discounted.totalCentavos);
  assert.equal(sales.finalIngredientCostCentavos, 1_800);
  assert.equal(sales.estimatedGrossProfitCentavos, discounted.totalCentavos - sales.finalIngredientCostCentavos);
});

test('approval reads and decisions enforce branch and role boundaries, and denial preserves checkout', async (t) => {
  const f = await fixture(t);
  const order = await f.order();
  const { approval } = await f.request(order);
  const path = decisionPath(approval);
  const deny = { decision: 'deny', reason: 'Fixture discount policy' };

  status(await f.get(undefined, queue), 401);
  status(await f.get(f.barista, queue), 403);
  assert.deepEqual(await f.list(f.secondCashier), []);
  assert.deepEqual(await f.list(f.otherManager), []);
  assert.deepEqual(await f.list(f.otherCashier), []);
  assert.deepEqual(await f.list(f.owner), [approval]);
  status(await f.post(f.otherCashier, requestPath(order), requestPayload(order)), 404);
  status(await f.post(f.barista, requestPath(order), requestPayload(order)), 403);
  status(await f.post(f.manager, requestPath(order), requestPayload(order)), 403);
  status(await f.post(f.cashier, path, { decision: 'approve' }), 403);
  status(await f.post(f.barista, path, deny), 403);
  status(await f.post(f.otherManager, path, deny), 404);
  status(await f.post(f.manager, path, { decision: 'deny' }), 400);
  status(await f.post(f.manager, path, { ...deny, amountCentavos: 100 }), 400);
  status(await f.post(f.cashier, requestPath(order), { ...requestPayload(order), requesterId: 'other-cashier' }), 400);
  assert.deepEqual(await f.list(f.manager), [approval]);

  const command = randomUUID();
  const denied = ok<ApprovalResult>(await f.post(f.manager, path, deny, command));
  assert.equal(denied.approval.status, 'denied');
  assert.equal(denied.approval.decisionReason, deny.reason);
  assert.equal(denied.approval.decidedAt, now());
  assert.deepEqual(await f.readOrder(order.id), order);
  assert.deepEqual(await f.list(), [denied.approval]);
  status(await f.post(f.manager, path, { decision: 'approve' }), 409);
  assert.deepEqual(ok<ApprovalResult>(await f.post(f.manager, path, deny, command)), denied);
});

test('an order version change stales the old request, and an unpaid ready order can still be discounted', async (t) => {
  const f = await fixture(t);
  const order = await f.order(true);
  const { approval } = await f.request(order);
  const sent = ok<{ order: Order }>(await f.post(f.cashier, `/api/v1/orders/${order.id}/send`, { expectedVersion: order.version })).order;
  status(await f.post(f.manager, decisionPath(approval), { decision: 'approve' }), 409);
  status(await f.post(f.cashier, requestPath(order), requestPayload(order)), 409);
  assert.deepEqual(await f.list(f.manager), [{ ...approval, status: 'stale' }]);
  assert.deepEqual(await f.readOrder(order.id), sent);

  const preparation = await f.post(f.barista, `/api/v1/orders/${order.id}/ready`, { expectedVersion: sent.version });
  status(preparation, 200);
  const ready = await f.readOrder(order.id);
  const current = await f.request(ready);
  const reviewed = ok<ApprovalResult>(await f.post(f.owner, decisionPath(current.approval), { decision: 'approve' }));
  assert.equal(reviewed.approval.status, 'approved');
  const discounted = await f.readOrder(order.id);
  assert.equal(discounted.released, true);
  assert.equal(discounted.ready, true);
  assert.equal(discounted.totalCentavos, priceCentavos - discountCentavos);
});

test('a replacement request supersedes the earlier amount and concurrent decisions apply once', async (t) => {
  const f = await fixture(t);
  const order = await f.order();
  const firstCommand = randomUUID();
  const first = await f.request(order, discountCentavos, firstCommand);
  const replacementAmount = 2_250;
  const replacement = await f.request(order, replacementAmount);
  assert.notEqual(first.approval.id, replacement.approval.id);
  assert.deepEqual(await f.request(order, discountCentavos, firstCommand), first);
  const list = await f.list();
  assert.equal(list.length, 2);
  assert.equal(list.find((item) => item.id === first.approval.id)?.status, 'stale');
  assert.equal(list.find((item) => item.id === replacement.approval.id)?.status, 'pending');
  status(await f.post(f.manager, decisionPath(first.approval), { decision: 'approve' }), 409);
  const outcomes = await Promise.all([f.manager, f.owner].map((token) => f.post(token, decisionPath(replacement.approval), { decision: 'approve' })));
  assert.deepEqual(outcomes.map((response) => response.statusCode).sort(), [200, 409]);
  const discounted = await f.readOrder(order.id);
  assert.equal(discounted.version, order.version + 1);
  assert.equal(discounted.discountCentavos, replacementAmount);
  assert.equal(discounted.totalCentavos, priceCentavos - replacementAmount);
});

test('discounts reject invalid amounts and cannot change confirmed or pending tenders', async (t) => {
  const f = await fixture(t);
  const order = await f.order();
  for (const amount of [0, -1, 1.5, '1500', null]) {
    status(await f.post(f.cashier, requestPath(order), { ...requestPayload(order), amountCentavos: amount }), 400);
  }
  status(await f.post(f.cashier, requestPath(order), requestPayload(order, priceCentavos)), 409);
  assert.deepEqual(await f.list(), []);

  const { approval } = await f.request(order);
  const paymentPath = `/api/v1/orders/${order.id}/payments`;
  const pending = ok<{ order: Order; payment: { id: string } }>(await f.post(f.cashier, paymentPath, {
    expectedVersion: order.version, method: 'gcash', amountCentavos: 5_000, verified: false, reference: 'Fixture pending approval',
  }));
  status(await f.post(f.manager, decisionPath(approval), { decision: 'approve' }), 409);
  status(await f.post(f.cashier, requestPath(pending.order), requestPayload(pending.order)), 409);
  const rejected = ok<{ order: Order }>(await f.post(f.cashier, `${paymentPath}/${pending.payment.id}/reject`, {
    expectedVersion: pending.order.version, reason: 'Fixture tender rejected',
  })).order;
  const current = await f.request(rejected);
  assert.equal(current.approval.status, 'pending', 'rejected-only tender history does not block a new request');

  const partial = ok<{ order: Order }>(await f.post(f.cashier, paymentPath, {
    expectedVersion: rejected.version, method: 'cash', amountCentavos: 1_000, cashReceivedCentavos: 1_000, verified: true,
  })).order;
  status(await f.post(f.manager, decisionPath(current.approval), { decision: 'approve' }), 409);
  status(await f.post(f.cashier, requestPath(partial), requestPayload(partial)), 409);
  assert.equal(partial.totalCentavos, priceCentavos);
  assert.equal(partial.paidCentavos, 1_000);
});
