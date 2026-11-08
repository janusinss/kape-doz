import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HubDatabase } from '../src/database.js';

test('schema 16 preserves legacy products and recipe versions while enabling existing products', async t => {
  const root = resolve(tmpdir());
  const prefix = join(root, 'kape-product-migration-');
  const folder = await mkdtemp(prefix);
  t.after(async () => { const target = resolve(folder); assert.equal(dirname(target), root); assert.ok(target.startsWith(prefix)); await rm(target, { recursive: true, force: true }); });
  const path = join(folder, 'hub.sqlite');
  const previous = new DatabaseSync(path);
  try {
    previous.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
    const migrationFolder = new URL('../migrations/', import.meta.url);
    const migrations = (await readdir(migrationFolder)).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().slice(0, 15);
    assert.equal(migrations.at(-1), '015_threshold_history.sql');
    for (const [index, name] of migrations.entries()) {
      previous.exec(await readFile(new URL(name, migrationFolder), 'utf8'));
      previous.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
    }
    previous.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(1,?)').run(randomUUID());
    previous.exec("INSERT INTO branches(id) VALUES('branch'); INSERT INTO ingredients(branch_id,id,name,unit) VALUES('branch','beans','Beans','g'); INSERT INTO products(branch_id,id,name,price_centavos,version) VALUES('branch','latte','Latte',16500,1); INSERT INTO product_versions(branch_id,product_id,version) VALUES('branch','latte',1); INSERT INTO product_recipe(branch_id,product_id,version,ingredient_id,quantity_milli) VALUES('branch','latte',1,'beans',18000);");
  } finally { previous.close(); }
  const migrated = new HubDatabase(path);
  try {
    const db = migrated.connection;
    assert.deepEqual({ ...db.prepare('SELECT id,name,price_centavos,version,available,availability_version FROM products').get() },
      { id: 'latte', name: 'Latte', price_centavos: 16500, version: 1, available: 1, availability_version: 1 });
    assert.deepEqual({ ...db.prepare('SELECT version,ingredient_id,quantity_milli FROM product_recipe').get() }, { version: 1, ingredient_id: 'beans', quantity_milli: 18000 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_availability_events').get()!.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM unreleased_order_replacements').get()!.n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
  } finally { migrated.close(); }
  const reopened = new HubDatabase(path);
  try { assert.equal(reopened.connection.prepare('SELECT available FROM products').get()!.available, 1); }
  finally { reopened.close(); }
});
