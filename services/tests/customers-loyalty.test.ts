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

test('schema 18 upgrades existing orders and settlements with nullable customer and zero loyalty counters', async t => {
  const root = resolve(tmpdir());
  const prefix = join(root, 'kape-customers-loyalty-migration-');
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
    const migrations = (await readdir(migrationFolder)).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().slice(0, 17);
    assert.equal(migrations.at(-1), '017_recipes_and_receiving.sql');
    for (const [index, name] of migrations.entries()) {
      previous.exec(await readFile(new URL(name, migrationFolder), 'utf8'));
      previous.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
    }
    previous.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(1,?)').run(randomUUID());
    previous.exec(`
      INSERT INTO branches(id) VALUES('branch');
      INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES('owner','branch','Owner','owner','fixture');
      INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at)
        VALUES('cmd-1','owner','branch','order.create','fp','{}',100);
      INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,total_centavos)
        VALUES('ord-1','branch',1,1,0,'Takeout','after_payment',100,15000);
      INSERT INTO order_settlements(branch_id,order_id,settled_at,business_date,total_centavos,command_id)
        VALUES('branch','ord-1',110,'2026-11-07',15000,'cmd-1');
    `);
  } finally {
    previous.close();
  }

  const migrated = new HubDatabase(path);
  try {
    const db = migrated.connection;
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.deepEqual(
      { ...db.prepare('SELECT customer_id,redeemed_points,loyalty_redemption_centavos FROM orders WHERE id=?').get('ord-1') },
      { customer_id: null, redeemed_points: 0, loyalty_redemption_centavos: 0 },
    );
    assert.deepEqual(
      { ...db.prepare('SELECT customer_id,earned_points,redeemed_points,loyalty_redemption_centavos FROM order_settlements WHERE order_id=?').get('ord-1') },
      { customer_id: null, earned_points: 0, redeemed_points: 0, loyalty_redemption_centavos: 0 },
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    migrated.close();
  }
});

