import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { hash } from 'bcryptjs';
import { createHub } from '../src/hub.js';

const scratchRoot = fileURLToPath(new URL('../../scratch/sales-migration-tests/', import.meta.url));
const password = 'Fixture-Sales-Migration-Password!';
const deviceSecret = 'Fixture-Sales-Migration-Device-Secret-32!';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const branch = 'legacy-branch';
const cashierId = 'legacy-cashier';
const deviceId = 'legacy-tablet';

function ok<T>(response: { statusCode: number; body: string; json(): unknown }): T {
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as T;
}

test('schema 5 sales upgrade preserves legacy money, unknown costs and command replay without inventing settlements', async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'schema5-'));
  const databasePath = join(folder, 'hub.sqlite');
  const legacy = new DatabaseSync(databasePath);
  let inspector: DatabaseSync | undefined;
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  t.after(async () => {
    inspector?.close();
    await hub?.close();
    const target = resolve(folder);
    assert.equal(dirname(target), resolve(scratchRoot));
    await rm(target, { recursive: true, force: true });
  });
  const oldTime = Date.UTC(2026, 10, 4, 15);
  const now = Date.UTC(2026, 10, 5, 16, 30);
  const migrations = ['001_authority.sql', '002_auth_reservations.sql', '003_business.sql', '004_command_context.sql', '005_operating_expenses.sql'];
  legacy.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
  for (const [index, name] of migrations.entries()) {
    legacy.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    legacy.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
  }
  const ownerHash = await hash(password, 12);
  const cashierHash = await hash('4826', 12);
  legacy.prepare('INSERT INTO branches(id) VALUES(?)').run(branch);
  for (const [id, role, credentialHash] of [['legacy-owner', 'owner', ownerHash], [cashierId, 'cashier', cashierHash]] as const) {
    legacy.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)')
      .run(id, branch, id, role, credentialHash);
  }
  legacy.prepare('INSERT INTO devices(id,branch_id,secret_hash) VALUES(?,?,?)').run(deviceId, branch, digest(deviceSecret));
  legacy.prepare('INSERT INTO ingredients(branch_id,id,name,unit) VALUES(?,?,?,?)').run(branch, 'beans', 'Legacy beans', 'g');
  legacy.prepare('INSERT INTO products(branch_id,id,name,price_centavos,version) VALUES(?,?,?,?,1)').run(branch, 'latte', 'Legacy latte', 16500);
  legacy.prepare('INSERT INTO product_versions(branch_id,product_id,version) VALUES(?,?,1)').run(branch, 'latte');
  legacy.prepare('INSERT INTO product_recipe(branch_id,product_id,version,ingredient_id,quantity_milli) VALUES(?,?,1,?,18000)').run(branch, 'latte', 'beans');

  const paymentCommand = randomUUID();
  const pendingPaymentId = randomUUID();
  const replayPayload = {
    commandId: paymentCommand, expectedVersion: 2, method: 'cash', amountCentavos: 16500, verified: true, cashReceivedCentavos: 20000,
  };
  const replayResponse = { commandId: paymentCommand, order: { id: 'legacy-paid', paidCentavos: 16500 }, payment: { id: 'legacy-full-payment' } };
  function command(id: string, action = 'legacy.fixture', response: unknown = {}, fingerprint = 'legacy-fixture') {
    legacy.prepare('INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, cashierId, branch, action, fingerprint, JSON.stringify(response), oldTime, deviceId);
  }
  command(paymentCommand, 'order.payment', replayResponse, digest(JSON.stringify({
    action: 'order.payment', target: 'legacy-paid', deviceId, input: replayPayload,
  })));
  command('legacy-receipt');
  command('legacy-ready-paid');
  command('legacy-ready-partial');
  command('legacy-partial-cash');
  command('legacy-pending-external');
  for (const [id, number, version, consumptionCommand] of [
    ['legacy-paid', 1, 4, 'legacy-ready-paid'], ['legacy-partial', 2, 5, 'legacy-ready-partial'],
  ] as const) {
    legacy.prepare(`INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,released_at,ready_at,total_centavos)
      VALUES(?,?,?,?,1,'04','explicit_send',?,?,?,16500)`).run(id, branch, number, version, oldTime, oldTime, oldTime);
    legacy.prepare(`INSERT INTO order_lines(branch_id,order_id,line_no,product_id,name,quantity,unit_price_centavos,note,recipe_version)
      VALUES(?,?,0,'latte','Legacy latte',1,16500,'',1)`).run(branch, id);
    legacy.prepare('INSERT INTO order_line_recipe(branch_id,order_id,line_no,ingredient_id,quantity_milli) VALUES(?,?,0,?,18000)').run(branch, id, 'beans');
    legacy.prepare('INSERT INTO reservations(branch_id,order_id,ingredient_id,quantity_milli,consumed) VALUES(?,?,?,18000,1)').run(branch, id, 'beans');
    legacy.prepare(`INSERT INTO stock_movements(id,branch_id,ingredient_id,quantity_milli,kind,order_id,command_id,accepted_at)
      VALUES(?,?,?,-18000,'consumption',?,?,?)`).run(`movement-${id}`, branch, 'beans', id, consumptionCommand, oldTime);
  }
  legacy.prepare(`INSERT INTO stock_receipts(id,branch_id,ingredient_id,quantity_milli,total_cost_centavos,reference,actor_id,accepted_at,command_id)
    VALUES(?,?,?,1000000,80000,'Legacy receiving',?,?,?)`).run('legacy-stock-receipt', branch, 'beans', cashierId, oldTime, 'legacy-receipt');
  legacy.prepare(`INSERT INTO stock_movements(id,branch_id,ingredient_id,quantity_milli,kind,receipt_id,command_id,accepted_at)
    VALUES(?,?,?,1000000,'receipt',?,?,?)`).run('legacy-receipt-movement', branch, 'beans', 'legacy-stock-receipt', 'legacy-receipt', oldTime);
  for (const [id, orderId, amount, received, change, commandId] of [
    ['legacy-full-payment', 'legacy-paid', 16500, 20000, 3500, paymentCommand],
    ['legacy-partial-payment', 'legacy-partial', 10000, 10000, 0, 'legacy-partial-cash'],
  ] as const) {
    legacy.prepare(`INSERT INTO payments(id,branch_id,order_id,method,amount_centavos,status,cash_received_centavos,change_centavos,accepted_at,command_id)
      VALUES(?,?,?,'cash',?,'confirmed',?,?,?,?)`).run(id, branch, orderId, amount, received, change, oldTime, commandId);
  }
  legacy.prepare(`INSERT INTO payments(id,branch_id,order_id,method,amount_centavos,status,reference,accepted_at,command_id)
    VALUES(?,?,?,'gcash',6500,'pending','Legacy pending GCash',?,?)`).run(pendingPaymentId, branch, 'legacy-partial', oldTime, 'legacy-pending-external');
  const oldStock = legacy.prepare('SELECT SUM(quantity_milli) AS quantity FROM stock_movements').get()!.quantity;
  const oldReceipt = legacy.prepare('SELECT fingerprint,response_json,device_id FROM command_receipts WHERE id=?').get(paymentCommand);
  legacy.close();

  hub = await createHub({ databasePath, now: () => now });
  inspector = new DatabaseSync(databasePath);
  assert.equal(inspector.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
  assert.equal(inspector.prepare('SELECT COUNT(*) AS count FROM order_settlements').get()!.count, 0);
  assert.equal(inspector.prepare('SELECT COUNT(*) AS count FROM stock_movement_valuations').get()!.count, 0);
  assert.equal(inspector.prepare('SELECT COUNT(*) AS count FROM order_recipe_valuation_estimates').get()!.count, 0);
  assert.equal(inspector.prepare('SELECT COUNT(*) AS count FROM ingredient_valuation_balances').get()!.count, 0);
  assert.equal(inspector.prepare('SELECT SUM(quantity_milli) AS quantity FROM stock_movements').get()!.quantity, oldStock);
  assert.deepEqual(inspector.prepare('SELECT fingerprint,response_json,device_id FROM command_receipts WHERE id=?').get(paymentCommand), oldReceipt);
  assert.equal(inspector.prepare('SELECT total_cost_centavos FROM stock_receipts WHERE id=?').get('legacy-stock-receipt')!.total_cost_centavos, 80000);
  const owner = ok<{ token: string }>(await hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'legacy-owner', password } })).token;
  const cashier = ok<{ token: string }>(await hub.app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { accountId: cashierId, pin: '4826', deviceId, deviceSecret } })).token;
  const get = (url: string, token = owner) => hub!.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const post = (url: string, token: string, payload: Record<string, unknown>) => hub!.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
  type Report = { settledOrderCount: number; settledSalesCentavos: number; unattributedLegacySettlements: number; ordersWithUnknownIngredientCost: number; estimatedGrossProfitCentavos: number | null; estimatedOperatingProfitCentavos: number | null };
  const initial = ok<Report>(await get('/api/v1/admin/sales?from=2026-11-04&through=2026-11-04'));
  assert.equal(initial.settledOrderCount, 0);
  assert.equal(initial.settledSalesCentavos, 0);
  assert.equal(initial.unattributedLegacySettlements, 1);
  assert.equal(initial.estimatedGrossProfitCentavos, null);
  assert.equal(initial.estimatedOperatingProfitCentavos, null);
  assert.deepEqual(ok(await post('/api/v1/orders/legacy-paid/payments', cashier, replayPayload)), replayResponse);
  assert.equal(inspector.prepare('SELECT COUNT(*) AS count FROM order_settlements').get()!.count, 0, 'old receipt replay must not retroactively create a settlement');
  assert.equal(inspector.prepare('SELECT COUNT(*) AS count FROM payments').get()!.count, 3);

  const verifyCommand = randomUUID();
  const verified = ok<{ order: { paidCentavos: number; ready: boolean } }>(await post(`/api/v1/orders/legacy-partial/payments/${pendingPaymentId}/verify`, cashier, { commandId: verifyCommand, expectedVersion: 5 }));
  assert.equal(verified.order.paidCentavos, 16500);
  assert.equal(verified.order.ready, true);
  const settlement = inspector.prepare('SELECT order_id,settled_at,business_date,total_centavos FROM order_settlements').get();
  assert.deepEqual({ ...settlement }, { order_id: 'legacy-partial', settled_at: now, business_date: '2026-11-06', total_centavos: 16500 });
  const dated = ok<Report>(await get('/api/v1/admin/sales?from=2026-11-06&through=2026-11-06'));
  assert.equal(dated.settledOrderCount, 1);
  assert.equal(dated.settledSalesCentavos, 16500);
  assert.equal(dated.unattributedLegacySettlements, 1);
  assert.equal(dated.ordersWithUnknownIngredientCost, 1);
  assert.equal(dated.estimatedGrossProfitCentavos, null);
  assert.equal(dated.estimatedOperatingProfitCentavos, null);
  assert.equal(inspector.prepare('SELECT COUNT(*) AS count FROM stock_movement_valuations').get()!.count, 0);
  assert.equal(inspector.prepare('SELECT SUM(quantity_milli) AS quantity FROM stock_movements').get()!.quantity, oldStock);
});
