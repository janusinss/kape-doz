import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  AdminRecoveryError, AdminRecoveryStore, matchesScope, pendingAdminCommand,
  type AdminRecoveryScope, type RecoveryBackend, type RecoveryKey, type RecoverySnapshot,
} from '../src/admin_recovery';
import { isProductOptions } from '../src/product_availability';

const crypto = webcrypto as unknown as Crypto;
const scope: AdminRecoveryScope = { hubOrigin: 'https://hub.example', authorityId: '12345678-1234-4123-8123-123456789abc', actorId: 'owner', branchId: 'branch', role: 'owner' };
const command = () => pendingAdminCommand({ id: '4d6376ba-562a-4d27-a7f6-386d344bec99', actorId: 'owner', branchId: 'branch',
  path: '/api/v1/ingredients', data: { ingredientId: 'beans', name: 'Private ingredient batch', unit: 'g' }, label: 'Ingredient created.' }, scope, 1000);

class Backend implements RecoveryBackend {
  key: RecoveryKey | null = null;
  record: string | null = null;
  writes = 0;
  failRead = false;
  failWrite = false;
  async read(): Promise<RecoverySnapshot> {
    if (this.failRead) throw new Error('Private underlying storage error');
    return { key: this.key, record: this.record };
  }
  async initializeKey(candidate: RecoveryKey, encryptedInitial: string): Promise<RecoverySnapshot> {
    if (this.failWrite) throw new Error('Private underlying storage error');
    if (this.key === null && this.record === null) { this.key = candidate; this.record = encryptedInitial; }
    if (this.key === null || this.record === null) throw new Error('Missing key or record');
    return { key: this.key, record: this.record };
  }
  async replace(expected: { record: string | null; keyId: string }, next: string): Promise<void> {
    if (this.failWrite) throw new Error('Private underlying storage error');
    if (this.record !== expected.record || this.key?.id !== expected.keyId) throw new Error('Stale writer');
    this.record = next;
    this.writes++;
  }
}

test('descriptors clone approved data and bind actor, role, authority and hub', () => {
  const data = { productId: 'latte', name: 'Latte', priceCentavos: 16500, recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }] };
  const saved = pendingAdminCommand({ ...command(), path: '/api/v1/products', data }, scope, 2000);
  data.recipe[0]!.quantityMilli = 1;
  assert.equal((saved.data.recipe as { quantityMilli: number }[])[0]?.quantityMilli, 18000);
  assert.ok(Object.isFrozen(saved));
  assert.ok(Object.isFrozen(saved.data));
  assert.ok(Object.isFrozen(saved.data.recipe));
  assert.equal(matchesScope(saved, scope), true);
  for (const other of [{ ...scope, actorId: 'other' }, { ...scope, role: 'manager' as const },
    { ...scope, hubOrigin: 'https://other.example' }, { ...scope, authorityId: '11111111-2222-4333-8444-555555555555' },
    { ...scope, branchId: 'other' }]) assert.equal(matchesScope(saved, other), false);
});