test('F03-03 customer enrollment, lookup, profile, role scoping, activity windows, and unconfigured VIP default', async () => {
  let now = Date.UTC(2026, 9, 1, 8, 0, 0); // 2026-10-01
  const hub = await createHub({ databasePath: ':memory:', now: () => (now += 1000) });
  try {
    await hub.provisionAccount({ id: 'owner', branchId: 'main', displayName: 'Owner', role: 'owner', secret: 'Owner-Secret-1!' });
    await hub.provisionAccount({ id: 'manager', branchId: 'main', displayName: 'Manager', role: 'manager', secret: 'Manager-Secret-1!' });
    await hub.provisionAccount({ id: 'cashier', branchId: 'main', displayName: 'Cashier', role: 'cashier', secret: '112233' });
    await hub.provisionAccount({ id: 'barista', branchId: 'main', displayName: 'Barista', role: 'barista', secret: '445566' });
    await hub.provisionDevice({ id: 'pos-1', branchId: 'main', secret: 'pos-secret-1234567890-1234567890-pos' });
    await hub.provisionDevice({ id: 'bar-1', branchId: 'main', secret: 'bar-secret-1234567890-1234567890-bar' });

    let ownerToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner', password: 'Owner-Secret-1!' },
    })).token;
    let managerToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'manager', password: 'Manager-Secret-1!' },
    })).token;
    let cashierToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/staff', payload: { accountId: 'cashier', pin: '112233', deviceId: 'pos-1', deviceSecret: 'pos-secret-1234567890-1234567890-pos' },
    })).token;
    const baristaToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/staff', payload: { accountId: 'barista', pin: '445566', deviceId: 'bar-1', deviceSecret: 'bar-secret-1234567890-1234567890-bar' },
    })).token;

    const call = (token: string, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
      hub.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

    // Barista cannot access customer routes
    assert.equal((await call(baristaToken, 'GET', '/api/v1/customers')).statusCode, 403);
    assert.equal((await call(baristaToken, 'POST', '/api/v1/customers', {
      commandId: randomUUID(), displayName: 'Blocked', phone: '09170000000', notes: '',
    })).statusCode, 403);

    // Setup catalog and drawer
    ok(await call(ownerToken, 'POST', '/api/v1/ingredients', { commandId: randomUUID(), ingredientId: 'beans', name: 'Beans', unit: 'g' }));
    ok(await call(ownerToken, 'POST', '/api/v1/inventory/receipts', {
      commandId: randomUUID(), ingredientId: 'beans', quantityMilli: 5_000_000, totalCostCentavos: 200_000, reference: 'PO-1',
    }));
    ok(await call(ownerToken, 'POST', '/api/v1/products', {
      commandId: randomUUID(), productId: 'latte', name: 'Latte', priceCentavos: 25_000,
      recipe: [{ ingredientId: 'beans', quantityMilli: 18_000 }],
    }));
    ok(await call(ownerToken, 'POST', '/api/v1/drawers', { commandId: randomUUID(), drawerId: 'drawer-1', name: 'Main Drawer', deviceIds: ['pos-1'] }));
    ok(await call(cashierToken, 'POST', '/api/v1/shifts/open', { commandId: randomUUID(), openingCashCentavos: 100_000 }));

    // Enroll 3 customers: Ada (old purchase), Grace (recent purchase), Linus (no purchases)
    const ada = ok<{ customer: { id: string; displayName: string; availablePoints: number } }>(await call(cashierToken, 'POST', '/api/v1/customers', {
      commandId: randomUUID(), customerId: 'cust-ada', displayName: 'Ada Lovelace', phone: '09171111111', notes: 'Oat preference',
    })).customer;
    assert.equal(ada.id, 'cust-ada');
    // Cashier view omits admin-only segmentation fields
    assert.equal('lifetimeNetSpendCentavos' in ada, false);
    assert.equal('isVip' in ada, false);

    ok(await call(managerToken, 'POST', '/api/v1/customers', {
      commandId: randomUUID(), customerId: 'cust-grace', displayName: 'Grace Hopper', phone: '09172222222', notes: 'Extra hot',
    }));
    ok(await call(managerToken, 'POST', '/api/v1/customers', {
      commandId: randomUUID(), customerId: 'cust-linus', displayName: 'Linus Torvalds', phone: '09173333333', notes: '',
    }));

    // Duplicate phone is rejected
    assert.equal((await call(cashierToken, 'POST', '/api/v1/customers', {
      commandId: randomUUID(), displayName: 'Dup', phone: '09171111111', notes: '',
    })).statusCode, 409);

    // 2026-10-01: Ada buys 1 Latte (₱250.00) -> settled
    const adaOrder = ok<{ order: { id: string; version: number } }>(await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: false, table: 'Takeout', customerId: 'cust-ada',
      items: [{ productId: 'latte', quantity: 1 }],
    })).order;
    ok(await call(cashierToken, 'POST', `/api/v1/orders/${adaOrder.id}/payments`, {
      commandId: randomUUID(), expectedVersion: adaOrder.version, method: 'cash', verified: true, amountCentavos: 25_000, cashReceivedCentavos: 25_000,
    }));

    // Advance clock to 2026-11-07 (37 days later) and refresh session tokens
    now = Date.UTC(2026, 10, 7, 9, 0, 0);
    ownerToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner', password: 'Owner-Secret-1!' },
    })).token;
    managerToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'manager', password: 'Manager-Secret-1!' },
    })).token;
    cashierToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/staff', payload: { accountId: 'cashier', pin: '112233', deviceId: 'pos-1', deviceSecret: 'pos-secret-1234567890-1234567890-pos' },
    })).token;

    // Grace buys 2 Lattes (₱500.00) on 2026-11-07
    const graceOrder = ok<{ order: { id: string; version: number } }>(await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: false, table: 'Takeout', customerId: 'cust-grace',
      items: [{ productId: 'latte', quantity: 2 }],
    })).order;
    ok(await call(cashierToken, 'POST', `/api/v1/orders/${graceOrder.id}/payments`, {
      commandId: randomUUID(), expectedVersion: graceOrder.version, method: 'cash', verified: true, amountCentavos: 50_000, cashReceivedCentavos: 50_000,
    }));

    // Check admin customer list & counters under default policy (30 days inactivity, VIP unconfigured)
    const adminList = ok<{
      customers: { id: string; activityStatus: string; isVip: boolean; lifetimeNetSpendCentavos: number; qualifyingPurchaseCount: number }[];
      counters: {
        totalCount: number;
        activeCount: number;
        inactiveCount: number;
        noPurchasesCount: number;
        vipConfigured: boolean;
        vipCount: number | null;
      };
      policy: { version: number; inactivityDays: number; vipRule: string; vipConfigured: boolean };
    }>(await call(managerToken, 'GET', '/api/v1/customers'));

    assert.deepEqual(adminList.counters, {
      totalCount: 3,
      activeCount: 1, // Grace
      inactiveCount: 1, // Ada (37 days >= 30 days)
      noPurchasesCount: 1, // Linus
      vipConfigured: false,
      vipCount: null,
    });

    // Manager cannot change owner policy
    assert.equal((await call(managerToken, 'POST', '/api/v1/customers/policy', {
      commandId: randomUUID(), expectedVersion: 1, inactivityDays: 60, vipRule: 'lifetime_spend', vipThreshold: 40_000, pointsExpiryDays: null,
    })).statusCode, 403);

    // Owner updates policy: inactivityDays = 60, VIP = lifetime_spend >= ₱400.00 (40,000 centavos)
    ok(await call(ownerToken, 'POST', '/api/v1/customers/policy', {
      commandId: randomUUID(), expectedVersion: 1, inactivityDays: 60, vipRule: 'lifetime_spend', vipThreshold: 40_000, pointsExpiryDays: 365,
    }));

    const afterPolicy = ok<typeof adminList>(await call(managerToken, 'GET', '/api/v1/customers'));
    assert.deepEqual(afterPolicy.counters, {
      totalCount: 3,
      activeCount: 2, // Both Ada (37 < 60) and Grace (0 < 60)
      inactiveCount: 0,
      noPurchasesCount: 1,
      vipConfigured: true,
      vipCount: 1, // Grace (50,000 >= 40,000)
    });

    const vipOnly = ok<typeof adminList>(await call(managerToken, 'GET', '/api/v1/customers?segment=vip'));
    assert.deepEqual(vipOnly.customers.map(c => c.id), ['cust-grace']);

    // Customer profile returns order history and loyalty ledger to admin
    const graceProfile = ok<{
      customer: { id: string; availablePoints: number; lifetimeNetSpendCentavos: number };
      ledger: { kind: string; pointsDelta: number; status: string }[];
      orders: { orderId: string; earnedPoints: number; totalCentavos: number }[];
    }>(await call(managerToken, 'GET', '/api/v1/customers/cust-grace'));
    assert.equal(graceProfile.customer.availablePoints, 5);
    assert.equal(graceProfile.customer.lifetimeNetSpendCentavos, 50_000);
    assert.equal(graceProfile.ledger.length, 1);
    assert.equal(graceProfile.orders.length, 1);
    assert.equal(graceProfile.orders[0]!.earnedPoints, 5);
  } finally {
    await hub.close();
  }
});

