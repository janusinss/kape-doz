import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';
import { digest } from '../src/identity.js';

const time = Date.UTC(2026, 10, 5, 8);
const pin = '4826';
const password = 'Terminal-Recovery-Fixture-Admin-Password!';
const secret = 'Terminal-Recovery-Fixture-Device-Secret-2026!';
type Response = { statusCode: number; body: string; json(): any };
type Order = { id: string; version: number; paidCentavos: number };

function ok<T>(response: Response): T {
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as T;
}

async function fixture(t: TestContext) {
  const root = resolve(tmpdir());
  const directory = await mkdtemp(join(root, 'kape-doz-terminal-recovery-'));
  const path = join(directory, 'hub.sqlite');
  let hub = await createHub({ databasePath: path, now: () => time });
  const inspector = new DatabaseSync(path);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(directory);
    assert.equal(dirname(target), root);
    assert.ok(target.startsWith(join(root, 'kape-doz-terminal-recovery-')));
    await rm(target, { recursive: true, force: true });
  });
  for (const [id, role, branchId] of [
    ['owner', 'owner', 'branch'], ['other-owner', 'owner', 'other-branch'],
    ['cashier', 'cashier', 'branch'], ['other-cashier', 'cashier', 'branch'],
  ] as const) {
    await hub.provisionAccount({ id, displayName: id, role, branchId, secret: role === 'cashier' ? pin : password });
  }
  for (const id of ['tablet', 'second-tablet']) {
    await hub.provisionDevice({ id, branchId: 'branch', secret });
  }
  async function login(accountId: string, deviceId?: string) {
    return ok<{ token: string }>(await hub.app.inject({
      method: 'POST', url: `/api/v1/auth/${deviceId ? 'staff' : 'admin'}`,
      payload: deviceId ? { accountId, pin, deviceId, deviceSecret: secret } : { accountId, password },
    })).token;
  }
  const owner = await login('owner');
  const otherOwner = await login('other-owner');
  const cashier = await login('cashier', 'tablet');
  const secondDevice = await login('cashier', 'second-tablet');
  const otherCashier = await login('other-cashier', 'tablet');
  const post = (token: string, url: string, input: Record<string, unknown>, commandId = randomUUID()) => hub.app.inject({
    method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { commandId, ...input },
  });
  const get = (token: string | undefined, url: string) => hub.app.inject({
    method: 'GET', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
  const lookup = (commandId: string, token = cashier) => get(token, `/api/v1/commands/${commandId}`);
  ok(await post(owner, '/api/v1/ingredients', { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
  ok(await post(owner, '/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli: 1_000_000, totalCostCentavos: 100_000, reference: 'Fixture original stock' }));
  ok(await post(owner, '/api/v1/products', { productId: 'latte', name: 'Fixture latte', priceCentavos: 16_500, recipe: [{ ingredientId: 'beans', quantityMilli: 18_000 }] }));
  ok(await post(owner, '/api/v1/drawers', { drawerId: 'counter', name: 'Fixture counter', deviceIds: ['tablet', 'second-tablet'] }));
  const order = ok<{ order: Order }>(await post(cashier, '/api/v1/orders', { dineIn: false, items: [{ productId: 'latte', quantity: 1 }] })).order;
  return {
    databasePath: path, owner, otherOwner, cashier, secondDevice, otherCashier, inspector, order, post, get, lookup,
    async reopen() { await hub.close(); hub = await createHub({ databasePath: path, now: () => time }); },
  };
}

test('controlled cash rejection is terminal across restart even when a later drawer opening makes the original input eligible', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const path = `/api/v1/orders/${f.order.id}/payments`;
  const input = { expectedVersion: f.order.version, method: 'cash', amountCentavos: 16_500, cashReceivedCentavos: 16_500, verified: true };
  const rejected = await f.post(f.cashier, path, input, commandId);
  assert.equal(rejected.statusCode, 409, rejected.body);
  const status = ok<Record<string, unknown>>(await f.lookup(commandId));
  assert.deepEqual(status, {
    commandId, status: 'rejected', action: 'order.payment', rejectedAt: time, error: rejected.json().error,
  });
  await f.reopen();
  assert.deepEqual(ok(await f.lookup(commandId)), status);
  ok(await f.post(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000 }));
  const replayed = await f.post(f.cashier, path, input, commandId);
  assert.equal(replayed.statusCode, 409, replayed.body);
  assert.deepEqual(replayed.json().error, rejected.json().error);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments WHERE order_id=?').get(f.order.id)!.count, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM cash_movements').get()!.count, 0);
  const fresh = ok<{ order: Order }>(await f.post(f.cashier, path, input));
  assert.equal(fresh.order.paidCentavos, 16_500);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments WHERE order_id=?').get(f.order.id)!.count, 1);
  assert.deepEqual(ok(await f.lookup(commandId)), status);
});

test('rejected command status and replay retain original actor, device, branch, action and payload bindings', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const path = `/api/v1/orders/${f.order.id}/payments`;
  const input = { expectedVersion: f.order.version, method: 'cash', amountCentavos: 16_500, cashReceivedCentavos: 16_500, verified: true };
  assert.equal((await f.post(f.cashier, path, input, commandId)).statusCode, 409);
  const original = ok(await f.lookup(commandId));
  const receipt = f.inspector.prepare('SELECT actor_id,branch_id,device_id,action,fingerprint,response_json,outcome,rejection_status FROM command_receipts WHERE id=?').get(commandId);
  for (const token of [f.secondDevice, f.otherCashier, f.owner, f.otherOwner]) {
    assert.deepEqual(ok(await f.lookup(commandId, token)), { commandId, status: 'unrecorded' });
  }
  assert.equal((await f.get(undefined, `/api/v1/commands/${commandId}`)).statusCode, 401);
  for (const token of [f.secondDevice, f.otherCashier]) {
    assert.equal((await f.post(token, path, input, commandId)).statusCode, 409);
  }
  assert.equal((await f.post(f.cashier, path, { ...input, amountCentavos: 10_000 }, commandId)).statusCode, 409);
  assert.equal((await f.post(f.cashier, `/api/v1/orders/${f.order.id}/send`, { expectedVersion: f.order.version }, commandId)).statusCode, 409);
  assert.deepEqual(f.inspector.prepare('SELECT actor_id,branch_id,device_id,action,fingerprint,response_json,outcome,rejection_status FROM command_receipts WHERE id=?').get(commandId), receipt);
  assert.deepEqual(ok(await f.lookup(commandId)), original);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE command_id=?').get(commandId)!.count, 1);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM outbox WHERE command_id=?').get(commandId)!.count, 1);
  const audit = f.inspector.prepare('SELECT action,payload_json FROM audit_events WHERE command_id=?').get(commandId)!;
  assert.equal(audit.action, 'order.payment.rejected');
  const event = JSON.parse(String(audit.payload_json)) as Record<string, unknown>;
  assert.equal(event.outcome, 'rejected');
  assert.equal(event.action, 'order.payment');
  assert.equal(event.target, f.order.id);
  assert.ok(!('input' in event));
  assert.ok(!('payload' in event));
});

