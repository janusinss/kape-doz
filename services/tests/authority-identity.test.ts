import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';
import { HubDatabase } from '../src/database.js';

const password = 'Authority-Identity-Fixture-Password!';
const secret = 'Authority-Identity-Fixture-Device-Secret!';
const origin = 'http://127.0.0.1:41234';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function directory(t: TestContext, close: () => Promise<void> = async () => {}) {
  const root = resolve(tmpdir());
  const folder = await mkdtemp(join(root, 'kape-doz-authority-identity-'));
  t.after(async () => {
    await close();
    const target = resolve(folder);
    assert.equal(dirname(target), root);
    assert.ok(target.startsWith(join(root, 'kape-doz-authority-identity-')));
    await rm(target, { recursive: true, force: true });
  });
  return folder;
}

async function fixture(t: TestContext) {
  const cleanup = { close: async () => {} };
  const folder = await directory(t, () => cleanup.close());
  const path = join(folder, 'hub.sqlite');
  let hub = await createHub({ databasePath: path, allowedOrigins: [origin] });
  const inspector = new DatabaseSync(path);
  cleanup.close = async () => { inspector.close(); await hub.close(); };
  for (const [id, role, branchId] of [
    ['identity-owner', 'owner', 'branch-a'], ['identity-manager', 'manager', 'branch-a'],
    ['identity-cashier', 'cashier', 'branch-a'], ['identity-other-owner', 'owner', 'branch-b'],
  ] as const) {
    await hub.provisionAccount({ id, role, branchId, displayName: id, secret: role === 'cashier' ? '4826' : password });
  }
  await hub.provisionDevice({ id: 'identity-tablet', branchId: 'branch-a', secret });
  async function login(accountId: string, staff = false) {
    const response = await hub.app.inject({
      method: 'POST', url: `/api/v1/auth/${staff ? 'staff' : 'admin'}`,
      payload: staff ? { accountId, pin: '4826', deviceId: 'identity-tablet', deviceSecret: secret } : { accountId, password },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(Object.keys(response.json()).sort(), ['actor', 'expiresAt', 'token']);
    return response.json<{ token: string }>().token;
  }
  const owner = await login('identity-owner');
  const manager = await login('identity-manager');
  const cashier = await login('identity-cashier', true);
  const otherOwner = await login('identity-other-owner');
  const get = (token: string | undefined, path: string, authority?: string) => hub.app.inject({
    method: 'GET', url: path, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(authority !== undefined ? { 'x-kape-doz-authority': authority } : {}),
    },
  });
  const create = (authority?: string, commandId = randomUUID()) => hub.app.inject({
    method: 'POST', url: '/api/v1/ingredients', headers: {
      authorization: `Bearer ${owner}`, ...(authority !== undefined ? { 'x-kape-doz-authority': authority } : {}),
    }, payload: { commandId, ingredientId: 'identity-beans', name: 'Identity fixture beans', unit: 'g' },
  });
  return {
    get hub() { return hub; }, path, inspector, owner, manager, cashier, otherOwner, get, create,
    async reopen() { await hub.close(); hub = await createHub({ databasePath: path, allowedOrigins: [origin] }); },
  };
}

test('authority identity requires an administrator and preserves existing login and me contracts', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.get(undefined, '/api/v1/authority')).statusCode, 401);
  assert.equal((await f.get(f.cashier, '/api/v1/authority')).statusCode, 403);
  const response = await f.get(f.owner, '/api/v1/authority');
  assert.equal(response.statusCode, 200, response.body);
  const identity = response.json<{ authorityId: string; branchId: string }>();
  assert.match(identity.authorityId, uuid);
  assert.deepEqual(Object.keys(identity).sort(), ['authorityId', 'branchId']);
  assert.equal(identity.branchId, 'branch-a');
  assert.deepEqual((await f.get(f.manager, '/api/v1/authority')).json(), identity);
  assert.deepEqual((await f.get(f.otherOwner, '/api/v1/authority')).json(), { ...identity, branchId: 'branch-b' });
  assert.deepEqual(Object.keys((await f.get(f.owner, '/api/v1/me')).json()).sort(), ['actor', 'expiresAt']);
  await f.reopen();
  assert.deepEqual((await f.get(f.owner, '/api/v1/authority')).json(), identity);
});

