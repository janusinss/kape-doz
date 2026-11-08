import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HubDatabase } from '../src/database.js';

test('schema 6 approval upgrade preserves legacy prices, payment, settlement and command history with zero discount', async (t) => {
  const tempRoot = resolve(tmpdir());
  const folder = await mkdtemp(join(tempRoot, 'kape-doz-approval-migration-'));
  const path = join(folder, 'hub.sqlite');
  let legacy: DatabaseSync | undefined = new DatabaseSync(path);
  let migrated: HubDatabase | undefined;
  t.after(async () => {
    legacy?.close();
    migrated?.close();
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(join(tempRoot, 'kape-doz-approval-migration-')));
    await rm(target, { recursive: true, force: true });
  });

  legacy.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
  const migrations = [
    '001_authority.sql', '002_auth_reservations.sql', '003_business.sql',
    '004_command_context.sql', '005_operating_expenses.sql', '006_sales_valuation.sql',
  ];
  for (const [index, name] of migrations.entries()) {
    legacy.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    legacy.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
  }
  const branchId = 'legacy-branch';
  const actorId = 'legacy-cashier';
  const commandId = 'legacy-command';
  const priceCentavos = 16_500;
  const at = Date.UTC(2026, 10, 5, 8);
  legacy.prepare('INSERT INTO branches(id) VALUES(?)').run(branchId);
  legacy.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)')
    .run(actorId, branchId, 'Preserved cashier', 'cashier', 'preserved-credential-hash');
  legacy.prepare('INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at) VALUES(?,?,?,?,?,?,?)')
    .run(commandId, actorId, branchId, 'fixture', 'preserved-fingerprint', '{"preserved":true}', at);
  legacy.prepare('INSERT INTO ingredients(branch_id,id,name,unit) VALUES(?,?,?,?)').run(branchId, 'beans', 'Preserved beans', 'g');
  legacy.prepare('INSERT INTO products(branch_id,id,name,price_centavos,version) VALUES(?,?,?,?,1)')
    .run(branchId, 'latte', 'Preserved latte', priceCentavos);
  for (const [id, orderNo] of [['legacy-paid', 1], ['legacy-open', 2]] as const) {
    legacy.prepare('INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,total_centavos) VALUES(?,?,?,1,0,?,?,?,?)')
      .run(id, branchId, orderNo, '', 'after_payment', at, priceCentavos);
    legacy.prepare('INSERT INTO order_lines(branch_id,order_id,line_no,product_id,name,quantity,unit_price_centavos,note) VALUES(?,?,0,?,?,1,?,?)')
      .run(branchId, id, 'latte', 'Preserved latte', priceCentavos, 'Preserved note');
  }
  legacy.prepare('INSERT INTO payments(id,branch_id,order_id,method,amount_centavos,status,cash_received_centavos,change_centavos,accepted_at,command_id) VALUES(?,?,?,\'cash\',?,\'confirmed\',?,?,?,?)')
    .run('legacy-payment', branchId, 'legacy-paid', priceCentavos, 20_000, 3_500, at, commandId);
  legacy.prepare('INSERT INTO order_settlements(branch_id,order_id,settled_at,business_date,total_centavos,command_id) VALUES(?,?,?,?,?,?)')
    .run(branchId, 'legacy-paid', at, '2026-11-05', priceCentavos, commandId);
  const orders = legacy.prepare('SELECT id,total_centavos,version FROM orders ORDER BY id').all();
  const lines = legacy.prepare('SELECT * FROM order_lines ORDER BY order_id,line_no').all();
  const payments = legacy.prepare('SELECT * FROM payments').all();
  const settlements = legacy.prepare('SELECT * FROM order_settlements').all();
  const commands = legacy.prepare('SELECT * FROM command_receipts').all();
  const accounts = legacy.prepare('SELECT * FROM accounts').all();
  legacy.close();
  legacy = undefined;

  migrated = new HubDatabase(path);
  const db = migrated.connection;
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
  assert.deepEqual(db.prepare('SELECT id,total_centavos,version FROM orders ORDER BY id').all(), orders);
  const defaults = db.prepare('SELECT id,discount_centavos FROM orders ORDER BY id').all();
  assert.deepEqual(defaults.map((row) => ({ ...row })), [
    { id: 'legacy-open', discount_centavos: 0 }, { id: 'legacy-paid', discount_centavos: 0 },
  ]);
  assert.deepEqual(db.prepare(`SELECT branch_id,order_id,line_no,product_id,name,quantity,unit_price_centavos,note,recipe_version
    FROM order_lines ORDER BY order_id,line_no`).all(), lines);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_lines WHERE retired<>0').get()!.count, 0);
  assert.deepEqual(db.prepare('SELECT * FROM payments').all(), payments);
  assert.deepEqual(db.prepare('SELECT branch_id,order_id,settled_at,business_date,total_centavos,command_id FROM order_settlements').all(), settlements);
  assert.equal(db.prepare('SELECT discount_centavos FROM order_settlements WHERE order_id=?').get('legacy-paid')!.discount_centavos, 0);
  assert.deepEqual(db.prepare('SELECT id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id FROM command_receipts').all(), commands);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE outcome<>'accepted' OR rejection_status IS NOT NULL").get()!.count, 0);
  assert.deepEqual(db.prepare('SELECT * FROM accounts').all(), accounts);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.prepare('UPDATE orders SET discount_centavos=-1 WHERE id=?').run('legacy-open'), /CHECK/);
  assert.equal(db.prepare('SELECT discount_centavos FROM orders WHERE id=?').get('legacy-open')!.discount_centavos, 0);

  migrated.close();
  migrated = new HubDatabase(path);
  assert.equal(migrated.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()!.count, 20);
  assert.deepEqual(migrated.connection.prepare('SELECT id,total_centavos,version FROM orders ORDER BY id').all(), orders);
});
