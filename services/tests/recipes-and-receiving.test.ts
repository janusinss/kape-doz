import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HubDatabase } from '../src/database.js';
import { createHub } from '../src/hub.js';

function ok<T>(response: { statusCode: number; body: string; json: () => unknown }, expected = 200): T {
  assert.equal(response.statusCode, expected, response.body);
  return response.json() as T;
}

test('schema 17 upgrades legacy receipts and product versions while preserving existing prices and options defaults', async t => {
  const root = resolve(tmpdir());
  const prefix = join(root, 'kape-recipes-receiving-migration-');
  const folder = await mkdtemp(prefix);
  t.after(async () => {
    const target = resolve(folder);
    assert.equal(dirname(target), root);
    assert.ok(target.startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  const path = join(folder, 'hub.sqlite');
  const previous = new DatabaseSync(path);
  try {
    previous.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
    const migrationFolder = new URL('../migrations/', import.meta.url);
    const migrations = (await readdir(migrationFolder)).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().slice(0, 16);
    assert.equal(migrations.at(-1), '016_product_availability.sql');
    for (const [index, name] of migrations.entries()) {
      previous.exec(await readFile(new URL(name, migrationFolder), 'utf8'));
      previous.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
    }
    previous.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(1,?)').run(randomUUID());
    previous.exec(`
      INSERT INTO branches(id) VALUES('branch');
      INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES('owner','branch','Owner','owner','fixture');
      INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at)
        VALUES('cmd-1','owner','branch','inventory.receive','fp','{}',100);
      INSERT INTO ingredients(branch_id,id,name,unit) VALUES('branch','beans','Beans','g');
      INSERT INTO stock_receipts(id,branch_id,ingredient_id,quantity_milli,total_cost_centavos,reference,actor_id,accepted_at,command_id)
        VALUES('rcpt-1','branch','beans',2000000,160000,'INV-1','owner',100,'cmd-1');
      INSERT INTO products(branch_id,id,name,price_centavos,version) VALUES('branch','latte','Latte',16500,1);
      INSERT INTO product_versions(branch_id,product_id,version) VALUES('branch','latte',1);
      INSERT INTO product_recipe(branch_id,product_id,version,ingredient_id,quantity_milli) VALUES('branch','latte',1,'beans',18000);
    `);
  } finally {
    previous.close();
  }

  const migrated = new HubDatabase(path);
  try {
    const db = migrated.connection;
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.deepEqual(
      { ...db.prepare('SELECT supplier,pack_count,pack_size_milli,quantity_milli FROM stock_receipts WHERE id=?').get('rcpt-1') },
      { supplier: '', pack_count: 1, pack_size_milli: 2000000, quantity_milli: 2000000 },
    );
    assert.deepEqual(
      { ...db.prepare('SELECT price_centavos,options_json FROM product_versions WHERE product_id=? AND version=1').get('latte') },
      { price_centavos: 16500, options_json: '{}' },
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    migrated.close();
  }
});

test('F04-02 stock receipts convert supplier pack counts into ingredient units, update weighted-average cost atomically, and ignore duplicates', async () => {
  let now = Date.UTC(2026, 10, 7, 8, 0, 0);
  const hub = await createHub({ databasePath: ':memory:', now: () => (now += 1000) });
  try {
    await hub.provisionAccount({ id: 'owner', branchId: 'main', displayName: 'Owner', role: 'owner', secret: 'Owner-Secret-1!' });
    const owner = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner', password: 'Owner-Secret-1!' },
    })).token;
    const post = (url: string, payload: Record<string, unknown>) =>
      hub.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${owner}` }, payload });
    const get = (url: string) =>
      hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${owner}` } });

    ok(await post('/api/v1/ingredients', { commandId: randomUUID(), ingredientId: 'oat-milk', name: 'Oat Milk', unit: 'ml' }));

    const receiveCmd = randomUUID();
    const receivePayload = {
      commandId: receiveCmd,
      ingredientId: 'oat-milk',
      supplier: 'Barista Depot',
      packCount: 6,
      packSizeMilli: 1_000_000,
      totalCostCentavos: 90_000,
      reference: 'PO-2026-101',
    };
    const first = ok<{
      commandId: string;
      ingredient: { id: string; onHandMilli: number; reservedMilli: number };
      receipt: {
        id: string;
        ingredientId: string;
        supplier: string;
        packCount: number;
        packSizeMilli: number;
        quantityMilli: number;
        totalCostCentavos: number;
        reference: string;
      };
    }>(await post('/api/v1/inventory/receipts', receivePayload));

    assert.equal(first.commandId, receiveCmd);
    assert.equal(first.ingredient.onHandMilli, 6_000_000);
    assert.deepEqual(first.receipt, {
      id: first.receipt.id,
      ingredientId: 'oat-milk',
      supplier: 'Barista Depot',
      packCount: 6,
      packSizeMilli: 1_000_000,
      quantityMilli: 6_000_000,
      totalCostCentavos: 90_000,
      reference: 'PO-2026-101',
    });

    const duplicate = ok<typeof first>(await post('/api/v1/inventory/receipts', receivePayload));
    assert.deepEqual(duplicate, first);

    const mismatch = await post('/api/v1/inventory/receipts', {
      commandId: randomUUID(),
      ingredientId: 'oat-milk',
      supplier: 'Barista Depot',
      packCount: 2,
      packSizeMilli: 1_000_000,
      quantityMilli: 1_500_000,
      totalCostCentavos: 30_000,
      reference: 'PO-MISMATCH',
    });
    assert.equal(mismatch.statusCode, 400);

    const second = ok<typeof first>(await post('/api/v1/inventory/receipts', {
      commandId: randomUUID(),
      ingredientId: 'oat-milk',
      supplier: 'Roaster Supply',
      packCount: 2,
      packSizeMilli: 1_000_000,
      totalCostCentavos: 50_000,
      reference: 'PO-2026-102',
    }));
    assert.equal(second.ingredient.onHandMilli, 8_000_000);

    const list = ok<{ ingredients: { id: string; onHandMilli: number }[] }>(await get('/api/v1/ingredients'));
    assert.equal(list.ingredients.find(i => i.id === 'oat-milk')?.onHandMilli, 8_000_000);
  } finally {
    await hub.close();
  }
});

