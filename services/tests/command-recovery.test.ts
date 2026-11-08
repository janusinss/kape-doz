import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHub } from '../src/hub.js';

test('command status survives restart and is scoped to its actor and device', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kape-doz-command-'));
  const databasePath = join(directory, 'test.sqlite');
  const original = await createHub({ databasePath });
  let hub = original;
  const pin = '3481';
  const secret = 'Command-Recovery-Fixture-Device-32!';
  const password = 'Command-Recovery-Fixture-Owner-Password!';
  try {
    await hub.provisionAccount({ id: 'fixture-owner', branchId: 'branch-a', displayName: 'Owner', role: 'owner', secret: password });
    for (const id of ['barista-a', 'barista-b']) {
      await hub.provisionAccount({ id, branchId: 'branch-a', displayName: id, role: 'barista', secret: pin });
    }
    for (const id of ['tablet-a', 'tablet-b']) {
      await hub.provisionDevice({ id, branchId: 'branch-a', secret });
    }
    const signIn = async (accountId: string, deviceId: string) => {
      const response = await hub.app.inject({
        method: 'POST', url: '/api/v1/auth/staff',
        payload: { accountId, pin, deviceId, deviceSecret: secret },
      });
      assert.equal(response.statusCode, 200);
      return 'Bearer ' + response.json<{ token: string }>().token;
    };
    const owner = await hub.app.inject({
      method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'fixture-owner', password },
    });
    assert.equal(owner.statusCode, 200);
    const created = await hub.app.inject({
      method: 'POST', url: '/api/v1/ingredients',
      headers: { authorization: 'Bearer ' + owner.json<{ token: string }>().token },
      payload: { commandId: randomUUID(), ingredientId: 'beans', name: 'Fixture beans', unit: 'g' },
    });
    assert.equal(created.statusCode, 200);
    const first = await signIn('barista-a', 'tablet-a');
    const otherDevice = await signIn('barista-a', 'tablet-b');
    const otherActor = await signIn('barista-b', 'tablet-a');
    const commandId = randomUUID();
    const lookup = (authorization?: string) => hub.app.inject({
      method: 'GET', url: '/api/v1/commands/' + commandId,
      headers: authorization ? { authorization } : {},
    });
    const missing = await lookup(first);
    assert.equal(missing.statusCode, 200);
    assert.deepEqual(missing.json(), { commandId, status: 'unrecorded' });
    const sent = await hub.app.inject({
      method: 'POST', url: '/api/v1/waste', headers: { authorization: first },
      payload: { commandId, ingredientId: 'beans', quantityMilli: 1000, reason: 'test', note: '' },
    });
    assert.equal(sent.statusCode, 200);
    await original.close();
    hub = await createHub({ databasePath });
    const accepted = await lookup(first);
    assert.equal(accepted.statusCode, 200);
    const body = accepted.json();
    assert.deepEqual(body, { commandId, status: 'accepted', action: 'inventory.waste', acceptedAt: body.acceptedAt });
    assert.ok(Number.isSafeInteger(body.acceptedAt));
    for (const auth of [otherDevice, otherActor]) {
      const response = await lookup(auth);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { commandId, status: 'unrecorded' });
    }
    assert.equal((await lookup()).statusCode, 401);
  } finally {
    try { await hub.close(); } finally { await rm(databasePath, { force: true }); }
    for (const suffix of ['-wal', '-shm']) await rm(databasePath + suffix, { force: true });
    await rmdir(directory);
  }
});
