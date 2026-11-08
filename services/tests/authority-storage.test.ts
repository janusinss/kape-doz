import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { compare, getRounds } from 'bcryptjs';
import { createHub } from '../src/hub.js';

const root = fileURLToPath(new URL('../../scratch/authority-tests/', import.meta.url));
const password = 'Fixture-Storage-Admin-Password!';
const deviceSecret = 'Fixture-Storage-Device-Secret-32!';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function fixture(t: TestContext) {
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'storage-'));
  const databasePath = join(folder, 'hub.sqlite');
  const hub = await createHub({ databasePath });
  await hub.provisionAccount({ id: 'owner-a', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'cashier-a', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: '4826' });
  await hub.provisionDevice({ id: 'tablet-a', branchId: 'branch-a', secret: deviceSecret });
  const inspector = new DatabaseSync(databasePath);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.ok(target.startsWith(resolve(root) + sep));
    assert.equal(dirname(target), resolve(root));
    await rm(target, { recursive: true, force: true });
  });
  const ownerResponse = await hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner-a', password } });
  assert.equal(ownerResponse.statusCode, 200);
  const staffResponse = await hub.app.inject({
    method: 'POST', url: '/api/v1/auth/staff',
    payload: { accountId: 'cashier-a', pin: '4826', deviceId: 'tablet-a', deviceSecret },
  });
  assert.equal(staffResponse.statusCode, 200);
  const ownerToken: string = ownerResponse.json().token;
  const staffToken: string = staffResponse.json().token;
  const revoke = (commandId: string) => hub.app.inject({
    method: 'POST', url: '/api/v1/devices/tablet-a/revoke',
    headers: { authorization: `Bearer ${ownerToken}` }, payload: { commandId, expectedVersion: 1 },
  });
  const counts = () => ({
    receipts: inspector.prepare('SELECT COUNT(*) AS count FROM command_receipts').get()!.count,
    audit: inspector.prepare('SELECT COUNT(*) AS count FROM audit_events').get()!.count,
    outbox: inspector.prepare('SELECT COUNT(*) AS count FROM outbox').get()!.count,
  });
  return { hub, inspector, ownerToken, staffToken, revoke, counts };
}

test('persisted credentials use bcrypt12 or stronger and sessions/devices store only token digests', async (t) => {
  const f = await fixture(t);
  const credentials = f.inspector.prepare('SELECT id,credential_hash FROM accounts ORDER BY id').all();
  assert.equal(credentials.length, 2);
  for (const account of credentials) {
    const stored = String(account.credential_hash);
    assert.ok(getRounds(stored) >= 12);
    const original = account.id === 'cashier-a' ? '4826' : password;
    assert.notEqual(stored, original);
    assert.equal(await compare(original, stored), true);
  }
  const tokenHashes = f.inspector.prepare('SELECT token_hash FROM sessions ORDER BY account_id').all();
  assert.equal(tokenHashes.length, 2);
  assert.deepEqual(new Set(tokenHashes.map((row) => row.token_hash)), new Set([sha256(f.ownerToken), sha256(f.staffToken)]));
  assert.ok(!tokenHashes.some((row) => row.token_hash === f.ownerToken || row.token_hash === f.staffToken));
  const device = f.inspector.prepare('SELECT secret_hash FROM devices WHERE id=?').get('tablet-a')!;
  assert.equal(device.secret_hash, sha256(deviceSecret));
  assert.notEqual(device.secret_hash, deviceSecret);
});

test('outbox insertion failure rolls back revocation, session invalidation, receipt and audit as one transaction', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  f.inspector.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END;");
  const failed = await f.revoke(commandId);
  assert.equal(failed.statusCode, 500);
  assert.ok(!/sqlite|trigger|injected|C:\\|stack/i.test(failed.body), 'public error must not disclose the injected database failure');
  const unchanged = f.inspector.prepare('SELECT revoked,version FROM devices WHERE id=?').get('tablet-a');
  assert.deepEqual({ ...unchanged }, { revoked: 0, version: 1 });
  assert.deepEqual(f.counts(), { receipts: 0, audit: 0, outbox: 0 });
  const me = await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${f.staffToken}` } });
  assert.equal(me.statusCode, 200, 'rollback must retain the previously valid staff session');

  f.inspector.exec('DROP TRIGGER fail_outbox;');
  assert.equal((await f.revoke(commandId)).statusCode, 200, 'same command may be retried after rollback');
  assert.deepEqual(f.counts(), { receipts: 1, audit: 1, outbox: 1 });
  assert.equal((await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${f.staffToken}` } })).statusCode, 401);
});

test('simultaneous identical revocations persist exactly one device effect, command receipt, audit and outbox row', async (t) => {
  const f = await fixture(t);
  const commandId = randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.revoke(commandId)));
  for (const result of results) {
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), results[0]!.json());
  }
  assert.deepEqual(f.counts(), { receipts: 1, audit: 1, outbox: 1 });
  const device = f.inspector.prepare('SELECT version,revoked FROM devices WHERE id=?').get('tablet-a');
  assert.deepEqual({ ...device }, { version: 2, revoked: 1 });
  const audit = f.inspector.prepare('SELECT command_id,actor_id,branch_id,action FROM audit_events').get();
  assert.deepEqual({ ...audit }, { command_id: commandId, actor_id: 'owner-a', branch_id: 'branch-a', action: 'device.revoke' });
  const pending = f.inspector.prepare('SELECT command_id,branch_id,status,event_type FROM outbox').get();
  assert.deepEqual({ ...pending }, { command_id: commandId, branch_id: 'branch-a', status: 'pending', event_type: 'device.revoked' });
});
