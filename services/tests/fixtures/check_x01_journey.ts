import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const prefix = 'PASS X01 owner setup, staff PIN, drawer open, dine-in send, barista ready, split settlement, optional receipt, cashier count, manager close ';
const [databasePath, logPath, ...extra] = process.argv.slice(2);
assert.ok(databasePath && logPath && !extra.length, 'Usage: check_x01_journey.ts <fixture.sqlite> <browser.log>');
const traces = readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.startsWith(prefix));
assert.equal(traces.length, 1, 'Expected one complete browser trace');
const trace = JSON.parse(traces[0]!.slice(prefix.length)) as {
  orderId: string;
  shiftId: string;
  productId: string;
  ingredientId: string;
  cashPaymentId: string;
  gcashPaymentId: string;
};
assert.deepEqual(Object.keys(trace).sort(), ['cashPaymentId', 'gcashPaymentId', 'ingredientId', 'orderId', 'productId', 'shiftId']);

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

  const receipt = one('SELECT quantity_milli,total_cost_centavos,supplier,pack_count,pack_size_milli,reference FROM stock_receipts WHERE branch_id=? AND ingredient_id=?', branch, trace.ingredientId);
  assert.deepEqual(receipt, {
    quantity_milli: 2000000,
    total_cost_centavos: 24000,
    supplier: 'Oat Co',
    pack_count: 2,
    pack_size_milli: 1000000,
    reference: 'SYNTHETIC-X01-RECEIPT',
  });

  const order = one('SELECT * FROM orders WHERE branch_id=? AND id=?', branch, trace.orderId);
  assert.equal(order.dine_in, 1);
  assert.ok(order.released_at !== null && order.ready_at !== null && order.cancelled_at === null);
  assert.equal(order.total_centavos, 17500);

  const line = one('SELECT line_no,product_id,quantity,unit_price_centavos,note,recipe_version FROM order_lines WHERE branch_id=? AND order_id=? AND retired=0', branch, trace.orderId);
  assert.deepEqual(line, {
    line_no: 0,
    product_id: trace.productId,
    quantity: 1,
    unit_price_centavos: 17500,
    note: 'X01 dine-in table 08',
    recipe_version: 1,
  });

  const payments = rows('SELECT id,method,amount_centavos,cash_received_centavos,change_centavos,status,reference FROM payments WHERE branch_id=? AND order_id=? ORDER BY accepted_at,id', branch, trace.orderId);
  assert.deepEqual(payments, [
    { id: trace.cashPaymentId, method: 'cash', amount_centavos: 10000, cash_received_centavos: 10000, change_centavos: 0, status: 'confirmed', reference: null },
    { id: trace.gcashPaymentId, method: 'gcash', amount_centavos: 7500, cash_received_centavos: null, change_centavos: null, status: 'confirmed', reference: 'SYNTHETIC-X01-GCASH' },
  ]);

  const settlements = rows('SELECT total_centavos,discount_centavos FROM order_settlements WHERE branch_id=? AND order_id=?', branch, trace.orderId);
  assert.deepEqual(settlements, [{ total_centavos: 17500, discount_centavos: 0 }]);

  const movements = rows('SELECT quantity_milli,quantity_after_milli,kind,order_id FROM stock_movements WHERE branch_id=? AND ingredient_id=? ORDER BY sequence', branch, trace.ingredientId);
  assert.deepEqual(movements, [
    { quantity_milli: 2000000, quantity_after_milli: 2000000, kind: 'receipt', order_id: null },
    { quantity_milli: -150000, quantity_after_milli: 1850000, kind: 'consumption', order_id: trace.orderId },
  ]);
  assert.equal(one('SELECT COALESCE(SUM(quantity_milli),0) AS reserved FROM reservations WHERE branch_id=? AND consumed=0 AND released=0', branch).reserved, 0);

  const printJobs = rows('SELECT type,status FROM print_jobs WHERE branch_id=? AND order_id=? ORDER BY id', branch, trace.orderId);
  assert.equal(printJobs.filter(j => j.type === 'receipt').length, 1);
  assert.equal(printJobs.filter(j => j.type === 'label').length, 1);

  const shift = one('SELECT id,status,opening_cash_centavos,counted_cash_centavos FROM shifts WHERE branch_id=? AND id=?', branch, trace.shiftId);
  assert.deepEqual([shift.status, shift.opening_cash_centavos, shift.counted_cash_centavos], ['closed', 100000, 110000]);
  assert.equal(one('SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM cash_movements WHERE branch_id=? AND shift_id=?', branch, trace.shiftId).amount, 10000);

  const receipts = rows('SELECT id,action,outcome FROM command_receipts WHERE branch_id=?', branch);
  for (const r of receipts) {
    assert.equal(r.outcome, 'accepted');
    assert.equal(one('SELECT COUNT(*) AS n FROM audit_events WHERE command_id=?', r.id as string).n, 1);
    assert.equal(one('SELECT COUNT(*) AS n FROM outbox WHERE command_id=?', r.id as string).n, 1);
  }

  console.log('PASS X01 SQLite reconciliation', JSON.stringify({
    orderId: trace.orderId,
    shiftId: trace.shiftId,
    acceptedCommands: receipts.length,
    settledCentavos: 17500,
    closingCashCentavos: 110000,
    varianceCentavos: 0,
    oatOnHandMilli: 1850000,
  }));
} finally {
  db.close();
}
