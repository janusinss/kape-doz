import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const latteCentavos = 16_500;
const espressoCentavos = 9_000;
const initialStock = 1_000_000;
const latteBeans = 18_000;
const latteMilk = 150_000;
const espressoBeans = 9_000;
const password = 'Amendment-Fixture-Admin-Password!';
const deviceSecret = 'Amendment-Fixture-Device-Secret-2026!';
const pin = '5391';
const now = () => Date.UTC(2026, 10, 6, 8);

type Response = { statusCode: number; body: string; json(): unknown };
type Line = { lineNo: number; productId: string; name: string; quantity: number; note: string; unitPriceCentavos?: number };
type Order = {
  id: string; version: number; releasedAt: number | null; ready: boolean; preparing: boolean; cancelled: boolean;
  paymentState: string; totalCentavos: number; paidCentavos: number; lines: Line[];
  amendment: Amendment | null;
};
type Amendment = {
  id: string; orderId: string; orderVersion: number;
  operation: 'add' | 'quantity' | 'remove' | 'replace' | 'note';
  status: 'awaiting_approval' | 'denied' | 'stale' | 'awaiting_station' | 'resolved';
  before: Line | null; after: Line | null; reason: string; decisionReason: string | null;
  requestedAt: number; appliedAt: number | null; resolvedAt: number | null;
  needsDisposition: boolean; recipe: { ingredientId: string; name: string; unit: string; quantityMilli: number }[];
  dispositionNote: string | null; totalBeforeCentavos?: number; totalAfterCentavos?: number;
};
type AmendmentReply = { commandId: string; amendment: Amendment };
type Item = { productId: string; quantity: number; note?: string };
type Stock = { id: string; onHandMilli: number; reservedMilli: number };

const orderPath = (order: Order) => `/api/v1/orders/${order.id}`;
const amendPath = (order: Order) => `${orderPath(order)}/amendments`;
const decisionPath = (amendment: Amendment) => `/api/v1/amendments/${amendment.id}/decision`;
const acknowledgePath = (order: Order, amendment: Amendment) => `${amendPath(order)}/${amendment.id}/acknowledge`;
const checkStatus = (response: Response, expected: number) => assert.equal(response.statusCode, expected, response.body);
function ok<T>(response: Response): T {
  checkStatus(response, 200);
  return response.json() as T;
}

