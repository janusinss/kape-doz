import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HubDatabase } from '../src/database.js';
import { BusinessService } from '../src/business.js';

test('schema 15 preserves schema 14 alerts and thresholds without inventing old threshold history', async t => {
  const root = resolve(tmpdir());
  const prefix = join(root, 'kape-doz-threshold-history-');
  const folder = await mkdtemp(prefix);
  t.after(async () => {
    const target = resolve(folder);
    assert.equal(dirname(target), root);
    assert.ok(target.startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  const path = join(folder, 'hub.sqlite');
  const prior = new DatabaseSync(path);
  const alertId = randomUUID();
  const originalEvent = randomUUID();
  let thresholdBefore: unknown;
  let alertBefore: unknown;
  let eventsBefore: unknown;
  try {
    prior.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
    const folderUrl = new URL('../migrations/', import.meta.url);
    const migrations = (await readdir(folderUrl)).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().slice(0, 14);
    assert.equal(migrations.at(-1), '014_inventory_alerts.sql');
    for (const [index, name] of migrations.entries()) {
      prior.exec(await readFile(new URL(name, folderUrl), 'utf8'));
      prior.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
    }
    prior.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(1,?)').run(randomUUID());
    prior.prepare("INSERT INTO branches(id) VALUES('branch')").run();
    prior.prepare("INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES('owner','branch','Owner','owner','fixture')").run();
    prior.prepare("INSERT INTO ingredients(branch_id,id,name,unit) VALUES('branch','beans','Beans','g')").run();
    prior.prepare("INSERT INTO ingredient_stock_thresholds(branch_id,ingredient_id,version,threshold_milli) VALUES('branch','beans',2,100)").run();
    prior.prepare(`INSERT INTO inventory_alerts(id,branch_id,ingredient_id,kind,status,version,on_hand_milli,reserved_milli,
      available_milli,threshold_milli,opened_at,last_evaluated_at) VALUES(?,'branch','beans','low_stock','open',1,0,0,0,100,1,1)`).run(alertId);
    prior.prepare(`INSERT INTO inventory_alert_events(id,alert_id,version,type,command_id,actor_id,at,note,
      on_hand_milli,reserved_milli,available_milli,threshold_milli) VALUES(?,?,1,'opened',NULL,NULL,1,NULL,0,0,0,100)`).run(originalEvent, alertId);
    assert.equal(prior.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='inventory_threshold_events'").get()!.n, 0);
    thresholdBefore = prior.prepare('SELECT * FROM ingredient_stock_thresholds').all();
    alertBefore = prior.prepare('SELECT * FROM inventory_alerts').all();
    eventsBefore = prior.prepare('SELECT * FROM inventory_alert_events').all();
  } finally { prior.close(); }

  const store = new HubDatabase(path);
  try {
    const db = store.connection;
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.deepEqual(db.prepare('SELECT * FROM ingredient_stock_thresholds').all(), thresholdBefore);
    assert.deepEqual(db.prepare('SELECT * FROM inventory_alerts').all(), alertBefore);
    assert.deepEqual(db.prepare('SELECT * FROM inventory_alert_events').all(), eventsBefore);
    assert.deepEqual(db.prepare('SELECT * FROM inventory_threshold_events').all(), []);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    const service = new BusinessService(store, () => 10);
    const actor = { id: 'owner', branchId: 'branch', role: 'owner' as const, displayName: 'Owner' };
    const commandId = randomUUID();
    const input = { commandId, expectedVersion: 2, thresholdMilli: 150, reason: 'First recorded change' };
    const accepted = service.setStockThreshold(actor, 'beans', input);
    assert.equal(accepted.threshold.version, 3);
    assert.deepEqual(service.setStockThreshold(actor, 'beans', input), accepted);
    const history = db.prepare(`SELECT old_threshold_milli,new_threshold_milli,version,reason,actor_id,command_id
      FROM inventory_threshold_events`).all();
    assert.equal(history.length, 1);
    assert.deepEqual({ ...history[0] }, { old_threshold_milli: 100, new_threshold_milli: 150, version: 3,
      reason: input.reason, actor_id: actor.id, command_id: commandId });
  } finally { store.close(); }
  const reopened = new HubDatabase(path);
  try {
    assert.equal(reopened.connection.prepare('SELECT COUNT(*) AS count FROM inventory_threshold_events').get()!.count, 1);
    assert.deepEqual(reopened.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { reopened.close(); }
});