test('controlled rejection rolls back partially written inventory and valuation before recording its terminal outcome', async (t) => {
  const f = await fixture(t);
  const maximumCarrying = 9_223_372_036_854_775_807n;
  f.inspector.prepare('UPDATE ingredient_valuation_balances SET carrying_microcentavos=? WHERE branch_id=? AND ingredient_id=?')
    .run(maximumCarrying, 'branch', 'beans');
  const receiptsBefore = f.inspector.prepare('SELECT * FROM stock_receipts ORDER BY id').all();
  const movementsBefore = f.inspector.prepare('SELECT * FROM stock_movements ORDER BY id').all();
  const commandId = randomUUID();
  const payload = { ingredientId: 'beans', quantityMilli: 1_000, totalCostCentavos: 1, reference: 'Fixture terminal inventory rejection' };
  const failed = await f.post(f.owner, '/api/v1/inventory/receipts', payload, commandId);
  assert.equal(failed.statusCode, 400, failed.body);
  assert.equal(ok<{ status: string }>(await f.lookup(commandId, f.owner)).status, 'rejected');
  assert.deepEqual(f.inspector.prepare('SELECT * FROM stock_receipts ORDER BY id').all(), receiptsBefore);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM stock_movements ORDER BY id').all(), movementsBefore);
  const balance = f.inspector.prepare('SELECT carrying_microcentavos FROM ingredient_valuation_balances WHERE branch_id=? AND ingredient_id=?');
  balance.setReadBigInts(true);
  assert.equal(balance.get('branch', 'beans')!.carrying_microcentavos, maximumCarrying);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE command_id=?').get(commandId)!.count, 1);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM outbox WHERE command_id=?').get(commandId)!.count, 1);
  f.inspector.prepare('UPDATE ingredient_valuation_balances SET carrying_microcentavos=? WHERE branch_id=? AND ingredient_id=?').run(100_000_000_000n, 'branch', 'beans');
  assert.equal((await f.post(f.owner, '/api/v1/inventory/receipts', payload, commandId)).statusCode, 400);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM stock_receipts ORDER BY id').all(), receiptsBefore);
  ok(await f.post(f.owner, '/api/v1/inventory/receipts', payload));
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM stock_receipts').get()!.count, receiptsBefore.length + 1);
});

