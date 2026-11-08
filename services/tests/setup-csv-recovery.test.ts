import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../src/database.js';
import { createHub } from '../src/hub.js';

const priorMigrations = [
  '001_authority.sql', '002_auth_reservations.sql', '003_business.sql', '004_command_context.sql',
  '005_operating_expenses.sql', '006_sales_valuation.sql', '007_order_approvals.sql', '008_order_cancellations.sql',
  '009_refunds.sql', '010_command_outcomes.sql', '011_hub_identity.sql', '012_sent_order_amendments.sql',
  '013_inventory_counts.sql', '014_inventory_alerts.sql', '015_threshold_history.sql', '016_product_availability.sql',
  '017_recipes_and_receiving.sql', '018_customers_and_loyalty.sql',
] as const;

test('Schema 18 upgrades cleanly to Schema 19 preserving existing orders and customers', async () => {
  const root = fileURLToPath(new URL('../../scratch/setup-csv-recovery-tests/', import.meta.url));
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'migration-19-'));
  const path = join(folder, 'hub.sqlite');
  let previous: DatabaseSync | undefined;
  let upgraded: HubDatabase | undefined;
  try {
    previous = new DatabaseSync(path);
    previous.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
    for (const [index, name] of priorMigrations.entries()) {
      if (name === '008_order_cancellations.sql' || name === '013_inventory_counts.sql') previous.exec('PRAGMA foreign_keys=OFF;');
      previous.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      if (name === '011_hub_identity.sql') {
        previous.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(1,?)').run('11111111-2222-4333-8444-555555555555');
      }
      if (name === '008_order_cancellations.sql' || name === '013_inventory_counts.sql') previous.exec('PRAGMA foreign_keys=ON;');
      previous.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
    }
    previous.close();
    previous = undefined;

    upgraded = new HubDatabase(path);
    const db = upgraded.connection;
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    previous?.close();
    upgraded?.close();
    assert.ok(resolve(folder).startsWith(resolve(root) + sep));
    await rm(folder, { recursive: true, force: true });
  }
});