test('credentials, forged scope, unsafe payloads and unsupported routes never reach storage', () => {
  for (const data of [{ password: 'Private-password-should-never-leak' }, { nested: { token: 'Private-token' } },
    { commandId: 'overridden' }, { actorId: 'other' }, { quantityMilli: -1 }, { amountCentavos: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => pendingAdminCommand({ ...command(), data }, scope, 1000), error => error instanceof AdminRecoveryError && !/Private/.test(error.message));
  }
  assert.throws(() => pendingAdminCommand({ ...command(), path: '/api/v1/auth/logout' }, scope, 1000), AdminRecoveryError);
  assert.throws(() => pendingAdminCommand({ ...command(), actorId: 'other' }, scope, 1000), AdminRecoveryError);
  assert.throws(() => pendingAdminCommand(command(), { ...scope, hubOrigin: 'http://192.168.1.4' }, 1000), AdminRecoveryError);
  assert.throws(() => pendingAdminCommand({ ...command(), data: { note: '漢'.repeat(12000) } }, scope, 1000), AdminRecoveryError);
  assert.throws(() => pendingAdminCommand({ ...command(), data: JSON.parse('{"__proto__":{"name":"unsafe"}}') }, scope, 1000), AdminRecoveryError);
});

const discountedRecipe = () => ({
  name: 'Discounted latte', priceCentavos: 16500,
  recipe: [{ ingredientId: 'milk', quantityMilli: 180000 }],
  sizes: [{ id: 'small', name: 'Small', priceDeltaCentavos: -2500,
    recipe: [{ ingredientId: 'milk', quantityMilli: 120000 }] }],
  substitutions: [{ id: 'alternate-milk', name: 'Alternate milk', priceDeltaCentavos: -500,
    replaceIngredientId: 'milk', withIngredientId: 'alternate-milk', quantityMilli: 180000 }],
});

for (const mode of ['create', 'update'] as const) {
  test(`signed recipe size and substitution adjustments survive encrypted ${mode} recovery`, async () => {
    const data = mode === 'create'
      ? { productId: 'discounted-latte', ...discountedRecipe() }
      : { expectedVersion: 2, ...discountedRecipe() };
    const saved = pendingAdminCommand({ ...command(),
      path: mode === 'create' ? '/api/v1/products' : '/api/v1/products/discounted-latte/recipe',
      data,
    }, scope, 1000);
    assert.equal((saved.data.sizes as { priceDeltaCentavos: number }[])[0]!.priceDeltaCentavos, -2500);
    assert.equal((saved.data.substitutions as { priceDeltaCentavos: number }[])[0]!.priceDeltaCentavos, -500);
    const backend = new Backend();
    await new AdminRecoveryStore(backend, crypto).savePending(saved);
    assert.deepEqual(await new AdminRecoveryStore(backend, crypto).load(), { pending: saved });
    assert.ok(!backend.record!.includes('Discounted latte'));
  });
}

test('signed recipe recovery does not allow negative prices, quantities, unknown fields or ordinary commands', () => {
  const base = discountedRecipe();
  const invalidProducts = [
    { ...base, priceCentavos: -1 },
    { ...base, recipe: [{ ingredientId: 'milk', quantityMilli: -1 }] },
    { ...base, sizes: [{ ...base.sizes[0]!, recipe: [{ ingredientId: 'milk', quantityMilli: -1 }] }] },
    { ...base, substitutions: [{ ...base.substitutions[0]!, quantityMilli: -1 }] },
    { ...base, priceDeltaCentavos: -1 },
    { ...base, sizes: [{ ...base.sizes[0]!, unknownAmount: -1 }] },
    { ...base, unknown: { priceDeltaCentavos: -1 } },
    { ...base, addons: [{ id: 'shot', name: 'Extra shot', priceDeltaCentavos: -1,
      recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }] }] },
  ];
  for (const data of invalidProducts) {
    for (const mode of ['create', 'update'] as const) {
      assert.throws(() => pendingAdminCommand({ ...command(),
        path: mode === 'create' ? '/api/v1/products' : '/api/v1/products/discounted-latte/recipe',
        data: mode === 'create' ? { productId: 'discounted-latte', ...data } : { expectedVersion: 2, ...data },
      }, scope, 1000), AdminRecoveryError);
    }
  }
  assert.throws(() => pendingAdminCommand({ ...command(), data: { ingredientId: 'beans', name: 'Beans', unit: 'g',
    sizes: [{ priceDeltaCentavos: -1 }] } }, scope, 1000), AdminRecoveryError);
  assert.throws(() => pendingAdminCommand({ ...command(), path: '/api/v1/inventory/receipts',
    data: { ingredientId: 'beans', quantityMilli: 1000, totalCostCentavos: -1, reference: 'Receipt' },
  }, scope, 1000), AdminRecoveryError);
  assert.equal(isProductOptions({ addons: [{ id: 'shot', name: 'Extra shot', priceDeltaCentavos: -1,
    recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }] }] }), false);
});

test('encrypted pending state survives a new store without plaintext financial data', async () => {
  const backend = new Backend();
  const store = new AdminRecoveryStore(backend, crypto);
  assert.deepEqual(await store.load(), { pending: null });
  const saved = command();
  await store.savePending(saved);
  assert.ok(backend.record);
  assert.ok(!backend.record.includes('Private ingredient batch'));
  assert.ok(!backend.record.includes(saved.id));
  assert.ok(!backend.record.includes(scope.actorId));
  assert.equal(backend.key?.key.extractable, false);
  const restarted = new AdminRecoveryStore(backend, crypto);
  assert.deepEqual(await restarted.load(), { pending: saved });
  assert.equal(backend.writes, 1);
  await restarted.savePending(saved);
  assert.equal(backend.writes, 1, 'identical save must preserve the original descriptor');
});

test('a different pending command and an incorrect clear preserve the original bytes', async () => {
  const backend = new Backend();
  const store = new AdminRecoveryStore(backend, crypto);
  await store.savePending(command());
  const before = backend.record;
  await assert.rejects(store.savePending({ ...command(), id: '11111111-2222-4333-8444-555555555555' }), AdminRecoveryError);
  await assert.rejects(store.clearPending('11111111-2222-4333-8444-555555555555', scope), AdminRecoveryError);
  await assert.rejects(store.clearPending(command().id, { ...scope, authorityId: '11111111-2222-4333-8444-555555555555' }), AdminRecoveryError);
  assert.equal(backend.record, before);
  assert.deepEqual(await store.clearPending(command().id, scope), { pending: null });
  assert.deepEqual(await new AdminRecoveryStore(backend, crypto).load(), { pending: null });
});