test('failure to persist rejection outbox leaves the operation unrecorded and retryable as one transaction', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const path = `/api/v1/orders/${f.order.id}/payments`;
  const input = { expectedVersion: f.order.version, method: 'cash', amountCentavos: 16_500, cashReceivedCentavos: 16_500, verified: true };
  f.inspector.exec("CREATE TRIGGER fail_terminal_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected terminal outbox failure'); END;");
  try {
    const failed = await f.post(f.cashier, path, input, commandId);
    assert.equal(failed.statusCode, 500, failed.body);
    assert.ok(!/sqlite|injected|trigger|stack/i.test(failed.body));
    assert.deepEqual(ok(await f.lookup(commandId)), { commandId, status: 'unrecorded' });
    assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE command_id=?').get(commandId)!.count, 0);
    assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM command_receipts WHERE id=?').get(commandId)!.count, 0);
  } finally { f.inspector.exec('DROP TRIGGER fail_terminal_outbox'); }
  await f.reopen();
  assert.equal((await f.post(f.cashier, path, input, commandId)).statusCode, 409);
  assert.equal(ok<{ status: string }>(await f.lookup(commandId)).status, 'rejected');
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM outbox WHERE command_id=?').get(commandId)!.count, 1);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments WHERE order_id=?').get(f.order.id)!.count, 0);
});

test('unexpected database errors and pre-business validation or permission failures remain outside terminal outcomes', async (t) => {
  const f = await fixture(t);
  ok(await f.post(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000 }));
  const commandId = randomUUID();
  const path = `/api/v1/orders/${f.order.id}/payments`;
  const input = { expectedVersion: f.order.version, method: 'cash', amountCentavos: 16_500, cashReceivedCentavos: 16_500, verified: true };
  f.inspector.exec("CREATE TRIGGER fail_terminal_payment BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT, 'injected unclassified failure'); END;");
  try {
    assert.equal((await f.post(f.cashier, path, input, commandId)).statusCode, 500);
    assert.deepEqual(ok(await f.lookup(commandId)), { commandId, status: 'unrecorded' });
  } finally { f.inspector.exec('DROP TRIGGER fail_terminal_payment'); }
  const schemaCommand = randomUUID();
  assert.equal((await f.post(f.cashier, path, { ...input, claimedRole: 'owner' }, schemaCommand)).statusCode, 400);
  assert.deepEqual(ok(await f.lookup(schemaCommand)), { commandId: schemaCommand, status: 'unrecorded' });
  const forbiddenCommand = randomUUID();
  assert.equal((await f.post(f.cashier, '/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli: 1_000, totalCostCentavos: 1, reference: 'Denied receipt' }, forbiddenCommand)).statusCode, 403);
  assert.deepEqual(ok(await f.lookup(forbiddenCommand)), { commandId: forbiddenCommand, status: 'unrecorded' });
  ok(await f.post(f.cashier, path, input, commandId));
  const accepted = ok<{ status: string }>(await f.lookup(commandId));
  assert.equal(accepted.status, 'accepted');
  assert.equal(f.inspector.prepare('SELECT outcome FROM command_receipts WHERE id=?').get(commandId)!.outcome, 'accepted');
  const replay = await f.post(f.cashier, path, input, commandId);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(ok(await f.lookup(commandId)), accepted);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments WHERE order_id=?').get(f.order.id)!.count, 1);
});

test('simultaneous rejected retries record one terminal outcome and never execute after later state changes', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const path = `/api/v1/orders/${f.order.id}/payments`;
  const input = { expectedVersion: f.order.version, method: 'cash', amountCentavos: 16_500, cashReceivedCentavos: 16_500, verified: true };
  const replies = await Promise.all([f.post(f.cashier, path, input, commandId), f.post(f.cashier, path, input, commandId)]);
  assert.deepEqual(replies.map((reply) => reply.statusCode), [409, 409]);
  assert.deepEqual(replies[0]!.json().error, replies[1]!.json().error);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM command_receipts WHERE id=?').get(commandId)!.count, 1);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE command_id=?').get(commandId)!.count, 1);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM outbox WHERE command_id=?').get(commandId)!.count, 1);
  ok(await f.post(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000 }));
  const afterOpening = await Promise.all([f.post(f.cashier, path, input, commandId), f.post(f.cashier, path, input, commandId)]);
  assert.deepEqual(afterOpening.map((reply) => reply.statusCode), [409, 409]);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments WHERE order_id=?').get(f.order.id)!.count, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM cash_movements').get()!.count, 0);
});