async function fixture(t: TestContext) {
  const tempRoot = resolve(tmpdir());
  const folder = await mkdtemp(join(tempRoot, 'kape-doz-amendments-'));
  const databasePath = join(folder, 'hub.sqlite');
  let hub = await createHub({ databasePath, now });
  const inspector = new DatabaseSync(databasePath, { readOnly: true });
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(join(tempRoot, 'kape-doz-amendments-')));
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

  for (const [ingredientId, unit] of [['beans', 'g'], ['milk', 'ml']] as const) {
    ok(await post(owner, '/api/v1/ingredients', { ingredientId, name: `Fixture ${ingredientId}`, unit }));
    ok(await post(owner, '/api/v1/inventory/receipts', {
      ingredientId, quantityMilli: initialStock, totalCostCentavos: 100_000, reference: `fixture-${ingredientId}`,
    }));
  }
  ok(await post(owner, '/api/v1/products', {
    productId: 'latte', name: 'Fixture latte', priceCentavos: latteCentavos,
    recipe: [{ ingredientId: 'beans', quantityMilli: latteBeans }, { ingredientId: 'milk', quantityMilli: latteMilk }],
  }));
  ok(await post(owner, '/api/v1/products', {
    productId: 'espresso', name: 'Fixture espresso', priceCentavos: espressoCentavos,
    recipe: [{ ingredientId: 'beans', quantityMilli: espressoBeans }],
  }));

  const readOrder = async (order: Order, token = cashier) => ok<{ order: Order }>(await get(token, orderPath(order))).order;
  const order = async (items: Item[] = [{ productId: 'latte', quantity: 1 }], dineIn = true) =>
    ok<{ order: Order }>(await post(cashier, '/api/v1/orders', { dineIn, ...(dineIn ? { table: '04' } : {}), items })).order;
  const send = async (order: Order) => ok<{ order: Order }>(await post(cashier, `${orderPath(order)}/send`, { expectedVersion: order.version })).order;
  async function kitchenAction(order: Order, action: 'prepare' | 'ready') {
    ok(await post(barista, `${orderPath(order)}/${action}`, { expectedVersion: order.version }));
    return readOrder(order);
  }
  async function stock() {
    const { ingredients } = ok<{ ingredients: Stock[] }>(await get(cashier, '/api/v1/ingredients'));
    return Object.fromEntries(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  }
  async function queue() {
    return ok<{ orders: Order[] }>(await get(barista, '/api/v1/orders?status=active')).orders;
  }
  async function pay(order: Order, amountCentavos: number, verified = true) {
    return ok<{ order: Order }>(await post(cashier, `${orderPath(order)}/payments`, {
      expectedVersion: order.version, method: 'gcash', amountCentavos, verified, reference: randomUUID(),
    })).order;
  }
  async function amend(order: Order, change: Record<string, unknown>, commandId = randomUUID()) {
    return ok<AmendmentReply>(await post(cashier, amendPath(order), {
      expectedVersion: order.version, reason: 'Customer corrected their order', ...change,
    }, commandId));
  }
  async function decide(amendment: Amendment, decision: 'approve' | 'deny', commandId = randomUUID()) {
    return ok<AmendmentReply>(await post(manager, decisionPath(amendment), { decision, reason: 'Reviewed the customer correction' }, commandId));
  }
  async function acknowledge(order: Order, amendment: Amendment, used: { ingredientId: string; quantityMilli: number }[] = [], commandId = randomUUID()) {
    return ok<AmendmentReply>(await post(barista, acknowledgePath(order, amendment), {
      expectedVersion: order.version, note: used.length ? 'Measured discarded preparation' : '', used,
    }, commandId));
  }
  function labels(order: Order) {
    return inspector.prepare("SELECT id,command_id FROM print_jobs WHERE order_id=? AND type='label'").all(order.id);
  }
  function settlements(order: Order) {
    return inspector.prepare('SELECT * FROM order_settlements WHERE order_id=?').all(order.id);
  }
  function tenders(order: Order) {
    return inspector.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id').all(order.id);
  }
  return {
    owner, manager, otherManager, cashier, otherCashier, barista, get, post, order, readOrder, send, kitchenAction,
    stock, queue, pay, amend, decide, acknowledge, labels, settlements, tenders, inspector,
    async reopen() { await hub.close(); hub = await createHub({ databasePath, now }); },
  };
}

