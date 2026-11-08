import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

type Order = { id: string; version: number; totalCentavos: number; released: boolean; paymentState: string;
  unavailableLines: { lineNo: number; productId: string; name: string }[];
  lines: { lineNo: number; productId: string; quantity: number; note: string }[] };
type Product = { id: string; available: boolean; availabilityVersion: number; version: number };
type Reply = { statusCode: number; body: string; json(): unknown };
function ok<T>(response: Reply): T { assert.equal(response.statusCode, 200, response.body); return response.json() as T; }

async function fixture(t: TestContext) {
  const tempRoot = resolve(tmpdir());
  const prefix = join(tempRoot, 'kape-availability-');
  const folder = await mkdtemp(prefix);
  const path = join(folder, 'hub.sqlite');
  const hub = await createHub({ databasePath: path });
  const inspector = new DatabaseSync(path);
  t.after(async () => { inspector.close(); await hub.close(); const target = resolve(folder); assert.equal(dirname(target), tempRoot); assert.ok(target.startsWith(prefix)); await rm(target, { recursive: true, force: true }); });
  const password = 'Synthetic-Availability-Password!';
  const deviceSecret = 'Synthetic-Availability-Device-Secret!';
  for (const [id, role, branch] of [
    ['owner', 'owner', 'branch'], ['manager', 'manager', 'branch'], ['cashier', 'cashier', 'branch'],
    ['barista', 'barista', 'branch'], ['outside', 'owner', 'other'],
  ] as const) await hub.provisionAccount({ id, role, branchId: branch, displayName: id, secret: role === 'cashier' || role === 'barista' ? '4812' : password });
  await hub.provisionDevice({ id: 'tablet', branchId: 'branch', secret: deviceSecret });
  async function signIn(id: string, staff = false) {
    return ok<{ token: string }>(await hub.app.inject({ method: 'POST', url: '/api/v1/auth/' + (staff ? 'staff' : 'admin'),
      payload: staff ? { accountId: id, pin: '4812', deviceId: 'tablet', deviceSecret } : { accountId: id, password } })).token;
  }
  const owner = await signIn('owner'), manager = await signIn('manager'), cashier = await signIn('cashier', true), barista = await signIn('barista', true), outside = await signIn('outside');
  const post = (url: string, payload: Record<string, unknown>, token = owner, commandId: string = randomUUID()) =>
    hub.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { commandId, ...payload } });
  const get = (url: string, token = owner) => hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  ok(await post('/api/v1/ingredients', { ingredientId: 'beans', name: 'Beans', unit: 'g' }));
  ok(await post('/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli: 100_000, totalCostCentavos: 10000, reference: 'Synthetic opening' }));
  for (const [id, price] of [['latte', 16500], ['same', 16500], ['cheaper', 12000]] as const)
    ok(await post('/api/v1/products', { productId: id, name: id, priceCentavos: price, recipe: [{ ingredientId: 'beans', quantityMilli: 9000 }] }));
  ok(await post('/api/v1/drawers', { drawerId: 'counter', name: 'Counter', deviceIds: ['tablet'] }));
  ok(await post('/api/v1/shifts/open', { openingCashCentavos: 100000 }, cashier));
  const create = async (dineIn = true, productId = 'latte', quantity = 1) => ok<{ order: Order }>(await post('/api/v1/orders', { dineIn, table: '04', items: [{ productId, quantity, note: 'Less sweet' }] }, cashier)).order;
  const set = async (available: boolean, expectedVersion = 1, commandId: string = randomUUID()) => ok<{ product: Product }>(await post('/api/v1/products/latte/availability', { expectedVersion, available, reason: 'Synthetic catalog change' }, manager, commandId)).product;
  const replace = async (order: Order, productId = 'same', commandId: string = randomUUID()) => ok<{ order: Order }>(await post(`/api/v1/orders/${order.id}/replace-unavailable`, { expectedVersion: order.version, lineNo: 0, productId, reason: 'Synthetic replacement' }, cashier, commandId)).order;
  return { owner, manager, cashier, barista, outside, post, get, create, set, replace, rows: (sql: string, ...args: (string | number)[]) => inspector.prepare(sql).all(...args).map(row => ({ ...row })) };
}

test('availability uses an independent version, durable reason and branch/role checks', async t => {
  const f = await fixture(t);
  const product = ok<{ products: Product[] }>(await f.get('/api/v1/products')).products.find(item => item.id === 'latte')!;
  assert.equal(product.available, true); assert.equal(product.availabilityVersion, 1); assert.equal(product.version, 1);
  const commandId = randomUUID();
  const changed = await f.set(false, 1, commandId);
  assert.equal(changed.available, false); assert.equal(changed.availabilityVersion, 2); assert.equal(changed.version, 1);
  assert.deepEqual(await f.set(false, 1, commandId), changed);
  assert.equal((await f.post('/api/v1/products/latte/availability', { expectedVersion: 1, available: true, reason: 'Changed retry' }, f.manager, commandId)).statusCode, 409);
  assert.equal((await f.post('/api/v1/products/latte/availability', { expectedVersion: 2, available: true, reason: 'Unauthorized' }, f.cashier)).statusCode, 403);
  assert.equal((await f.post('/api/v1/products/latte/availability', { expectedVersion: 2, available: true, reason: 'Other branch' }, f.outside)).statusCode, 404);
  const events = f.rows('SELECT old_available,new_available,reason,actor_id FROM product_availability_events WHERE command_id=?', commandId);
  assert.deepEqual(events, [{ old_available: 1, new_available: 0, reason: 'Synthetic catalog change', actor_id: 'manager' }]);
  const unavailable = await f.post('/api/v1/orders', { dineIn: true, table: '', items: [{ productId: 'latte', quantity: 1, note: '' }] }, f.cashier);
  assert.equal(unavailable.statusCode, 409); assert.equal((unavailable.json() as {error:{code:string}}).error.code, 'product_unavailable');
});

test('unreleased order replaces a disabled item while preserving the original line and reason', async t => {
  const f = await fixture(t);
  const original = await f.create(true, 'latte', 2);
  await f.set(false);
  const held = ok<{order:Order}>(await f.get(`/api/v1/orders/${original.id}`, f.cashier)).order;
  assert.deepEqual(held.unavailableLines, [{ lineNo: 0, productId: 'latte', name: 'latte' }]);
  const refused = await f.post(`/api/v1/orders/${held.id}/send`, { expectedVersion: held.version }, f.cashier);
  assert.equal(refused.statusCode, 409); assert.equal((refused.json() as {error:{code:string}}).error.code, 'product_unavailable');
  const id = randomUUID();
  const replacement = await f.replace(held, 'cheaper', id);
  assert.equal(replacement.totalCentavos, 24000); assert.equal(replacement.version, 2);
  assert.deepEqual(replacement.unavailableLines, []);
  assert.deepEqual(replacement.lines.map(line => [line.productId, line.quantity, line.note]), [['cheaper', 2, 'Less sweet']]);
  assert.deepEqual(await f.replace(held, 'cheaper', id), replacement);
  assert.deepEqual(f.rows('SELECT old_line_no,new_line_no,reason FROM unreleased_order_replacements WHERE command_id=?', id), [{ old_line_no: 0, new_line_no: 1, reason: 'Synthetic replacement' }]);
  assert.equal(f.rows('SELECT * FROM order_lines WHERE branch_id=? AND order_id=? AND retired=1', 'branch', held.id).length, 1);
});

test('verified pending money remains recorded when disabled and same-price replacement releases once', async t => {
  const f = await fixture(t);
  const created = await f.create(false);
  const pending = ok<{order:Order;payment:{id:string}}>(await f.post(`/api/v1/orders/${created.id}/payments`, { expectedVersion: created.version, method: 'gcash', amountCentavos: 16500, verified: false, reference: 'SYNTHETIC-AVAILABILITY' }, f.cashier));
  await f.set(false);
  const verifyId = randomUUID();
  const verified = ok<{order:Order}>(await f.post(`/api/v1/orders/${created.id}/payments/${pending.payment.id}/verify`, { expectedVersion: pending.order.version }, f.cashier, verifyId));
  assert.equal(verified.order.paymentState, 'paid'); assert.equal(verified.order.released, false);
  assert.equal(verified.order.unavailableLines.length, 1);
  assert.equal(f.rows('SELECT * FROM order_settlements WHERE order_id=?', created.id).length, 1);
  const rejected = await f.post(`/api/v1/orders/${created.id}/replace-unavailable`, { expectedVersion: verified.order.version, lineNo: 0, productId: 'cheaper', reason: 'Price differs' }, f.cashier);
  assert.equal(rejected.statusCode, 409);
  const commandId = randomUUID();
  const replacement = await f.replace(verified.order, 'same', commandId);
  assert.equal(replacement.released, true); assert.equal(replacement.paymentState, 'paid');
  assert.deepEqual(await f.replace(verified.order, 'same', commandId), replacement);
  assert.equal(f.rows("SELECT * FROM print_jobs WHERE order_id=? AND type='label'", created.id).length, 1);
  assert.equal(f.rows('SELECT * FROM order_settlements WHERE order_id=?', created.id).length, 1);
});

test('an order already sent to the station remains payable and completable when its product is disabled', async t => {
  const f = await fixture(t);
  const order = await f.create();
  const sent = ok<{order:Order}>(await f.post(`/api/v1/orders/${order.id}/send`, { expectedVersion: order.version }, f.cashier)).order;
  await f.set(false);
  const ready = ok<{order:Order}>(await f.post(`/api/v1/orders/${order.id}/ready`, { expectedVersion: sent.version }, f.barista)).order;
  const paid = ok<{order:Order}>(await f.post(`/api/v1/orders/${order.id}/payments`, { expectedVersion: ready.version, method: 'cash', amountCentavos: 16500, verified: true, cashReceivedCentavos: 20000 }, f.cashier)).order;
  assert.equal(paid.paymentState, 'paid'); assert.equal(paid.released, true);
  assert.equal(f.rows("SELECT * FROM stock_movements WHERE order_id=? AND kind='consumption'", order.id).length, 1);
});