test('distinct hub connections serialize terminal rejection and later accepted duplicates under their original command IDs', async (t) => {
  const f = await fixture(t);
  const rejectedCommand = randomUUID();
  const path = `/api/v1/orders/${f.order.id}/payments`;
  const input = { expectedVersion: f.order.version, method: 'cash', amountCentavos: 16_500, cashReceivedCentavos: 16_500, verified: true };
  type WorkerReply = { statusCode: number; body: Record<string, unknown>; businessBarrierReached: boolean };
  const workerCode = `
    const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    import('tsx/esm/api').then(async ({ register }) => {
      const unregister = register();
      try {
      const { createHub } = await import(workerData.moduleUrl);
      const hub = await createHub({ databasePath: workerData.databasePath, now: () => workerData.now });
      const originalExec = DatabaseSync.prototype.exec;
      const barrier = new Int32Array(workerData.barrier);
      let begins = 0;
      let businessBarrierReached = false;
      DatabaseSync.prototype.exec = function (statement) {
        // The first transaction is authorize()'s request limit. Synchronize
        // before either separate connection can lock the business transaction.
        if (statement === 'BEGIN IMMEDIATE' && ++begins === 2) {
          businessBarrierReached = true;
          if (Atomics.add(barrier, 0, 1) === 1) Atomics.notify(barrier, 0);
          else if (Atomics.wait(barrier, 0, 1, 10_000) === 'timed-out') {
            throw new Error('Other hub did not reach the business transaction');
          }
        }
        return originalExec.call(this, statement);
      };
      let result;
      try {
        const response = await hub.app.inject({
          method: 'POST', url: workerData.path,
          headers: { authorization: 'Bearer ' + workerData.token },
          payload: { commandId: workerData.commandId, ...workerData.input },
        });
        result = { statusCode: response.statusCode, body: response.json(), businessBarrierReached };
      } finally {
        DatabaseSync.prototype.exec = originalExec;
        await hub.close();
      }
      parentPort.postMessage(result);
      } finally { await unregister(); }
    }).catch(error => { throw error; });
  `;
  const race = async (commandId: string) => {
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const start = () => new Promise<WorkerReply>((resolveWorker, rejectWorker) => {
      const worker = new Worker(workerCode, {
        eval: true,
        workerData: {
          databasePath: f.databasePath, moduleUrl: new URL('../src/hub.ts', import.meta.url).href,
          now: time, token: f.cashier, path, input, commandId, barrier,
        },
      });
      let result: WorkerReply | undefined;
      let failure: Error | undefined;
      worker.once('message', (value: WorkerReply) => { result = value; });
      worker.once('error', (error: Error) => { failure = error; });
      worker.once('exit', (code) => {
        if (failure) rejectWorker(failure);
        else if (code !== 0 || result === undefined) rejectWorker(new Error(`Hub worker exited with code ${code}.`));
        else resolveWorker(result);
      });
    });
    const replies = await Promise.allSettled([start(), start()]);
    const results: WorkerReply[] = [];
    for (const reply of replies) {
      if (reply.status === 'rejected') throw reply.reason;
      assert.equal(reply.value.businessBarrierReached, true);
      results.push(reply.value);
    }
    assert.equal(new Int32Array(barrier)[0], 2);
    return results;
  };
  const rejected = await race(rejectedCommand);
  assert.deepEqual(rejected.map(reply => reply.statusCode), [409, 409]);
  assert.deepEqual(rejected[0]!.body.error, rejected[1]!.body.error);
  const terminalReceipt = f.inspector.prepare('SELECT * FROM command_receipts WHERE id=?').get(rejectedCommand);
  assert.equal(terminalReceipt!.outcome, 'rejected');
  assert.equal(terminalReceipt!.rejection_status, 409);
  for (const table of ['command_receipts', 'audit_events', 'outbox']) {
    const key = table === 'command_receipts' ? 'id' : 'command_id';
    assert.equal(f.inspector.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key}=?`).get(rejectedCommand)!.count, 1);
  }
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments').get()!.count, 0);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM cash_movements').get()!.count, 0);
  ok(await f.post(f.cashier, '/api/v1/shifts/open', { openingCashCentavos: 100_000 }));
  const stillRejected = await race(rejectedCommand);
  assert.deepEqual(stillRejected.map(reply => reply.statusCode), [409, 409]);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM command_receipts WHERE id=?').get(rejectedCommand), terminalReceipt);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments').get()!.count, 0);
  const acceptedCommand = randomUUID();
  const accepted = await race(acceptedCommand);
  assert.deepEqual(accepted.map(reply => reply.statusCode), [200, 200]);
  assert.deepEqual(accepted[0]!.body, accepted[1]!.body);
  for (const table of ['command_receipts', 'audit_events', 'outbox']) {
    const key = table === 'command_receipts' ? 'id' : 'command_id';
    assert.equal(f.inspector.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key}=?`).get(acceptedCommand)!.count, 1);
  }
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM payments').get()!.count, 1);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM cash_movements').get()!.count, 1);
  assert.equal(f.inspector.prepare('SELECT COUNT(*) AS count FROM order_settlements').get()!.count, 1);
  assert.deepEqual(ok(await f.lookup(acceptedCommand)), {
    commandId: acceptedCommand, status: 'accepted', action: 'order.payment', acceptedAt: time,
  });
  assert.deepEqual(f.inspector.prepare('PRAGMA foreign_key_check').all(), []);
});

