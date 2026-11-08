import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { HubDatabase } from '../src/database.js';

const legacyColumns = 'id,branch_id,ingredient_id,quantity_milli,kind,receipt_id,order_id,waste_id,command_id,accepted_at';

async function schemaTwelve(t: TestContext, unsafe = false) {
  const tempRoot = resolve(tmpdir());
  const prefix = join(tempRoot, 'kape-doz-count-migration-');
  const folder = await mkdtemp(prefix);
  t.after(async () => {
    const target = resolve(folder);
    assert.equal(dirname(target), tempRoot);
    assert.ok(target.startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  const path = join(folder, 'hub.sqlite');
  const db = new DatabaseSync(path);
  const authorityId = randomUUID();
  try {
    db.exec('PRAGMA foreign_keys=OFF; PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
    const migrationFolder = new URL('../migrations/', import.meta.url);
    const migrations = (await readdir(migrationFolder)).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().slice(0, 12);
    assert.equal(migrations.at(-1), '012_sent_order_amendments.sql');
    for (const [index, name] of migrations.entries()) {
      db.exec(await readFile(new URL(name, migrationFolder), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
    }
    db.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(1,?)').run(authorityId);
    db.exec('PRAGMA foreign_keys=ON');

    for (const branch of ['north', 'south']) {
      db.prepare('INSERT INTO branches(id) VALUES(?)').run(branch);
      db.prepare("INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,'owner','fixture-hash')")
        .run(`owner-${branch}`, branch, `Owner ${branch}`);
      db.prepare("INSERT INTO ingredients(branch_id,id,name,unit) VALUES(?,'beans','Beans','g')").run(branch);
    }
    for (const [sequence, branch, quantity, at] of [
      [3, 'north', unsafe ? Number.MAX_SAFE_INTEGER : 1000, 200],
      [7, 'south', -500, 100],
      [10, 'north', unsafe ? 1 : -250, 100],
      [14, 'south', 900, 100],
    ] as const) {
      const id = `move-${sequence}`;
      const actor = `owner-${branch}`;
      const command = `command-${sequence}`;
      const source = `source-${sequence}`;
      db.prepare("INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at) VALUES(?,?,?,'inventory.legacy','fixture','{}',?)")
        .run(command, actor, branch, at);
      if (quantity > 0) {
        db.prepare("INSERT INTO stock_receipts(id,branch_id,ingredient_id,quantity_milli,total_cost_centavos,reference,actor_id,accepted_at,command_id) VALUES(?,?,'beans',?,1,'fixture',?,?,?)")
          .run(source, branch, quantity, actor, at, command);
      } else {
        db.prepare("INSERT INTO waste_entries(id,branch_id,ingredient_id,quantity_milli,reason,note,actor_id,accepted_at,command_id) VALUES(?,?,'beans',?,'dial_in','fixture',?,?,?)")
          .run(source, branch, -quantity, actor, at, command);
      }
      db.prepare(`INSERT INTO stock_movements(rowid,${legacyColumns}) VALUES(?,?,?,'beans',?,?,?,NULL,?,?,?)`)
        .run(sequence, id, branch, quantity, quantity > 0 ? 'receipt' : 'waste', quantity > 0 ? source : null, quantity < 0 ? source : null, command, at);
      db.prepare('INSERT INTO stock_movement_valuations(movement_id,value_microcentavos) VALUES(?,?)')
        .run(id, quantity > 0 ? 1_000_000 : null);
    }
    return {
      path, authorityId,
      movements: db.prepare(`SELECT ${legacyColumns} FROM stock_movements ORDER BY rowid`).all(),
      values: db.prepare('SELECT * FROM stock_movement_valuations ORDER BY movement_id').all(),
    };
  } finally { db.close(); }
}

test('schema 13 preserves movement links and builds running balances by original branch and movement order', async (t) => {
  const legacy = await schemaTwelve(t);
  const hub = new HubDatabase(legacy.path);
  const db = hub.connection;
  try {
    assert.equal(hub.authorityId, legacy.authorityId);
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(db.prepare(`SELECT ${legacyColumns} FROM stock_movements ORDER BY sequence`).all(), legacy.movements);
    assert.deepEqual(db.prepare('SELECT * FROM stock_movement_valuations ORDER BY movement_id').all(), legacy.values);
    const balances = db.prepare('SELECT sequence,quantity_after_milli FROM stock_movements ORDER BY sequence').all();
    assert.deepEqual(balances.map(row => [row.sequence, row.quantity_after_milli]), [[3, 1000], [7, -500], [10, 750], [14, 400]]);
    assert.throws(() => db.prepare("DELETE FROM stock_movements WHERE id='move-3'").run(), /FOREIGN KEY/);

    assert.throws(() => db.prepare("INSERT INTO stock_movements(id,branch_id,ingredient_id,quantity_milli,quantity_after_milli,kind,receipt_id,command_id,accepted_at) VALUES('wrong-balance','north','beans',1000,1751,'receipt','source-3','command-3',100)").run(), /Invalid stock movement sequence or balance/);
    assert.throws(() => db.prepare("INSERT INTO stock_movements(sequence,id,branch_id,ingredient_id,quantity_milli,quantity_after_milli,kind,receipt_id,command_id,accepted_at) VALUES(4,'out-of-order','north','beans',1000,2000,'receipt','source-3','command-3',100)").run(), /Invalid stock movement sequence or balance/);
    db.prepare("INSERT INTO stock_movements(id,branch_id,ingredient_id,quantity_milli,quantity_after_milli,kind,receipt_id,command_id,accepted_at) VALUES('new-movement','north','beans',1000,1750,'receipt','source-3','command-3',100)").run();
    assert.equal(db.prepare("SELECT sequence FROM stock_movements WHERE id='new-movement'").get()!.sequence, 15);
    assert.deepEqual(db.prepare("SELECT name FROM pragma_index_info('stock_history') ORDER BY seqno").all().map(row => row.name), ['branch_id', 'ingredient_id', 'sequence']);
  } finally { hub.close(); }
});

test('schema 13 rolls back an unsafe cumulative balance and keeps legacy records readable', async (t) => {
  const legacy = await schemaTwelve(t, true);
  assert.throws(() => new HubDatabase(legacy.path), /CHECK.*quantity_after_milli/);
  const db = new DatabaseSync(legacy.path, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 12);
    assert.deepEqual(db.prepare(`SELECT ${legacyColumns} FROM stock_movements ORDER BY rowid`).all(), legacy.movements);
    assert.deepEqual(db.prepare('SELECT * FROM stock_movement_valuations ORDER BY movement_id').all(), legacy.values);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('inventory_counts','stock_movements_next')").get()!.count, 0);
  } finally { db.close(); }
});