test('F04-01 recipe variants, milk substitutions, extra shots, service packaging, and versioned updates keep accepted orders on their original recipe version', async t => {
  const root = resolve(tmpdir());
  const prefix = join(root, 'kape-f04-01-');
  const folder = await mkdtemp(prefix);
  t.after(async () => {
    const target = resolve(folder);
    assert.equal(dirname(target), root);
    assert.ok(target.startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  const dbPath = join(folder, 'hub.sqlite');
  let now = Date.UTC(2026, 10, 7, 9, 0, 0);
  const hub = await createHub({ databasePath: dbPath, now: () => (now += 1000) });
  try {
    await hub.provisionAccount({ id: 'owner', branchId: 'main', displayName: 'Owner', role: 'owner', secret: 'Owner-Secret-1!' });
    await hub.provisionAccount({ id: 'cashier', branchId: 'main', displayName: 'Cashier', role: 'cashier', secret: '1234' });
    await hub.provisionAccount({ id: 'barista', branchId: 'main', displayName: 'Barista', role: 'barista', secret: '5678' });
    await hub.provisionDevice({ id: 'pos-1', branchId: 'main', secret: 'pos-secret-123456789012345678901234' });
    await hub.provisionDevice({ id: 'kds-1', branchId: 'main', secret: 'kds-secret-123456789012345678901234' });

    const owner = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner', password: 'Owner-Secret-1!' },
    })).token;
    const cashier = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/staff', payload: { accountId: 'cashier', pin: '1234', deviceId: 'pos-1', deviceSecret: 'pos-secret-123456789012345678901234' },
    })).token;
    const barista = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/staff', payload: { accountId: 'barista', pin: '5678', deviceId: 'kds-1', deviceSecret: 'kds-secret-123456789012345678901234' },
    })).token;

    const post = (url: string, token: string, payload: Record<string, unknown>) =>
      hub.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
    const get = (url: string, token = owner) =>
      hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

    for (const [ingredientId, name, unit, packSizeMilli, totalCostCentavos] of [
      ['beans', 'Espresso Beans', 'g', 1_000_000, 100_000],
      ['whole-milk', 'Whole Milk', 'ml', 1_000_000, 10_000],
      ['oat-milk', 'Oat Milk', 'ml', 1_000_000, 20_000],
      ['syrup', 'Vanilla Syrup', 'ml', 1_000_000, 15_000],
      ['ceramic-prep', 'Dine-In Sleeve', 'piece', 100_000, 5_000],
      ['to-go-cup', 'Takeout Cup & Lid', 'piece', 100_000, 10_000],
    ] as const) {
      ok(await post('/api/v1/ingredients', owner, { commandId: randomUUID(), ingredientId, name, unit }));
      ok(await post('/api/v1/inventory/receipts', owner, {
        commandId: randomUUID(),
        ingredientId,
        supplier: 'Main Supplier',
        packCount: 1,
        packSizeMilli,
        totalCostCentavos,
        reference: `INIT-${ingredientId}`,
      }));
    }

    const createLatte = ok<{ product: { id: string; version: number; options: unknown } }>(await post('/api/v1/products', owner, {
      commandId: randomUUID(),
      productId: 'cafe-latte',
      name: 'Cafe Latte',
      priceCentavos: 15000,
      recipe: [
        { ingredientId: 'beans', quantityMilli: 18000 },
        { ingredientId: 'whole-milk', quantityMilli: 180000 },
      ],
      sizes: [
        {
          id: 'large',
          name: '16oz Large',
          priceDeltaCentavos: 3000,
          recipe: [
            { ingredientId: 'beans', quantityMilli: 24000 },
            { ingredientId: 'whole-milk', quantityMilli: 240000 },
          ],
        },
      ],
      substitutions: [
        {
          id: 'sub-oat',
          name: 'Oat Milk',
          priceDeltaCentavos: 2500,
          replaceIngredientId: 'whole-milk',
          withIngredientId: 'oat-milk',
          quantityMilli: 240000,
        },
      ],
      addons: [
        {
          id: 'extra-shot',
          name: 'Extra Espresso Shot',
          priceDeltaCentavos: 2000,
          recipe: [{ ingredientId: 'beans', quantityMilli: 9000 }],
        },
        {
          id: 'vanilla',
          name: 'Vanilla Pump',
          priceDeltaCentavos: 1500,
          recipe: [{ ingredientId: 'syrup', quantityMilli: 15000 }],
        },
      ],
      dineInPackaging: [{ ingredientId: 'ceramic-prep', quantityMilli: 1000 }],
      takeoutPackaging: [{ ingredientId: 'to-go-cup', quantityMilli: 1000 }],
    }));
    assert.equal(createLatte.product.version, 1);

    const dineInOrder = ok<{ order: { id: string; version: number; totalCentavos: number; lines: { name: string; unitPriceCentavos: number }[] } }>(
      await post('/api/v1/orders', cashier, {
        commandId: randomUUID(),
        dineIn: true,
        table: 'T-4',
        items: [
          {
            productId: 'cafe-latte',
            quantity: 1,
            sizeId: 'large',
            substitutionId: 'sub-oat',
            addons: [{ addonId: 'extra-shot', quantity: 2 }],
            note: 'Less ice',
          },
        ],
      }),
    );

    assert.equal(dineInOrder.order.totalCentavos, 15000 + 3000 + 2500 + 2 * 2000);
    assert.equal(dineInOrder.order.lines[0]!.unitPriceCentavos, 24500);
    assert.equal(dineInOrder.order.lines[0]!.name, 'Cafe Latte (16oz Large, Oat Milk, 2× Extra Espresso Shot)');

    const updatedRecipe = ok<{ product: { id: string; version: number; priceCentavos: number } }>(
      await post('/api/v1/products/cafe-latte/recipe', owner, {
        commandId: randomUUID(),
        expectedVersion: 1,
        name: 'Cafe Latte',
        priceCentavos: 17000,
        recipe: [
          { ingredientId: 'beans', quantityMilli: 20000 },
          { ingredientId: 'whole-milk', quantityMilli: 200000 },
        ],
        sizes: [
          {
            id: 'large',
            name: '16oz Large',
            priceDeltaCentavos: 3500,
            recipe: [
              { ingredientId: 'beans', quantityMilli: 28000 },
              { ingredientId: 'whole-milk', quantityMilli: 260000 },
            ],
          },
        ],
        substitutions: [
          {
            id: 'sub-oat',
            name: 'Oat Milk',
            priceDeltaCentavos: 3000,
            replaceIngredientId: 'whole-milk',
            withIngredientId: 'oat-milk',
            quantityMilli: 260000,
          },
        ],
        addons: [
          {
            id: 'extra-shot',
            name: 'Extra Espresso Shot',
            priceDeltaCentavos: 2500,
            recipe: [{ ingredientId: 'beans', quantityMilli: 10000 }],
          },
        ],
        dineInPackaging: [{ ingredientId: 'ceramic-prep', quantityMilli: 1000 }],
        takeoutPackaging: [{ ingredientId: 'to-go-cup', quantityMilli: 2000 }],
      }),
    );
    assert.equal(updatedRecipe.product.version, 2);

    const sentDineIn = ok<{ order: { id: string; version: number; totalCentavos: number } }>(
      await post(`/api/v1/orders/${dineInOrder.order.id}/send`, cashier, {
        commandId: randomUUID(),
        expectedVersion: dineInOrder.order.version,
      }),
    );
    assert.equal(sentDineIn.order.totalCentavos, 24500);

    const readyDineIn = ok<{ order: { version: number; ready: boolean } }>(
      await post(`/api/v1/orders/${dineInOrder.order.id}/ready`, barista, {
        commandId: randomUUID(),
        expectedVersion: sentDineIn.order.version,
      }),
    );
    assert.equal(readyDineIn.order.ready, true);

    const takeoutOrder = ok<{ order: { id: string; version: number; totalCentavos: number } }>(
      await post('/api/v1/orders', cashier, {
        commandId: randomUUID(),
        dineIn: false,
        items: [
          {
            productId: 'cafe-latte',
            quantity: 1,
          },
        ],
      }),
    );
    assert.equal(takeoutOrder.order.totalCentavos, 17000);

    const ingredientsAfter = ok<{ ingredients: { id: string; onHandMilli: number }[] }>(await get('/api/v1/ingredients'));
    const byId = new Map(ingredientsAfter.ingredients.map(i => [i.id, i.onHandMilli]));
    assert.equal(byId.get('beans'), 1_000_000 - 42000);
    assert.equal(byId.get('whole-milk'), 1_000_000);
    assert.equal(byId.get('oat-milk'), 1_000_000 - 240000);
    assert.equal(byId.get('ceramic-prep'), 100_000 - 1000);

    const inspect = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(
        inspect.prepare('SELECT recipe_version FROM order_lines WHERE order_id=? AND line_no=0').get(dineInOrder.order.id)!.recipe_version,
        1,
      );
      assert.deepEqual(
        inspect.prepare('SELECT ingredient_id,quantity_milli FROM order_line_recipe WHERE order_id=? AND line_no=0 ORDER BY ingredient_id').all(dineInOrder.order.id).map(r => ({ ...r })),
        [
          { ingredient_id: 'beans', quantity_milli: 42000 },
          { ingredient_id: 'ceramic-prep', quantity_milli: 1000 },
          { ingredient_id: 'oat-milk', quantity_milli: 240000 },
        ],
      );
      assert.equal(
        inspect.prepare('SELECT recipe_version FROM order_lines WHERE order_id=? AND line_no=0').get(takeoutOrder.order.id)!.recipe_version,
        2,
      );
      assert.deepEqual(
        inspect.prepare('SELECT ingredient_id,quantity_milli FROM order_line_recipe WHERE order_id=? AND line_no=0 ORDER BY ingredient_id').all(takeoutOrder.order.id).map(r => ({ ...r })),
        [
          { ingredient_id: 'beans', quantity_milli: 20000 },
          { ingredient_id: 'to-go-cup', quantity_milli: 2000 },
          { ingredient_id: 'whole-milk', quantity_milli: 200000 },
        ],
      );
    } finally {
      inspect.close();
    }
  } finally {
    await hub.close();
  }
});
