import assert from 'node:assert/strict';
import test from 'node:test';
import * as hubApi from '../src/api';

const command: hubApi.Mutation = {
  id: '4d6376ba-562a-4d27-a7f6-386d344bec99', actorId: 'owner', branchId: 'branch',
  path: '/api/v1/ingredients', data: { ingredientId: 'beans', name: 'Beans', unit: 'g' }, label: 'Ingredient created.',
};
const session: hubApi.Session = { token: 'fixture-token', expiresAt: Date.now() + 60_000,
  authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
  actor: { id: 'owner', displayName: 'Owner', branchId: 'branch', role: 'owner' } };
const accepted = { commandId: command.id, status: 'accepted', action: 'ingredient.create', acceptedAt: 1000 };
const rejected = { commandId: command.id, status: 'rejected', action: 'ingredient.create', rejectedAt: 1001,
  error: { code: 'conflict', message: 'The command conflicts with the accepted state.' } };
const unrecorded = { commandId: command.id, status: 'unrecorded' };
const parser = (value: unknown, descriptor = command) =>
  (hubApi as unknown as { validateCommandStatus: (value: unknown, command: hubApi.Mutation) => unknown }).validateCommandStatus(value, descriptor);

test('terminal command status is exact and bound to saved ID and action', () => {
  assert.deepEqual(parser(accepted), accepted);
  assert.deepEqual(parser(rejected), rejected);
  assert.deepEqual(parser(unrecorded), unrecorded);
  for (const value of [
    { ...accepted, commandId: 'another-command' }, { ...accepted, action: 'inventory.receive' },
    { ...accepted, acceptedAt: -1 }, { ...accepted, acceptedAt: Number.MAX_SAFE_INTEGER + 1 },
    { ...accepted, extra: 'untrusted' }, { ...rejected, rejectedAt: null },
    { ...rejected, error: { code: 'conflict', message: '' } },
    { ...rejected, error: { code: 'conflict', message: 'Rejected', rawPayload: 'private' } },
    { ...unrecorded, action: 'ingredient.create' }, { ...rejected, status: 'failed' },
  ]) assert.throws(() => parser(value), hubApi.HubError);
});

test('authentication, permission, throttling and infrastructure failures cannot acknowledge terminal rejection', () => {
  for (const code of ['unauthorized', 'forbidden', 'request_failed', 'rate_limited', 'future_unknown_code']) {
    assert.throws(() => parser({ ...rejected, error: { code, message: 'Request unavailable.' } }), hubApi.HubError, code);
  }
  for (const code of ['invalid_request', 'not_found', 'conflict', 'payload_too_large']) {
    const value = { ...rejected, error: { code, message: 'Business operation rejected.' } };
    assert.deepEqual(parser(value), value);
  }
});

test('saved admin routes resolve their original business action', () => {
  const routes = [
    ['/api/v1/inventory/receipts', {}, 'inventory.receive'],
    ['/api/v1/products', {}, 'product.create'], ['/api/v1/shifts/shift/review', {}, 'shift.review'],
    ['/api/v1/approvals/request/decision', {}, 'approval.decide'],
    ['/api/v1/refunds/refund/decision', {}, 'refund.decide'],
    ['/api/v1/refunds/refund/legs/leg', { action: 'mark_unknown' }, 'refund.leg.mark_unknown'],
    ['/api/v1/devices/tablet/revoke', {}, 'device.revoke'],
    ['/api/v1/admin/expenses', {}, 'expense.record'],
    ['/api/v1/admin/expense-coverage', {}, 'expense.coverage.confirm'],
  ] as const;
  for (const [path, data, action] of routes) assert.deepEqual(parser({ ...accepted, action }, { ...command, path, data }), { ...accepted, action });
  for (const path of ['/api/v1/auth/logout', '/api/v1/refunds/refund/legs/leg']) {
    assert.throws(() => parser(accepted, { ...command, path }), hubApi.HubError);
  }
});

test('command lookup uses authenticated GET and rejects mismatched replies', async t => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://127.0.0.1' } } });
  const priorFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = priorFetch; if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  let reply: unknown = rejected;
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify(reply), { status: 200 }); };
  const api = hubApi.api as typeof hubApi.api & { commandStatus: (session: hubApi.Session, command: hubApi.Mutation) => Promise<unknown> };
  assert.deepEqual(await api.commandStatus(session, command), rejected);
  assert.equal(requests[0]?.url, 'http://127.0.0.1/api/v1/commands/' + command.id);
  assert.equal(requests[0]?.init?.method, 'GET');
  assert.equal((requests[0]?.init?.headers as Record<string, string>).Authorization, 'Bearer fixture-token');
  reply = { ...accepted, action: 'inventory.waste' };
  await assert.rejects(api.commandStatus(session, command), hubApi.HubError);
  const beforeInvalid = requests.length;
  await assert.rejects(api.commandStatus(session, { ...command, id: '../another-command' }), hubApi.HubError);
  assert.equal(requests.length, beforeInvalid);
});

test('authoritative refresh validates records and preserves supported name and negative-stock boundaries', async t => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://127.0.0.1' } } });
  const priorFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = priorFetch; if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  let reply: unknown = { ingredients: [{ id: 'beans', name: 'A'.repeat(120), unit: 'g', onHandMilli: -1000, reservedMilli: 0 }] };
  const paths: string[] = [];
  globalThis.fetch = async url => { paths.push(new URL(String(url)).pathname); return new Response(JSON.stringify(reply), { status: 200 }); };
  await hubApi.refreshCommand(session, command);
  assert.deepEqual(paths, ['/api/v1/ingredients']);
  for (const value of [
    {}, { ingredients: 'not an array' }, { ingredients: [null] },
    { ingredients: [{ id: 'beans', name: 'Beans', unit: 'g', onHandMilli: 1000, reservedMilli: -1 }] },
    { ingredients: [{ id: 'beans', name: 'Beans', unit: 'kg', onHandMilli: 1000, reservedMilli: 0 }] },
  ]) { reply = value; await assert.rejects(hubApi.refreshCommand(session, command), hubApi.HubError); }
  reply = { products: [{ id: 'latte', name: 'B'.repeat(120), priceCentavos: 16500, version: 1, recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }] }] };
  await hubApi.refreshCommand(session, { ...command, path: '/api/v1/products' });
  assert.equal(paths.at(-1), '/api/v1/products');
  reply = { shifts: [{ id: 'shift', drawerId: 'counter', version: 2, status: 'closed', expectedCashCentavos: 110000, countedCashCentavos: 109000, varianceCentavos: -1000 }] };
  await hubApi.refreshCommand(session, { ...command, path: '/api/v1/shifts/shift/review' });
  assert.equal(paths.at(-1), '/api/v1/admin/shifts');
  reply = { devices: [{ id: 'tablet', branchId: 'other-branch', version: 1, revoked: true }] };
  await assert.rejects(hubApi.refreshCommand(session, { ...command, path: '/api/v1/devices/tablet/revoke' }), hubApi.HubError);
});
