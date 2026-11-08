import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createHub } from '../src/hub.js';

// Run explicitly with tsx --test tests/refund-scale.ts. The fixture represents
// 90,072 completed, fully returned sales using each supported tender ceiling.
test('cash payout and blind review retain exact net cash above safe-integer gross turnover', async (t) => {
  const root = resolve(tmpdir());
  const folder = await mkdtemp(join(root, 'kape-doz-refund-scale-'));
  const path = join(folder, 'hub.sqlite');
  const time = Date.UTC(2026, 10, 5, 8);
  const hub = await createHub({ databasePath: path, now: () => time });
  const inspector = new DatabaseSync(path);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), root);
    assert.ok(target.startsWith(join(root, 'kape-doz-refund-scale-')));
    await rm(target, { recursive: true, force: true });
  });
  const password = 'Scale-Refund-Fixture-Password!';
  const secret = 'Scale-Refund-Fixture-Device-Secret-2026!';
  for (const [id, role] of [['owner', 'owner'], ['manager', 'manager'], ['cashier', 'cashier']] as const) {
    await hub.provisionAccount({ id, branchId: 'branch', displayName: id, role, secret: role === 'cashier' ? '4826' : password });
  }
  await hub.provisionDevice({ id: 'tablet', branchId: 'branch', secret });
  const ownerLogin = await hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner', password } });
  const managerLogin = await hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'manager', password } });
  const cashierLogin = await hub.app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { accountId: 'cashier', pin: '4826', deviceId: 'tablet', deviceSecret: secret } });
  assert.equal(ownerLogin.statusCode, 200, ownerLogin.body);
  assert.equal(managerLogin.statusCode, 200, managerLogin.body);
  assert.equal(cashierLogin.statusCode, 200, cashierLogin.body);
  const owner = ownerLogin.json<{ token: string }>().token;
  const manager = managerLogin.json<{ token: string }>().token;
  const cashier = cashierLogin.json<{ token: string }>().token;
  async function post<T>(token: string, url: string, payload: Record<string, unknown>, commandId = randomUUID()) {
    const response = await hub.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { commandId, ...payload } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<T>();
  }
  await post(owner, '/api/v1/ingredients', { ingredientId: 'beans', name: 'Scale beans', unit: 'g' });
  await post(owner, '/api/v1/products', { productId: 'latte', name: 'Scale latte', priceCentavos: 16_500, recipe: [{ ingredientId: 'beans', quantityMilli: 18_000 }] });
  await post(owner, '/api/v1/drawers', { drawerId: 'drawer', name: 'Scale drawer', deviceIds: ['tablet'] });
  const { shift } = await post<{ shift: { id: string } }>(cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000 });
  const { order } = await post<{ order: { id: string; version: number } }>(cashier, '/api/v1/orders', { dineIn: false, items: [{ productId: 'latte', quantity: 1 }] });
  const paid = await post<{ order: { version: number }; payment: { id: string } }>(cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'cash', amountCentavos: 16_500, cashReceivedCentavos: 16_500, verified: true,
  });
  const requested = await post<{ refund: { id: string } }>(cashier, `/api/v1/orders/${order.id}/refunds`, { expectedVersion: paid.order.version, amountCentavos: 6_000, lineNumbers: [0], reason: 'Scale fixture actual payout' });
  const approved = await post<{ refund: { legs: { id: string; version: number }[] } }>(manager, `/api/v1/refunds/${requested.refund.id}/decision`, { decision: 'approve', allocations: [{ paymentId: paid.payment.id, amountCentavos: 6_000 }] });

  inspector.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  try {
    inspector.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072),
      actions(tag,action) AS (VALUES('pay','order.payment'),('request','refund.request'),('approve','refund.decide'),('return','refund.leg.record_cash'))
      INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id)
      SELECT 'scale-'||tag||'-'||n,CASE WHEN tag='approve' THEN 'manager' ELSE 'cashier' END,'branch',action,
        'scale-'||tag||'-'||n,'{}',?,CASE WHEN tag='approve' THEN NULL ELSE 'tablet' END FROM sequence CROSS JOIN actions`).run(time);
    inspector.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,released_at,total_centavos)
      SELECT 'scale-order-'||n,'branch',n+1,4,0,'','after_payment',?,?,100000000000 FROM sequence`).run(time, time);
    inspector.exec(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO order_lines(branch_id,order_id,line_no,product_id,name,quantity,unit_price_centavos,note)
      SELECT 'branch','scale-order-'||n,0,'latte','Synthetic turnover latte',1,100000000000,'' FROM sequence`);
    inspector.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO payments(id,branch_id,order_id,method,amount_centavos,status,cash_received_centavos,change_centavos,accepted_at,command_id)
      SELECT 'scale-payment-'||n,'branch','scale-order-'||n,'cash',100000000000,'confirmed',100000000000,0,?,'scale-pay-'||n FROM sequence`).run(time);
    inspector.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO cash_movements(id,branch_id,shift_id,payment_id,actor_id,device_id,amount_centavos,command_id)
      SELECT 'scale-cash-'||n,'branch',?,'scale-payment-'||n,'cashier','tablet',100000000000,'scale-pay-'||n FROM sequence`).run(shift.id);
    inspector.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO order_settlements(branch_id,order_id,settled_at,business_date,total_centavos,command_id)
      SELECT 'branch','scale-order-'||n,?,'2026-11-05',100000000000,'scale-pay-'||n FROM sequence`).run(time);
    inspector.exec(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO settlement_payment_links(payment_id,branch_id,order_id)
      SELECT 'scale-payment-'||n,'branch','scale-order-'||n FROM sequence`);
    inspector.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO refund_requests(id,branch_id,order_id,order_version,amount_centavos,reason,requester_id,requester_device_id,requested_at,
        request_command_id,decision,reviewer_id,decided_at,decision_command_id)
      SELECT 'scale-refund-'||n,'branch','scale-order-'||n,2,100000000000,'Synthetic completed turnover','cashier','tablet',?,
        'scale-request-'||n,'approve','manager',?,'scale-approve-'||n FROM sequence`).run(time, time);
    inspector.exec(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO refund_lines(branch_id,order_id,refund_id,line_no,name,quantity,unit_price_centavos)
      SELECT 'branch','scale-order-'||n,'scale-refund-'||n,0,'Synthetic turnover latte',1,100000000000 FROM sequence`);
    inspector.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO refund_legs(id,branch_id,order_id,refund_id,payment_id,amount_centavos,version,status,revenue_centavos,completed_at,completion_command_id)
      SELECT 'scale-leg-'||n,'branch','scale-order-'||n,'scale-refund-'||n,'scale-payment-'||n,100000000000,2,'completed',100000000000,?,'scale-return-'||n FROM sequence`).run(time);
    inspector.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<90072)
      INSERT INTO refund_cash_movements(id,branch_id,shift_id,leg_id,actor_id,device_id,amount_centavos,command_id)
      SELECT 'scale-return-cash-'||n,'branch',?,'scale-leg-'||n,'cashier','tablet',100000000000,'scale-return-'||n FROM sequence`).run(shift.id);
    inspector.exec('COMMIT');
  } catch (error) { inspector.exec('ROLLBACK'); throw error; }
  assert.deepEqual(inspector.prepare('PRAGMA foreign_key_check').all(), []);
  const total = inspector.prepare('SELECT SUM(amount_centavos) AS amount FROM cash_movements');
  total.setReadBigInts(true);
  assert.equal(total.get()!.amount, 9_007_200_000_016_500n);
  const leg = approved.refund.legs[0]!;
  await post(cashier, `/api/v1/refunds/${requested.refund.id}/legs/${leg.id}`, { expectedVersion: leg.version, action: 'record_cash' });
  const current = await hub.app.inject({ method: 'GET', url: '/api/v1/shifts/current', headers: { authorization: `Bearer ${cashier}` } });
  assert.equal(current.statusCode, 200, current.body);
  const currentShift = current.json<{ shift: { id: string; version: number } }>().shift;
  const counted = await post<{ shift: { version: number } }>(cashier, `/api/v1/shifts/${shift.id}/submit-count`, { expectedVersion: currentShift.version, countedCashCentavos: 110_500, note: 'Exact net after high turnover' });
  const listed = await hub.app.inject({ method: 'GET', url: '/api/v1/admin/shifts', headers: { authorization: `Bearer ${manager}` } });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json<{ shifts: { expectedCashCentavos: number }[] }>().shifts[0]!.expectedCashCentavos, 110_500);
  const reviewed = await post<{ expectedCashCentavos: number; varianceCentavos: number }>(manager, `/api/v1/shifts/${shift.id}/review`, { expectedVersion: counted.shift.version, decision: 'approve' });
  assert.equal(reviewed.expectedCashCentavos, 110_500);
  assert.equal(reviewed.varianceCentavos, 0);
});
