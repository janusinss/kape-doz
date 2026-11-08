import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHub } from '../src/hub.js';

type Hub = Awaited<ReturnType<typeof createHub>>;
const scratchRoot = fileURLToPath(new URL('../../scratch/authority-tests/', import.meta.url));
const password = 'Fixture-Admin-Password-2026!';
const deviceSecret = 'Fixture-Enrolled-Tablet-Secret-2026!';

async function fixture(t: TestContext) {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'authority-'));
  const databasePath = join(folder, 'hub.sqlite');
  let instant = Date.UTC(2026, 10, 4, 8, 0, 0);
  let hub = await createHub({ databasePath, now: () => instant });
  await hub.provisionAccount({
    id: 'cashier-a', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: '4826',
  });
  await hub.provisionAccount({
    id: 'owner-a', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password,
  });
  await hub.provisionDevice({ id: 'tablet-a', branchId: 'branch-a', secret: deviceSecret });
  t.after(async () => {
    await hub.close();
    const target = resolve(folder);
    const root = resolve(scratchRoot);
    assert.ok(target.startsWith(root + sep), 'cleanup must stay inside the isolated scratch directory');
    assert.equal(dirname(target), root);
    await rm(target, { recursive: true, force: true });
  });
  return {
    get hub() { return hub; },
    advance(milliseconds: number) { instant += milliseconds; },
    async reopen() {
      await hub.close();
      hub = await createHub({ databasePath, now: () => instant });
    },
  };
}

async function staffLogin(hub: Hub, overrides: Record<string, unknown> = {}) {
  return hub.app.inject({
    method: 'POST', url: '/api/v1/auth/staff',
    payload: { accountId: 'cashier-a', pin: '4826', deviceId: 'tablet-a', deviceSecret, ...overrides },
  });
}

async function adminLogin(hub: Hub, overrides: Record<string, unknown> = {}) {
  return hub.app.inject({
    method: 'POST', url: '/api/v1/auth/admin',
    payload: { accountId: 'owner-a', password, ...overrides },
  });
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

test('staff sign-in returns a single-role actor and an opaque authenticated session', async (t) => {
  const f = await fixture(t);
  const result = await staffLogin(f.hub);
  assert.equal(result.statusCode, 200);
  const session = result.json();
  assert.equal(typeof session.token, 'string');
  assert.ok(session.token.length >= 32);
  assert.ok(Number.isFinite(session.expiresAt));
  assert.deepEqual(session.actor, {
    id: 'cashier-a', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a',
  });
  assert.deepEqual(Object.keys(session).sort(), ['actor', 'expiresAt', 'token']);

  const me = await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(session.token) });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json().actor, session.actor);
  assert.ok(!/secret|password|hash|pin/i.test(me.body), 'public actor response must exclude credentials');

  const context = await f.hub.app.inject({ method: 'GET', url: '/api/v1/staff/context', headers: bearer(session.token) });
  assert.equal(context.statusCode, 200);
  assert.deepEqual(context.json(), { actor: session.actor, modules: ['cashier'], branchId: 'branch-a' });
});

test('barista has only station and waste modules; cashier cannot access admin context', async (t) => {
  const f = await fixture(t);
  await f.hub.provisionAccount({
    id: 'barista-a', displayName: 'Fixture barista', role: 'barista', branchId: 'branch-a', secret: '5937',
  });
  const barista = await staffLogin(f.hub, { accountId: 'barista-a', pin: '5937' });
  assert.equal(barista.statusCode, 200);
  const response = await f.hub.app.inject({ method: 'GET', url: '/api/v1/staff/context', headers: bearer(barista.json().token) });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().modules, ['station', 'waste']);

  const cashier = await staffLogin(f.hub);
  const denied = await f.hub.app.inject({ method: 'GET', url: '/api/v1/admin/context', headers: bearer(cashier.json().token) });
  assert.equal(denied.statusCode, 403);
  assert.ok(!/margin|variance|password|hash/i.test(denied.body));
});