test('device revocation terminal rejection is scoped and survives retry without changing devices or sessions', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const path = '/api/v1/devices/tablet/revoke';
  const input = { expectedVersion: 2 };
  const devices = f.inspector.prepare('SELECT * FROM devices ORDER BY id').all();
  const sessions = f.inspector.prepare('SELECT * FROM sessions ORDER BY token_hash').all();
  const rejected = await f.post(f.owner, path, input, commandId);
  assert.equal(rejected.statusCode, 409, rejected.body);
  const outcome = ok(await f.lookup(commandId, f.owner));
  assert.deepEqual(outcome, {
    commandId, status: 'rejected', action: 'device.revoke', rejectedAt: time, error: rejected.json().error,
  });
  assert.deepEqual(f.inspector.prepare('SELECT * FROM devices ORDER BY id').all(), devices);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM sessions ORDER BY token_hash').all(), sessions);
  await f.reopen();
  const replay = await f.post(f.owner, path, input, commandId);
  assert.equal(replay.statusCode, 409, replay.body);
  assert.deepEqual(replay.json().error, rejected.json().error);
  assert.deepEqual(ok(await f.lookup(commandId, f.owner)), outcome);
  for (const token of [f.cashier, f.otherOwner]) {
    assert.deepEqual(ok(await f.lookup(commandId, token)), { commandId, status: 'unrecorded' });
  }
  assert.equal((await f.post(f.otherOwner, path, input, commandId)).statusCode, 409);
  assert.deepEqual(ok(await f.lookup(commandId, f.owner)), outcome);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM devices ORDER BY id').all(), devices);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM sessions ORDER BY token_hash').all(), sessions);
  assert.equal((await f.get(f.cashier, '/api/v1/me')).statusCode, 200);
  const receipt = f.inspector.prepare('SELECT outcome,rejection_status FROM command_receipts WHERE id=?').get(commandId)!;
  assert.deepEqual({ ...receipt }, { outcome: 'rejected', rejection_status: 409 });
  const audit = f.inspector.prepare('SELECT action,payload_json FROM audit_events WHERE command_id=?').all(commandId);
  const outbox = f.inspector.prepare('SELECT event_type,payload_json FROM outbox WHERE command_id=?').all(commandId);
  assert.equal(audit.length, 1);
  assert.equal(outbox.length, 1);
  assert.equal(audit[0]!.action, 'device.revoke.rejected');
  assert.equal(outbox[0]!.event_type, 'device.revoke.rejected');
  assert.equal((JSON.parse(String(audit[0]!.payload_json)) as { outcome: string }).outcome, 'rejected');
});