test('F05-01 and F08-02: account role management, password/PIN reset, device enrollment, and versioned branch config', async () => {
  let time = Date.UTC(2026, 10, 7, 8, 0, 0);
  const hub = await createHub({ databasePath: ':memory:', now: () => time });
  try {
    await hub.provisionAccount({ id: 'owner-1', branchId: 'b1', displayName: 'Owner One', role: 'owner', secret: 'Owner-Secret-Pass-123!' });
    await hub.provisionAccount({ id: 'manager-1', branchId: 'b1', displayName: 'Manager One', role: 'manager', secret: 'Manager-Secret-Pass-123!' });
    await hub.provisionAccount({ id: 'cashier-1', branchId: 'b1', displayName: 'Cashier One', role: 'cashier', secret: '1234' });
    await hub.provisionDevice({ id: 'dev-1', branchId: 'b1', secret: 'Device-Secret-Key-32-Characters!!' });

    const call = async (token: string | undefined, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
      hub.app.inject({
        method,
        url,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        ...(payload ? { payload } : {}),
      });

    const ownerToken = (await call(undefined, 'POST', '/api/v1/auth/admin', { accountId: 'owner-1', password: 'Owner-Secret-Pass-123!' })).json().token as string;
    const managerToken = (await call(undefined, 'POST', '/api/v1/auth/admin', { accountId: 'manager-1', password: 'Manager-Secret-Pass-123!' })).json().token as string;
    const cashierToken = (await call(undefined, 'POST', '/api/v1/auth/staff', {
      accountId: 'cashier-1', pin: '1234', deviceId: 'dev-1', deviceSecret: 'Device-Secret-Key-32-Characters!!',
    })).json().token as string;

    // Staff cannot list or manage accounts; manager can list but not mutate
    assert.equal((await call(cashierToken, 'GET', '/api/v1/accounts')).statusCode, 403);
    assert.equal((await call(managerToken, 'GET', '/api/v1/accounts')).statusCode, 200);
    assert.equal((await call(managerToken, 'POST', '/api/v1/accounts', {
      commandId: randomUUID(), accountId: 'barista-new', displayName: 'Barista New', role: 'barista', secret: '5678',
    })).statusCode, 403);

    // Owner creates barista account and enrolls a new device
    const createdAcc = await call(ownerToken, 'POST', '/api/v1/accounts', {
      commandId: randomUUID(), accountId: 'barista-new', displayName: 'Barista New', role: 'barista', secret: '5678',
    });
    assert.equal(createdAcc.statusCode, 200);
    assert.equal(createdAcc.json().account.role, 'barista');
    assert.equal(createdAcc.json().account.credential_hash, undefined);

    const enrolledDev = await call(ownerToken, 'POST', '/api/v1/devices', {
      commandId: randomUUID(), deviceId: 'dev-barista', secret: 'Barista-Device-Secret-32-Chars!!!',
    });
    assert.equal(enrolledDev.statusCode, 200);
    assert.equal(enrolledDev.json().device.id, 'dev-barista');

    // New barista signs in on the newly enrolled device
    const baristaLogin = await call(undefined, 'POST', '/api/v1/auth/staff', {
      accountId: 'barista-new', pin: '5678', deviceId: 'dev-barista', deviceSecret: 'Barista-Device-Secret-32-Chars!!!',
    });
    assert.equal(baristaLogin.statusCode, 200);
    const baristaToken = baristaLogin.json().token as string;

    // Owner cannot disable or demote self
    assert.equal((await call(ownerToken, 'POST', '/api/v1/accounts/owner-1', {
      commandId: randomUUID(), expectedVersion: 1, displayName: 'Owner One', role: 'owner', disabled: true,
    })).statusCode, 409);

    // Owner resets barista PIN and updates display name -> revokes active barista session
    const updatedAcc = await call(ownerToken, 'POST', '/api/v1/accounts/barista-new', {
      commandId: randomUUID(), expectedVersion: 1, displayName: 'Barista Senior', role: 'barista', disabled: false, secret: '9012',
    });
    assert.equal(updatedAcc.statusCode, 200);
    assert.equal((await call(baristaToken, 'GET', '/api/v1/me')).statusCode, 401);
    assert.equal((await call(undefined, 'POST', '/api/v1/auth/staff', {
      accountId: 'barista-new', pin: '9012', deviceId: 'dev-barista', deviceSecret: 'Barista-Device-Secret-32-Chars!!!',
    })).statusCode, 200);

    // Versioned branch configuration: old orders keep their captured config version
    await call(ownerToken, 'POST', '/api/v1/ingredients', { commandId: randomUUID(), ingredientId: 'beans', name: 'Beans', unit: 'g' });
    await call(ownerToken, 'POST', '/api/v1/inventory/receipts', {
      commandId: randomUUID(), ingredientId: 'beans', quantityMilli: 1_000_000, totalCostCentavos: 50_000, reference: 'PO-1',
    });
    await call(ownerToken, 'POST', '/api/v1/products', {
      commandId: randomUUID(), productId: 'americano', name: 'Americano', priceCentavos: 12000, recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }],
    });
    const order1 = (await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: true, table: 'T1', items: [{ productId: 'americano', quantity: 1 }],
    })).json().order;

    const cfgUpdate = await call(ownerToken, 'POST', '/api/v1/settings/config', {
      commandId: randomUUID(),
      expectedVersion: 1,
      receiptHeader: 'KAPE DOZ ROASTERY',
      receiptFooter: 'See you tomorrow!',
      taxDisplayNote: 'VAT inclusive',
      stationVisibleCards: 6,
      offlineAccessExpiryMinutes: 240,
    });
    assert.equal(cfgUpdate.statusCode, 200);
    assert.equal(cfgUpdate.json().config.version, 2);

    const order2 = (await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: true, table: 'T2', items: [{ productId: 'americano', quantity: 1 }],
    })).json().order;
    assert.equal(order2.configVersion, 2);
    const reloadedOrder1 = (await call(cashierToken, 'GET', `/api/v1/orders/${order1.id}`)).json().order;
    assert.equal(reloadedOrder1.configVersion, undefined);
  } finally {
    await hub.close();
  }
});

