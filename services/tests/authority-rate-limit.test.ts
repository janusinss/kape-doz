import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { createHub } from '../src/hub.js';

const root = fileURLToPath(new URL('../../scratch/authority-tests/', import.meta.url));
const deviceSecret = 'Fixture-Rate-Device-Secret-2026!';

async function fixture(t: TestContext) {
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'rate-'));
  const databasePath = join(folder, 'hub.sqlite');
  let instant = Date.UTC(2026, 10, 4, 10);
  let hub = await createHub({ databasePath, now: () => instant });
  await hub.provisionAccount({
    id: 'cashier-a', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: '4826',
  });
  await hub.provisionDevice({ id: 'tablet-a', branchId: 'branch-a', secret: deviceSecret });
  t.after(async () => {
    await hub.close();
    const target = resolve(folder);
    assert.ok(target.startsWith(resolve(root) + sep));
    assert.equal(dirname(target), resolve(root));
    await rm(target, { recursive: true, force: true });
  });
  return {
    login(accountId = 'cashier-a', pin = '4826') {
      return hub.app.inject({
        method: 'POST', url: '/api/v1/auth/staff',
        payload: { accountId, pin, deviceId: 'tablet-a', deviceSecret },
      });
    },
    advance(milliseconds: number) { instant += milliseconds; },
    async reopen() {
      await hub.close();
      hub = await createHub({ databasePath, now: () => instant });
    },
  };
}

test('five failed accounts from one IP throttle further login across restart until the failure window expires', async (t) => {
  const f = await fixture(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await f.login(`unknown-account-${attempt}`, '9999')).statusCode, 401);
  }
  await f.reopen();
  const blocked = await f.login('another-unknown-account', '9999');
  assert.equal(blocked.statusCode, 429, 'rotating accounts must not bypass the per-IP failure limit');
  assert.equal((await f.login()).statusCode, 429, 'a correct secret does not bypass an active IP lockout');
  f.advance(15 * 60 * 1000 + 1);
  assert.equal((await f.login()).statusCode, 200);
});

test('successful sequential logins do not consume the failed-attempt allowance', async (t) => {
  const f = await fixture(t);
  for (let attempt = 0; attempt < 7; attempt++) {
    assert.equal((await f.login()).statusCode, 200, `successful login ${attempt + 1} must remain available`);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await f.login(`missing-after-success-${attempt}`, '9999')).statusCode, 401);
  }
  assert.equal((await f.login('sixth-failure', '9999')).statusCode, 429);
});

test('concurrent attempts reserve the IP failure budget before asynchronous credential verification', async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => f.login(`parallel-missing-${index}`, '9999')));
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [401, 401, 401, 401, 401, 429]);
  assert.equal((await f.login('parallel-seventh', '9999')).statusCode, 429);
});