test('legacy accepted revocation receipt retains its original fingerprint, response and event shapes on replay', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const deviceId = 'second-tablet';
  const path = `/api/v1/devices/${deviceId}/revoke`;
  const expectedVersion = 1;
  const version = 2;
  const result = { device: { id: deviceId, branchId: 'branch', version, revoked: true }, commandId };
  // Seed the exact receipt contract emitted before the shared outcome helper.
  const fingerprint = digest(JSON.stringify({ action: 'device.revoke', id: deviceId, expectedVersion }));
  const event = JSON.stringify({ deviceId, version, revoked: true });
  f.inspector.exec('BEGIN IMMEDIATE');
  try {
    f.inspector.prepare('UPDATE devices SET revoked=1,version=? WHERE id=?').run(version, deviceId);
    f.inspector.prepare('UPDATE sessions SET revoked=1 WHERE device_id=?').run(deviceId);
    f.inspector.prepare('INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at) VALUES(?,?,?,?,?,?,?)')
      .run(commandId, 'owner', 'branch', 'device.revoke', fingerprint, JSON.stringify(result), time);
    f.inspector.prepare('INSERT INTO audit_events(id,command_id,actor_id,branch_id,action,payload_json,accepted_at) VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(), commandId, 'owner', 'branch', 'device.revoke', event, time);
    f.inspector.prepare('INSERT INTO outbox(id,command_id,branch_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), commandId, 'branch', 'device.revoked', event, time);
    f.inspector.exec('COMMIT');
  } catch (error) { f.inspector.exec('ROLLBACK'); throw error; }
  const before = {
    receipt: f.inspector.prepare('SELECT * FROM command_receipts WHERE id=?').get(commandId),
    audit: f.inspector.prepare('SELECT * FROM audit_events WHERE command_id=?').all(commandId),
    outbox: f.inspector.prepare('SELECT * FROM outbox WHERE command_id=?').all(commandId),
    device: f.inspector.prepare('SELECT * FROM devices WHERE id=?').get(deviceId),
    sessions: f.inspector.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),
  };
  await f.reopen();
  const response = await f.post(f.owner, path, { expectedVersion }, commandId);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), result);
  assert.deepEqual(ok(await f.lookup(commandId, f.owner)), {
    commandId, status: 'accepted', action: 'device.revoke', acceptedAt: time,
  });
  assert.equal((await f.post(f.owner, path, { expectedVersion: version }, commandId)).statusCode, 409);
  assert.equal((await f.post(f.otherOwner, path, { expectedVersion }, commandId)).statusCode, 409);
  assert.deepEqual(ok(await f.lookup(commandId, f.otherOwner)), { commandId, status: 'unrecorded' });
  assert.deepEqual(f.inspector.prepare('SELECT * FROM command_receipts WHERE id=?').get(commandId), before.receipt);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM audit_events WHERE command_id=?').all(commandId), before.audit);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM outbox WHERE command_id=?').all(commandId), before.outbox);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM devices WHERE id=?').get(deviceId), before.device);
  assert.deepEqual(f.inspector.prepare('SELECT * FROM sessions ORDER BY token_hash').all(), before.sessions);
  assert.equal((await f.get(f.cashier, '/api/v1/me')).statusCode, 200);
});
