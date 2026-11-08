import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const prefix = 'PASS inventory alerts and nonblocking shortage across manager, cashier and barista ';
const [databasePath, logPath, ...extra] = process.argv.slice(2);
assert.ok(databasePath && logPath && !extra.length, 'Usage: check_inventory_alerts.ts <fixture.sqlite> <browser.log>');
const traces = readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.startsWith(prefix));
assert.equal(traces.length, 1, 'Expected one complete browser trace');
const trace = JSON.parse(traces[0]!.slice(prefix.length)) as { orderId: string; alertId: string };
assert.deepEqual(Object.keys(trace).sort(), ['alertId', 'orderId']);
for (const id of [trace.orderId, trace.alertId]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const rows = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).all(...args).map(row => ({ ...row }));
  const one = (sql: string, ...args: SQLInputValue[]) => {
    const items = rows(sql, ...args);
    assert.equal(items.length, 1, `Expected exactly one row for ${sql}`);
    return items[0]!;
  };
  assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok');
  assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
  assert.equal(one('SELECT MAX(version) AS version FROM schema_migrations').version, 17);
  const branch = 'transport-branch';
  const order = one('SELECT * FROM orders WHERE id=? AND branch_id=?', trace.orderId, branch);
  assert.ok(order.released_at !== null && order.ready_at !== null && order.cancelled_at === null);
  assert.equal(order.total_centavos, 16500);
  assert.deepEqual(rows('SELECT product_id,quantity FROM order_lines WHERE branch_id=? AND order_id=? AND retired=0', branch, trace.orderId),
    [{ product_id: 'fixture-latte', quantity: 1 }]);
  const movements = rows(`SELECT quantity_milli,quantity_after_milli,kind,order_id,command_id FROM stock_movements
    WHERE branch_id=? AND ingredient_id='beans' ORDER BY sequence`, branch);
  assert.equal(movements.length, 4);
  assert.deepEqual(movements.map(m => [m.quantity_milli,m.quantity_after_milli,m.kind]),
    [[1000000,1000000,'receipt'],[-990000,10000,'waste'],[-18000,-8000,'consumption'],[100000,92000,'receipt']]);
  assert.equal(movements[2]!.order_id, trace.orderId);
  const receive = one(`SELECT quantity_milli,total_cost_centavos,reference FROM stock_receipts
    WHERE branch_id=? AND command_id=?`, branch, movements[3]!.command_id as string);
  assert.deepEqual(receive, { quantity_milli:100000, total_cost_centavos:8000, reference:'Synthetic replenishment' });

  const alerts = rows('SELECT * FROM inventory_alerts WHERE branch_id=? AND ingredient_id=? ORDER BY kind', branch, 'beans');
  assert.equal(alerts.length, 2);
  const low = alerts.find(item => item.kind === 'low_stock')!;
  const shortage = alerts.find(item => item.kind === 'shortage')!;
  assert.equal(low.id, trace.alertId);
  assert.equal(low.status, 'resolved');
  assert.equal(low.resolution, 'threshold_changed');
  assert.equal(low.acknowledged_by, 'transport-manager');
  assert.equal(low.acknowledgment_note, 'Synthetic receiving follow-up');
  assert.equal(shortage.status, 'resolved');
  assert.equal(shortage.resolution, 'stock_recovered');
  for (const alert of alerts) {
    assert.deepEqual([alert.on_hand_milli,alert.reserved_milli,alert.available_milli],[92000,0,92000]);
    const events = rows('SELECT version,type,command_id FROM inventory_alert_events WHERE alert_id=? ORDER BY version', alert.id as string);
    assert.equal(events.length, alert.version);
    assert.deepEqual(events.map(item => item.version), Array.from({length:events.length},(_, i)=>i+1));
    assert.equal(events[0]!.type, 'opened');
    assert.equal(events.at(-1)!.type, 'resolved');
    assert.equal(new Set(events.map(item=>item.command_id)).size, events.length);
  }
  assert.deepEqual(rows('SELECT version,type,note FROM inventory_alert_events WHERE alert_id=? AND type=?',trace.alertId,'acknowledged'),
    [{version:2,type:'acknowledged',note:'Synthetic receiving follow-up'}]);
  const source = rows(`SELECT order_id,phase,required_milli,available_milli,shortfall_milli,command_id
    FROM inventory_order_shortages WHERE branch_id=? AND alert_id=? ORDER BY phase`, branch, shortage.id as string);
  assert.deepEqual(source.map(item => [item.order_id,item.phase,item.required_milli,item.available_milli,item.shortfall_milli]),[
    [trace.orderId,'order.ready',18000,10000,8000], [trace.orderId,'order.send',18000,10000,8000],
  ]);
  assert.equal(source[0]!.command_id, movements[2]!.command_id);
  assert.equal(source[1]!.command_id, one("SELECT id FROM command_receipts WHERE action='order.send'").id);
  const history = rows(`SELECT version,old_threshold_milli,new_threshold_milli,reason,actor_id,command_id
    FROM inventory_threshold_events WHERE branch_id=? AND ingredient_id=? ORDER BY version`,branch,'beans');
  assert.deepEqual(history.map(item => [item.version,item.old_threshold_milli,item.new_threshold_milli,item.reason,item.actor_id]),[
    [1,null,1000000,'Synthetic alert threshold','transport-manager'],
    [2,1000000,null,'Synthetic threshold cleared','transport-manager'],
  ]);
  for (const event of history) {
    const command = one('SELECT * FROM command_receipts WHERE id=?', event.command_id as string);
    assert.equal(command.action,'inventory.threshold.set');
    const input = { commandId: command.id, expectedVersion: Number(event.version)-1, thresholdMilli:event.new_threshold_milli, reason:event.reason };
    const fingerprint = createHash('sha256').update(JSON.stringify({action:'inventory.threshold.set',target:'beans',deviceId:null,input})).digest('hex');
    assert.equal(command.fingerprint,fingerprint);
  }
  assert.deepEqual(rows('SELECT version,threshold_milli FROM ingredient_stock_thresholds WHERE branch_id=? AND ingredient_id=?',branch,'beans'),[{version:2,threshold_milli:null}]);
  assert.deepEqual(rows('SELECT total_centavos FROM order_settlements WHERE branch_id=? AND order_id=?',branch,trace.orderId),[{total_centavos:16500}]);
  const shift=one('SELECT id,status,opening_cash_centavos,counted_cash_centavos FROM shifts WHERE branch_id=?',branch);
  assert.deepEqual([shift.status,shift.opening_cash_centavos,shift.counted_cash_centavos],['closed',100000,116500]);
  assert.equal(one('SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM cash_movements WHERE branch_id=? AND shift_id=?',branch,shift.id as string).amount,16500);
  const review=one("SELECT response_json FROM command_receipts WHERE branch_id=? AND action='shift.review'",branch);
  const result=JSON.parse(String(review.response_json)) as {expectedCashCentavos:number;varianceCentavos:number};
  assert.deepEqual([result.expectedCashCentavos,result.varianceCentavos],[116500,0]);
  const receipts=rows('SELECT id,action,outcome FROM command_receipts WHERE branch_id=?',branch);
  assert.equal(receipts.length,16);
  for (const receipt of receipts) {
    assert.equal(receipt.outcome,'accepted');
    assert.equal(one('SELECT COUNT(*) AS n FROM audit_events WHERE command_id=?',receipt.id as string).n,1);
    assert.equal(one('SELECT COUNT(*) AS n FROM outbox WHERE command_id=?',receipt.id as string).n,1);
  }
  assert.deepEqual(rows('SELECT type,status FROM print_jobs WHERE branch_id=? AND order_id=?',branch,trace.orderId),[{type:'label',status:'unconfigured'}]);
  console.log('PASS inventory alerts SQLite reconciliation',JSON.stringify({orderId:trace.orderId,alertId:trace.alertId,
    acceptedCommands:receipts.length,shortageObservations:source.length,settledCentavos:16500,closingCashCentavos:116500,
    varianceCentavos:0,beansOnHandMilli:92000}));
} finally { db.close(); }
