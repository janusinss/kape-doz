import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HubDatabase } from '../src/database.js';

test('schema 8 refund upgrade preserves original tender, cancellation, stock, valuation and command records', async (t) => {
  const tempRoot = resolve(tmpdir());
  const folder = await mkdtemp(join(tempRoot, 'kape-doz-refund-migration-'));
  const path = join(folder, 'hub.sqlite');
  let legacy: DatabaseSync | undefined = new DatabaseSync(path);
  let upgraded: HubDatabase | undefined;
  t.after(async () => {
    legacy?.close();
    upgraded?.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(join(tempRoot, 'kape-doz-refund-migration-')));
    await rm(target, { recursive: true, force: true });
  });
  legacy.exec('PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
  const migrations = [
    '001_authority.sql', '002_auth_reservations.sql', '003_business.sql', '004_command_context.sql',
    '005_operating_expenses.sql', '006_sales_valuation.sql', '007_order_approvals.sql', '008_order_cancellations.sql',
  ];
  for (const [index, name] of migrations.entries()) {
    legacy.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    legacy.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
  }
  legacy.exec('PRAGMA foreign_keys=ON');
  const branchId = 'legacy-branch';
  const at = Date.UTC(2026, 10, 5, 15);
  legacy.prepare('INSERT INTO branches(id) VALUES(?)').run(branchId);
  for (const [id, role] of [['legacy-cashier', 'cashier'], ['legacy-manager', 'manager']] as const) {
    legacy.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)')
      .run(id, branchId, id, role, 'preserved-credential');
  }
  legacy.prepare('INSERT INTO devices(id,branch_id,secret_hash) VALUES(?,?,?)').run('legacy-tablet', branchId, 'preserved-device');
  for (const commandId of ['legacy-payment', 'legacy-request', 'legacy-cancel', 'legacy-waste']) {
    legacy.prepare('INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(commandId, 'legacy-cashier', branchId, 'preserved.action', `preserved-${commandId}`, JSON.stringify({ commandId, preserved: true }), at, 'legacy-tablet');
    legacy.prepare('INSERT INTO audit_events(id,command_id,actor_id,branch_id,action,payload_json,accepted_at) VALUES(?,?,?,?,?,?,?)')
      .run(`audit-${commandId}`, commandId, 'legacy-cashier', branchId, 'preserved.action', '{"preserved":true}', at);
    legacy.prepare('INSERT INTO outbox(id,command_id,branch_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(`outbox-${commandId}`, commandId, branchId, 'preserved.action', '{"preserved":true}', at);
  }
  legacy.prepare('INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,total_centavos,cancelled_at) VALUES(?,?,1,3,0,?,?,?,16500,?)')
    .run('legacy-order', branchId, '', 'after_payment', at, at);
  legacy.prepare('INSERT INTO payments(id,branch_id,order_id,method,amount_centavos,status,cash_received_centavos,change_centavos,accepted_at,command_id) VALUES(?,?,?,\'cash\',5000,\'confirmed\',5000,0,?,?)')
    .run('legacy-tender', branchId, 'legacy-order', at, 'legacy-payment');
  legacy.prepare('INSERT INTO order_approvals(id,branch_id,order_id,order_version,action,amount_centavos,subtotal_centavos,reason,requester_id,requester_device_id,requested_at,request_command_id,decision,decided_at,reviewer_id,decision_command_id,requested_kitchen_state,requested_payment_state,collected_centavos,pending_centavos) VALUES(?,?,?,2,\'cancel\',16500,16500,?,?,?,?,?,\'approve\',?,?,?,\'not_released\',\'partially_paid\',5000,0)')
    .run('legacy-approval', branchId, 'legacy-order', 'Preserved cancellation', 'legacy-cashier', 'legacy-tablet', at, 'legacy-request', at, 'legacy-manager', 'legacy-cancel');
  legacy.prepare('INSERT INTO order_cancellations(branch_id,order_id,approval_id,cancelled_at,status,outcome,disposition_note,resolved_at,resolved_by,resolution_command_id) VALUES(?,?,?,?,\'resolved\',\'unprepared\',?,?,?,?)')
    .run(branchId, 'legacy-order', 'legacy-approval', at, 'Order cancelled before release.', at, 'legacy-manager', 'legacy-cancel');
  legacy.prepare('INSERT INTO ingredients(branch_id,id,name,unit) VALUES(?,?,?,?)').run(branchId, 'beans', 'Preserved beans', 'g');
  legacy.prepare('INSERT INTO waste_entries(id,branch_id,ingredient_id,quantity_milli,reason,note,actor_id,accepted_at,command_id) VALUES(?,?,?,1000,?,?,?,?,?)')
    .run('legacy-waste-entry', branchId, 'beans', 'dial_in', 'Preserved note', 'legacy-cashier', at, 'legacy-waste');
  legacy.prepare('INSERT INTO stock_movements(id,branch_id,ingredient_id,quantity_milli,kind,waste_id,command_id,accepted_at) VALUES(?,?,?,-1000,\'waste\',?,?,?)')
    .run('legacy-stock-waste', branchId, 'beans', 'legacy-waste-entry', 'legacy-waste', at);
  legacy.prepare('INSERT INTO stock_movement_valuations(movement_id,value_microcentavos) VALUES(?,NULL)').run('legacy-stock-waste');
  const before = {
    orders: legacy.prepare('SELECT * FROM orders').all(),
    payments: legacy.prepare('SELECT * FROM payments').all(),
    approvals: legacy.prepare('SELECT * FROM order_approvals').all(),
    cancellations: legacy.prepare('SELECT * FROM order_cancellations').all(),
    waste: legacy.prepare('SELECT * FROM waste_entries').all(),
    movements: legacy.prepare('SELECT * FROM stock_movements').all(),
    values: legacy.prepare('SELECT * FROM stock_movement_valuations').all(),
    commands: legacy.prepare('SELECT * FROM command_receipts ORDER BY id').all(),
    audits: legacy.prepare('SELECT * FROM audit_events ORDER BY id').all(),
    outbox: legacy.prepare('SELECT * FROM outbox ORDER BY id').all(),
  };
  legacy.close();
  legacy = undefined;
  upgraded = new HubDatabase(path);
  const db = upgraded.connection;
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
  assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(db.prepare('SELECT * FROM orders').all(), before.orders.map(row => Object.assign(Object.create(null), row, {
    customer_id: null,
    redeemed_points: 0,
    loyalty_redemption_centavos: 0,
  })));
  assert.deepEqual(db.prepare('SELECT * FROM payments').all(), before.payments);
  assert.deepEqual(db.prepare('SELECT * FROM order_approvals').all(), before.approvals);
  assert.deepEqual(db.prepare('SELECT * FROM order_cancellations').all(), before.cancellations);
  assert.deepEqual(db.prepare('SELECT * FROM waste_entries').all(), before.waste);
  assert.deepEqual(db.prepare('SELECT id,branch_id,ingredient_id,quantity_milli,kind,receipt_id,order_id,waste_id,command_id,accepted_at FROM stock_movements ORDER BY sequence').all(), before.movements);
  assert.deepEqual(db.prepare('SELECT * FROM stock_movement_valuations').all(), before.values);
  assert.deepEqual(db.prepare('SELECT id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id FROM command_receipts ORDER BY id').all(), before.commands);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE outcome<>'accepted' OR rejection_status IS NOT NULL").get()!.count, 0);
  assert.deepEqual(db.prepare('SELECT * FROM audit_events ORDER BY id').all(), before.audits);
  assert.deepEqual(db.prepare('SELECT * FROM outbox ORDER BY id').all(), before.outbox);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refund_cash_movements').get()!.count, 0);
  upgraded.close();
  upgraded = new HubDatabase(path);
  assert.equal(upgraded.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()!.count, 20);
  assert.deepEqual(upgraded.connection.prepare('SELECT * FROM payments').all(), before.payments);
});
