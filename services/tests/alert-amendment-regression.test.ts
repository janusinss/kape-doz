import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { HubDatabase } from '../src/database.js';
import { BusinessService } from '../src/business.js';

function fixture(t: TestContext) {
  const store = new HubDatabase(':memory:');
  t.after(() => store.close());
  const db = store.connection;
  db.prepare("INSERT INTO branches(id) VALUES('branch')").run();
  for (const role of ['owner', 'manager', 'cashier', 'barista']) {
    db.prepare("INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,'branch',?,?, 'fixture')")
      .run(role, role, role);
  }
  db.prepare("INSERT INTO devices(id,branch_id,secret_hash) VALUES('tablet','branch','fixture')").run();
  const owner = { id: 'owner', displayName: 'owner', branchId: 'branch', role: 'owner' as const };
  const manager = { ...owner, id: 'manager', role: 'manager' as const };
  const cashier = { ...owner, id: 'cashier', role: 'cashier' as const, deviceId: 'tablet' };
  const barista = { ...owner, id: 'barista', role: 'barista' as const, deviceId: 'tablet' };
  const business = new BusinessService(store, () => 1_800_000_000_000);
  business.createIngredient(owner, { commandId: randomUUID(), ingredientId: 'beans', name: 'Beans', unit: 'g' });
  business.receiveStock(owner, { commandId: randomUUID(), ingredientId: 'beans', quantityMilli: 1000, totalCostCentavos: 100, reference: 'fixture' });
  for (const [productId, quantityMilli] of [['small', 600], ['large', 1200]] as const) {
    business.createProduct(owner, { commandId: randomUUID(), productId, name: productId, priceCentavos: 10000,
      recipe: [{ ingredientId: 'beans', quantityMilli }] });
  }
  function sentOrder() {
    const created = business.createOrder(cashier, { commandId: randomUUID(), dineIn: true, table: '01',
      items: [{ productId: 'small', quantity: 1, note: '' }] }).order;
    return business.sendOrder(cashier, created.id, { commandId: randomUUID(), expectedVersion: created.version }).order;
  }
  function source(commandId: string) {
    return db.prepare('SELECT order_id,phase,required_milli,available_milli,shortfall_milli FROM inventory_order_shortages WHERE command_id=?').get(commandId);
  }
  return { db, owner, manager, cashier, barista, business, sentOrder, source };
}

test('a queued quantity increase links its source order to a new shortage incident', t => {
  const f = fixture(t);
  const order = f.sentOrder();
  const commandId = randomUUID();
  f.business.requestAmendment(f.cashier, order.id, { commandId, expectedVersion: order.version, operation: 'quantity', lineNo: 0,
    quantity: 2, reason: 'Customer requests another' });
  const alerts = f.business.listStockAlerts(f.owner, { status: 'active' }).alerts;
  assert.equal(alerts.filter(alert => alert.kind === 'shortage').length, 1);
  assert.deepEqual({ ...f.source(commandId) }, { order_id: order.id, phase: 'order.amendment.request',
    required_milli: 1200, available_milli: 1000, shortfall_milli: 200 });
});

test('barista acknowledgment of a preparing replacement links the increased reservation to the source order', t => {
  const f = fixture(t);
  const sent = f.sentOrder();
  const preparing = f.business.startPreparation(f.barista, sent.id, { commandId: randomUUID(), expectedVersion: sent.version }).order;
  const request = f.business.requestAmendment(f.cashier, sent.id, { commandId: randomUUID(), expectedVersion: preparing.version,
    operation: 'replace', lineNo: 0, productId: 'large', quantity: 1, note: '', reason: 'Customer changes drink' }).amendment;
  const approval = f.business.decideAmendment(f.manager, String(request.id), { commandId: randomUUID(), decision: 'approve', reason: 'Approved' }).amendment;
  const current = f.business.getOrder(f.cashier, sent.id).order;
  const commandId = randomUUID();
  f.business.acknowledgeAmendment(f.barista, sent.id, String(approval.id), { commandId, expectedVersion: current.version, note: '', used: [] });
  const alerts = f.business.listStockAlerts(f.owner, { status: 'active' }).alerts;
  assert.equal(alerts.filter(alert => alert.kind === 'shortage').length, 1);
  assert.deepEqual({ ...f.source(commandId) }, { order_id: sent.id, phase: 'order.amendment.acknowledge',
    required_milli: 1200, available_milli: 1000, shortfall_milli: 200 });
});

test('an alert cursor remains usable when its incident resolves between pages', t => {
  const f = fixture(t);
  for (let i = 0; i < 51; i++) {
    const ingredientId = `ingredient-${i}`;
    f.business.createIngredient(f.owner, { commandId: randomUUID(), ingredientId, name: ingredientId, unit: 'g' });
    f.business.setStockThreshold(f.owner, ingredientId, { commandId: randomUUID(), expectedVersion: 0, thresholdMilli: 0, reason: 'Set threshold' });
  }
  const first = f.business.listStockAlerts(f.owner, { status: 'active' });
  assert.equal(first.alerts.length, 50);
  assert.ok(first.nextCursor);
  const cursor = first.alerts.find(alert => alert.id === first.nextCursor)!;
  f.business.setStockThreshold(f.owner, cursor.ingredientId, { commandId: randomUUID(), expectedVersion: 1, thresholdMilli: null, reason: 'Disable threshold' });
  const next = f.business.listStockAlerts(f.owner, { status: 'active', before: first.nextCursor });
  assert.equal(next.alerts.length, 1);
});
