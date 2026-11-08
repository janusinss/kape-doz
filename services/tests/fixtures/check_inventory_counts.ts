import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { salesReport } from '../../src/sales_report.js';

const prefix = 'PASS F04-03 admin count, conflict, preserved movement, pending-cost recovery, prospective revaluation and closure ';
const countNames = ['staleCount', 'negativeCount', 'positiveCount'] as const;
const commandNames = [
  'openShift', 'staleCount', 'staleWaste', 'staleReceipt', 'staleObserve', 'discard', 'negativeCount',
  'firstCreate', 'firstSend', 'firstPay', 'negativeObserve', 'firstReady', 'concurrentReceipt', 'negativeApprove',
  'positiveCount', 'positiveObserve', 'positiveApprove', 'unknownCreate', 'unknownSend', 'unknownPay',
  'unknownReady', 'unknownWaste', 'confirmCost', 'beforeRevalue', 'staleRevalue', 'revalue',
  'knownCreate', 'knownSend', 'knownPay', 'knownReady', 'countShift', 'closeShift',
] as const;
const branchId = 'transport-branch';
const manager = 'transport-manager';
const cashier = 'transport-cashier';
const barista = 'transport-barista';
const cashierDevice = 'transport-cashier-tablet';
const baristaDevice = 'transport-barista-tablet';
type Row = Record<string, unknown>;
type CommandName = typeof commandNames[number];

function object(value: unknown): Row {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected a trace object');
  return value as Row;
}

function uuid(value: unknown): string {
  assert.equal(typeof value, 'string', 'Expected a trace UUID');
  assert.match(String(value), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return String(value);
}

function namedIds<K extends string>(source: unknown, names: readonly K[]): Record<K, string> {
  const entries = object(source);
  assert.deepEqual(Object.keys(entries).sort(), [...names].sort(), 'Trace keys must match the completed rehearsal');
  return Object.fromEntries(names.map(name => [name, uuid(entries[name])])) as Record<K, string>;
}

function parseTrace(path: string) {
  const matches = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.startsWith(prefix));
  assert.equal(matches.length, 1, 'Expected exactly one final F04-03 PASS JSON trace');
  const value = object(JSON.parse(matches[0]!.slice(prefix.length)));
  assert.deepEqual(Object.keys(value).sort(), ['commands', 'countIds', 'orderIds', 'shiftId']);
  const counts = namedIds(value.countIds, countNames);
  const commands = namedIds(value.commands, commandNames);
  assert.ok(Array.isArray(value.orderIds) && value.orderIds.length === 3, 'Expected three traced orders');
  const orders = value.orderIds.map(uuid) as [string, string, string];
  const shiftId = uuid(value.shiftId);
  const all = [...Object.values(counts), ...Object.values(commands), ...orders, shiftId];
  assert.equal(new Set(all).size, all.length, 'Trace identities must be distinct');
  return { counts, commands, orders, shiftId };
}