test('F07-01, F07-02, F07-03, F07-05 & ADR 004: earning, offline pending sync, dual-gated redemption with timeout reconciliation, and multi-refund loyalty adjustment cases', async () => {
  let now = Date.UTC(2026, 10, 7, 10, 0, 0);
  const hub = await createHub({ databasePath: ':memory:', now: () => (now += 1000) });
  try {
    await hub.provisionAccount({ id: 'owner', branchId: 'main', displayName: 'Owner', role: 'owner', secret: 'Owner-Secret-1!' });
    await hub.provisionAccount({ id: 'manager', branchId: 'main', displayName: 'Manager', role: 'manager', secret: 'Manager-Secret-1!' });
    await hub.provisionAccount({ id: 'cashier', branchId: 'main', displayName: 'Cashier', role: 'cashier', secret: '112233' });
    await hub.provisionDevice({ id: 'pos-1', branchId: 'main', secret: 'pos-secret-1234567890-1234567890-pos' });

    let ownerToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner', password: 'Owner-Secret-1!' },
    })).token;
    let managerToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'manager', password: 'Manager-Secret-1!' },
    })).token;
    let cashierToken = ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/staff', payload: { accountId: 'cashier', pin: '112233', deviceId: 'pos-1', deviceSecret: 'pos-secret-1234567890-1234567890-pos' },
    })).token;

    const call = (token: string, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
      hub.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

    ok(await call(ownerToken, 'POST', '/api/v1/ingredients', { commandId: randomUUID(), ingredientId: 'beans', name: 'Beans', unit: 'g' }));
    ok(await call(ownerToken, 'POST', '/api/v1/inventory/receipts', {
      commandId: randomUUID(), ingredientId: 'beans', quantityMilli: 10_000_000, totalCostCentavos: 400_000, reference: 'PO-1',
    }));
    ok(await call(ownerToken, 'POST', '/api/v1/products', {
      commandId: randomUUID(), productId: 'pour-over', name: 'Pour Over', priceCentavos: 25_000,
      recipe: [{ ingredientId: 'beans', quantityMilli: 20_000 }],
    }));
    ok(await call(ownerToken, 'POST', '/api/v1/drawers', { commandId: randomUUID(), drawerId: 'drawer-1', name: 'Main Drawer', deviceIds: ['pos-1'] }));
    ok(await call(cashierToken, 'POST', '/api/v1/shifts/open', { commandId: randomUUID(), openingCashCentavos: 200_000 }));

    // Enroll customer Elena
    ok(await call(cashierToken, 'POST', '/api/v1/customers', {
      commandId: randomUUID(), customerId: 'cust-elena', displayName: 'Elena Gilbert', phone: '09178889999', notes: 'Regular',
    }));

    // 1. F07-01: Online order ₱500.00 with ₱50.00 manager discount -> settled at ₱450.00, paid with ₱1,000 cash (₱550 change).
    // Eligible spend is ₱450.00 (45,000 centavos) -> earns floor(45000 / 10000) = 4 whole points (not 5 or 10).
    const order1 = ok<{ order: { id: string; version: number } }>(await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: true, table: 'T1',
      items: [{ productId: 'pour-over', quantity: 2 }],
    })).order;
    const attached1 = ok<{ order: { id: string; version: number; customerId: string } }>(await call(cashierToken, 'POST', `/api/v1/orders/${order1.id}/customer`, {
      commandId: randomUUID(), expectedVersion: order1.version, customerId: 'cust-elena',
    })).order;
    assert.equal(attached1.customerId, 'cust-elena');

    const discApproval = ok<{ approval: { id: string } }>(await call(cashierToken, 'POST', `/api/v1/orders/${order1.id}/approvals`, {
      commandId: randomUUID(), expectedVersion: attached1.version, action: 'discount', amountCentavos: 5_000, reason: 'Promo 50 off',
    })).approval;
    ok(await call(managerToken, 'POST', `/api/v1/approvals/${discApproval.id}/decision`, {
      commandId: randomUUID(), decision: 'approve',
    }));

    // Partial payment of ₱200.00 does NOT earn points yet
    const afterPartial = ok<{ order: { version: number; earnedPoints: number } }>(await call(cashierToken, 'POST', `/api/v1/orders/${order1.id}/payments`, {
      commandId: randomUUID(), expectedVersion: attached1.version + 1, method: 'cash', verified: true, amountCentavos: 20_000, cashReceivedCentavos: 20_000,
    })).order;
    assert.equal(afterPartial.earnedPoints, 0);

    // Remaining ₱250.00 paid with ₱1,000.00 bill (₱750.00 change) settles order -> earns 4 points
    const settled1 = ok<{ order: { version: number; earnedPoints: number; totalCentavos: number } }>(await call(cashierToken, 'POST', `/api/v1/orders/${order1.id}/payments`, {
      commandId: randomUUID(), expectedVersion: afterPartial.version, method: 'cash', verified: true, amountCentavos: 25_000, cashReceivedCentavos: 100_000,
    })).order;
    assert.equal(settled1.totalCentavos, 45_000);
    assert.equal(settled1.earnedPoints, 4);

    // 2. F07-02: Switch cloud mode to offline; Elena buys 3 Pour Overs (₱750.00) -> earns 7 points as PENDING
    ok(await call(managerToken, 'POST', '/api/v1/loyalty/cloud-mode', { commandId: randomUUID(), mode: 'offline' }));
    const order2 = ok<{ order: { id: string; version: number } }>(await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: false, table: 'Takeout', customerId: 'cust-elena',
      items: [{ productId: 'pour-over', quantity: 3 }],
    })).order;
    ok(await call(cashierToken, 'POST', `/api/v1/orders/${order2.id}/payments`, {
      commandId: randomUUID(), expectedVersion: order2.version, method: 'cash', verified: true, amountCentavos: 75_000, cashReceivedCentavos: 75_000,
    }));

    const elenaOffline = ok<{ customer: { availablePoints: number; pendingPoints: number } }>(await call(managerToken, 'GET', '/api/v1/customers/cust-elena')).customer;
    assert.equal(elenaOffline.availablePoints, 4);
    assert.equal(elenaOffline.pendingPoints, 7);

    // Offline pending points cannot be redeemed (requesting 6 points fails when only 4 are available)
    const order3 = ok<{ order: { id: string; version: number } }>(await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: false, table: 'Takeout', customerId: 'cust-elena',
      items: [{ productId: 'pour-over', quantity: 2 }],
    })).order;
    assert.equal((await call(cashierToken, 'POST', `/api/v1/orders/${order3.id}/loyalty/redeem-request`, {
      commandId: randomUUID(), expectedVersion: order3.version, points: 6, reason: 'Try redeeming pending points',
    })).statusCode, 409);

    // Requesting 4 available points succeeds, manager approves, but cloud validation is blocked while offline
    const redeemReq = ok<{ redemption: { id: string; version: number; status: string; discountCentavos: number } }>(
      await call(cashierToken, 'POST', `/api/v1/orders/${order3.id}/loyalty/redeem-request`, {
        commandId: randomUUID(), expectedVersion: order3.version, points: 4, reason: 'Redeem 4 available points',
      }),
    ).redemption;
    assert.equal(redeemReq.discountCentavos, 400);
    assert.equal(redeemReq.status, 'pending');

    // Cloud validation before manager approval is rejected
    assert.equal((await call(cashierToken, 'POST', `/api/v1/loyalty/redemptions/${redeemReq.id}/validate-cloud`, {
      commandId: randomUUID(), expectedVersion: redeemReq.version,
    })).statusCode, 409);

    const approvedRedeem = ok<{ redemption: { id: string; version: number; status: string; cloudStatus: string } }>(
      await call(managerToken, 'POST', `/api/v1/loyalty/redemptions/${redeemReq.id}/decision`, {
        commandId: randomUUID(), decision: 'approve', reason: 'Approved 4 pts',
      }),
    ).redemption;
    assert.equal(approvedRedeem.status, 'approved');
    assert.equal(approvedRedeem.cloudStatus, 'awaiting_cloud');

    // Still offline -> validate-cloud fails with 409
    assert.equal((await call(cashierToken, 'POST', `/api/v1/loyalty/redemptions/${redeemReq.id}/validate-cloud`, {
      commandId: randomUUID(), expectedVersion: approvedRedeem.version,
    })).statusCode, 409);

    // Simulate cloud timeout -> transitions to cloud_unknown without debiting points
    ok(await call(managerToken, 'POST', '/api/v1/loyalty/cloud-mode', { commandId: randomUUID(), mode: 'timeout' }));
    const timedOut = ok<{ redemption: { id: string; version: number; status: string; cloudStatus: string } }>(
      await call(cashierToken, 'POST', `/api/v1/loyalty/redemptions/${redeemReq.id}/validate-cloud`, {
        commandId: randomUUID(), expectedVersion: approvedRedeem.version,
      }),
    ).redemption;
    assert.equal(timedOut.status, 'cloud_unknown');

    const elenaDuringUnknown = ok<{ customer: { availablePoints: number; pendingPoints: number } }>(await call(managerToken, 'GET', '/api/v1/customers/cust-elena')).customer;
    assert.equal(elenaDuringUnknown.availablePoints, 4);

    // Reconnect cloud online, sync pending points (idempotent), and reconcile unknown redemption
    ok(await call(managerToken, 'POST', '/api/v1/loyalty/cloud-mode', { commandId: randomUUID(), mode: 'online' }));
    const syncCmd = randomUUID();
    const sync1 = ok<{ syncedEntriesCount: number; syncedPoints: number }>(await call(cashierToken, 'POST', '/api/v1/loyalty/sync', { commandId: syncCmd }));
    assert.equal(sync1.syncedEntriesCount, 1);
    assert.equal(sync1.syncedPoints, 7);
    // Replay of same commandId returns identical result; second sync finds 0 pending
    const syncReplay = ok<{ syncedEntriesCount: number; syncedPoints: number }>(await call(cashierToken, 'POST', '/api/v1/loyalty/sync', { commandId: syncCmd }));
    assert.equal(syncReplay.syncedPoints, 7);
    const sync2 = ok<{ syncedEntriesCount: number; syncedPoints: number }>(await call(cashierToken, 'POST', '/api/v1/loyalty/sync', { commandId: randomUUID() }));
    assert.equal(sync2.syncedEntriesCount, 0);

    // Reconcile cloud_unknown redemption as confirm_debited -> debits 4 points once and reduces order3 total from 50,000 to 49,600
    const reconciled = ok<{
      redemption: { status: string; cloudStatus: string; cloudReference: string };
      order: { id: string; version: number; totalCentavos: number; subtotalCentavos: number; redeemedPoints: number; loyaltyRedemptionCentavos: number };
    }>(await call(managerToken, 'POST', `/api/v1/loyalty/redemptions/${redeemReq.id}/reconcile-cloud`, {
      commandId: randomUUID(), expectedVersion: timedOut.version, outcome: 'confirm_authorized', cloudReference: 'CLOUD-RECON-01', note: 'Verified cloud debit',
    }));
    assert.equal(reconciled.redemption.status, 'applied');
    assert.equal(reconciled.order.totalCentavos, 49_600);
    assert.equal(reconciled.order.subtotalCentavos, 50_000);
    assert.equal(reconciled.order.redeemedPoints, 4);
    assert.equal(reconciled.order.loyaltyRedemptionCentavos, 400);

    // Elena now has 4 + 7 - 4 = 7 available points. Settle order3 (₱496.00 -> earns 4 points -> 11 available points)
    const settled3 = ok<{ order: { version: number; earnedPoints: number } }>(await call(cashierToken, 'POST', `/api/v1/orders/${order3.id}/payments`, {
      commandId: randomUUID(), expectedVersion: reconciled.order.version, method: 'gcash', amountCentavos: 49_600, reference: 'GC-ORDER3', verified: true,
    })).order;
    assert.equal(settled3.earnedPoints, 4);

    const elenaBeforeRefunds = ok<{ customer: { availablePoints: number } }>(await call(managerToken, 'GET', '/api/v1/customers/cust-elena')).customer;
    assert.equal(elenaBeforeRefunds.availablePoints, 11);

    // 3. F07-05 & ADR 004: Partial refund #1 on order3 (₱248.00) creates linked loyalty_refund_cases record
    const order3AfterSettle = ok<{ order: { version: number; payments: { id: string }[] } }>(await call(cashierToken, 'GET', `/api/v1/orders/${order3.id}`)).order;
    const refund1 = ok<{ refund: { id: string } }>(await call(cashierToken, 'POST', `/api/v1/orders/${order3.id}/refunds`, {
      commandId: randomUUID(), expectedVersion: order3AfterSettle.version, amountCentavos: 24_800, reason: '1 drink remade/refunded', lineNumbers: [0],
    })).refund;
    const refund1Decided = ok<{
      refund: { id: string; legs: { id: string; version: number }[] };
      loyaltyRefundCase: { id: string; version: number; originalEarnedPoints: number; originalRedeemedPoints: number; remainingReversibleEarnedPoints: number; remainingRestorableRedeemedPoints: number; status: string };
    }>(await call(managerToken, 'POST', `/api/v1/refunds/${refund1.id}/decision`, {
      commandId: randomUUID(), decision: 'approve', reason: 'Approve partial refund 1',
      allocations: [{ paymentId: order3AfterSettle.payments[0]!.id, amountCentavos: 24_800 }],
    }));
    assert.equal(refund1Decided.loyaltyRefundCase.status, 'pending');
    assert.equal(refund1Decided.loyaltyRefundCase.originalEarnedPoints, 4);
    assert.equal(refund1Decided.loyaltyRefundCase.originalRedeemedPoints, 4);

    // Cashier is forbidden from viewing or deciding loyalty refund cases
    assert.equal((await call(cashierToken, 'GET', '/api/v1/loyalty/refund-cases')).statusCode, 403);
    assert.equal((await call(cashierToken, 'POST', `/api/v1/loyalty/refund-cases/${refund1Decided.loyaltyRefundCase.id}/decision`, {
      commandId: randomUUID(), expectedVersion: 1, reverseEarnedPoints: 2, restoreRedeemedPoints: 2, reason: 'Cashier attempt',
    })).statusCode, 403);

    // Manager cannot reverse more than originalEarnedPoints (5 > 4)
    assert.equal((await call(managerToken, 'POST', `/api/v1/loyalty/refund-cases/${refund1Decided.loyaltyRefundCase.id}/decision`, {
      commandId: randomUUID(), expectedVersion: 1, reverseEarnedPoints: 5, restoreRedeemedPoints: 2, reason: 'Exceed cap',
    })).statusCode, 409);

    // Manager reverses 2 earned points and restores 2 redeemed points on partial refund #1
    const case1Resolved = ok<{ refundCase: { status: string; reversedEarnedPoints: number; restoredRedeemedPoints: number } }>(
      await call(managerToken, 'POST', `/api/v1/loyalty/refund-cases/${refund1Decided.loyaltyRefundCase.id}/decision`, {
        commandId: randomUUID(), expectedVersion: 1, reverseEarnedPoints: 2, restoreRedeemedPoints: 2, reason: 'Half order loyalty adjustment',
      }),
    ).refundCase;
    assert.equal(case1Resolved.status, 'resolved');

    // Partial refund #2 on order3 (remaining ₱248.00) -> remaining caps are 2 earned and 2 redeemed
    const order3Mid = ok<{ order: { version: number } }>(await call(cashierToken, 'GET', `/api/v1/orders/${order3.id}`)).order;
    const refund2 = ok<{ refund: { id: string } }>(await call(cashierToken, 'POST', `/api/v1/orders/${order3.id}/refunds`, {
      commandId: randomUUID(), expectedVersion: order3Mid.version, amountCentavos: 24_800, reason: 'Second drink refunded', lineNumbers: [0],
    })).refund;
    const refund2Decided = ok<{
      loyaltyRefundCase: { id: string; version: number; remainingReversibleEarnedPoints: number; remainingRestorableRedeemedPoints: number };
    }>(await call(managerToken, 'POST', `/api/v1/refunds/${refund2.id}/decision`, {
      commandId: randomUUID(), decision: 'approve', reason: 'Approve partial refund 2',
      allocations: [{ paymentId: order3AfterSettle.payments[0]!.id, amountCentavos: 24_800 }],
    }));
    assert.equal(refund2Decided.loyaltyRefundCase.remainingReversibleEarnedPoints, 2);
    assert.equal(refund2Decided.loyaltyRefundCase.remainingRestorableRedeemedPoints, 2);

    // Trying to reverse 3 earned points on partial refund #2 fails because only 2 remain
    assert.equal((await call(managerToken, 'POST', `/api/v1/loyalty/refund-cases/${refund2Decided.loyaltyRefundCase.id}/decision`, {
      commandId: randomUUID(), expectedVersion: 1, reverseEarnedPoints: 3, restoreRedeemedPoints: 2, reason: 'Exceed remaining cap',
    })).statusCode, 409);

    // Spend 10 of Elena's 11 points on order4 so her available balance drops to 1 point before resolving refund2's case!
    const order4 = ok<{ order: { id: string; version: number } }>(await call(cashierToken, 'POST', '/api/v1/orders', {
      commandId: randomUUID(), dineIn: false, table: 'Takeout', customerId: 'cust-elena',
      items: [{ productId: 'pour-over', quantity: 1 }],
    })).order;
    const redeem4 = ok<{ redemption: { id: string; version: number } }>(await call(cashierToken, 'POST', `/api/v1/orders/${order4.id}/loyalty/redeem-request`, {
      commandId: randomUUID(), expectedVersion: order4.version, points: 10, reason: 'Spend 10 pts',
    })).redemption;
    const redeem4Approved = ok<{ redemption: { version: number } }>(await call(managerToken, 'POST', `/api/v1/loyalty/redemptions/${redeem4.id}/decision`, {
      commandId: randomUUID(), decision: 'approve', reason: 'Approve 10 pts',
    })).redemption;
    ok(await call(cashierToken, 'POST', `/api/v1/loyalty/redemptions/${redeem4.id}/validate-cloud`, {
      commandId: randomUUID(), expectedVersion: redeem4Approved.version,
    }));

    // Elena now has 1 available point. On refund2's case, manager requests reversing 2 earned points and restoring 0 redeemed points.
    // Because 2 > 1 available point, it transitions to insufficient_balance_review without making balance negative!
    const case2Exception = ok<{ refundCase: { id: string; version: number; status: string; customerAvailablePoints: number } }>(
      await call(managerToken, 'POST', `/api/v1/loyalty/refund-cases/${refund2Decided.loyaltyRefundCase.id}/decision`, {
        commandId: randomUUID(), expectedVersion: 1, reverseEarnedPoints: 2, restoreRedeemedPoints: 0, reason: 'Reverse remaining 2 earned points',
      }),
    ).refundCase;
    assert.equal(case2Exception.status, 'insufficient_balance_review');
    assert.equal(case2Exception.customerAvailablePoints, 1);

    // Manager resolves the insufficient balance exception by capping reversal to the 1 available point
    const case2Resolved = ok<{ refundCase: { status: string; reversedEarnedPoints: number; customerAvailablePoints: number } }>(
      await call(managerToken, 'POST', `/api/v1/loyalty/refund-cases/${case2Exception.id}/resolve-exception`, {
        commandId: randomUUID(), expectedVersion: case2Exception.version, action: 'apply_available_and_waive', appliedReversalPoints: 1, resolutionNote: 'Capped reversal at available 1 pt',
      }),
    ).refundCase;
    assert.equal(case2Resolved.status, 'resolved');
    assert.equal(case2Resolved.reversedEarnedPoints, 1);
    assert.equal(case2Resolved.customerAvailablePoints, 0);
  } finally {
    await hub.close();
  }
});
