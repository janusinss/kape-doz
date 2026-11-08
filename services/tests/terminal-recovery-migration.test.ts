import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HubDatabase } from '../src/database.js';

test('schema 9 receipts retain accepted outcomes and enforce explicit terminal rejection status after upgrade', async (t) => {
  const root = resolve(tmpdir());
  const directory = await mkdtemp(join(root, 'kape-doz-terminal-migration-'));
  const path = join(directory, 'hub.sqlite');
  let legacy: DatabaseSync | undefined = new DatabaseSync(path);
  let current: HubDatabase | undefined;
  t.after(async () => {
    legacy?.close();
    current?.close();
    const target = resolve(directory);
    assert.equal(dirname(target), root);
    assert.ok(target.startsWith(join(root, 'kape-doz-terminal-migration-')));
    await rm(target, { recursive: true, force: true });
  });
  legacy.exec('PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
  for (const [index, name] of [
    '001_authority.sql', '002_auth_reservations.sql', '003_business.sql', '004_command_context.sql',
    '005_operating_expenses.sql', '006_sales_valuation.sql', '007_order_approvals.sql', '008_order_cancellations.sql', '009_refunds.sql',
  ].entries()) {
    legacy.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    legacy.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
  }
  legacy.exec('PRAGMA foreign_keys=ON');
  legacy.prepare('INSERT INTO branches(id) VALUES(?)').run('branch');
  legacy.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)')
    .run('owner', 'branch', 'Legacy owner', 'owner', 'preserved-credential');
  const commandId = randomUUID();
  const response = JSON.stringify({ commandId, preserved: true });
  legacy.prepare('INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at) VALUES(?,?,?,?,?,?,?)')
    .run(commandId, 'owner', 'branch', 'inventory.receive', 'preserved-fingerprint', response, 100);
  legacy.prepare('INSERT INTO audit_events(id,command_id,actor_id,branch_id,action,payload_json,accepted_at) VALUES(?,?,?,?,?,?,?)')
    .run('legacy-audit', commandId, 'owner', 'branch', 'inventory.receive', '{"preserved":true}', 100);
  legacy.prepare('INSERT INTO outbox(id,command_id,branch_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)')
    .run('legacy-outbox', commandId, 'branch', 'inventory.receive', '{"preserved":true}', 100);
  const receipt = legacy.prepare('SELECT * FROM command_receipts').get();
  const audit = legacy.prepare('SELECT * FROM audit_events').all();
  const outbox = legacy.prepare('SELECT * FROM outbox').all();
  legacy.close();
  legacy = undefined;
  current = new HubDatabase(path);
  const db = current.connection;
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
  assert.deepEqual(db.prepare('SELECT id,actor_id,branch_id,action,fingerprint,response_json,accepted_at,device_id FROM command_receipts WHERE id=?').get(commandId), receipt);
  assert.deepEqual({ ...db.prepare('SELECT outcome,rejection_status FROM command_receipts WHERE id=?').get(commandId) }, { outcome: 'accepted', rejection_status: null });
  assert.deepEqual(db.prepare('SELECT * FROM audit_events').all(), audit);
  assert.deepEqual(db.prepare('SELECT * FROM outbox').all(), outbox);
  assert.throws(() => db.prepare('UPDATE command_receipts SET outcome=\'rejected\',rejection_status=NULL WHERE id=?').run(commandId), /CHECK/);
  assert.throws(() => db.prepare('UPDATE command_receipts SET outcome=\'accepted\',rejection_status=409 WHERE id=?').run(commandId), /CHECK/);
  assert.throws(() => db.prepare('UPDATE command_receipts SET outcome=\'rejected\',rejection_status=500 WHERE id=?').run(commandId), /CHECK/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  current.close();
  current = new HubDatabase(path);
  assert.deepEqual({ ...current.connection.prepare('SELECT outcome,rejection_status FROM command_receipts WHERE id=?').get(commandId) }, { outcome: 'accepted', rejection_status: null });
});