test('expected authority header fences wrong-hub reads and mutations before rate counters or business effects', async (t) => {
  const f = await fixture(t);
  const own = (await f.get(f.owner, '/api/v1/authority')).json<{ authorityId: string }>().authorityId;
  assert.match(own, uuid);
  const commandId = randomUUID();
  const limits = f.inspector.prepare('SELECT * FROM request_limits ORDER BY scope,subject').all();
  for (const malformed of ['', 'not-an-authority', own + ', ' + own]) {
    const response = await f.create(malformed, commandId);
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error.code, 'invalid_request');
  }
  const wrong = randomUUID();
  const denied = await f.create(wrong, commandId);
  assert.equal(denied.statusCode, 409, denied.body);
  assert.equal(denied.json().error.code, 'authority_mismatch');
  const hidden = await f.get(f.owner, '/api/v1/commands/' + commandId, wrong);
  assert.equal(hidden.statusCode, 409, hidden.body);
  assert.equal(hidden.json().error.code, 'authority_mismatch');
  assert.deepEqual(f.inspector.prepare('SELECT * FROM request_limits ORDER BY scope,subject').all(), limits);
  for (const table of ['ingredients', 'command_receipts', 'audit_events', 'outbox']) {
    assert.equal(f.inspector.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count, 0);
  }
  const accepted = await f.create(own, commandId);
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal((await f.get(f.owner, '/api/v1/commands/' + commandId, own)).json().status, 'accepted');
  assert.equal((await f.get(f.owner, '/api/v1/me')).statusCode, 200, 'older clients may omit the header');
  assert.equal((await f.get(f.cashier, '/api/v1/staff/context')).statusCode, 200);
  const preflight = await f.hub.app.inject({ method: 'OPTIONS', url: '/api/v1/ingredients', headers: {
    origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type, x-kape-doz-authority',
  } });
  assert.equal(preflight.statusCode, 204, preflight.body);
  assert.ok(String(preflight.headers['access-control-allow-headers']).toLowerCase().includes('x-kape-doz-authority'));
});

test('fresh authorities with matching account and branch IDs cannot replay one another pending commands', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const identityA = (await first.get(first.owner, '/api/v1/authority')).json<{ authorityId: string }>().authorityId;
  const identityB = (await second.get(second.owner, '/api/v1/authority')).json<{ authorityId: string }>().authorityId;
  assert.match(identityA, uuid);
  assert.match(identityB, uuid);
  assert.notEqual(identityA, identityB);
  const commandId = randomUUID();
  assert.equal((await first.create(identityA, commandId)).statusCode, 200);
  const retargeted = await second.create(identityA, commandId);
  assert.equal(retargeted.statusCode, 409, retargeted.body);
  assert.equal(retargeted.json().error.code, 'authority_mismatch');
  assert.equal(second.inspector.prepare('SELECT COUNT(*) AS count FROM command_receipts WHERE id=?').get(commandId)!.count, 0);
  assert.equal(second.inspector.prepare('SELECT COUNT(*) AS count FROM ingredients').get()!.count, 0);
  assert.equal((await second.get(second.owner, '/api/v1/commands/' + commandId, identityA)).statusCode, 409);
  assert.deepEqual((await second.get(second.owner, '/api/v1/commands/' + commandId, identityB)).json(), { commandId, status: 'unrecorded' });
  assert.equal((await first.get(first.owner, '/api/v1/commands/' + commandId, identityA)).json().status, 'accepted');
});

async function schemaTen(t: TestContext) {
  const folder = await directory(t);
  const path = join(folder, 'legacy.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
    for (const [index, name] of [
      '001_authority.sql', '002_auth_reservations.sql', '003_business.sql', '004_command_context.sql',
      '005_operating_expenses.sql', '006_sales_valuation.sql', '007_order_approvals.sql', '008_order_cancellations.sql',
      '009_refunds.sql', '010_command_outcomes.sql',
    ].entries()) {
      db.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
    }
    db.prepare('INSERT INTO branches(id) VALUES(?)').run('preserved-branch');
    db.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)')
      .run('preserved-owner', 'preserved-branch', 'Preserved owner', 'owner', 'preserved-credential');
  } finally { db.close(); }
  return path;
}