test('admin sign-in is separate from staff PIN access and permits the admin context', async (t) => {
  const f = await fixture(t);
  await f.hub.provisionAccount({
    id: 'manager-a', displayName: 'Fixture manager', role: 'manager', branchId: 'branch-a', secret: password,
  });
  const manager = await adminLogin(f.hub, { accountId: 'manager-a' });
  assert.equal(manager.statusCode, 200);
  const context = await f.hub.app.inject({ method: 'GET', url: '/api/v1/admin/context', headers: bearer(manager.json().token) });
  assert.equal(context.statusCode, 200);
  assert.equal(context.json().actor.role, 'manager');
  const wrongRealm = await f.hub.app.inject({ method: 'GET', url: '/api/v1/staff/context', headers: bearer(manager.json().token) });
  assert.equal(wrongRealm.statusCode, 403);

  assert.equal((await adminLogin(f.hub, { accountId: 'cashier-a', password: '4826-Not-An-Admin-Password' })).statusCode, 401);
  assert.equal((await staffLogin(f.hub, { accountId: 'owner-a', pin: '4826' })).statusCode, 401);
});

test('unknown or incorrect credentials and invalid device enrollment return generic errors', async (t) => {
  const f = await fixture(t);
  const badPin = await staffLogin(f.hub, { pin: '9999' });
  const unknownAccount = await staffLogin(f.hub, { accountId: 'does-not-exist' });
  const unknownDevice = await staffLogin(f.hub, { deviceId: 'unenrolled-tablet' });
  const wrongDeviceSecret = await staffLogin(f.hub, { deviceSecret: 'wrong-device-secret-value' });
  assert.equal(badPin.statusCode, 401);
  for (const result of [unknownAccount, unknownDevice, wrongDeviceSecret]) {
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.json().error, badPin.json().error);
  }
  await f.hub.provisionDevice({ id: 'tablet-other-branch', branchId: 'branch-b', secret: deviceSecret });
  assert.equal((await staffLogin(f.hub, { deviceId: 'tablet-other-branch' })).statusCode, 401);
});

test('strict request validation rejects actor or role spoofing and malformed credentials', async (t) => {
  const f = await fixture(t);
  assert.equal((await staffLogin(f.hub, { role: 'owner' })).statusCode, 400);
  assert.equal((await staffLogin(f.hub, { branchId: 'branch-b' })).statusCode, 400);
  assert.equal((await staffLogin(f.hub, { pin: 4826 })).statusCode, 400);
  assert.equal((await staffLogin(f.hub, { pin: '' })).statusCode, 400);
  assert.equal((await adminLogin(f.hub, { password: 'short' })).statusCode, 400);
  assert.equal((await adminLogin(f.hub, { actorId: 'owner-a' })).statusCode, 400);
});

test('five failed PIN attempts persist across restart and block a correct PIN until the window expires', async (t) => {
  const f = await fixture(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await staffLogin(f.hub, { pin: '9999' })).statusCode, 401);
  }
  await f.reopen();
  assert.equal((await staffLogin(f.hub)).statusCode, 429);
  f.advance(15 * 60 * 1000 + 1);
  assert.equal((await staffLogin(f.hub)).statusCode, 200);
});

test('missing, malformed and expired sessions cannot access protected resources', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.hub.app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode, 401);
  assert.equal((await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer('invalid-token') })).statusCode, 401);
  const session = (await staffLogin(f.hub)).json();
  await f.reopen();
  assert.equal((await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(session.token) })).statusCode, 200);
  f.advance(24 * 60 * 60 * 1000 + 1);
  assert.equal((await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(session.token) })).statusCode, 401);
});

test('logout revokes the session durably and cannot be reused after reopening the hub', async (t) => {
  const f = await fixture(t);
  const session = (await staffLogin(f.hub)).json();
  const logout = await f.hub.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: bearer(session.token), payload: {} });
  assert.equal(logout.statusCode, 204);
  await f.reopen();
  assert.equal((await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(session.token) })).statusCode, 401);
});