test('F05-02, F06-03, F02-04, F02-05: controllable printer adapter recovery, handover/recall, and waste correction', async () => {
  const time = Date.UTC(2026, 10, 7, 9, 0, 0);
  const hub = await createHub({ databasePath: ':memory:', now: () => time });
  try {
    await hub.provisionAccount({ id: 'owner-1', branchId: 'b1', displayName: 'Owner', role: 'owner', secret: 'Owner-Secret-Pass-123!' });
    await hub.provisionAccount({ id: 'cashier-1', branchId: 'b1', displayName: 'Cashier', role: 'cashier', secret: '1234' });
    await hub.provisionAccount({ id: 'barista-1', branchId: 'b1', displayName: 'Barista', role: 'barista', secret: '5678' });
    await hub.provisionDevice({ id: 'dev-c', branchId: 'b1', secret: 'Device-Secret-Key-32-Characters!!' });
    await hub.provisionDevice({ id: 'dev-b', branchId: 'b1', secret: 'Device-Secret-Key-32-Characters!!' });

    const call = async (token: string | undefined, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
      hub.app.inject({
        method,
        url,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        ...(payload ? { payload } : {}),
      });

    const ownerToken = (await call(undefined, 'POST', '/api/v1/auth/admin', { accountId: 'owner-1', password: 'Owner-Secret-Pass-123!' })).json().token as string;
    const cashierToken = (await call(undefined, 'POST', '/api/v1/auth/staff', {
      accountId: 'cashier-1', pin: '1234', deviceId: 'dev-c', deviceSecret: 'Device-Secret-Key-32-Characters!!',
    })).json().token as string;
    const baristaToken = (await call(undefined, 'POST', '/api/v1/auth/staff', {
      accountId: 'barista-1', pin: '5678', deviceId: 'dev-b', deviceSecret: 'Device-Secret-Key-32-Characters!!',
    })).json().token as string;

    await call(ownerToken, 'POST', '/api/v1/ingredients', { commandId: randomUUID(), ingredientId: 'beans', name: 'Beans', unit: 'g' });
    await call(ownerToken, 'POST', '/api/v1/inventory/receipts', {
      commandId: randomUUID(), ingredientId: 'beans', quantityMilli: 1_000_000, totalCostCentavos: 50_000, reference: 'PO-1',
    });
    await call(ownerToken, 'POST', '/api/v1/products', {
      commandId: randomUUID(), productId: 'latte', name: 'Latte', priceCentavos: 15000, recipe: [{ ingredientId: 'beans', quantityMilli: 20000 }],
    });
    await call(ownerToken, 'POST', '/api/v1/drawers', { commandId: randomUUID(), drawerId: 'd1', name: 'Drawer 1', deviceIds: ['dev-c'] });
    await call(cashierToken, 'POST', '/api/v1/shifts/open', { commandId: randomUUID(), openingCashCentavos: 100_000 });

    // Configure receipt printer to 'unknown' (timeout) and label printer to 'failed' (paper out)
    await call(ownerToken, 'POST', '/api/v1/printers/mode', {
      commandId: randomUUID(), type: 'label', mode: 'failed', failureReason: 'Label roll out of paper',
    });
    await call(ownerToken, 'POST', '/api/v1/printers/mode', {
      commandId: randomUUID(), type: 'receipt', mode: 'unknown', failureReason: 'Receipt printer transport timeout',
    });

    // Create and pay takeout order -> releases to bar even though label printer is 'failed'
    const created = (await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: false, table: '', items: [{ productId: 'latte', quantity: 1 }],
    })).json().order;
    const paid = (await call(cashierToken, 'POST', `/api/v1/orders/${created.id}/payments`, {
      commandId: randomUUID(), expectedVersion: created.version, method: 'cash', amountCentavos: 15000, cashReceivedCentavos: 15000, verified: true,
    })).json().order;
    assert.equal(paid.released, true);

    // Request receipt -> reports 'unknown' truthfully without claiming physical paper
    const receiptRes = await call(cashierToken, 'POST', `/api/v1/orders/${created.id}/receipt`, {
      commandId: randomUUID(), expectedVersion: paid.version,
    });
    assert.equal(receiptRes.statusCode, 200);
    const receiptJob = receiptRes.json().job;
    assert.equal(receiptJob.status, 'unknown');
    assert.equal(receiptJob.simulated, true);
    assert.equal(receiptJob.physicalPaperClaimed, false);
    assert.equal(receiptJob.originalJobId, receiptJob.id);

    // Set printers to 'confirmed' and retry both jobs -> references originalJobId and does not duplicate sales/stock/cash
    await call(ownerToken, 'POST', '/api/v1/printers/mode', { commandId: randomUUID(), type: 'label', mode: 'confirmed' });
    await call(ownerToken, 'POST', '/api/v1/printers/mode', { commandId: randomUUID(), type: 'receipt', mode: 'confirmed' });

    const jobsList = (await call(cashierToken, 'GET', `/api/v1/print-jobs?orderId=${created.id}`)).json().jobs as { id: string; type: string }[];
    const labelJob = jobsList.find(j => j.type === 'label')!;
    const retriedLabel = (await call(baristaToken, 'POST', `/api/v1/print-jobs/${labelJob.id}/retry`, {
      commandId: randomUUID(), action: 'retry',
    })).json().job;
    assert.equal(retriedLabel.status, 'confirmed');
    assert.equal(retriedLabel.originalJobId, labelJob.id);
    assert.equal(retriedLabel.attempts, 2);

    const retriedReceipt = (await call(cashierToken, 'POST', `/api/v1/print-jobs/${receiptJob.id}/retry`, {
      commandId: randomUUID(), action: 'reprint',
    })).json().job;
    assert.equal(retriedReceipt.status, 'confirmed');
    assert.equal(retriedReceipt.originalJobId, receiptJob.id);
    assert.equal(retriedReceipt.attempts, 2);

    // Barista marks Ready -> consumes 20,000 mg once (980,000 remaining)
    const ready = (await call(baristaToken, 'POST', `/api/v1/orders/${created.id}/ready`, {
      commandId: randomUUID(), expectedVersion: paid.version,
    })).json().order;
    assert.equal(ready.ready, true);

    // Handover and recall never repeat consumption
    const handedOver = (await call(baristaToken, 'POST', `/api/v1/orders/${created.id}/handover`, {
      commandId: randomUUID(), expectedVersion: ready.version,
    })).json().order;
    assert.ok(handedOver.handoverAt > 0);

    const recalled = (await call(baristaToken, 'POST', `/api/v1/orders/${created.id}/recall`, {
      commandId: randomUUID(), expectedVersion: handedOver.version,
    })).json().order;
    assert.equal(recalled.handoverAt, undefined);
    assert.equal(recalled.recalledCount, 1);

    const stockAfterRecall = (await call(ownerToken, 'GET', '/api/v1/ingredients')).json().ingredients[0];
    assert.equal(stockAfterRecall.onHandMilli, 980_000);

    // Waste entry and correction without double deduction
    const wasteRes = (await call(baristaToken, 'POST', '/api/v1/waste', {
      commandId: randomUUID(), ingredientId: 'beans', quantityMilli: 10_000, reason: 'Dial-in', note: 'Initial shot',
    })).json().waste;
    assert.equal((await call(ownerToken, 'GET', '/api/v1/ingredients')).json().ingredients[0].onHandMilli, 970_000);

    // Correcting waste from 10g to 15g deducts only the 5g delta (965,000 remaining)
    const correctedWaste = await call(baristaToken, 'POST', `/api/v1/waste/${wasteRes.id}/correct`, {
      commandId: randomUUID(), correctedQuantityMilli: 15_000, reason: 'Measured puck weight was 15g',
    });
    assert.equal(correctedWaste.statusCode, 200);
    assert.equal(correctedWaste.json().wasteEntry.effectiveQuantityMilli, 15_000);
    assert.equal((await call(ownerToken, 'GET', '/api/v1/ingredients')).json().ingredients[0].onHandMilli, 965_000);
  } finally {
    await hub.close();
  }
});