test('a sent addition reaches the station once, preserves the original release and blocks Ready until acknowledged', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order());
  const labels = f.labels(sent);
  assert.equal(labels.length, 1);
  const commandId = randomUUID();
  const change = { operation: 'add', productId: 'espresso', quantity: 2, note: 'Serve separately' };
  const result = await f.amend(sent, change, commandId);
  assert.equal(result.amendment.status, 'awaiting_station');
  assert.equal(result.amendment.before, null);
  assert.equal(result.amendment.after?.lineNo, 1);
  assert.equal(result.amendment.after?.quantity, 2);
  const changed = await f.readOrder(sent);
  assert.equal(changed.totalCentavos, latteCentavos + espressoCentavos * 2);
  assert.equal(changed.releasedAt, sent.releasedAt);
  assert.equal(changed.version, sent.version + 1);
  assert.equal((await f.stock()).beans?.reservedMilli, latteBeans + espressoBeans * 2);
  assert.equal((await f.stock()).beans?.onHandMilli, initialStock);
  const station = (await f.queue()).find((item) => item.id === sent.id)!;
  assert.equal(station.amendment?.id, result.amendment.id);
  assert.equal(station.amendment?.after?.note, 'Serve separately');
  assert.ok(!Object.hasOwn(station.amendment!, 'totalAfterCentavos'));
  assert.ok(!Object.hasOwn(station.amendment!.after!, 'unitPriceCentavos'));
  for (const version of [sent.version, changed.version]) {
    checkStatus(await f.post(f.barista, `${orderPath(sent)}/ready`, { expectedVersion: version }), 409);
  }
  await f.reopen();
  assert.deepEqual(await f.amend(sent, change, commandId), result);
  const ackCommandId = randomUUID();
  const ack = await f.acknowledge(changed, result.amendment, [], ackCommandId);
  assert.equal(ack.amendment.status, 'resolved');
  assert.deepEqual(await f.acknowledge(changed, result.amendment, [], ackCommandId), ack);
  const ready = await f.kitchenAction(await f.readOrder(sent), 'ready');
  assert.equal(ready.ready, true);
  assert.equal((await f.stock()).beans?.onHandMilli, initialStock - latteBeans - espressoBeans * 2);
  assert.equal((await f.stock()).beans?.reservedMilli, 0);
  assert.deepEqual(f.labels(sent), labels);
  assert.equal(f.settlements(sent).length, 0);
});

test('a preparing quantity reduction waits for manager approval and records measured discarded ingredients once', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order([{ productId: 'latte', quantity: 2 }, { productId: 'espresso', quantity: 1 }]));
  const preparing = await f.kitchenAction(sent, 'prepare');
  const before = await f.stock();
  const requested = (await f.amend(preparing, { operation: 'quantity', lineNo: 0, quantity: 1 })).amendment;
  assert.equal(requested.status, 'awaiting_approval');
  assert.equal(requested.before?.quantity, 2);
  assert.equal(requested.after?.quantity, 1);
  assert.equal(requested.totalBeforeCentavos, latteCentavos * 2 + espressoCentavos);
  assert.equal(requested.totalAfterCentavos, latteCentavos + espressoCentavos);
  const awaiting = await f.readOrder(sent);
  assert.equal(awaiting.version, preparing.version);
  assert.deepEqual(awaiting.lines, preparing.lines);
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.queue()).find((order) => order.id === sent.id)?.amendment, null);

  const decisionCommand = randomUUID();
  const approved = await f.decide(requested, 'approve', decisionCommand);
  assert.equal(approved.amendment.status, 'awaiting_station');
  assert.equal(approved.amendment.appliedAt, null);
  assert.equal(approved.amendment.needsDisposition, true);
  assert.deepEqual(Object.fromEntries(approved.amendment.recipe.map((entry) => [entry.ingredientId, entry.quantityMilli])), {
    beans: latteBeans, milk: latteMilk,
  });
  const staged = await f.readOrder(sent);
  assert.deepEqual(staged.lines, preparing.lines);
  assert.equal(staged.totalCentavos, preparing.totalCentavos);
  assert.deepEqual(await f.stock(), before);
  const station = (await f.queue()).find((order) => order.id === sent.id)!;
  assert.equal(station.amendment?.id, approved.amendment.id);
  assert.equal(station.amendment?.needsDisposition, true);
  checkStatus(await f.post(f.barista, `${orderPath(sent)}/ready`, { expectedVersion: staged.version }), 409);
  checkStatus(await f.post(f.barista, acknowledgePath(sent, approved.amendment), {
    expectedVersion: staged.version, note: 'Measured an unrelated ingredient', used: [{ ingredientId: 'unknown-ingredient', quantityMilli: 1_000 }],
  }), 400);
  assert.deepEqual(await f.stock(), before);
  await f.reopen();
  assert.deepEqual(await f.decide(requested, 'approve', decisionCommand), approved);

  const used = [{ ingredientId: 'beans', quantityMilli: 8_000 }, { ingredientId: 'milk', quantityMilli: 27_000 }];
  const ackId = randomUUID();
  const ack = await f.acknowledge(staged, approved.amendment, used, ackId);
  assert.equal(ack.amendment.status, 'resolved');
  assert.equal(ack.amendment.dispositionNote, 'Measured discarded preparation');
  assert.deepEqual(await f.acknowledge(staged, approved.amendment, used, ackId), ack);
  const changed = await f.readOrder(sent);
  assert.equal(changed.lines.find((line) => line.lineNo === 0)?.quantity, 1);
  assert.equal(changed.totalCentavos, latteCentavos + espressoCentavos);
  const actual = await f.stock();
  assert.equal(actual.beans?.onHandMilli, initialStock - 8_000);
  assert.equal(actual.milk?.onHandMilli, initialStock - 27_000);
  assert.equal(actual.beans?.reservedMilli, latteBeans + espressoBeans);
  assert.equal(actual.milk?.reservedMilli, latteMilk);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS n FROM waste_entries WHERE command_id=?').get(ackId)?.n, 2);
  await f.kitchenAction(changed, 'ready');
  assert.equal((await f.stock()).beans?.onHandMilli, initialStock - 8_000 - latteBeans - espressoBeans);
  assert.equal((await f.stock()).milk?.onHandMilli, initialStock - 27_000 - latteMilk);
  assert.equal(f.labels(sent).length, 1);
});