test('schema 10 upgrades seed one stable authority without replacing existing identity records', async (t) => {
  const path = await schemaTen(t);
  let db = new HubDatabase(path);
  try {
    const identity = db.connection.prepare('SELECT singleton,authority_id FROM hub_identity').get()!;
    assert.equal(identity.singleton, 1);
    assert.match(String(identity.authority_id), uuid);
    assert.equal(db.connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.equal(db.connection.prepare('SELECT credential_hash FROM accounts WHERE id=?').get('preserved-owner')!.credential_hash, 'preserved-credential');
    assert.equal(db.connection.prepare('SELECT COUNT(*) AS count FROM hub_identity').get()!.count, 1);
    assert.throws(() => db.connection.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(2,?)').run(randomUUID()), /CHECK/);
    db.close();
    db = new HubDatabase(path);
    assert.deepEqual(db.connection.prepare('SELECT singleton,authority_id FROM hub_identity').get(), identity);
    assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('concurrent schema 10 upgrades retain the same single authority UUID', async (t) => {
  const path = await schemaTen(t);
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const workerCode = `
    const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    const barrier = new Int32Array(workerData.barrier);
    const original = DatabaseSync.prototype.exec;
    let synchronized = false;
    DatabaseSync.prototype.exec = function (statement) {
      if (!synchronized && statement === 'BEGIN IMMEDIATE') {
        synchronized = true;
        if (Atomics.add(barrier, 0, 1) === 1) Atomics.notify(barrier, 0);
        else if (Atomics.wait(barrier, 0, 1, 10_000) === 'timed-out') throw new Error('Other hub did not enter identity upgrade');
      }
      return original.call(this, statement);
    };
    import(workerData.moduleUrl).then(({ HubDatabase }) => {
      const db = new HubDatabase(workerData.path);
      try { parentPort.postMessage(db.connection.prepare('SELECT singleton,authority_id FROM hub_identity').all()); }
      finally { db.close(); }
    }).catch(error => { throw error; });
  `;
  const start = () => new Promise<unknown>((resolveWorker, rejectWorker) => {
    const worker = new Worker(workerCode, { eval: true, workerData: { path, barrier, moduleUrl: new URL('../src/database.ts', import.meta.url).href } });
    let result: unknown;
    let failure: Error | undefined;
    worker.once('message', (value: unknown) => { result = value; });
    worker.once('error', (error: Error) => { failure = error; });
    worker.once('exit', (code) => {
      if (failure) rejectWorker(failure);
      else if (code !== 0 || result === undefined) rejectWorker(new Error('Identity worker exited without its result.'));
      else resolveWorker(result);
    });
  });
  const starts = await Promise.allSettled([start(), start()]);
  for (const result of starts) if (result.status === 'rejected') throw result.reason;
  assert.equal(new Int32Array(barrier)[0], 2);
  const [first, second] = starts.map(result => (result as PromiseFulfilledResult<unknown>).value);
  assert.deepEqual(first, second);
  assert.equal((first as { authority_id: string }[]).length, 1);
  assert.match((first as { authority_id: string }[])[0]!.authority_id, uuid);
});

test('missing or corrupt authority identity blocks startup without generating a replacement or resetting records', async (t) => {
  for (const corruption of ['missing', 'invalid'] as const) {
    const path = await schemaTen(t);
    const current = new HubDatabase(path);
    try {
      if (corruption === 'missing') current.connection.prepare('DELETE FROM hub_identity WHERE singleton=1').run();
      else current.connection.prepare('UPDATE hub_identity SET authority_id=? WHERE singleton=1').run('x'.repeat(36));
    } finally { current.close(); }
    assert.throws(() => new HubDatabase(path), /authority identity is missing or invalid/);
    const retained = new DatabaseSync(path);
    try {
      assert.equal(retained.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
      assert.equal(retained.prepare('SELECT credential_hash FROM accounts WHERE id=?').get('preserved-owner')!.credential_hash, 'preserved-credential');
      const rows = retained.prepare('SELECT singleton,authority_id FROM hub_identity').all();
      assert.deepEqual(rows.map(row => ({ ...row })), corruption === 'missing' ? [] : [{ singleton: 1, authority_id: 'x'.repeat(36) }]);
    } finally { retained.close(); }
  }
});
