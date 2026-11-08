import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const prefix = 'PASS X04 customer enrollment, approved online redemption, offline earning, reconnect sync, partial refund, point reconciliation ';
const [databasePath, logPath, ...extra] = process.argv.slice(2);
assert.ok(databasePath && logPath && !extra.length, 'Usage: check_x04_journey.ts <fixture.sqlite> <browser.log>');
const traces = readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.startsWith(prefix));
assert.equal(traces.length, 1, 'Expected one complete browser trace');
const trace = JSON.parse(traces[0]!.slice(prefix.length)) as {
  customerId: string;
  order1Id: string;
  order2Id: string;
  order3Id: string;
  redemptionId: string;
  refundId: string;
  refundCaseId: string;
  productId: string;
};
assert.deepEqual(Object.keys(trace).sort(), [
  'customerId',
  'order1Id',
  'order2Id',
  'order3Id',
  'productId',
  'redemptionId',
  'refundCaseId',
  'refundId',
]);

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const rows = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).all(...args).map(row => ({ ...row }));
  const one = (sql: string, ...args: SQLInputValue[]) => {
    const items = rows(sql, ...args);
    assert.equal(items.length, 1, `Expected one row for ${sql}`);
    return items[0]!;
  };
  assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok');
  assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
  assert.equal(one('SELECT MAX(version) AS version FROM schema_migrations').version, 20);
  const branch = 'transport-branch';

  const customer = one('SELECT display_name,phone FROM customers WHERE branch_id=? AND id=?', branch, trace.customerId);
  assert.deepEqual(customer, {
    display_name: 'Maria Clara',
    phone: '09171234567',
  });

  const order1 = one('SELECT customer_id,total_centavos,redeemed_points,loyalty_redemption_centavos FROM orders WHERE branch_id=? AND id=?', branch, trace.order1Id);
  assert.deepEqual(order1, {
    customer_id: trace.customerId,
    total_centavos: 20000,
    redeemed_points: 0,
    loyalty_redemption_centavos: 0,
  });

  const order2 = one('SELECT customer_id,total_centavos,redeemed_points,loyalty_redemption_centavos FROM orders WHERE branch_id=? AND id=?', branch, trace.order2Id);
  assert.deepEqual(order2, {
    customer_id: trace.customerId,
    total_centavos: 19900,
    redeemed_points: 1,
    loyalty_redemption_centavos: 100,
  });

  const redemption = one('SELECT decision,cloud_status,requested_points,discount_centavos FROM loyalty_redemptions WHERE branch_id=? AND id=?', branch, trace.redemptionId);
  assert.deepEqual(redemption, {
    decision: 'approve',
    cloud_status: 'applied',
    requested_points: 1,
    discount_centavos: 100,
  });

  const order3 = one('SELECT customer_id,total_centavos,redeemed_points,loyalty_redemption_centavos FROM orders WHERE branch_id=? AND id=?', branch, trace.order3Id);
  assert.deepEqual(order3, {
    customer_id: trace.customerId,
    total_centavos: 20000,
    redeemed_points: 0,
    loyalty_redemption_centavos: 0,
  });

  const refundCase = one('SELECT refund_id,order_id,customer_id,reversed_earned_points,restored_redeemed_points,status FROM loyalty_refund_cases WHERE branch_id=? AND id=?', branch, trace.refundCaseId);
  assert.deepEqual(refundCase, {
    refund_id: trace.refundId,
    order_id: trace.order3Id,
    customer_id: trace.customerId,
    reversed_earned_points: 1,
    restored_redeemed_points: 0,
    status: 'resolved',
  });

  const ledger = rows('SELECT kind,points_delta,status,order_id,redemption_id,refund_case_id FROM loyalty_ledger WHERE branch_id=? AND customer_id=? ORDER BY sequence', branch, trace.customerId);
  assert.deepEqual(ledger, [
    { kind: 'earn', points_delta: 2, status: 'available', order_id: trace.order1Id, redemption_id: null, refund_case_id: null },
    { kind: 'redeem', points_delta: -1, status: 'available', order_id: trace.order2Id, redemption_id: trace.redemptionId, refund_case_id: null },
    { kind: 'earn', points_delta: 1, status: 'available', order_id: trace.order2Id, redemption_id: null, refund_case_id: null },
    { kind: 'earn', points_delta: 2, status: 'available', order_id: trace.order3Id, redemption_id: null, refund_case_id: null },
    { kind: 'refund_reversal', points_delta: -1, status: 'available', order_id: trace.order3Id, redemption_id: null, refund_case_id: trace.refundCaseId },
  ]);

  const availablePoints = Number(one(`SELECT COALESCE(SUM(points_delta),0) AS pts FROM loyalty_ledger WHERE branch_id=? AND customer_id=? AND status='available'`, branch, trace.customerId).pts);
  const pendingPoints = Number(one(`SELECT COALESCE(SUM(points_delta),0) AS pts FROM loyalty_ledger WHERE branch_id=? AND customer_id=? AND status='pending'`, branch, trace.customerId).pts);
  assert.equal(availablePoints, 3);
  assert.equal(pendingPoints, 0);

  const receipts = rows('SELECT id,action,outcome FROM command_receipts WHERE branch_id=?', branch);
  for (const r of receipts) {
    assert.equal(r.outcome, 'accepted');
    assert.equal(one('SELECT COUNT(*) AS n FROM audit_events WHERE command_id=?', r.id as string).n, 1);
    assert.equal(one('SELECT COUNT(*) AS n FROM outbox WHERE command_id=?', r.id as string).n, 1);
  }

  console.log('PASS X04 SQLite reconciliation', JSON.stringify({
    customerId: trace.customerId,
    availablePoints,
    pendingPoints,
    acceptedCommands: receipts.length,
    ledgerEntries: ledger.length,
  }));
} finally {
  db.close();
}