test('amendment approvals isolate roles and branches and deny or reject stale requests without altering lines', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order([{ productId: 'latte', quantity: 1 }, { productId: 'espresso', quantity: 1 }]));
  const change = { operation: 'remove', lineNo: 1 };
  const body = { expectedVersion: sent.version, reason: 'Customer removes an item', ...change };
  checkStatus(await f.post(f.barista, amendPath(sent), body), 403);
  checkStatus(await f.post(f.otherCashier, amendPath(sent), body), 404);
  const deniedRequest = (await f.amend(sent, change)).amendment;
  const decideBody = { decision: 'approve', reason: 'Reviewed the request' };
  checkStatus(await f.post(f.cashier, decisionPath(deniedRequest), decideBody), 403);
  checkStatus(await f.post(f.otherManager, decisionPath(deniedRequest), decideBody), 404);
  checkStatus(await f.get(f.barista, '/api/v1/amendments'), 403);
  assert.deepEqual(ok<{ amendments: Amendment[] }>(await f.get(f.otherManager, '/api/v1/amendments')).amendments, []);
  assert.ok(ok<{ amendments: Amendment[] }>(await f.get(f.manager, '/api/v1/amendments')).amendments.some((item) => item.id === deniedRequest.id));
  assert.equal((await f.decide(deniedRequest, 'deny')).amendment.status, 'denied');
  assert.deepEqual((await f.readOrder(sent)).lines, sent.lines);
  assert.equal((await f.stock()).beans?.reservedMilli, latteBeans + espressoBeans);

  const old = (await f.amend(sent, change)).amendment;
  checkStatus(await f.post(f.cashier, amendPath(sent), {
    expectedVersion: sent.version, operation: 'note', lineNo: 0, note: 'Serve at counter', reason: 'Competing amendment',
  }), 409);
  const preparing = await f.kitchenAction(sent, 'prepare');
  const note = (await f.amend(preparing, { operation: 'note', lineNo: 0, note: 'Serve at counter' })).amendment;
  const amended = await f.readOrder(sent);
  checkStatus(await f.post(f.manager, decisionPath(old), decideBody), 409);
  checkStatus(await f.post(f.cashier, acknowledgePath(sent, note), { expectedVersion: amended.version, note: '', used: [] }), 403);
  assert.equal((await f.readOrder(sent)).lines.find((line) => line.lineNo === 1)?.quantity, 1);
  assert.equal((await f.readOrder(sent)).totalCentavos, latteCentavos + espressoCentavos);
  assert.equal((await f.stock()).beans?.reservedMilli, latteBeans + espressoBeans);
});

