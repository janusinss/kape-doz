import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const prefix = 'PASS X03 admin receiving, recipe publication, sale, ready/waste, shortage alert, count adjustment, reporting ';
const [databasePath, logPath, ...extra] = process.argv.slice(2);
assert.ok(databasePath && logPath && !extra.length, 'Usage: check_x03_journey.ts <fixture.sqlite> <browser.log>');
const traces = readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.startsWith(prefix));
assert.equal(traces.length, 1, 'Expected one complete browser trace');
const trace = JSON.parse(traces[0]!.slice(prefix.length)) as {
  order1Id: string;
  order2Id: string;
  productId: string;
  oatId: string;
  cupId: string;
  countId: string;
};
assert.deepEqual(Object.keys(trace).sort(), ['countId', 'cupId', 'oatId', 'order1Id', 'order2Id', 'productId']);

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

  const oatReceipt = one('SELECT quantity_milli,total_cost_centavos,supplier,pack_count,pack_size_milli FROM stock_receipts WHERE branch_id=? AND ingredient_id=?', branch, trace.oatId);
  assert.deepEqual(oatReceipt, {
    quantity_milli: 2000000,
    total_cost_centavos: 24000,
    supplier: 'Oat Co',
    pack_count: 2,
    pack_size_milli: 1000000,
  });

  const cupReceipt = one('SELECT quantity_milli,total_cost_centavos,supplier,pack_count,pack_size_milli FROM stock_receipts WHERE branch_id=? AND ingredient_id=?', branch, trace.cupId);
  assert.deepEqual(cupReceipt, {
    quantity_milli: 100000,
    total_cost_centavos: 50000,
    supplier: 'Cup Co',
    pack_count: 2,
    pack_size_milli: 50000,
  });

  const product = one('SELECT version,price_centavos FROM products WHERE branch_id=? AND id=?', branch, trace.productId);
  assert.deepEqual(product, { version: 2, price_centavos: 20000 });

  const line1 = one('SELECT unit_price_centavos,recipe_version FROM order_lines WHERE branch_id=? AND order_id=? AND retired=0', branch, trace.order1Id);
  assert.deepEqual(line1, { unit_price_centavos: 22500, recipe_version: 1 });
  const bom1 = rows('SELECT ingredient_id,quantity_milli FROM order_line_recipe WHERE branch_id=? AND order_id=? ORDER BY ingredient_id', branch, trace.order1Id);
  assert.deepEqual(bom1, [
    { ingredient_id: 'beans', quantity_milli: 27000 },
    { ingredient_id: trace.cupId, quantity_milli: 1000 },
    { ingredient_id: trace.oatId, quantity_milli: 200000 },
  ]);

  const line2 = one('SELECT unit_price_centavos,recipe_version FROM order_lines WHERE branch_id=? AND order_id=? AND retired=0', branch, trace.order2Id);
  assert.deepEqual(line2, { unit_price_centavos: 20000, recipe_version: 2 });
  const bom2 = rows('SELECT ingredient_id,quantity_milli FROM order_line_recipe WHERE branch_id=? AND order_id=? ORDER BY ingredient_id', branch, trace.order2Id);
  assert.deepEqual(bom2, [
    { ingredient_id: 'beans', quantity_milli: 20000 },
    { ingredient_id: trace.oatId, quantity_milli: 150000 },
  ]);

  const oatMovements = rows('SELECT quantity_milli,quantity_after_milli,kind FROM stock_movements WHERE branch_id=? AND ingredient_id=? ORDER BY sequence', branch, trace.oatId);
  assert.deepEqual(oatMovements, [
    { quantity_milli: 2000000, quantity_after_milli: 2000000, kind: 'receipt' },
    { quantity_milli: -200000, quantity_after_milli: 1800000, kind: 'consumption' },
    { quantity_milli: -1700000, quantity_after_milli: 100000, kind: 'waste' },
    { quantity_milli: -150000, quantity_after_milli: -50000, kind: 'consumption' },
    { quantity_milli: 250000, quantity_after_milli: 200000, kind: 'count_adjustment' },
  ]);

  const count = one('SELECT id,status,observed_milli,variance_milli FROM inventory_counts WHERE branch_id=? AND id=?', branch, trace.countId);
  assert.equal(count.status, 'approved');
  assert.equal(count.observed_milli, 200000);
  assert.equal(count.variance_milli, 250000);
  const countCost = one('SELECT total_cost_centavos,reference FROM inventory_count_costs WHERE count_id=?', trace.countId);
  assert.deepEqual(countCost, { total_cost_centavos: 3000, reference: 'Matches reserve carton invoice' });

  const shortageAlerts = rows("SELECT status,resolution FROM inventory_alerts WHERE branch_id=? AND ingredient_id=? AND kind='shortage'", branch, trace.oatId);
  assert.deepEqual(shortageAlerts, [{ status: 'resolved', resolution: 'stock_recovered' }]);

  const receipts = rows('SELECT id,action,outcome FROM command_receipts WHERE branch_id=?', branch);
  for (const r of receipts) {
    assert.equal(r.outcome, 'accepted');
    assert.equal(one('SELECT COUNT(*) AS n FROM audit_events WHERE command_id=?', r.id as string).n, 1);
    assert.equal(one('SELECT COUNT(*) AS n FROM outbox WHERE command_id=?', r.id as string).n, 1);
  }

  console.log('PASS X03 SQLite reconciliation', JSON.stringify({
    order1Id: trace.order1Id,
    order2Id: trace.order2Id,
    countId: trace.countId,
    acceptedCommands: receipts.length,
    oatOnHandMilli: 200000,
  }));
} finally {
  db.close();
}