test('only an owner can revoke an enrolled device and revocation immediately invalidates staff sessions', async (t) => {
  const f = await fixture(t);
  const staff = (await staffLogin(f.hub)).json();
  const payload = { commandId: randomUUID(), expectedVersion: 1 };
  const forbidden = await f.hub.app.inject({ method: 'POST', url: '/api/v1/devices/tablet-a/revoke', headers: bearer(staff.token), payload });
  assert.equal(forbidden.statusCode, 403);
  assert.equal((await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(staff.token) })).statusCode, 200);
  const owner = (await adminLogin(f.hub)).json();
  const revoke = await f.hub.app.inject({ method: 'POST', url: '/api/v1/devices/tablet-a/revoke', headers: bearer(owner.token), payload });
  assert.equal(revoke.statusCode, 200);
  assert.deepEqual(revoke.json(), { device: { id: 'tablet-a', branchId: 'branch-a', version: 2, revoked: true }, commandId: payload.commandId });
  assert.equal((await f.hub.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(staff.token) })).statusCode, 401);
  assert.equal((await staffLogin(f.hub)).statusCode, 401);
  await f.reopen();
  assert.equal((await staffLogin(f.hub)).statusCode, 401);
});

test('device revocation retries preserve one accepted result across restart and reject changed command identity', async (t) => {
  const f = await fixture(t);
  const owner = (await adminLogin(f.hub)).json();
  const payload = { commandId: randomUUID(), expectedVersion: 1 };
  const inject = (token: string, body = payload) => f.hub.app.inject({
    method: 'POST', url: '/api/v1/devices/tablet-a/revoke', headers: bearer(token), payload: body,
  });
  const original = await inject(owner.token);
  assert.equal(original.statusCode, 200);
  await f.reopen();
  const replay = await inject(owner.token);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), original.json());
  assert.equal((await inject(owner.token, { ...payload, expectedVersion: 2 })).statusCode, 409);
  assert.equal((await inject(owner.token, { commandId: randomUUID(), expectedVersion: 1 })).statusCode, 409);

  await f.hub.provisionAccount({
    id: 'owner-b', displayName: 'Second fixture owner', role: 'owner', branchId: 'branch-a', secret: password,
  });
  const secondOwner = (await adminLogin(f.hub, { accountId: 'owner-b' })).json();
  assert.equal((await inject(secondOwner.token)).statusCode, 409);
  const listed = await f.hub.app.inject({ method: 'GET', url: '/api/v1/devices', headers: bearer(owner.token) });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json().devices, [{ id: 'tablet-a', branchId: 'branch-a', version: 2, revoked: true }]);
  f.advance(24 * 60 * 60 * 1000 + 1);
  assert.equal((await inject(owner.token)).statusCode, 401);
});

test('device enumeration and mutation remain within the authenticated owner branch', async (t) => {
  const f = await fixture(t);
  await f.hub.provisionDevice({ id: 'tablet-b', branchId: 'branch-b', secret: deviceSecret });
  await f.hub.provisionAccount({
    id: 'owner-other-branch', displayName: 'Other branch fixture owner', role: 'owner', branchId: 'branch-b', secret: password,
  });
  const owner = (await adminLogin(f.hub)).json();
  const listed = await f.hub.app.inject({ method: 'GET', url: '/api/v1/devices', headers: bearer(owner.token) });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json().devices.map((device: { id: string }) => device.id), ['tablet-a']);
  const denied = await f.hub.app.inject({
    method: 'POST', url: '/api/v1/devices/tablet-b/revoke', headers: bearer(owner.token),
    payload: { commandId: randomUUID(), expectedVersion: 1 },
  });
  assert.equal(denied.statusCode, 404);
  const otherOwner = (await adminLogin(f.hub, { accountId: 'owner-other-branch' })).json();
  const intact = await f.hub.app.inject({ method: 'GET', url: '/api/v1/devices', headers: bearer(otherOwner.token) });
  assert.deepEqual(intact.json().devices, [{ id: 'tablet-b', branchId: 'branch-b', version: 1, revoked: false }]);
});