test('split-paid takeout stays off the station until verified and preserves its original sale through refund and replacement', async (t) => {
  const f = await fixture(t);
  const cashCentavos = 10_000;
  const externalCentavos = latteCentavos - cashCentavos;
  ok(await f.post(f.owner, '/api/v1/drawers', { drawerId: 'counter', name: 'Fixture counter', deviceIds: ['tablet-a'] }));
  const { shift } = ok<{ shift: { id: string } }>(await f.post(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000 }));
  const unpaid = await f.order([{ productId: 'latte', quantity: 1 }], false);
  const partial = ok<{ order: Order }>(await f.post(f.cashier, `${orderPath(unpaid)}/payments`, {
    expectedVersion: unpaid.version, method: 'cash', amountCentavos: cashCentavos,
    cashReceivedCentavos: cashCentavos, verified: true,
  })).order;
  assert.equal(partial.paymentState, 'partially_paid');
  assert.equal(partial.releasedAt, null);
  const pending = await f.pay(partial, externalCentavos, false);
  assert.equal(pending.paymentState, 'pending_verification');
  assert.equal(pending.paidCentavos, cashCentavos);
  assert.equal(pending.releasedAt, null);
  assert.equal((await f.queue()).some((order) => order.id === pending.id), false);
  assert.equal((await f.stock()).beans?.reservedMilli, 0);
  assert.deepEqual(f.labels(pending), []);
  assert.deepEqual(f.settlements(pending), []);
  checkStatus(await f.post(f.cashier, `${orderPath(pending)}/send`, { expectedVersion: pending.version }), 409);
  const pendingTender = f.tenders(pending).find((tender) => tender.method === 'gcash')!;
  assert.equal(pendingTender.status, 'pending');
  const verifyPath = `${orderPath(pending)}/payments/${String(pendingTender.id)}/verify`;
  const verifyBody = { expectedVersion: pending.version };
  const verifyCommand = randomUUID();
  const verified = ok<{ order: Order }>(await f.post(f.cashier, verifyPath, verifyBody, verifyCommand));
  assert.deepEqual(ok(await f.post(f.cashier, verifyPath, verifyBody, verifyCommand)), verified);
  const paid = verified.order;
  assert.equal(paid.paymentState, 'paid');
  assert.notEqual(paid.releasedAt, null);
  assert.equal((await f.queue()).some((order) => order.id === paid.id), true);
  const settlement = f.settlements(paid);
  const tenders = f.tenders(paid);
  const linksFor = (order: Order) => f.inspector.prepare('SELECT payment_id FROM settlement_payment_links WHERE order_id=? ORDER BY payment_id').all(order.id);
  const links = linksFor(paid);
  const labels = f.labels(paid);
  assert.equal(settlement.length, 1);
  assert.equal(settlement[0]?.total_centavos, latteCentavos);
  assert.equal(labels.length, 1);
  assert.deepEqual(tenders.map((tender) => tender.method).sort(), ['cash', 'gcash']);
  assert.ok(tenders.every((tender) => tender.status === 'confirmed'));
  assert.deepEqual(links.map((link) => link.payment_id), tenders.map((tender) => tender.id));
  const priceChange = await f.post(f.cashier, amendPath(paid), {
    expectedVersion: paid.version, reason: 'Customer orders an espresso instead', operation: 'replace', lineNo: 0,
    productId: 'espresso', quantity: 1, note: '',
  });
  checkStatus(priceChange, 409);
  const note = (await f.amend(paid, { operation: 'note', lineNo: 0, note: 'Serve without a lid' })).amendment;
  assert.equal(note.status, 'awaiting_station');
  const amended = await f.readOrder(paid);
  assert.equal(amended.paymentState, 'paid');
  assert.equal(amended.totalCentavos, latteCentavos);
  assert.equal(amended.lines[0]?.note, 'Serve without a lid');
  await f.acknowledge(amended, note);
  const original = await f.readOrder(paid);
  const { approval } = ok<{ approval: { id: string } }>(await f.post(f.cashier, `${orderPath(original)}/approvals`, {
    expectedVersion: original.version, action: 'cancel', reason: 'Customer wants a different priced drink',
  }));
  ok(await f.post(f.manager, `/api/v1/approvals/${approval.id}/decision`, { decision: 'approve' }));
  const cancelled = await f.readOrder(original);
  assert.equal(cancelled.cancelled, true);
  assert.equal((await f.queue()).find((order) => order.id === original.id)?.cancelled, true);
  checkStatus(await f.post(f.barista, `${orderPath(cancelled)}/ready`, { expectedVersion: original.version }), 409);
  ok(await f.post(f.barista, `${orderPath(cancelled)}/cancellation/disposition`, {
    expectedVersion: cancelled.version, outcome: 'unprepared', note: 'No ingredients used', used: [],
  }));
  const disposed = await f.readOrder(cancelled);
  const { refund } = ok<{ refund: { id: string } }>(await f.post(f.cashier, `${orderPath(disposed)}/refunds`, {
    expectedVersion: disposed.version, amountCentavos: latteCentavos, lineNumbers: [0], reason: 'Original paid drink was cancelled',
  }));
  type PayoutLeg = { id: string; version: number; method: string; paymentId: string; amountCentavos: number; status: string };
  const authorized = ok<{ refund: { legs: PayoutLeg[] } }>(await f.post(f.manager, `/api/v1/refunds/${refund.id}/decision`, {
    decision: 'approve', allocations: tenders.map((tender) => ({ paymentId: String(tender.id), amountCentavos: Number(tender.amount_centavos) })),
  })).refund;
  assert.equal(authorized.legs.length, 2);
  const cash = authorized.legs.find((leg) => leg.method === 'cash')!;
  const gcash = authorized.legs.find((leg) => leg.method === 'gcash')!;
  assert.equal(cash.amountCentavos, cashCentavos);
  assert.equal(gcash.amountCentavos, externalCentavos);
  const cashPath = `/api/v1/refunds/${refund.id}/legs/${cash.id}`;
  const cashBody = { expectedVersion: cash.version, action: 'record_cash' };
  const cashCommand = randomUUID();
  const recorded = ok(await f.post(f.cashier, cashPath, cashBody, cashCommand));
  assert.deepEqual(ok(await f.post(f.cashier, cashPath, cashBody, cashCommand)), recorded);
  const refunded = ok<{ refund: { legs: PayoutLeg[] } }>(await f.post(f.manager, `/api/v1/refunds/${refund.id}/legs/${gcash.id}`, {
    expectedVersion: gcash.version, action: 'confirm_external', reference: randomUUID(), note: 'Merchant confirmed the return',
  })).refund;
  assert.ok(refunded.legs.every((leg) => leg.status === 'completed'));
  const debits = f.inspector.prepare('SELECT shift_id,leg_id,amount_centavos FROM refund_cash_movements').all();
  assert.deepEqual(debits.map((debit) => ({ ...debit })), [{ shift_id: shift.id, leg_id: cash.id, amount_centavos: cashCentavos }]);
  const replacement = await f.pay(await f.order([{ productId: 'espresso', quantity: 1 }], false), espressoCentavos);
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.totalCentavos, espressoCentavos);
  assert.equal(replacement.paymentState, 'paid');
  assert.equal(f.settlements(replacement).length, 1);
  assert.equal(f.settlements(replacement)[0]?.total_centavos, espressoCentavos);
  assert.equal(linksFor(replacement).length, 1);
  assert.deepEqual(f.settlements(paid), settlement);
  assert.deepEqual(f.tenders(paid), tenders);
  assert.deepEqual(linksFor(paid), links);
  assert.deepEqual(f.labels(paid), labels);
  assert.equal((await f.stock()).beans?.onHandMilli, initialStock);
  assert.equal((await f.stock()).beans?.reservedMilli, espressoBeans);
});

