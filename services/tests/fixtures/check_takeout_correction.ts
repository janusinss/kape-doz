import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const prefix = 'PASS X02 paid takeout correction through split refund, separate replacement, reporting and drawer closure ';
const entities = [
  'originalId', 'replacementId', 'deniedApprovalId', 'approvedApprovalId', 'refundId',
  'cashPaymentId', 'gcashPaymentId', 'replacementPaymentId', 'cashLegId', 'gcashLegId', 'shiftId',
] as const;
const commands = [
  'open', 'createOriginal', 'cashOriginal', 'pending', 'verify', 'prepare', 'requestDenied', 'deny',
  'requestApproved', 'cancel', 'staleReady', 'disposition', 'requestRefund', 'approveRefund',
  'cashPayout', 'externalPayout', 'createReplacement', 'payReplacement', 'readyReplacement', 'count', 'close',
] as const;
const branchId = 'transport-branch';
const cashier = 'transport-cashier';
const barista = 'transport-barista';
const manager = 'transport-manager';
const cashierDevice = 'transport-cashier-tablet';
const baristaDevice = 'transport-barista-tablet';

type Row = Record<string, unknown>;
type CommandName = typeof commands[number];

function object(value: unknown): Row {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  return value as Row;
}

function ids<K extends string>(source: Row, keys: readonly K[]): Record<K, string> {
  const pairs = keys.map((key) => {
    const value = source[key];
    assert.equal(typeof value, 'string', `Missing ${key}`);
    assert.match(String(value), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, `Invalid ${key}`);
    return [key, value] as const;
  });
  assert.equal(new Set(pairs.map(([, value]) => value)).size, keys.length, 'Trace identities must be distinct');
  return Object.fromEntries(pairs) as Record<K, string>;
}

function parseTrace(path: string) {
  const found = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((line) => line.startsWith(prefix));
  assert.equal(found.length, 1, 'Expected exactly one completed X02 trace in the browser log');
  const value = object(JSON.parse(found[0]!.slice(prefix.length)));
  const commandIds = object(value.cmd);
  assert.deepEqual(Object.keys(value).sort(), [...entities, 'cmd'].sort());
  assert.deepEqual(Object.keys(commandIds).sort(), [...commands].sort());
  return { ...ids(value, entities), cmd: ids(commandIds, commands) };
}

