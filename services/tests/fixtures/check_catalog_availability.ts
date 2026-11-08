import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const prefix = 'PASS catalog availability disable, same-price replacement without double charge, and barista completion ';
const [databasePath, logPath, ...extra] = process.argv.slice(2);
assert.ok(databasePath && logPath && !extra.length, 'Usage: check_catalog_availability.ts <fixture.sqlite> <browser.log>');
const traces = readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.startsWith(prefix));
assert.equal(traces.length, 1, 'Expected one complete browser trace');
const trace = JSON.parse(traces[0]!.slice(prefix.length)) as { orderId: string; pendingPaymentId: string };
assert.deepEqual(Object.keys(trace).sort(), ['orderId', 'pendingPaymentId']);

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
  assert.equal(one('SELECT MAX(version) AS version FROM schema_migrations').version, 17);
  const branch = 'transport-branch';

  const latte = one('SELECT available,availability_version,version FROM products WHERE branch_id=? AND id=?', branch, 'fixture-latte');
  assert.deepEqual(latte, { available: 0, availability_version: 2, version: 1 });
  const americano = one('SELECT available,availability_version,version,price_centavos FROM products WHERE branch_id=? AND id=?', branch, 'fixture-americano');
  assert.deepEqual(americano, { available: 1, availability_version: 1, version: 1, price_centavos: 16500 });

  const availEvents = rows('SELECT product_id,version,old_available,new_available,reason,actor_id FROM product_availability_events WHERE branch_id=? ORDER BY version', branch);
  assert.deepEqual(availEvents, [
    { product_id: 'fixture-latte', version: 2, old_available: 1, new_available: 0, reason: 'Synthetic steamed milk outage', actor_id: 'transport-manager' },
  ]);

  const order = one('SELECT * FROM orders WHERE branch_id=? AND id=?', branch, trace.orderId);
  assert.ok(order.released_at !== null && order.ready_at !== null && order.cancelled_at === null);
  assert.equal(order.total_centavos, 16500);

  const lines = rows('SELECT line_no,product_id,quantity,unit_price_centavos,note,retired FROM order_lines WHERE branch_id=? AND order_id=? ORDER BY line_no', branch, trace.orderId);
  assert.deepEqual(lines, [
    { line_no: 0, product_id: 'fixture-latte', quantity: 1, unit_price_centavos: 16500, note: 'Extra hot, availability rehearsal', retired: 1 },
    { line_no: 1, product_id: 'fixture-americano', quantity: 1, unit_price_centavos: 16500, note: 'Extra hot, availability rehearsal', retired: 0 },
  ]);

  const replacements = rows('SELECT old_line_no,new_line_no,reason,actor_id FROM unreleased_order_replacements WHERE branch_id=? AND order_id=?', branch, trace.orderId);
  assert.deepEqual(replacements, [
    { old_line_no: 0, new_line_no: 1, reason: 'Customer selected Americano at same price', actor_id: 'transport-cashier' },
  ]);

  const payments = rows('SELECT id,method,amount_centavos,status,reference FROM payments WHERE branch_id=? AND order_id=? ORDER BY accepted_at,id', branch, trace.orderId);
  assert.equal(payments.length, 2);
  assert.deepEqual(payments.map(p => [p.method, p.amount_centavos, p.status, p.reference]), [
    ['cash', 10000, 'confirmed', null],
    ['gcash', 6500, 'confirmed', 'SYNTHETIC-AVAILABILITY-GCASH'],
  ]);
  assert.equal(payments[1]!.id, trace.pendingPaymentId);

  const settlements = rows('SELECT total_centavos,discount_centavos FROM order_settlements WHERE branch_id=? AND order_id=?', branch, trace.orderId);
  assert.deepEqual(settlements, [{ total_centavos: 16500, discount_centavos: 0 }]);

  const movements = rows("SELECT quantity_milli,quantity_after_milli,kind,order_id FROM stock_movements WHERE branch_id=? AND ingredient_id='beans' ORDER BY sequence", branch);
  assert.deepEqual(movements, [
    { quantity_milli: 1000000, quantity_after_milli: 1000000, kind: 'receipt', order_id: null },
    { quantity_milli: -18000, quantity_after_milli: 982000, kind: 'consumption', order_id: trace.orderId },
  ]);
  assert.equal(one("SELECT COALESCE(SUM(quantity_milli),0) AS reserved FROM reservations WHERE branch_id=? AND consumed=0 AND released=0", branch).reserved, 0);

  const shift = one('SELECT id,status,opening_cash_centavos,counted_cash_centavos FROM shifts WHERE branch_id=?', branch);
  assert.deepEqual([shift.status, shift.opening_cash_centavos, shift.counted_cash_centavos], ['closed', 100000, 110000]);
  assert.equal(one('SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM cash_movements WHERE branch_id=? AND shift_id=?', branch, shift.id as string).amount, 10000);

  assert.deepEqual(rows('SELECT type,status FROM print_jobs WHERE branch_id=? AND order_id=?', branch, trace.orderId), [{ type: 'label', status: 'unconfigured' }]);

  const receipts = rows('SELECT id,action,outcome FROM command_receipts WHERE branch_id=?', branch);
  for (const receipt of receipts) {
    assert.equal(receipt.outcome, 'accepted');
    assert.equal(one('SELECT COUNT(*) AS n FROM audit_events WHERE command_id=?', receipt.id as string).n, 1);
    assert.equal(one('SELECT COUNT(*) AS n FROM outbox WHERE command_id=?', receipt.id as string).n, 1);
  }

  console.log('PASS catalog availability SQLite reconciliation', JSON.stringify({
    orderId: trace.orderId,
    acceptedCommands: receipts.length,
    settledCentavos: 16500,
    closingCashCentavos: 110000,
    varianceCentavos: 0,
    beansOnHandMilli: 982000,
  }));
} finally {
  db.close();
}