test('an amendment and Ready racing the same version cannot both win', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order());
  const [amendment, ready] = await Promise.all([
    f.post(f.cashier, amendPath(sent), {
      expectedVersion: sent.version, operation: 'quantity', lineNo: 0, quantity: 2, reason: 'Customer adds a second latte',
    }),
    f.post(f.barista, `${orderPath(sent)}/ready`, { expectedVersion: sent.version }),
  ]);
  assert.deepEqual([amendment.statusCode, ready.statusCode].sort(), [200, 409]);
  const current = await f.readOrder(sent);
  assert.equal(current.version, sent.version + 1);
  assert.equal(f.labels(sent).length, 1);
  if (amendment.statusCode === 200) {
    assert.equal(current.ready, false);
    assert.equal(current.lines[0]?.quantity, 2);
    assert.equal((await f.stock()).beans?.onHandMilli, initialStock);
    assert.equal((await f.stock()).beans?.reservedMilli, latteBeans * 2);
  } else {
    assert.equal(current.ready, true);
    assert.equal(current.lines[0]?.quantity, 1);
    assert.equal((await f.stock()).beans?.onHandMilli, initialStock - latteBeans);
    assert.equal((await f.stock()).beans?.reservedMilli, 0);
  }
});

test('retired line numbers are preserved, and a newly appended line stays refundable beyond the original index range', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order(Array.from({ length: 50 }, () => ({ productId: 'latte', quantity: 1 }))));
  const requested = (await f.amend(sent, { operation: 'remove', lineNo: 0 })).amendment;
  const approved = (await f.decide(requested, 'approve')).amendment;
  assert.equal(approved.status, 'awaiting_station');
  await f.acknowledge(await f.readOrder(sent), approved);
  const reduced = await f.readOrder(sent);
  assert.equal(reduced.lines.length, 49);
  assert.equal(reduced.lines.some((line) => line.lineNo === 0), false);
  assert.equal(reduced.totalCentavos, latteCentavos * 49);

  const added = (await f.amend(reduced, { operation: 'add', productId: 'espresso', quantity: 1, note: '' })).amendment;
  assert.equal(added.after?.lineNo, 50);
  await f.acknowledge(await f.readOrder(sent), added);
  const changed = await f.readOrder(sent);
  assert.equal(changed.lines.length, 50);
  assert.equal(changed.lines[49]?.lineNo, 50);
  assert.equal(changed.totalCentavos, latteCentavos * 49 + espressoCentavos);
  assert.equal(f.labels(sent).length, 1);
  const paid = await f.pay(changed, changed.totalCentavos);
  assert.equal(paid.paymentState, 'paid');
  assert.equal(f.settlements(sent).length, 1);
  const refund = (lineNo: number) => f.post(f.cashier, `${orderPath(paid)}/refunds`, {
    expectedVersion: paid.version, amountCentavos: espressoCentavos, lineNumbers: [lineNo], reason: 'Refund this saved item',
  });
  const accepted = ok<{ refund: { lines: Line[] } }>(await refund(50)).refund;
  assert.equal(accepted.lines[0]?.lineNo, 50);
  assert.equal(accepted.lines[0]?.name, 'Fixture espresso');
  const retired = await refund(0);
  assert.ok([400, 404, 409].includes(retired.statusCode), retired.body);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS n FROM refund_requests WHERE order_id=?').get(paid.id)?.n, 1);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS n FROM order_lines WHERE order_id=?').get(paid.id)?.n, 51);
});

