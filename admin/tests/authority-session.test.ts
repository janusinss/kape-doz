import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { api, HubError, login, type Mutation, type Session } from '../src/api';

const authorityId = 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad';
const hubOrigin = 'http://127.0.0.1:7331';
const actor = { id: 'owner', displayName: 'Fixture owner', branchId: 'branch', role: 'owner' as const };
const rawSession = { token: 'A'.repeat(43), expiresAt: Date.now() + 60_000, actor };

function transport(t: TestContext) {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: hubOrigin } } });
  const priorFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = priorFetch; if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  const calls: { url: string; init?: RequestInit }[] = [];
  let authority: unknown = { authorityId, branchId: 'branch' };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const path = new URL(String(url)).pathname;
    return new Response(JSON.stringify(path === '/api/v1/auth/admin' ? rawSession : path === '/api/v1/authority' ? authority : { ingredients: [] }), { status: 200 });
  };
  return { calls, authority(value: unknown) { authority = value; } };
}

test('admin login binds its session to an authenticated exact hub identity', async t => {
  const f = transport(t);
  const session = await login('owner', 'Synthetic fixture password');
  assert.equal((session as any).authorityId, authorityId);
  assert.equal((session as any).hubOrigin, hubOrigin);
  assert.deepEqual(f.calls.map(call => new URL(call.url).pathname), ['/api/v1/auth/admin', '/api/v1/authority']);
  assert.equal(new Headers(f.calls[1]!.init!.headers).get('Authorization'), 'Bearer ' + rawSession.token);
  await api.ingredients(session);
  assert.equal(new Headers(f.calls[2]!.init!.headers).get('X-Kape-Doz-Authority'), authorityId);
});

test('malformed, cross-branch or unavailable authority cannot produce an operational session', async t => {
  const f = transport(t);
  for (const value of [null, { authorityId, branchId: 'other' }, { authorityId: 'invalid', branchId: 'branch' }, { authorityId, branchId: 'branch', extra: true }]) {
    f.authority(value);
    await assert.rejects(login('owner', 'Synthetic fixture password'), HubError);
  }
});

test('authenticated calls use their original hub origin and reject a mismatched saved authority before network', async t => {
  const f = transport(t);
  const session = { ...rawSession, authorityId, hubOrigin } as Session;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://127.0.0.1:7442' } } });
  await api.ingredients(session);
  assert.equal(f.calls[0]!.url, hubOrigin + '/api/v1/ingredients');
  const command = { id: '8b4d7cc3-2912-4e72-bbed-ecc6626d29d7', actorId: 'owner', branchId: 'branch',
    path: '/api/v1/ingredients', data: { ingredientId: 'beans', name: 'Beans', unit: 'g' }, label: 'Ingredient created.',
    authorityId: '014fa126-a2f1-43c0-a7c4-bb580eb629ec', hubOrigin, role: 'owner', createdAt: 1000 } as Mutation;
  await assert.rejects(api.commandStatus(session, command), HubError);
  await assert.rejects(api.mutate(session, command), HubError);
  assert.equal(f.calls.length, 1);
});