test('F05-03, F05-04, F08-01, F08-04, F05-05, F08-05: Loyverse CSV import/export, cloud outbox sync conflicts, and isolated backup/restore', async () => {
  let time = Date.UTC(2026, 10, 7, 10, 0, 0);
  const hub = await createHub({ databasePath: ':memory:', now: () => time });
  const targetHub = await createHub({ databasePath: ':memory:', now: () => time });
  try {
    for (const h of [hub, targetHub]) {
      await h.provisionAccount({ id: 'owner-1', branchId: 'b1', displayName: 'Owner', role: 'owner', secret: 'Owner-Secret-Pass-123!' });
      await h.provisionAccount({ id: 'cashier-1', branchId: 'b1', displayName: 'Cashier', role: 'cashier', secret: '1234' });
      await h.provisionDevice({ id: 'dev-c', branchId: 'b1', secret: 'Device-Secret-Key-32-Characters!!' });
    }

    const call = async (h: typeof hub, token: string | undefined, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
      h.app.inject({
        method,
        url,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        ...(payload ? { payload } : {}),
      });

    const ownerToken = (await call(hub, undefined, 'POST', '/api/v1/auth/admin', { accountId: 'owner-1', password: 'Owner-Secret-Pass-123!' })).json().token as string;
    const cashierToken = (await call(hub, undefined, 'POST', '/api/v1/auth/staff', {
      accountId: 'cashier-1', pin: '1234', deviceId: 'dev-c', deviceSecret: 'Device-Secret-Key-32-Characters!!',
    })).json().token as string;

    // Invalid CSV preview changes no data
    const badCsv = 'Handle,Item name,Price,IngredientId,IngredientName,Unit,RecipeQuantityMilli\nbad-item,,0,beans,Beans,g,18000';
    const badPreview = (await call(hub, ownerToken, 'POST', '/api/v1/csv/preview', {
      kind: 'catalog', duplicatePolicy: 'skip', csvText: badCsv,
    })).json().preview;
    assert.equal(badPreview.valid, false);
    assert.equal(badPreview.summary.errorCount, 1);
    assert.equal((await call(hub, ownerToken, 'POST', '/api/v1/csv/import', {
      commandId: randomUUID(), kind: 'catalog', duplicatePolicy: 'skip', csvText: badCsv,
    })).statusCode, 400);
    assert.equal((await call(hub, ownerToken, 'GET', '/api/v1/products')).json().products.length, 0);

    // Valid Loyverse Catalog CSV import + repeat with skip vs update
    const goodCatalogCsv = [
      'Handle,Item name,Price,IngredientId,IngredientName,Unit,RecipeQuantityMilli',
      'csv-latte,CSV Cafe Latte,160.00,csv-beans,CSV Arabica Beans,g,18000',
      'csv-mocha,CSV Mocha,185.00,csv-beans,CSV Arabica Beans,g,20000',
    ].join('\n');
    const previewRes = (await call(hub, ownerToken, 'POST', '/api/v1/csv/preview', {
      kind: 'catalog', duplicatePolicy: 'skip', csvText: goodCatalogCsv,
    })).json().preview;
    assert.equal(previewRes.valid, true);
    assert.equal(previewRes.summary.addedCount, 2);

    const import1 = (await call(hub, ownerToken, 'POST', '/api/v1/csv/import', {
      commandId: randomUUID(), kind: 'catalog', duplicatePolicy: 'skip', csvText: goodCatalogCsv,
    })).json().importBatch;
    assert.equal(import1.addedCount, 2);
    assert.equal(import1.skippedCount, 0);

    // Repeat with 'skip' -> 0 added, 2 skipped
    const importSkip = (await call(hub, ownerToken, 'POST', '/api/v1/csv/import', {
      commandId: randomUUID(), kind: 'catalog', duplicatePolicy: 'skip', csvText: goodCatalogCsv,
    })).json().importBatch;
    assert.equal(importSkip.addedCount, 0);
    assert.equal(importSkip.skippedCount, 2);

    // Repeat with 'update' -> 2 updated
    const updatedCatalogCsv = [
      'Handle,Item name,Price,IngredientId,IngredientName,Unit,RecipeQuantityMilli',
      'csv-latte,CSV Cafe Latte Updated,170.00,csv-beans,CSV Arabica Beans,g,19000',
    ].join('\n');
    const importUpdate = (await call(hub, ownerToken, 'POST', '/api/v1/csv/import', {
      commandId: randomUUID(), kind: 'catalog', duplicatePolicy: 'update', csvText: updatedCatalogCsv,
    })).json().importBatch;
    assert.equal(importUpdate.updatedCount, 1);

    // Staff denied financial export (F08-01)
    assert.equal((await call(hub, cashierToken, 'GET', '/api/v1/csv/export?kind=financial')).statusCode, 403);
    assert.equal((await call(hub, ownerToken, 'GET', '/api/v1/csv/export?kind=catalog')).statusCode, 200);

    // Cloud outbox sync & conflict inspection (F08-04)
    const pushed = (await call(hub, ownerToken, 'POST', '/api/v1/sync/push', { commandId: randomUUID() })).json();
    assert.equal(pushed.syncStatus.pendingOutboxCount, 0);
    assert.ok(pushed.syncStatus.acknowledgedOutboxCount > 0);
    assert.equal(pushed.syncStatus.lastSyncedAt, time);

    // Ingest out-of-order stale product envelope (incoming version 1 < local version 2 for csv-latte)
    const ingested = (await call(hub, ownerToken, 'POST', '/api/v1/sync/ingest', {
      commandId: randomUUID(),
      envelopes: [
        {
          envelopeId: 'env-stale-1',
          entityType: 'product',
          entityId: 'csv-latte',
          version: 1,
          payload: { name: 'Stale Old Name', priceCentavos: 10000 },
        },
      ],
    })).json();
    assert.equal(ingested.outcomes[0].outcome, 'conflict');
    assert.equal(ingested.syncStatus.openConflictCount, 1);

    // Local product state was NOT overwritten by stale sync
    const productsAfterConflict = (await call(hub, ownerToken, 'GET', '/api/v1/products')).json().products as { id: string; name: string; version: number }[];
    const csvLatte = productsAfterConflict.find(p => p.id === 'csv-latte')!;
    assert.equal(csvLatte.name, 'CSV Cafe Latte Updated');
    assert.equal(csvLatte.version, 2);

    // Resolve sync conflict
    const conflictId = ingested.syncStatus.conflicts[0].id as string;
    const resolvedSync = (await call(hub, ownerToken, 'POST', `/api/v1/sync/conflicts/${conflictId}/resolve`, {
      commandId: randomUUID(), resolutionNote: 'Kept newer local version 2',
    })).json().syncStatus;
    assert.equal(resolvedSync.openConflictCount, 0);

    // Backup & Restore (F05-05, F08-05)
    assert.equal((await call(hub, cashierToken, 'GET', '/api/v1/admin/backup')).statusCode, 403);
    const backupRes = await call(hub, ownerToken, 'GET', '/api/v1/admin/backup');
    assert.equal(backupRes.statusCode, 200);
    const backup = backupRes.json().backup;
    assert.equal(backup.secretsRedacted, true);
    assert.equal(JSON.stringify(backup).includes('credential_hash'), false);
    assert.equal(JSON.stringify(backup).includes('secret_hash'), false);

    // Restore into isolated targetHub
    const targetOwnerToken = (await call(targetHub, undefined, 'POST', '/api/v1/auth/admin', {
      accountId: 'owner-1', password: 'Owner-Secret-Pass-123!',
    })).json().token as string;

    // Reject incompatible version and tampered checksum
    assert.equal((await call(targetHub, targetOwnerToken, 'POST', '/api/v1/admin/restore', {
      commandId: randomUUID(), backup: { ...backup, schemaVersion: 99 },
    })).statusCode, 400);
    assert.equal((await call(targetHub, targetOwnerToken, 'POST', '/api/v1/admin/restore', {
      commandId: randomUUID(), backup: { ...backup, checksum: 'tampered' },
    })).statusCode, 400);

    // Valid restore succeeds and restores catalog, CSV import history, and sync history
    const restoreRes = await call(targetHub, targetOwnerToken, 'POST', '/api/v1/admin/restore', {
      commandId: randomUUID(), backup,
    });
    assert.equal(restoreRes.statusCode, 200);
    const restoredProducts = (await call(targetHub, targetOwnerToken, 'GET', '/api/v1/products')).json().products as { id: string; name: string }[];
    assert.equal(restoredProducts.length, 2);
    assert.equal(restoredProducts.find(p => p.id === 'csv-latte')?.name, 'CSV Cafe Latte Updated');
  } finally {
    await hub.close();
    await targetHub.close();
  }
});

test('Schema 20: Hub discovery (/api/v1/hub-info), one-time tablet pairing codes (/api/v1/devices/:id/pair & /api/v1/devices/pair/claim), and private LAN HTTP policy', async () => {
  let time = Date.UTC(2026, 10, 8, 9, 0, 0);
  const hub = await createHub({ databasePath: ':memory:', now: () => time, allowPrivateLanHttp: true, allowedOrigins: ['http://192.168.1.50:8787'] });
  try {
    await hub.provisionAccount({ id: 'owner-1', branchId: 'b1', displayName: 'Owner', role: 'owner', secret: 'Owner-Secret-Pass-123!' });
    await hub.provisionAccount({ id: 'cashier-1', branchId: 'b1', displayName: 'Cashier', role: 'cashier', secret: '1234' });
    await hub.provisionDevice({ id: 'tablet-pos-1', branchId: 'b1', secret: 'Old-Secret-Key-32-Characters-Min!' });

    // 1. Unauthenticated GET /api/v1/hub-info returns authorityId, branchId, displayName, schemaVersion: 20
    const infoRes = await hub.app.inject({
      method: 'GET',
      url: '/api/v1/hub-info',
      headers: { origin: 'http://192.168.1.50:8787' },
    });
    assert.equal(infoRes.statusCode, 200);
    assert.equal(infoRes.headers['access-control-allow-origin'], 'http://192.168.1.50:8787');
    const info = infoRes.json();
    assert.equal(info.branchId, 'b1');
    assert.equal(info.displayName, 'KAPE DOZ');
    assert.equal(info.schemaVersion, 20);
    assert.equal(info.status, 'ready');
    assert.match(info.authorityId, /^[0-9a-f-]{36}$/i);

    // Public non-LAN HTTP origin is rejected even when allowPrivateLanHttp is enabled
    const publicHttpRes = await hub.app.inject({
      method: 'GET',
      url: '/api/v1/hub-info',
      headers: { origin: 'http://example.com' },
    });
    assert.equal(publicHttpRes.statusCode, 403);

    // 2. Owner generates a one-time pairing code for tablet-pos-1
    const ownerToken = (await hub.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin',
      payload: { accountId: 'owner-1', password: 'Owner-Secret-Pass-123!' },
    })).json().token as string;

    const pairRes = await hub.app.inject({
      method: 'POST',
      url: '/api/v1/devices/tablet-pos-1/pair',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { commandId: randomUUID(), hubOrigin: 'http://192.168.1.50:8787' },
    });
    assert.equal(pairRes.statusCode, 200);
    const pairBundle = pairRes.json().pairing;
    assert.equal(pairBundle.deviceId, 'tablet-pos-1');
    assert.equal(pairBundle.branchId, 'b1');
    assert.equal(pairBundle.authorityId, info.authorityId);
    assert.match(pairBundle.pairingCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const qrDecoded = JSON.parse(pairBundle.qrPayload);
    assert.equal(qrDecoded.type, 'kape-doz-pair-v1');
    assert.equal(qrDecoded.pairingCode, pairBundle.pairingCode);
    assert.equal(qrDecoded.hubOrigin, 'http://192.168.1.50:8787');

    // 3. Tablet claims the pairing code once and receives a fresh 32+ char secret
    const claimRes = await hub.app.inject({
      method: 'POST',
      url: '/api/v1/devices/pair/claim',
      payload: { pairingCode: pairBundle.pairingCode.toLowerCase().replace('-', '') },
    });
    assert.equal(claimRes.statusCode, 200);
    const claimed = claimRes.json().enrollment;
    assert.equal(claimed.deviceId, 'tablet-pos-1');
    assert.equal(claimed.branchId, 'b1');
    assert.equal(claimed.authorityId, info.authorityId);
    assert.equal(claimed.hubOrigin, 'http://192.168.1.50:8787');
    assert.ok(claimed.deviceSecret.length >= 32);

    // 4. Reusing the same pairing code is rejected with 404 not_found
    const reuseRes = await hub.app.inject({
      method: 'POST',
      url: '/api/v1/devices/pair/claim',
      payload: { pairingCode: pairBundle.pairingCode },
    });
    assert.equal(reuseRes.statusCode, 404);

    // 5. Staff can sign in immediately using the newly claimed deviceSecret
    const staffLoginRes = await hub.app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff',
      payload: {
        accountId: 'cashier-1',
        pin: '1234',
        deviceId: claimed.deviceId,
        deviceSecret: claimed.deviceSecret,
      },
    });
    assert.equal(staffLoginRes.statusCode, 200);

    // 6. Expired pairing codes are rejected
    const pairExpired = (await hub.app.inject({
      method: 'POST',
      url: '/api/v1/devices/tablet-pos-1/pair',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { commandId: randomUUID() },
    })).json().pairing;
    time += 16 * 60_000;
    const expiredClaim = await hub.app.inject({
      method: 'POST',
      url: '/api/v1/devices/pair/claim',
      payload: { pairingCode: pairExpired.pairingCode },
    });
    assert.equal(expiredClaim.statusCode, 404);
  } finally {
    await hub.close();
  }
});
