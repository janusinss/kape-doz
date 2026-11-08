import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { estimateRemovalCost, postStockValue } from '../src/inventory_valuation.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ingredient_valuation_balances (
      branch_id TEXT NOT NULL, ingredient_id TEXT NOT NULL, carrying_microcentavos INTEGER,
      PRIMARY KEY(branch_id,ingredient_id)
    ) STRICT;
    CREATE TABLE stock_movement_valuations (movement_id TEXT PRIMARY KEY,value_microcentavos INTEGER) STRICT;`);
  const base = { branchId: 'branch-a', ingredientId: 'beans' };
  function move(movementId: string, quantityBeforeMilli: number, deltaMilli: number, receiptCostCentavos?: number) {
    postStockValue(db, { ...base, movementId, quantityBeforeMilli, deltaMilli, receiptCostCentavos });
  }
  const estimate = (onHandMilli: number, quantityMilli: number) => estimateRemovalCost(db, base.branchId, base.ingredientId, onHandMilli, quantityMilli);
  function posted(id: string) {
    const statement = db.prepare('SELECT value_microcentavos FROM stock_movement_valuations WHERE movement_id=?');
    statement.setReadBigInts(true);
    return statement.get(id)?.value_microcentavos;
  }
  return { db, move, estimate, posted };
}

test('valuation weights receipts and conserves exact carrying value through depletion', (t) => {
  const f = setup();
  t.after(() => f.db.close());
  f.move('first', 0, 1_000_000, 80000);
  f.move('second', 1_000_000, 1_000_000, 100000);
  assert.equal(f.estimate(2_000_000, 18000), 1_620_000_000n);
  f.move('ready', 2_000_000, -18000);
  assert.equal(f.posted('ready'), 1_620_000_000n);
  f.move('deplete', 1_982_000, -1_982_000);
  assert.equal(f.posted('deplete'), 178_380_000_000n);
  f.move('odd-value', 0, 3000, 1);
  f.move('partial', 3000, -1000);
  f.move('residue', 2000, -2000);
  assert.equal(f.posted('partial'), 333333n);
  assert.equal(f.posted('residue'), 666667n);
});

test('valuation leaves legacy and short stock unknown until an exact-zero balance resets the anchor', (t) => {
  const f = setup();
  t.after(() => f.db.close());
  assert.equal(f.estimate(5000, 1000), null);
  f.move('legacy-receipt', 5000, 1000, 80);
  assert.equal(f.posted('legacy-receipt'), 80_000_000n);
  assert.equal(f.estimate(6000, 1000), null);
  f.move('legacy-depletion', 6000, -6000);
  assert.equal(f.posted('legacy-depletion'), null);
  f.move('priced', 0, 1000, 100);
  assert.equal(f.estimate(1000, 2000), null);
  f.move('short', 1000, -2000);
  assert.equal(f.posted('short'), null);
  f.move('negative-crossing', -1000, 3000, 400);
  assert.equal(f.posted('negative-crossing'), 400_000_000n);
  assert.equal(f.estimate(2000, 1000), null);
  f.move('clear', 2000, -2000);
  f.move('new-anchor', 0, 1000, 50);
  assert.equal(f.estimate(1000, 1000), 50_000_000n);
  assert.equal(f.posted('short'), null, 'future receipts cannot rewrite old unresolved costs');
});

test('valuation rejects a carrying balance above SQLite integer range before writing', (t) => {
  const f = setup();
  t.after(() => f.db.close());
  const limit = (1n << 63n) - 1n;
  f.db.prepare('INSERT INTO ingredient_valuation_balances VALUES(?,?,?)').run('branch-a', 'beans', limit);
  assert.throws(() => f.move('over-limit', 1000, 1000, 1), { status: 400, code: 'invalid_request' });
  assert.equal(f.posted('over-limit'), undefined);
  assert.equal(f.estimate(1000, 1000), limit);
});