function audit(path: string, trace: ReturnType<typeof parseTrace>) {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = (sql: string, ...parameters: SQLInputValue[]) => db.prepare(sql).all(...parameters).map((row) => ({ ...row }));
  const row = (sql: string, ...parameters: SQLInputValue[]) => {
    const result = rows(sql, ...parameters);
    assert.equal(result.length, 1, `Expected one row for ${sql}`);
    return result[0]!;
  };
  const {
    originalId, replacementId, deniedApprovalId, approvedApprovalId, refundId, cashPaymentId,
    gcashPaymentId, replacementPaymentId, cashLegId, gcashLegId, shiftId, cmd,
  } = trace;

  try {
    assert.deepEqual(rows('PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
    assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
    const expected = {
      open: ['shift.open', cashier, cashierDevice],
      createOriginal: ['order.create', cashier, ''],
      cashOriginal: ['order.payment', cashier, originalId],
      pending: ['order.payment', cashier, originalId],
      verify: ['order.payment.verify', cashier, `${originalId}/${gcashPaymentId}`],
      prepare: ['order.prepare', barista, originalId],
      requestDenied: ['approval.request', cashier, originalId],
      deny: ['approval.decide', manager, deniedApprovalId],
      requestApproved: ['approval.request', cashier, originalId],
      cancel: ['approval.decide', manager, approvedApprovalId],
      staleReady: ['order.ready', barista, originalId],
      disposition: ['order.cancellation.disposition', barista, originalId],
      requestRefund: ['refund.request', cashier, originalId],
      approveRefund: ['refund.decide', manager, refundId],
      cashPayout: ['refund.leg.record_cash', cashier, `${refundId}/${cashLegId}`],
      externalPayout: ['refund.leg.confirm_external', manager, `${refundId}/${gcashLegId}`],
      createReplacement: ['order.create', cashier, ''],
      payReplacement: ['order.payment', cashier, replacementId],
      readyReplacement: ['order.ready', barista, replacementId],
      count: ['shift.submit-count', cashier, shiftId],
      close: ['shift.review', manager, shiftId],
    } as const satisfies Record<CommandName, readonly [string, string, string]>;
    const receipts = new Map<CommandName, { data: Row; fingerprint: unknown }>();
    for (const key of commands) {
      const [action, actor, target] = expected[key];
      const device = actor === cashier ? cashierDevice : actor === barista ? baristaDevice : null;
      const rejected = key === 'staleReady';
      const eventAction = rejected ? `${action}.rejected` : action;
      const c = row(`SELECT action,actor_id,device_id,branch_id,outcome,rejection_status,fingerprint,response_json
        FROM command_receipts WHERE id=?`, cmd[key]);
      assert.deepEqual([c.action, c.actor_id, c.device_id, c.branch_id, c.outcome, c.rejection_status],
        [action, actor, device, branchId, rejected ? 'rejected' : 'accepted', rejected ? 409 : null], key);
      assert.match(String(c.fingerprint), /^[0-9a-f]{64}$/);
      const a = row('SELECT action,actor_id,branch_id,device_id,payload_json FROM audit_events WHERE command_id=?', cmd[key]);
      const o = row('SELECT event_type,branch_id,device_id,payload_json FROM outbox WHERE command_id=?', cmd[key]);
      assert.deepEqual([a.action, a.actor_id, a.branch_id, a.device_id], [eventAction, actor, branchId, device], key);
      assert.deepEqual([o.event_type, o.branch_id, o.device_id, o.payload_json], [eventAction, branchId, device, a.payload_json], key);
      const event = object(JSON.parse(String(a.payload_json)));
      assert.deepEqual([event.action, event.target, event.actorId, event.deviceId, event.branchId], [action, target, actor, device, branchId], key);
      const data = object(JSON.parse(String(c.response_json)));
      if (rejected) {
        assert.equal(event.errorCode, 'conflict');
        assert.equal(object(data.error).code, 'conflict');
      } else assert.equal(data.commandId, cmd[key]);
      receipts.set(key, { data, fingerprint: c.fingerprint });
    }
    const workflowActions = new Set<string>(Object.values(expected).map(([action]) => action));
    const recordedIds = rows('SELECT id,action FROM command_receipts WHERE branch_id=?', branchId)
      .filter(({ action }) => workflowActions.has(String(action))).map(({ id }) => String(id)).sort();
    assert.deepEqual(recordedIds, Object.values(cmd).sort(), 'Workflow actions must have one receipt per traced identity');
    const response = (key: CommandName) => receipts.get(key)!.data;
    const replyOrder = (key: CommandName) => object(response(key).order);
    const beforeVerify = ['createOriginal', 'cashOriginal', 'pending'] as const;
    for (const key of beforeVerify) {
      const order = replyOrder(key);
      assert.deepEqual([order.id, order.dineIn, order.released, order.releasedAt, order.ready], [originalId, false, false, null, false], key);
    }
    assert.deepEqual([replyOrder('cashOriginal').paidCentavos, replyOrder('pending').paidCentavos], [10_000, 10_000]);
    const pendingPayment = object(response('pending').payment);
    assert.deepEqual([pendingPayment.id, pendingPayment.status, pendingPayment.amountCentavos, pendingPayment.reference],
      [gcashPaymentId, 'pending', 6_500, 'SYNTHETIC-X02-PAYMENT']);
    const verified = replyOrder('verify');
    assert.deepEqual([verified.id, verified.paidCentavos, verified.released], [originalId, 16_500, true]);
    assert.equal(object(response('verify').payment).id, gcashPaymentId);
    assert.equal(object(response('verify').payment).status, 'confirmed');
    const preparation = replyOrder('prepare');
    assert.equal(preparation.id, originalId);
    assert.equal(preparation.preparing, true);
    const staleInput = { commandId: cmd.staleReady, expectedVersion: preparation.version };
    const staleFingerprint = createHash('sha256').update(JSON.stringify({
      action: 'order.ready', target: originalId, deviceId: baristaDevice, input: staleInput,
    })).digest('hex');
    assert.equal(receipts.get('staleReady')!.fingerprint, staleFingerprint, 'Stale Ready must use the actual pre-cancellation version');
    const denialReply = object(response('deny').approval);
    assert.deepEqual([denialReply.id, denialReply.status, denialReply.cancellationStatus], [deniedApprovalId, 'denied', null]);
    const approvalReply = object(response('cancel').approval);
    assert.deepEqual([approvalReply.id, approvalReply.status, approvalReply.cancellationStatus], [approvedApprovalId, 'approved', 'awaiting_disposition']);

    assert.deepEqual(rows(`SELECT id,dine_in,release_policy,total_centavos,discount_centavos,released_at,
      preparing_at IS NOT NULL AS preparing,ready_at IS NOT NULL AS ready,cancelled_at IS NOT NULL AS cancelled
      FROM orders WHERE branch_id=? ORDER BY order_no`, branchId), [
      { id: originalId, dine_in: 0, release_policy: 'after_payment', total_centavos: 16_500, discount_centavos: 0,
        released_at: verified.releasedAt, preparing: 1, ready: 0, cancelled: 1 },
      { id: replacementId, dine_in: 0, release_policy: 'after_payment', total_centavos: 9_000, discount_centavos: 0,
        released_at: replyOrder('payReplacement').releasedAt, preparing: 0, ready: 1, cancelled: 0 },
    ]);
    assert.deepEqual(rows(`SELECT order_id,line_no,product_id,quantity,unit_price_centavos,note,retired FROM order_lines
      WHERE branch_id=? ORDER BY unit_price_centavos DESC`, branchId), [
      { order_id: originalId, line_no: 0, product_id: 'fixture-latte', quantity: 1, unit_price_centavos: 16_500, note: 'Original takeout', retired: 0 },
      { order_id: replacementId, line_no: 0, product_id: 'fixture-espresso', quantity: 1, unit_price_centavos: 9_000, note: 'Replacement takeout', retired: 0 },
    ]);
    assert.deepEqual(rows('SELECT id FROM order_amendments WHERE branch_id=?', branchId), [], 'Paid price correction must use the cancellation/refund workflow');
    assert.deepEqual(rows(`SELECT id,order_id,action,decision,order_version,collected_centavos,pending_centavos,
      requested_kitchen_state,requested_payment_state,request_command_id,decision_command_id,reviewer_id
      FROM order_approvals WHERE branch_id=? ORDER BY decision DESC`, branchId), [
      { id: deniedApprovalId, order_id: originalId, action: 'cancel', decision: 'deny', order_version: preparation.version,
        collected_centavos: 16_500, pending_centavos: 0, requested_kitchen_state: 'preparing', requested_payment_state: 'paid',
        request_command_id: cmd.requestDenied, decision_command_id: cmd.deny, reviewer_id: manager },
      { id: approvedApprovalId, order_id: originalId, action: 'cancel', decision: 'approve', order_version: preparation.version,
        collected_centavos: 16_500, pending_centavos: 0, requested_kitchen_state: 'preparing', requested_payment_state: 'paid',
        request_command_id: cmd.requestApproved, decision_command_id: cmd.cancel, reviewer_id: manager },
    ]);
    assert.deepEqual(rows(`SELECT order_id,approval_id,status,outcome,resolved_by,resolution_command_id
      FROM order_cancellations WHERE branch_id=?`, branchId), [
      { order_id: originalId, approval_id: approvedApprovalId, status: 'resolved', outcome: 'used', resolved_by: barista, resolution_command_id: cmd.disposition },
    ]);

    assert.deepEqual(rows(`SELECT id,order_id,method,amount_centavos,status,reference,cash_received_centavos,change_centavos,command_id
      FROM payments WHERE branch_id=? ORDER BY amount_centavos DESC`, branchId), [
      { id: cashPaymentId, order_id: originalId, method: 'cash', amount_centavos: 10_000, status: 'confirmed', reference: null,
        cash_received_centavos: 10_000, change_centavos: 0, command_id: cmd.cashOriginal },
      { id: replacementPaymentId, order_id: replacementId, method: 'cash', amount_centavos: 9_000, status: 'confirmed', reference: null,
        cash_received_centavos: 9_000, change_centavos: 0, command_id: cmd.payReplacement },
      { id: gcashPaymentId, order_id: originalId, method: 'gcash', amount_centavos: 6_500, status: 'confirmed', reference: 'SYNTHETIC-X02-PAYMENT',
        cash_received_centavos: null, change_centavos: null, command_id: cmd.pending },
    ]);
    assert.deepEqual(rows(`SELECT order_id,total_centavos,discount_centavos,command_id FROM order_settlements
      WHERE branch_id=? ORDER BY total_centavos DESC`, branchId), [
      { order_id: originalId, total_centavos: 16_500, discount_centavos: 0, command_id: cmd.verify },
      { order_id: replacementId, total_centavos: 9_000, discount_centavos: 0, command_id: cmd.payReplacement },
    ]);
    assert.deepEqual(rows(`SELECT s.order_id,s.payment_id FROM settlement_payment_links s JOIN payments p ON p.id=s.payment_id
      WHERE s.branch_id=? ORDER BY p.amount_centavos DESC`, branchId), [
      { order_id: originalId, payment_id: cashPaymentId }, { order_id: replacementId, payment_id: replacementPaymentId },
      { order_id: originalId, payment_id: gcashPaymentId },
    ]);
    assert.deepEqual(rows(`SELECT id,order_id,amount_centavos,decision,requester_id,reviewer_id,request_command_id,decision_command_id
      FROM refund_requests WHERE branch_id=?`, branchId), [
      { id: refundId, order_id: originalId, amount_centavos: 16_500, decision: 'approve', requester_id: cashier, reviewer_id: manager,
        request_command_id: cmd.requestRefund, decision_command_id: cmd.approveRefund },
    ]);
    assert.deepEqual(rows(`SELECT order_id,refund_id,line_no,quantity,unit_price_centavos FROM refund_lines WHERE branch_id=?`, branchId), [
      { order_id: originalId, refund_id: refundId, line_no: 0, quantity: 1, unit_price_centavos: 16_500 },
    ]);
    assert.deepEqual(rows(`SELECT id,order_id,refund_id,payment_id,amount_centavos,revenue_centavos,status,reference,completion_command_id
      FROM refund_legs WHERE branch_id=? ORDER BY amount_centavos DESC`, branchId), [
      { id: cashLegId, order_id: originalId, refund_id: refundId, payment_id: cashPaymentId, amount_centavos: 10_000, revenue_centavos: 10_000,
        status: 'completed', reference: null, completion_command_id: cmd.cashPayout },
      { id: gcashLegId, order_id: originalId, refund_id: refundId, payment_id: gcashPaymentId, amount_centavos: 6_500, revenue_centavos: 6_500,
        status: 'completed', reference: 'SYNTHETIC-X02-REFUND', completion_command_id: cmd.externalPayout },
    ]);
    assert.deepEqual(rows(`SELECT leg_id,version,action,actor_id,command_id FROM refund_leg_events WHERE branch_id=? ORDER BY action`, branchId), [
      { leg_id: gcashLegId, version: 2, action: 'confirm_external', actor_id: manager, command_id: cmd.externalPayout },
      { leg_id: cashLegId, version: 2, action: 'record_cash', actor_id: cashier, command_id: cmd.cashPayout },
    ]);
    assert.deepEqual(rows('SELECT method,reference,leg_id FROM external_refund_references WHERE branch_id=?', branchId), [
      { method: 'gcash', reference: 'SYNTHETIC-X02-REFUND', leg_id: gcashLegId },
    ]);
    assert.deepEqual(rows(`SELECT payment_id,shift_id,actor_id,amount_centavos,command_id FROM cash_movements
      WHERE branch_id=? ORDER BY amount_centavos DESC`, branchId), [
      { payment_id: cashPaymentId, shift_id: shiftId, actor_id: cashier, amount_centavos: 10_000, command_id: cmd.cashOriginal },
      { payment_id: replacementPaymentId, shift_id: shiftId, actor_id: cashier, amount_centavos: 9_000, command_id: cmd.payReplacement },
    ]);
    assert.deepEqual(rows(`SELECT shift_id,leg_id,actor_id,amount_centavos,command_id FROM refund_cash_movements WHERE branch_id=?`, branchId), [
      { shift_id: shiftId, leg_id: cashLegId, actor_id: cashier, amount_centavos: 10_000, command_id: cmd.cashPayout },
    ]);
    const shift = row(`SELECT id,drawer_id,status,opening_cash_centavos,counted_cash_centavos,opened_by,current_count_id
      FROM shifts WHERE branch_id=?`, branchId);
    assert.deepEqual([shift.id, shift.drawer_id, shift.status, shift.opening_cash_centavos, shift.counted_cash_centavos, shift.opened_by],
      [shiftId, 'fixture-counter', 'closed', 100_000, 109_000, cashier]);
    assert.deepEqual(rows(`SELECT id,shift_id,counted_cash_centavos,actor_id,command_id FROM shift_counts WHERE branch_id=?`, branchId), [
      { id: shift.current_count_id, shift_id: shiftId, counted_cash_centavos: 109_000, actor_id: cashier, command_id: cmd.count },
    ]);
    assert.deepEqual(rows(`SELECT shift_id,count_id,actor_id,decision,expected_cash_centavos,variance_centavos,command_id
      FROM shift_reviews WHERE branch_id=?`, branchId), [
      { shift_id: shiftId, count_id: shift.current_count_id, actor_id: manager, decision: 'approve', expected_cash_centavos: 109_000,
        variance_centavos: 0, command_id: cmd.close },
    ]);

    assert.deepEqual(rows(`SELECT c.order_id,w.ingredient_id,w.quantity_milli,w.actor_id,w.command_id FROM cancellation_waste c
      JOIN waste_entries w ON w.branch_id=c.branch_id AND w.id=c.waste_id WHERE c.branch_id=?`, branchId), [
      { order_id: originalId, ingredient_id: 'beans', quantity_milli: 9_000, actor_id: barista, command_id: cmd.disposition },
    ]);
    assert.deepEqual(rows(`SELECT order_id,ingredient_id,quantity_milli,consumed,released FROM reservations
      WHERE branch_id=? ORDER BY quantity_milli DESC`, branchId), [
      { order_id: originalId, ingredient_id: 'beans', quantity_milli: 18_000, consumed: 0, released: 1 },
      { order_id: replacementId, ingredient_id: 'beans', quantity_milli: 9_000, consumed: 1, released: 0 },
    ]);
    assert.deepEqual(rows(`SELECT m.order_id,m.kind,m.quantity_milli,m.command_id,v.value_microcentavos FROM stock_movements m
      JOIN stock_movement_valuations v ON v.movement_id=m.id WHERE m.branch_id=? AND m.ingredient_id='beans' AND m.kind<>'receipt' ORDER BY m.kind`, branchId), [
      { order_id: replacementId, kind: 'consumption', quantity_milli: -9_000, command_id: cmd.readyReplacement, value_microcentavos: 720_000_000 },
      { order_id: null, kind: 'waste', quantity_milli: -9_000, command_id: cmd.disposition, value_microcentavos: 720_000_000 },
    ]);
    const stock = row(`SELECT SUM(quantity_milli) AS quantity FROM stock_movements WHERE branch_id=? AND ingredient_id='beans'`, branchId);
    assert.equal(stock.quantity, 982_000);
    const value = row(`SELECT carrying_microcentavos FROM ingredient_valuation_balances WHERE branch_id=? AND ingredient_id='beans'`, branchId);
    assert.equal(value.carrying_microcentavos, 78_560_000_000);
    assert.deepEqual(rows(`SELECT j.order_id,j.type,j.status,j.command_id FROM print_jobs j JOIN orders o ON o.id=j.order_id
      WHERE j.branch_id=? ORDER BY o.order_no`, branchId), [
      { order_id: originalId, type: 'label', status: 'unconfigured', command_id: cmd.verify },
      { order_id: replacementId, type: 'label', status: 'unconfigured', command_id: cmd.payReplacement },
    ]);
    const sales = row(`SELECT (SELECT SUM(total_centavos) FROM order_settlements WHERE branch_id=?) AS settled,
      (SELECT SUM(revenue_centavos) FROM refund_legs WHERE branch_id=? AND status='completed') AS refunded`, branchId, branchId);
    assert.deepEqual(sales, { settled: 25_500, refunded: 16_500 });
    assert.equal(Number(sales.settled) - Number(sales.refunded), 9_000);
    console.log('PASS X02 SQLite reconciliation', JSON.stringify({
      originalId, replacementId, shiftId, acceptedCommands: commands.length - 1, rejectedCommands: 1,
      settledCentavos: 25_500, refundedCentavos: 16_500, netSalesCentavos: 9_000, finalIngredientCostCentavos: 720,
      wasteCostCentavos: 720, closingCashCentavos: 109_000, varianceCentavos: 0, beansOnHandMilli: stock.quantity,
    }));
  } finally { db.close(); }
}

const [databasePath, logPath, ...extra] = process.argv.slice(2);
assert.ok(databasePath && logPath && !extra.length,
  'Usage: node --import tsx tests/fixtures/check_takeout_correction.ts <fixture.sqlite> <browser.log>');
audit(databasePath, parseTrace(logPath));