function audit(path: string, trace: ReturnType<typeof parseTrace>) {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = (sql: string, ...parameters: SQLInputValue[]) => db.prepare(sql).all(...parameters).map(row => ({ ...row }));
  const row = (sql: string, ...parameters: SQLInputValue[]) => {
    const result = rows(sql, ...parameters);
    assert.equal(result.length, 1, `Expected one row for ${sql}`);
    return result[0]!;
  };
  const { counts, commands: cmd, orders, shiftId } = trace;
  const [first, unknown, known] = orders;
  const receipts = new Map<CommandName, Row>();
  const bindings = new Map<CommandName, { action: string; actor: string; target: string; input: Row }>();
  function bind(key: CommandName, action: string, actor: string, target: string, input: Row) {
    bindings.set(key, { action, actor, target, input: { commandId: cmd[key], ...input } });
  }
  const receive = (key: CommandName, quantityMilli: number, totalCostCentavos: number) => bind(key, 'inventory.receive', manager, 'beans', {
    ingredientId: 'beans', quantityMilli, totalCostCentavos, reference: 'Synthetic stock count rehearsal ' + key,
  });
  const waste = (key: CommandName, quantityMilli: number) => bind(key, 'inventory.waste', barista, 'beans', {
    ingredientId: 'beans', quantityMilli, reason: 'Synthetic inventory rehearsal', note: key,
  });
  function orderBindings(key: 'first' | 'unknown' | 'known', id: string) {
    bind(`${key}Create`, 'order.create', cashier, '', { dineIn: true, table: 'T1', items: [{ productId: 'fixture-latte', quantity: 1, note: 'Synthetic count rehearsal' }] });
    bind(`${key}Send`, 'order.send', cashier, id, { expectedVersion: 1 });
    bind(`${key}Pay`, 'order.payment', cashier, id, { expectedVersion: 2, method: 'cash', amountCentavos: 16_500, verified: true, cashReceivedCentavos: 20_000 });
    bind(`${key}Ready`, 'order.ready', barista, id, { expectedVersion: 3 });
  }
  bind('openShift', 'shift.open', cashier, cashierDevice, { openingCashCentavos: 100_000 });
  for (const key of countNames) bind(key, 'inventory.count.start', manager, 'beans', { ingredientId: 'beans' });
  waste('staleWaste', 1_000);
  receive('staleReceipt', 1_000, 80);
  bind('staleObserve', 'inventory.count.observe', manager, counts.staleCount, { expectedVersion: 1, unit: 'g', observedMilli: 999_000 });
  bind('discard', 'inventory.count.decide', manager, counts.staleCount, { expectedVersion: 1, decision: 'discard', reason: 'Stock moved during the measurement' });
  orderBindings('first', first);
  bind('negativeObserve', 'inventory.count.observe', manager, counts.negativeCount, { expectedVersion: 1, unit: 'g', observedMilli: 990_000 });
  receive('concurrentReceipt', 200_000, 16_000);
  bind('negativeApprove', 'inventory.count.decide', manager, counts.negativeCount, { expectedVersion: 2, decision: 'approve', reason: 'Physical count variance confirmed' });
  bind('positiveObserve', 'inventory.count.observe', manager, counts.positiveCount, { expectedVersion: 1, unit: 'g', observedMilli: 1_182_000 });
  bind('positiveApprove', 'inventory.count.decide', manager, counts.positiveCount, { expectedVersion: 2, decision: 'approve', reason: 'Extra stock found in storage' });
  orderBindings('unknown', unknown);
  waste('unknownWaste', 2_000);
  bind('confirmCost', 'inventory.count.confirm_cost', manager, counts.positiveCount, { expectedVersion: 3, totalCostCentavos: 800, reference: 'Synthetic gain cost evidence' });
  receive('beforeRevalue', 20_000, 1_600);
  bind('staleRevalue', 'inventory.count.revalue', manager, counts.positiveCount, {
    expectedVersion: 4, totalCostCentavos: 92_960, reference: 'Synthetic stale whole balance', expectedStockVersion: 9,
  });
  bind('revalue', 'inventory.count.revalue', manager, counts.positiveCount, {
    expectedVersion: 4, totalCostCentavos: 94_560, reference: 'Synthetic current whole balance evidence', expectedStockVersion: 10,
  });
  orderBindings('known', known);
  // Opening plus three recorded cash payments leaves version 4 before the count.
  bind('countShift', 'shift.submit-count', cashier, shiftId, { expectedVersion: 4, countedCashCentavos: 149_500, note: 'Synthetic count rehearsal closed' });
  bind('closeShift', 'shift.review', manager, shiftId, { expectedVersion: 5, decision: 'approve' });

  try {
    assert.deepEqual(rows('PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
    assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
    assert.equal(row('SELECT MAX(version) AS version FROM schema_migrations').version, 17);
    assert.equal(bindings.size, commandNames.length);
    for (const key of commandNames) {
      const binding = bindings.get(key)!;
      const device = binding.actor === cashier ? cashierDevice : binding.actor === barista ? baristaDevice : null;
      const rejected = key === 'staleObserve' || key === 'staleRevalue';
      const action = binding.action + (rejected ? '.rejected' : '');
      const receipt = row('SELECT actor_id,branch_id,device_id,action,fingerprint,response_json,outcome,rejection_status FROM command_receipts WHERE id=?', cmd[key]);
      assert.deepEqual([receipt.actor_id, receipt.branch_id, receipt.device_id, receipt.action, receipt.outcome, receipt.rejection_status],
        [binding.actor, branchId, device, binding.action, rejected ? 'rejected' : 'accepted', rejected ? 409 : null], key);
      const fingerprint = createHash('sha256').update(JSON.stringify({ action: binding.action, target: binding.target, deviceId: device, input: binding.input })).digest('hex');
      assert.equal(receipt.fingerprint, fingerprint, key + ' must bind the actual rehearsal inputs');
      const audit = row('SELECT actor_id,branch_id,device_id,action,payload_json FROM audit_events WHERE command_id=?', cmd[key]);
      const outbox = row('SELECT branch_id,device_id,event_type,payload_json FROM outbox WHERE command_id=?', cmd[key]);
      assert.deepEqual([audit.actor_id, audit.branch_id, audit.device_id, audit.action], [binding.actor, branchId, device, action], key);
      assert.deepEqual([outbox.branch_id, outbox.device_id, outbox.event_type, outbox.payload_json], [branchId, device, action, audit.payload_json], key);
      const event = object(JSON.parse(String(audit.payload_json)));
      assert.deepEqual([event.action, event.target, event.actorId, event.deviceId, event.branchId], [binding.action, binding.target, binding.actor, device, branchId], key);
      const response = object(JSON.parse(String(receipt.response_json)));
      if (rejected) {
        assert.equal(object(response.error).code, 'conflict', key);
        assert.equal(event.errorCode, 'conflict', key);
      } else assert.equal(response.commandId, cmd[key], key);
      receipts.set(key, response);
    }
    const actions = new Set([...bindings.values()].map(binding => binding.action));
    const workflowIds = rows('SELECT id,action FROM command_receipts WHERE branch_id=? AND actor_id IN (?,?,?)', branchId, manager, cashier, barista)
      .filter(receipt => actions.has(String(receipt.action))).map(receipt => String(receipt.id)).sort();
    assert.deepEqual(workflowIds, Object.values(cmd).sort(), 'No duplicate confirmation or extra workflow mutations');
    const rejected = rows("SELECT id FROM command_receipts WHERE branch_id=? AND outcome='rejected' ORDER BY id", branchId).map(item => item.id);
    assert.deepEqual(rejected, [cmd.staleObserve, cmd.staleRevalue].sort(), 'Exactly two durable conflicts');
    const replyCount = (key: CommandName) => object(receipts.get(key)!.count);
    for (const [key, status, version, quantity, costStatus] of [
      ['discard', 'discarded', 2, 1_000_000, 'not_required'],
      ['negativeApprove', 'approved', 3, 1_172_000, 'not_required'],
      ['positiveApprove', 'approved', 3, 1_182_000, 'pending'],
      ['confirmCost', 'approved', 4, 1_162_000, 'confirmed'],
      ['revalue', 'approved', 5, 1_182_000, 'confirmed'],
    ] as const) {
      const count = replyCount(key);
      assert.deepEqual([count.status, count.version, count.liveOnHandMilli, count.costStatus], [status, version, quantity, costStatus], key);
    }
    assert.equal(replyCount('confirmCost').canRevalue, true);
    assert.equal(replyCount('revalue').balanceCostCentavos, 94_560);
    assert.equal(replyCount('revalue').canRevalue, false);
    assert.deepEqual(rows(`SELECT id,unit,status,version,snapshot_milli,snapshot_stock_version,observed_milli,variance_milli,reason,
      created_by,observed_by,decided_by,basis_before_microcentavos FROM inventory_counts WHERE branch_id=? ORDER BY rowid`, branchId), [
      { id: counts.staleCount, unit: 'g', status: 'discarded', version: 2, snapshot_milli: 1_000_000, snapshot_stock_version: 1,
        observed_milli: null, variance_milli: null, reason: 'Stock moved during the measurement', created_by: manager, observed_by: null, decided_by: manager, basis_before_microcentavos: null },
      { id: counts.negativeCount, unit: 'g', status: 'approved', version: 3, snapshot_milli: 1_000_000, snapshot_stock_version: 3,
        observed_milli: 990_000, variance_milli: -10_000, reason: 'Physical count variance confirmed', created_by: manager, observed_by: manager, decided_by: manager, basis_before_microcentavos: null },
      { id: counts.positiveCount, unit: 'g', status: 'approved', version: 5, snapshot_milli: 1_172_000, snapshot_stock_version: 6,
        observed_milli: 1_182_000, variance_milli: 10_000, reason: 'Extra stock found in storage', created_by: manager, observed_by: manager, decided_by: manager, basis_before_microcentavos: 93_760_000_000 },
    ]);
    assert.deepEqual(rows('SELECT count_id,total_cost_centavos,reference,actor_id,command_id FROM inventory_count_costs'), [
      { count_id: counts.positiveCount, total_cost_centavos: 800, reference: 'Synthetic gain cost evidence', actor_id: manager, command_id: cmd.confirmCost },
    ]);
    assert.deepEqual(rows('SELECT count_id,branch_id,ingredient_id,stock_version,on_hand_milli,total_cost_centavos,reference,actor_id,command_id FROM inventory_count_revaluations'), [
      { count_id: counts.positiveCount, branch_id: branchId, ingredient_id: 'beans', stock_version: 10, on_hand_milli: 1_182_000,
        total_cost_centavos: 94_560, reference: 'Synthetic current whole balance evidence', actor_id: manager, command_id: cmd.revalue },
    ]);

    const movements = rows(`SELECT m.id,m.sequence,m.kind,m.quantity_milli,m.quantity_after_milli,m.count_id,m.order_id,m.command_id,
      v.movement_id AS valuation_movement_id,v.value_microcentavos
      FROM stock_movements m LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id
      WHERE m.branch_id=? AND m.ingredient_id='beans' ORDER BY m.sequence`, branchId);
    const expectedMovements = [
      ['receipt', 1_000_000, 1_000_000, null, null, null, 80_000_000_000],
      ['waste', -1_000, 999_000, null, null, cmd.staleWaste, 80_000_000],
      ['receipt', 1_000, 1_000_000, null, null, cmd.staleReceipt, 80_000_000],
      ['consumption', -18_000, 982_000, null, first, cmd.firstReady, 1_440_000_000],
      ['receipt', 200_000, 1_182_000, null, null, cmd.concurrentReceipt, 16_000_000_000],
      ['count_adjustment', -10_000, 1_172_000, counts.negativeCount, null, cmd.negativeApprove, 800_000_000],
      ['count_adjustment', 10_000, 1_182_000, counts.positiveCount, null, cmd.positiveApprove, null],
      ['consumption', -18_000, 1_164_000, null, unknown, cmd.unknownReady, null],
      ['waste', -2_000, 1_162_000, null, null, cmd.unknownWaste, null],
      ['receipt', 20_000, 1_182_000, null, null, cmd.beforeRevalue, 1_600_000_000],
      ['consumption', -18_000, 1_164_000, null, known, cmd.knownReady, 1_440_000_000],
    ];
    assert.equal(movements.length, expectedMovements.length);
    let balance = 0n;
    for (const [index, move] of movements.entries()) {
      assert.equal(move.sequence, index + 1);
      assert.equal(move.valuation_movement_id, move.id, 'An explicit NULL cost row must exist for every unknown movement');
      assert.ok(Number.isSafeInteger(move.quantity_milli) && Number.isSafeInteger(move.quantity_after_milli));
      balance += BigInt(Number(move.quantity_milli));
      assert.equal(balance, BigInt(Number(move.quantity_after_milli)), 'Each stored running balance must equal its exact sequence sum');
      const [kind, quantity, after, countId, orderId, commandId, value] = expectedMovements[index]!;
      assert.deepEqual([move.kind, move.quantity_milli, move.quantity_after_milli, move.count_id, move.order_id, move.value_microcentavos],
        [kind, quantity, after, countId, orderId, value], 'movement ' + (index + 1));
      if (commandId !== null) assert.equal(move.command_id, commandId);
    }
    assert.equal(balance, 1_164_000n);
    assert.equal(row("SELECT SUM(quantity_milli) AS quantity FROM stock_movements WHERE branch_id=? AND ingredient_id='beans'", branchId).quantity, Number(balance));
    assert.equal(row("SELECT carrying_microcentavos FROM ingredient_valuation_balances WHERE branch_id=? AND ingredient_id='beans'", branchId).carrying_microcentavos, 93_120_000_000);
    assert.deepEqual(rows(`SELECT w.quantity_milli,w.note,w.actor_id,w.command_id FROM waste_entries w WHERE w.branch_id=? ORDER BY w.rowid`, branchId), [
      { quantity_milli: 1_000, note: 'staleWaste', actor_id: barista, command_id: cmd.staleWaste },
      { quantity_milli: 2_000, note: 'unknownWaste', actor_id: barista, command_id: cmd.unknownWaste },
    ]);
    assert.deepEqual(rows(`SELECT o.id,o.version,o.dine_in,o.release_policy,o.table_ref,o.total_centavos,o.discount_centavos,
      o.released_at IS NOT NULL AS released,o.ready_at IS NOT NULL AS ready,o.cancelled_at FROM orders o WHERE branch_id=? ORDER BY order_no`, branchId),
    orders.map(id => ({ id, version: 4, dine_in: 1, release_policy: 'explicit_send', table_ref: 'T1', total_centavos: 16_500,
      discount_centavos: 0, released: 1, ready: 1, cancelled_at: null })));
    for (const [index, id] of orders.entries()) {
      assert.deepEqual(rows('SELECT line_no,product_id,quantity,unit_price_centavos,note,recipe_version,retired FROM order_lines WHERE branch_id=? AND order_id=?', branchId, id),
        [{ line_no: 0, product_id: 'fixture-latte', quantity: 1, unit_price_centavos: 16_500, note: 'Synthetic count rehearsal', recipe_version: 1, retired: 0 }]);
      assert.deepEqual(rows('SELECT line_no,ingredient_id,quantity_milli FROM order_line_recipe WHERE branch_id=? AND order_id=?', branchId, id),
        [{ line_no: 0, ingredient_id: 'beans', quantity_milli: 18_000 }]);
      assert.deepEqual(rows('SELECT ingredient_id,quantity_milli,consumed,released FROM reservations WHERE branch_id=? AND order_id=?', branchId, id),
        [{ ingredient_id: 'beans', quantity_milli: 18_000, consumed: 1, released: 0 }]);
      assert.deepEqual(rows('SELECT ingredient_id,cost_microcentavos FROM order_recipe_valuation_estimates WHERE branch_id=? AND order_id=?', branchId, id),
        [{ ingredient_id: 'beans', cost_microcentavos: index === 1 ? null : 1_440_000_000 }]);
      const payment = row('SELECT id,method,amount_centavos,status,cash_received_centavos,change_centavos,command_id FROM payments WHERE branch_id=? AND order_id=?', branchId, id);
      const key = (['firstPay', 'unknownPay', 'knownPay'] as const)[index]!;
      assert.deepEqual([payment.method, payment.amount_centavos, payment.status, payment.cash_received_centavos, payment.change_centavos, payment.command_id],
        ['cash', 16_500, 'confirmed', 20_000, 3_500, cmd[key]]);
      assert.deepEqual(rows('SELECT total_centavos,discount_centavos,command_id FROM order_settlements WHERE branch_id=? AND order_id=?', branchId, id),
        [{ total_centavos: 16_500, discount_centavos: 0, command_id: cmd[key] }]);
      assert.deepEqual(rows('SELECT payment_id FROM settlement_payment_links WHERE branch_id=? AND order_id=?', branchId, id), [{ payment_id: payment.id }]);
      assert.deepEqual(rows('SELECT shift_id,actor_id,device_id,amount_centavos,command_id FROM cash_movements WHERE branch_id=? AND payment_id=?', branchId, String(payment.id)),
        [{ shift_id: shiftId, actor_id: cashier, device_id: cashierDevice, amount_centavos: 16_500, command_id: cmd[key] }]);
    }
    assert.equal(row('SELECT COUNT(*) AS count FROM payments WHERE branch_id=?', branchId).count, 3);
    assert.deepEqual(rows('SELECT total_centavos FROM order_settlements WHERE branch_id=? ORDER BY total_centavos', branchId), [{ total_centavos: 16_500 }, { total_centavos: 16_500 }, { total_centavos: 16_500 }]);
    assert.deepEqual(rows('SELECT id FROM refund_requests WHERE branch_id=?', branchId), []);
    assert.deepEqual(rows('SELECT id FROM operating_expenses WHERE branch_id=?', branchId), [], 'Count loss must not also become an operating expense');
    const shift = row('SELECT drawer_id,status,version,opening_cash_centavos,counted_cash_centavos,opened_by,current_count_id FROM shifts WHERE branch_id=? AND id=?', branchId, shiftId);
    assert.deepEqual([shift.drawer_id, shift.status, shift.version, shift.opening_cash_centavos, shift.counted_cash_centavos, shift.opened_by],
      ['fixture-counter', 'closed', 6, 100_000, 149_500, cashier]);
    assert.deepEqual(rows('SELECT id,shift_id,counted_cash_centavos,actor_id,command_id FROM shift_counts WHERE branch_id=?', branchId),
      [{ id: shift.current_count_id, shift_id: shiftId, counted_cash_centavos: 149_500, actor_id: cashier, command_id: cmd.countShift }]);
    assert.deepEqual(rows('SELECT shift_id,count_id,actor_id,decision,expected_cash_centavos,variance_centavos,command_id FROM shift_reviews WHERE branch_id=?', branchId),
      [{ shift_id: shiftId, count_id: shift.current_count_id, actor_id: manager, decision: 'approve', expected_cash_centavos: 149_500, variance_centavos: 0, command_id: cmd.closeShift }]);
    assert.deepEqual(rows(`SELECT j.order_id,j.type,j.status,j.command_id FROM print_jobs j JOIN orders o ON o.id=j.order_id
      WHERE j.branch_id=? ORDER BY o.order_no`, branchId), orders.map((id, index) => ({
      order_id: id, type: 'label', status: 'unconfigured', command_id: cmd[(['firstSend', 'unknownSend', 'knownSend'] as const)[index]!],
    })), 'One label per order; optional receipt printing was not requested');
    const dates = rows('SELECT DISTINCT business_date FROM order_settlements WHERE branch_id=?', branchId);
    assert.equal(dates.length, 1, 'Rehearsal settlements must share one business day');
    const day = String(dates[0]!.business_date);
    const sales = salesReport(db, branchId, { from: day, through: day }, 0);
    assert.deepEqual([sales.settledOrderCount, sales.settledSalesCentavos, sales.netSalesCentavos, sales.refundCentavos,
      sales.finalIngredientCostCentavos, sales.estimatedIngredientCostCentavos, sales.ordersWithUnknownIngredientCost,
      sales.wasteCostCentavos, sales.wasteEntriesWithUnknownCost, sales.stockLossCostCentavos, sales.stockLossEntriesWithUnknownCost, sales.enteredExpensesCentavos],
    [3, 49_500, 49_500, 0, 2_880, 0, 1, 80, 1, 800, 0, 0]);
    assert.equal(sales.estimatedGrossProfitCentavos, null, 'Historical unknown ingredient cost must remain visible');
    assert.equal(sales.estimatedOperatingProfitCentavos, null, 'Historical unknown cost must prevent a complete profit claim');
    console.log('PASS F04-03 SQLite reconciliation', JSON.stringify({
      countIds: counts, orderIds: orders, shiftId, acceptedCommands: commandNames.length - 2, rejectedCommands: 2,
      settledCentavos: 49_500, closingCashCentavos: 149_500, varianceCentavos: 0, stockLossCostCentavos: 800,
      beansOnHandMilli: Number(balance), carryingCentavos: 93_120, historicalUnknownOrders: 1, historicalUnknownWasteEntries: 1,
    }));
  } finally { db.close(); }
}

const [databasePath, logPath, ...extra] = process.argv.slice(2);
assert.ok(databasePath && logPath && extra.length === 0,
  'Usage: node --import tsx tests/fixtures/check_inventory_counts.ts <fixture.sqlite> <browser.log>');
audit(databasePath, parseTrace(logPath));
