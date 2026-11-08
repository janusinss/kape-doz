import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { HubDatabase } from '../src/database.js';

async function legacyFixture(t: TestContext, invalidWasteReference = false) {
  const tempRoot = resolve(tmpdir());
  const folder = await mkdtemp(join(tempRoot, 'kape-doz-cancellation-migration-'));
  const path = join(folder, 'hub.sqlite');
  const db = new DatabaseSync(path);
  t.after(async () => {
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(join(tempRoot, 'kape-doz-cancellation-migration-')));
    await rm(target, { recursive: true, force: true });
  });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
  const migrations = [
    '001_authority.sql', '002_auth_reservations.sql', '003_business.sql', '004_command_context.sql',
    '005_operating_expenses.sql', '006_sales_valuation.sql', '007_order_approvals.sql',
  ];
  for (const [index, name] of migrations.entries()) {
    db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
  }
  const branchId = 'legacy-branch';
  const cashierId = 'legacy-cashier';
  const at = Date.UTC(2026, 10, 5, 8);
  db.prepare('INSERT INTO branches(id) VALUES(?)').run(branchId);
  db.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)')
    .run(cashierId, branchId, 'Legacy cashier', 'cashier', 'preserved-credential-hash');
  db.prepare('INSERT INTO devices(id,branch_id,secret_hash) VALUES(?,?,?)').run('legacy-device', branchId, 'preserved-device-hash');
  for (const commandId of ['old-request', 'replacement-request', 'raw-waste']) {
    db.prepare('INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(commandId, cashierId, branchId, 'legacy.fixture', `preserved-${commandId}`, JSON.stringify({ commandId, preserved: true }), at, 'legacy-device');
    db.prepare('INSERT INTO audit_events(id,command_id,actor_id,branch_id,action,payload_json,accepted_at,device_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(`audit-${commandId}`, commandId, cashierId, branchId, 'legacy.fixture', '{"preserved":true}', at, 'legacy-device');
    db.prepare('INSERT INTO outbox(id,command_id,branch_id,event_type,payload_json,created_at,device_id) VALUES(?,?,?,?,?,?,?)')
      .run(`outbox-${commandId}`, commandId, branchId, 'legacy.fixture', '{"preserved":true}', at, 'legacy-device');
  }
  db.prepare('INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,total_centavos) VALUES(?,?,1,1,1,?,?,?,16500)')
    .run('legacy-order', branchId, '04', 'explicit_send', at);
  db.exec('BEGIN IMMEDIATE');
  for (const [id, commandId, amount, supersededBy] of [
    ['old-approval', 'old-request', 1_000, 'current-approval'],
    ['current-approval', 'replacement-request', 1_500, null],
  ] as const) {
    db.prepare('INSERT INTO order_approvals(id,branch_id,order_id,order_version,action,amount_centavos,subtotal_centavos,reason,requester_id,requester_device_id,requested_at,request_command_id,superseded_by) VALUES(?,?,?,1,\'discount\',?,16500,?,?,?,?,?,?)')
      .run(id, branchId, 'legacy-order', amount, 'Preserved request reason', cashierId, 'legacy-device', at, commandId, supersededBy);
  }
  db.exec('COMMIT');
  db.prepare('INSERT INTO ingredients(branch_id,id,name,unit) VALUES(?,?,?,?)').run(branchId, 'beans', 'Preserved beans', 'g');
  db.prepare('INSERT INTO waste_entries(id,branch_id,ingredient_id,quantity_milli,reason,note,actor_id,accepted_at,command_id) VALUES(?,?,?,18000,?,?,?,?,?)')
    .run('legacy-waste', branchId, 'beans', 'dial_in', 'Preserved waste note', cashierId, at, 'raw-waste');
  db.prepare('INSERT INTO stock_movements(id,branch_id,ingredient_id,quantity_milli,kind,waste_id,command_id,accepted_at) VALUES(?,?,?,-18000,\'waste\',?,?,?)')
    .run('legacy-waste-movement', branchId, 'beans', 'legacy-waste', 'raw-waste', at);
  db.prepare('INSERT INTO stock_movement_valuations(movement_id,value_microcentavos) VALUES(?,?)')
    .run('legacy-waste-movement', 1_440_000_000);
  db.prepare('INSERT INTO ingredient_valuation_balances(branch_id,ingredient_id,carrying_microcentavos) VALUES(?,?,NULL)')
    .run(branchId, 'beans');
  if (invalidWasteReference) {
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare('UPDATE stock_movements SET waste_id=? WHERE id=?').run('missing-waste', 'legacy-waste-movement');
  }
  const before = {
    approvals: db.prepare('SELECT * FROM order_approvals ORDER BY id').all(),
    waste: db.prepare('SELECT * FROM waste_entries').all(),
    movements: db.prepare('SELECT * FROM stock_movements').all(),
    values: db.prepare('SELECT * FROM stock_movement_valuations').all(),
    balances: db.prepare('SELECT * FROM ingredient_valuation_balances').all(),
    commands: db.prepare('SELECT * FROM command_receipts ORDER BY id').all(),
    audit: db.prepare('SELECT * FROM audit_events ORDER BY id').all(),
    outbox: db.prepare('SELECT * FROM outbox ORDER BY id').all(),
  };
  db.close();
  return { path, before };
}

test('schema 7 cancellation upgrade preserves approval chains, linked waste and accepted command history', async (t) => {
  const f = await legacyFixture(t);
  const migrated = new HubDatabase(f.path);
  try {
    const db = migrated.connection;
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const approvals = db.prepare('SELECT id,branch_id,order_id,order_version,action,amount_centavos,subtotal_centavos,reason,requester_id,requester_device_id,requested_at,request_command_id,superseded_by,decision,decision_reason,decided_at,reviewer_id,decision_command_id FROM order_approvals ORDER BY id').all();
    assert.deepEqual(approvals, f.before.approvals);
    const waste = db.prepare('SELECT id,branch_id,ingredient_id,quantity_milli,reason,note,actor_id,accepted_at,command_id FROM waste_entries').all();
    assert.deepEqual(waste, f.before.waste);
    assert.deepEqual(db.prepare('SELECT id,branch_id,ingredient_id,quantity_milli,kind,receipt_id,order_id,waste_id,command_id,accepted_at FROM stock_movements ORDER BY sequence').all(), f.before.movements);
    assert.deepEqual(db.prepare('SELECT * FROM stock_movement_valuations').all(), f.before.values);
    assert.deepEqual(db.prepare('SELECT * FROM ingredient_valuation_balances').all(), f.before.balances);
    assert.deepEqual(db.prepare('SELECT id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id FROM command_receipts ORDER BY id').all(), f.before.commands);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE outcome<>'accepted' OR rejection_status IS NOT NULL").get()!.count, 0);
    assert.deepEqual(db.prepare('SELECT * FROM audit_events ORDER BY id').all(), f.before.audit);
    assert.deepEqual(db.prepare('SELECT * FROM outbox ORDER BY id').all(), f.before.outbox);
    assert.throws(() => db.prepare('UPDATE stock_movements SET waste_id=? WHERE id=?').run('missing-waste', 'legacy-waste-movement'), /FOREIGN KEY/);
  } finally { migrated.close(); }
  const reopened = new HubDatabase(f.path);
  try {
    assert.equal(reopened.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()!.count, 20);
    assert.deepEqual(reopened.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { reopened.close(); }
});

test('cancellation migration rejects broken legacy references with schema and all accepted records preserved', async (t) => {
  const f = await legacyFixture(t, true);
  assert.throws(() => new HubDatabase(f.path));
  const retained = new DatabaseSync(f.path);
  try {
    assert.equal(retained.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 7);
    assert.deepEqual(retained.prepare('SELECT * FROM order_approvals ORDER BY id').all(), f.before.approvals);
    assert.deepEqual(retained.prepare('SELECT * FROM waste_entries').all(), f.before.waste);
    assert.deepEqual(retained.prepare('SELECT * FROM stock_movements').all(), f.before.movements);
    assert.deepEqual(retained.prepare('SELECT * FROM command_receipts ORDER BY id').all(), f.before.commands);
    assert.deepEqual(retained.prepare('SELECT * FROM audit_events ORDER BY id').all(), f.before.audit);
    assert.deepEqual(retained.prepare('SELECT * FROM outbox ORDER BY id').all(), f.before.outbox);
  } finally { retained.close(); }
});

test('concurrent hub starts both accept the same completed schema 17 upgrade', async (t) => {
  const f = await legacyFixture(t);
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const workerCode = `
    const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    const barrier = new Int32Array(workerData.barrier);
    const exec = DatabaseSync.prototype.exec;
    let synchronized = false;
    DatabaseSync.prototype.exec = function (statement) {
      if (!synchronized && statement === 'BEGIN IMMEDIATE') {
        synchronized = true;
        if (Atomics.add(barrier, 0, 1) === 1) Atomics.notify(barrier, 0);
        else if (Atomics.wait(barrier, 0, 1, 10_000) === 'timed-out') throw new Error('Other hub did not enter migration');
      }
      return exec.call(this, statement);
    };
    import(workerData.moduleUrl).then(({ HubDatabase }) => {
      const db = new HubDatabase(workerData.path);
      try {
        parentPort.postMessage({
          schema: db.connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
          enforcement: db.connection.prepare('PRAGMA foreign_keys').get().foreign_keys,
        });
      } finally { db.close(); }
    }).catch(error => { throw error; });
  `;
  const start = () => new Promise<unknown>((resolveWorker, rejectWorker) => {
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { path: f.path, barrier, moduleUrl: new URL('../src/database.ts', import.meta.url).href },
    });
    let result: unknown;
    worker.once('message', (value: unknown) => { result = value; });
    worker.once('error', rejectWorker);
    worker.once('exit', (code) => {
      if (code !== 0 || result === undefined) rejectWorker(new Error(`Migration worker exited with code ${code}.`));
      else resolveWorker(result);
    });
  });
  const starts = await Promise.allSettled([start(), start()]);
  for (const opened of starts) {
    if (opened.status === 'rejected') throw opened.reason;
    assert.deepEqual(opened.value, { schema: 20, enforcement: 1 });
  }
  assert.equal(new Int32Array(barrier)[0], 2);
  const inspect = new DatabaseSync(f.path, { readOnly: true });
  try {
    assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=8').get()!.count, 1);
    assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(inspect.prepare('SELECT id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id FROM command_receipts ORDER BY id').all(), f.before.commands);
    assert.equal(inspect.prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE outcome<>'accepted' OR rejection_status IS NOT NULL").get()!.count, 0);
  } finally { inspect.close(); }
});
