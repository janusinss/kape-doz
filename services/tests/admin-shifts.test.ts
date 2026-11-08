import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHub } from '../src/hub.js';

const scratchRoot = fileURLToPath(new URL('../../scratch/admin-shifts-tests/', import.meta.url));
const password = 'Fixture-Shifts-Admin-Password!';
const deviceSecret = 'Fixture-Shifts-Device-Secret-2026!';
const path = '/api/v1/admin/shifts';

function ok<T>(response: { statusCode: number; body: string; json(): unknown }): T {
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as T;
}

type Shift = { id: string; drawerId: string; status: string; version: number };
type ListedShift = Shift & {
  openingCashCentavos: number; countedCashCentavos: number;
  expectedCashCentavos: number; varianceCentavos: number;
  openedAt: number; submittedAt: number; note: string;
};

test('admin shift review list is durable, latest-count-first and restricted to the authorized branch and roles', async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'shifts-'));
  const databasePath = join(folder, 'hub.sqlite');
  let now = Date.UTC(2026, 10, 4, 9);
  let hub = await createHub({ databasePath, now: () => now });
  t.after(async () => {
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), resolve(scratchRoot));
    await rm(target, { recursive: true, force: true });
  });

  await hub.provisionAccount({ id: 'owner-a', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'manager-a', displayName: 'Fixture manager', role: 'manager', branchId: 'branch-a', secret: password });
  await hub.provisionAccount({ id: 'cashier-a', displayName: 'Fixture cashier', role: 'cashier', branchId: 'branch-a', secret: '4826' });
  await hub.provisionAccount({ id: 'owner-b', displayName: 'Other branch fixture owner', role: 'owner', branchId: 'branch-b', secret: password });
  await hub.provisionAccount({ id: 'cashier-b', displayName: 'Other branch fixture cashier', role: 'cashier', branchId: 'branch-b', secret: '4826' });
  for (const [id, branchId] of [['tablet-a', 'branch-a'], ['tablet-a2', 'branch-a'], ['tablet-b', 'branch-b']] as const) {
    await hub.provisionDevice({ id, branchId, secret: deviceSecret });
  }

  const login = async (accountId: string, deviceId?: string) => ok<{ token: string }>(await hub.app.inject({
    method: 'POST',
    url: `/api/v1/auth/${deviceId ? 'staff' : 'admin'}`,
    payload: deviceId ? { accountId, pin: '4826', deviceId, deviceSecret } : { accountId, password },
  })).token;
  const owner = await login('owner-a');
  const manager = await login('manager-a');
  const cashier = await login('cashier-a', 'tablet-a');
  const secondCashier = await login('cashier-a', 'tablet-a2');
  const otherOwner = await login('owner-b');
  const otherCashier = await login('cashier-b', 'tablet-b');
  const get = (url: string, token?: string) => hub.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const post = (token: string, url: string, payload: Record<string, unknown>) => hub.app.inject({
    method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { commandId: randomUUID(), ...payload },
  });
  const open = async (token: string, openingCashCentavos: number) => ok<{ shift: Shift }>(
    await post(token, '/api/v1/shifts/open', { openingCashCentavos }),
  ).shift;
  const submit = async (token: string, shift: Shift, countedCashCentavos: number, note: string) => ok<{ shift: Shift }>(
    await post(token, `/api/v1/shifts/${shift.id}/submit-count`, { expectedVersion: shift.version, countedCashCentavos, note }),
  ).shift;
  const review = async (token: string, shift: Shift, decision: 'approve' | 'recount') => ok<{ shift: Shift }>(
    await post(token, `/api/v1/shifts/${shift.id}/review`, { expectedVersion: shift.version, decision }),
  ).shift;
  const list = async (token: string) => ok<{ shifts: ListedShift[] }>(await get(path, token));

  ok(await post(owner, '/api/v1/ingredients', { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
  ok(await post(owner, '/api/v1/products', {
    productId: 'latte', name: 'Fixture latte', priceCentavos: 16500,
    recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }],
  }));
  for (const [token, drawerId, deviceId] of [
    [owner, 'counter-a', 'tablet-a'], [owner, 'counter-a2', 'tablet-a2'], [otherOwner, 'counter-b', 'tablet-b'],
  ] as const) {
    ok(await post(token, '/api/v1/drawers', { drawerId, name: drawerId, deviceIds: [deviceId] }));
  }

  const openedAt = now;
  let primary = await open(cashier, 100000);
  const order = ok<{ order: { id: string; version: number } }>(await post(cashier, '/api/v1/orders', {
    dineIn: true, items: [{ productId: 'latte', quantity: 1 }],
  })).order;
  ok(await post(cashier, `/api/v1/orders/${order.id}/payments`, {
    expectedVersion: order.version, method: 'cash', amountCentavos: 10000, cashReceivedCentavos: 20000, verified: true,
  }));
  primary = ok<{ shift: Shift }>(await get('/api/v1/shifts/current', cashier)).shift;
  now += 1000;
  primary = await submit(cashier, primary, 109900, 'First count');
  const firstSubmittedAt = now;
  primary = await review(manager, primary, 'recount');
  const other = await open(otherCashier, 50000);
  now += 1000;
  const otherCount = await submit(otherCashier, other, 50000, 'Other branch note');
  const second = await open(secondCashier, 20000);
  now += 1000;
  const secondCount = await submit(secondCashier, second, 20001, 'Second drawer note');
  const secondSubmittedAt = now;

  const firstList = await list(owner);
  assert.deepEqual(firstList.shifts, [
    { id: second.id, drawerId: 'counter-a2', status: 'awaiting_review', version: secondCount.version,
      openingCashCentavos: 20000, countedCashCentavos: 20001, expectedCashCentavos: 20000,
      varianceCentavos: 1, openedAt: secondSubmittedAt - 1000, submittedAt: secondSubmittedAt, note: 'Second drawer note' },
    { id: primary.id, drawerId: 'counter-a', status: 'recount_required', version: primary.version,
      openingCashCentavos: 100000, countedCashCentavos: 109900, expectedCashCentavos: 110000,
      varianceCentavos: -100, openedAt, submittedAt: firstSubmittedAt, note: 'First count' },
  ]);
  assert.deepEqual(await list(manager), firstList);
  assert.deepEqual((await list(otherOwner)).shifts.map((shift) => shift.id), [otherCount.id]);
  assert.equal((await get(path, cashier)).statusCode, 403);
  assert.equal((await get(path)).statusCode, 401);

  now += 1000;
  primary = await submit(cashier, primary, 110025, 'Latest recount note');
  const finalSubmittedAt = now;
  now += 1000;
  primary = await review(owner, primary, 'approve');
  const openOnly = await open(cashier, 99000);
  await hub.close();
  hub = await createHub({ databasePath, now: () => now });

  const reopened = await list(manager);
  assert.deepEqual(reopened.shifts, [
    { id: primary.id, drawerId: 'counter-a', status: 'closed', version: primary.version,
      openingCashCentavos: 100000, countedCashCentavos: 110025, expectedCashCentavos: 110000,
      varianceCentavos: 25, openedAt, submittedAt: finalSubmittedAt, note: 'Latest recount note' },
    firstList.shifts[0],
  ]);
  assert.ok(reopened.shifts.every((shift) => shift.id !== openOnly.id && shift.id !== otherCount.id));
});
