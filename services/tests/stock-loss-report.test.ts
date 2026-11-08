import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { HubDatabase } from '../src/database.js';
import { BusinessService } from '../src/business.js';

function fixture(t: TestContext, quantityMilli = 1_000_000, cost = 80_000) {
  const store = new HubDatabase(':memory:');
  t.after(() => store.close());
  const db = store.connection;
  let time = Date.parse('2026-11-06T12:00:00+08:00');
  for (const branchId of ['count-a', 'count-b']) {
    db.prepare('INSERT INTO branches(id) VALUES(?)').run(branchId);
    db.prepare("INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,'Fixture owner','owner','fixture-hash')")
      .run('owner-' + branchId, branchId);
  }
  const actor = { id: 'owner-count-a', branchId: 'count-a', role: 'owner' as const, displayName: 'Fixture owner' };
  const business = new BusinessService(store, () => time);
  business.createIngredient(actor, { commandId: randomUUID(), ingredientId: 'beans', name: 'Beans', unit: 'g' });
  business.receiveStock(actor, { commandId: randomUUID(), ingredientId: 'beans', quantityMilli, totalCostCentavos: cost, reference: 'Synthetic stock' });
  const period = { from: '2026-11-06', through: '2026-11-06' };
  business.confirmExpenseCoverage(actor, { commandId: randomUUID(), ...period });
  function count(observedMilli: number) {
    const opened = business.startStockCount(actor, { commandId: randomUUID(), ingredientId: 'beans' }).count;
    const submitted = business.observeStockCount(actor, String(opened.id), {
      commandId: randomUUID(), expectedVersion: Number(opened.version), unit: 'g', observedMilli,
    }).count;
    const command = { commandId: randomUUID(), expectedVersion: Number(submitted.version), decision: 'approve' as const, reason: 'Synthetic count evidence' };
    const result = business.decideStockCount(actor, String(submitted.id), command);
    return { ...result, command };
  }
  return { store, db, business, actor, period, count, report: () => business.listSales(actor, period), setTime: (value: string) => { time = Date.parse(value); } };
}

test('count shortage is deducted once as a separate period stock loss and a found gain does not create income', (t) => {
  const f = fixture(t);
  f.business.recordExpense(f.actor, { commandId: randomUUID(), category: 'Supplies', description: 'Synthetic supplies', amountCentavos: 101,
    startsOn: f.period.from, endsOn: f.period.through });
  f.business.confirmExpenseCoverage(f.actor, { commandId: randomUUID(), ...f.period });
  const approved = f.count(900_000);
  const report = f.report() as Record<string, unknown>;
  assert.equal(report.stockLossCostCentavos, 8_000);
  assert.equal(report.stockLossEntriesWithUnknownCost, 0);
  assert.equal(report.finalIngredientCostCentavos, 0);
  assert.equal(report.wasteCostCentavos, 0);
  assert.equal(report.estimatedGrossProfitCentavos, 0);
  assert.equal(report.estimatedOperatingProfitCentavos, -8_101);
  assert.deepEqual(f.business.decideStockCount(f.actor, String(approved.count.id), approved.command), { count: approved.count, commandId: approved.commandId });
  assert.equal((f.report() as Record<string, unknown>).stockLossCostCentavos, 8_000);
  const gain = f.count(950_000).count;
  f.business.confirmStockCountCost(f.actor, String(gain.id), { commandId: randomUUID(), expectedVersion: Number(gain.version), totalCostCentavos: 4_000, reference: 'Synthetic extra beans' });
  assert.equal((f.report() as Record<string, unknown>).estimatedOperatingProfitCentavos, -8_101);
  f.setTime('2026-11-07T00:00:00+08:00');
  f.count(940_000);
  assert.equal((f.report() as Record<string, unknown>).stockLossCostCentavos, 8_000, 'next Manila date is outside the report');
  const other = { ...f.actor, id: 'owner-count-b', branchId: 'count-b' };
  assert.equal((f.business.listSales(other, f.period) as Record<string, unknown>).stockLossCostCentavos, 0);
});

test('unknown count loss blocks the operating estimate after prospective cost confirmation', (t) => {
  const f = fixture(t);
  const gain = f.count(1_050_000).count;
  f.count(1_040_000);
  const before = f.report() as Record<string, unknown>;
  assert.equal(before.stockLossCostCentavos, 0);
  assert.equal(before.stockLossEntriesWithUnknownCost, 1);
  assert.equal(before.estimatedGrossProfitCentavos, 0);
  assert.equal(before.estimatedOperatingProfitCentavos, null);
  const confirmed = f.business.confirmStockCountCost(f.actor, String(gain.id), {
    commandId: randomUUID(), expectedVersion: Number(gain.version), totalCostCentavos: 4_000, reference: 'Synthetic gain evidence',
  }).count;
  assert.equal(confirmed.canRevalue, true);
  f.business.revalueStockCount(f.actor, String(gain.id), {
    commandId: randomUUID(), expectedVersion: Number(confirmed.version), expectedStockVersion: Number(confirmed.liveStockVersion),
    totalCostCentavos: 83_200, reference: 'Synthetic all-stock evidence',
  });
  assert.equal((f.report() as Record<string, unknown>).stockLossEntriesWithUnknownCost, 1);
  assert.equal((f.report() as Record<string, unknown>).estimatedOperatingProfitCentavos, null);
});

test('stock losses sum microcentavo values before rounding the period total', (t) => {
  const f = fixture(t, 1_000, 1);
  f.count(667);
  f.count(334);
  const report = f.report() as Record<string, unknown>;
  assert.equal(report.stockLossCostCentavos, 1);
  assert.equal(report.estimatedOperatingProfitCentavos, -1);
});
