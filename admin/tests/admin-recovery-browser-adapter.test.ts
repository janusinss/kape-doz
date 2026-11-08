import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { createAdminRecoveryStore, pendingAdminCommand } from '../src/admin_recovery';

/** A transaction-backed IndexedDB fake for connection lifecycle and platform failures. */
class Factory {
  readonly records = new Map<string, Map<IDBValidKey, unknown>>();
  readonly connections: Database[] = [];
  open() {
    const request = { result: undefined as unknown, onupgradeneeded: null as null | (() => void), onsuccess: null as null | (() => void), onerror: null, onblocked: null };
    queueMicrotask(() => {
      const database = new Database(this.records);
      this.connections.push(database);
      request.result = database;
      if (this.records.size === 0) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

class Database extends EventTarget {
  private closed = false;
  onversionchange: (() => void) | null = null;
  constructor(private records: Map<string, Map<IDBValidKey, unknown>>) { super(); }
  createObjectStore(name: string) { this.records.set(name, new Map()); }
  transaction(names: string[], mode: IDBTransactionMode) {
    if (this.closed) throw new DOMException('The connection is closed', 'InvalidStateError');
    const data = new Map(names.map(name => [name, new Map(this.records.get(name)!)]));
    let pending = 0, aborted = false, completed = false;
    const transaction = {
      oncomplete: null as null | (() => void), onabort: null as null | (() => void), onerror: null as null | (() => void),
      abort() { aborted = true; queueMicrotask(() => transaction.onabort?.()); },
      objectStore: (name: string) => ({
        get: (key: IDBValidKey) => operation(() => structuredClone(data.get(name)!.get(key))),
        add: (value: unknown, key: IDBValidKey) => operation(() => {
          if (data.get(name)!.has(key)) throw new DOMException('Duplicate key', 'ConstraintError');
          data.get(name)!.set(key, structuredClone(value)); return key;
        }),
        put: (value: unknown, key: IDBValidKey) => operation(() => { data.get(name)!.set(key, structuredClone(value)); return key; }),
      }),
    };
    const operation = (perform: () => unknown) => {
      pending++;
      const request = { result: undefined as unknown, onsuccess: null as null | (() => void) };
      queueMicrotask(() => {
        if (aborted) return;
        try { request.result = perform(); request.onsuccess?.(); }
        catch { transaction.abort(); }
        pending--;
        queueMicrotask(() => {
          if (pending !== 0 || aborted || completed) return;
          completed = true;
          if (mode === 'readwrite') for (const [name, rows] of data) this.records.set(name, rows);
          transaction.oncomplete?.();
        });
      });
      return request;
    };
    return transaction;
  }
  close() { this.closed = true; }
  unexpectedClose() { this.closed = true; this.dispatchEvent(new Event('close')); }
}

function platform(t: TestContext) {
  const factory = new Factory();
  const previous = new Map(['indexedDB', 'crypto', 'window', 'BroadcastChannel'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  return factory;
}

const command = () => pendingAdminCommand({ id: '4d6376ba-562a-4d27-a7f6-386d344bec99', actorId: 'owner', branchId: 'branch',
  path: '/api/v1/ingredients', data: { ingredientId: 'beans', name: 'Recovery beans', unit: 'g' }, label: 'Ingredient created.' },
  { hubOrigin: 'https://hub.example', authorityId: '12345678-1234-4123-8123-123456789abc', actorId: 'owner', branchId: 'branch', role: 'owner' }, 1000);

test('a denied advisory channel constructor leaves encrypted IndexedDB recovery usable', async t => {
  const factory = platform(t);
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: class { constructor() { throw new DOMException('Channel denied', 'SecurityError'); } } });
  const store = createAdminRecoveryStore();
  t.after(() => store.close());
  assert.deepEqual(await store.savePending(command()), { pending: command() });
  assert.equal(factory.connections.length, 1);
  const stored = factory.records.get('state')!.get('journal');
  assert.equal(typeof stored, 'string');
  assert.ok(!(stored as string).includes('Recovery beans'));
  assert.deepEqual(await store.load(), { pending: command() });
});

test('unexpected IndexedDB close reopens the same encrypted state for retry', async t => {
  const factory = platform(t);
  const store = createAdminRecoveryStore();
  t.after(() => store.close());
  await store.savePending(command());
  const record = factory.records.get('state')!.get('journal');
  const key = factory.records.get('keys')!.get('active');
  factory.connections[0]!.unexpectedClose();
  assert.deepEqual(await store.load(), { pending: command() });
  assert.equal(factory.connections.length, 2);
  assert.equal(factory.records.get('state')!.get('journal'), record);
  assert.equal(factory.records.get('keys')!.get('active'), key);
});