test('concurrent stores cannot replace one pending command with another', async () => {
  const backend = new Backend();
  const a = new AdminRecoveryStore(backend, crypto);
  const b = new AdminRecoveryStore(backend, crypto);
  const other = { ...command(), id: '11111111-2222-4333-8444-555555555555' };
  const results = await Promise.allSettled([a.savePending(command()), b.savePending(other)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const current = (await a.load()).pending;
  assert.ok([command().id, other.id].includes(current!.id));
  const original = current!.id;
  await a.clearPending(original, scope);
  const replacement = original === other.id ? command() : other;
  await b.savePending(replacement);
  const bytes = backend.record;
  await assert.rejects(a.clearPending(original, scope), AdminRecoveryError);
  assert.equal(backend.record, bytes);
});

test('corrupt, future, tampered and missing-key records fail closed without replacement', async () => {
  const backend = new Backend();
  const store = new AdminRecoveryStore(backend, crypto);
  await store.savePending(command());
  const original = backend.record!;
  const envelope = JSON.parse(original);
  for (const bytes of ['not JSON', JSON.stringify({ ...envelope, schemaVersion: 2 }),
    JSON.stringify({ ...envelope, revision: envelope.revision + 1 }), JSON.stringify({ ...envelope, iv: 'AAAA' }),
    JSON.stringify({ ...envelope, ciphertext: 'A'.repeat(envelope.ciphertext.length) })]) {
    backend.record = bytes;
    await assert.rejects(new AdminRecoveryStore(backend, crypto).load(), AdminRecoveryError);
    assert.equal(backend.record, bytes);
  }
  backend.record = original;
  const futureIv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(JSON.stringify([1, envelope.revision, backend.key!.id]));
  const futureBytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: futureIv, additionalData: aad }, backend.key!.key,
    new TextEncoder().encode(JSON.stringify({ version: 2, pending: command() })));
  backend.record = JSON.stringify({ ...envelope, iv: Buffer.from(futureIv).toString('base64'), ciphertext: Buffer.from(futureBytes).toString('base64') });
  const futureRecord = backend.record;
  await assert.rejects(new AdminRecoveryStore(backend, crypto).load(), AdminRecoveryError);
  assert.equal(backend.record, futureRecord);
  backend.record = original;
  backend.key = null;
  await assert.rejects(new AdminRecoveryStore(backend, crypto).load(), AdminRecoveryError);
  assert.equal(backend.record, original);
  assert.equal(backend.key, null);
});

test('failed reads, failed writes and a wrong encryption key preserve the saved operation', async () => {
  const backend = new Backend();
  const store = new AdminRecoveryStore(backend, crypto);
  backend.failWrite = true;
  await assert.rejects(store.savePending(command()), error => error instanceof AdminRecoveryError && !/Private/.test(error.message));
  assert.equal(backend.record, null);
  backend.failWrite = false;
  await store.savePending(command());
  const original = backend.record;
  backend.failWrite = true;
  await assert.rejects(store.clearPending(command().id, scope), AdminRecoveryError);
  assert.equal(backend.record, original);
  backend.failRead = true;
  await assert.rejects(store.load(), error => error instanceof AdminRecoveryError && !/Private/.test(error.message));
  backend.failRead = false;
  backend.key = { id: backend.key!.id, key: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) };
  await assert.rejects(new AdminRecoveryStore(backend, crypto).load(), AdminRecoveryError);
  assert.equal(backend.record, original);
});

test('a retained key with a missing journal never resets to an empty state', async () => {
  const backend = new Backend();
  const store = new AdminRecoveryStore(backend, crypto);
  await store.savePending(command());
  const key = backend.key;
  backend.record = null;
  await assert.rejects(new AdminRecoveryStore(backend, crypto).load(), AdminRecoveryError);
  await assert.rejects(new AdminRecoveryStore(backend, crypto).savePending(command()), AdminRecoveryError);
  assert.equal(backend.key, key);
  assert.equal(backend.record, null);
});

test('startup rereads the winning initialization and preserves a command saved by another tab', async () => {
  const backend = new Backend();
  const initialize = backend.initializeKey.bind(backend);
  let anotherTabSaved = false;
  backend.initializeKey = async (candidate, encryptedInitial) => {
    const snapshot = await initialize(candidate, encryptedInitial);
    if (!anotherTabSaved) {
      anotherTabSaved = true;
      await new AdminRecoveryStore(backend, crypto).savePending(command());
    }
    return snapshot;
  };
  assert.deepEqual(await new AdminRecoveryStore(backend, crypto).load(), { pending: command() });
});

test('a failed advisory notification cannot misreport a committed save or clear', async () => {
  const backend = new Backend();
  let closed = false;
  const channel = { addEventListener() {}, removeEventListener() {}, postMessage() { throw new Error('Channel unavailable'); }, close() { closed = true; } } as unknown as BroadcastChannel;
  const store = new AdminRecoveryStore(backend, crypto, channel);
  assert.deepEqual(await store.savePending(command()), { pending: command() });
  assert.equal(closed, true);
  assert.deepEqual(await new AdminRecoveryStore(backend, crypto).load(), { pending: command() });
  assert.deepEqual(await store.clearPending(command().id, scope), { pending: null });
});