test('pending and partial payment leave sent-order pricing frozen', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order());
  const pending = await f.pay(sent, 6_000, false);
  const change = (order: Order) => f.post(f.cashier, amendPath(order), {
    expectedVersion: order.version, operation: 'quantity', lineNo: 0, quantity: 2, reason: 'Customer adds a second latte',
  });
  const firstTender = f.tenders(pending)[0]!;
  assert.equal(pending.paymentState, 'pending_verification');
  checkStatus(await change(pending), 409);
  const partial = ok<{ order: Order }>(await f.post(f.cashier, `${orderPath(pending)}/payments/${String(firstTender.id)}/verify`, {
    expectedVersion: pending.version,
  })).order;
  assert.equal(partial.paymentState, 'partially_paid');
  checkStatus(await change(partial), 409);
  assert.equal((await f.readOrder(sent)).totalCentavos, latteCentavos);
  assert.equal(f.tenders(sent).length, 1);
  assert.equal(f.settlements(sent).length, 0);
  assert.equal((await f.stock()).beans?.reservedMilli, latteBeans);
});

test('whole-order cancellation supersedes staged prep work and records one disposition against the unchanged recipe', async (t) => {
  const f = await fixture(t);
  const sent = await f.send(await f.order([{ productId: 'latte', quantity: 2 }]));
  const preparing = await f.kitchenAction(sent, 'prepare');
  const requested = (await f.amend(preparing, { operation: 'quantity', lineNo: 0, quantity: 1 })).amendment;
  const approved = (await f.decide(requested, 'approve')).amendment;
  const staged = await f.readOrder(sent);
  assert.equal(approved.status, 'awaiting_station');
  assert.equal(approved.appliedAt, null);
  checkStatus(await f.post(f.cashier, `${orderPath(staged)}/payments`, {
    expectedVersion: staged.version, method: 'gcash', amountCentavos: staged.totalCentavos, verified: true, reference: randomUUID(),
  }), 409);
  assert.equal(f.tenders(sent).length, 0);

  const { approval } = ok<{ approval: { id: string } }>(await f.post(f.cashier, `${orderPath(staged)}/approvals`, {
    expectedVersion: staged.version, action: 'cancel', reason: 'Customer cancels the whole order',
  }));
  ok(await f.post(f.manager, `/api/v1/approvals/${approval.id}/decision`, { decision: 'approve' }));
  const cancelled = await f.readOrder(sent);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.lines[0]?.quantity, 2);
  assert.equal(cancelled.totalCentavos, latteCentavos * 2);
  assert.equal((await f.stock()).beans?.reservedMilli, latteBeans * 2);
  assert.equal((await f.stock()).milk?.reservedMilli, latteMilk * 2);
  const stale = ok<{ amendments: Amendment[] }>(await f.get(f.manager, '/api/v1/amendments')).amendments.find((item) => item.id === approved.id);
  assert.equal(stale?.status, 'stale');
  assert.equal(stale.appliedAt, null);
  const station = (await f.queue()).find((order) => order.id === sent.id)!;
  assert.equal(station.cancelled, true);
  assert.notEqual(station.amendment?.status, 'awaiting_station');
  checkStatus(await f.post(f.barista, acknowledgePath(sent, approved), {
    expectedVersion: cancelled.version, note: 'Stale disposition', used: [{ ingredientId: 'beans', quantityMilli: 5_000 }],
  }), 409);
  assert.equal((await f.stock()).beans?.onHandMilli, initialStock);
  const dispositionCommand = randomUUID();
  const body = {
    expectedVersion: cancelled.version, outcome: 'used', note: 'Actual ingredients used before stopping',
    used: [{ ingredientId: 'beans', quantityMilli: 12_000 }, { ingredientId: 'milk', quantityMilli: 90_000 }],
  };
  const path = `${orderPath(cancelled)}/cancellation/disposition`;
  const resolved = ok(await f.post(f.barista, path, body, dispositionCommand));
  assert.deepEqual(ok(await f.post(f.barista, path, body, dispositionCommand)), resolved);
  assert.equal((await f.stock()).beans?.onHandMilli, initialStock - 12_000);
  assert.equal((await f.stock()).milk?.onHandMilli, initialStock - 90_000);
  assert.equal((await f.stock()).beans?.reservedMilli, 0);
  assert.equal((await f.stock()).milk?.reservedMilli, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS n FROM waste_entries').get()?.n, 2);
  assert.equal(f.settlements(sent).length, 0);
  assert.equal(f.labels(sent).length, 1);
});
