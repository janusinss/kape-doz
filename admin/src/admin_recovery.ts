import type { Mutation } from './api';
import { validCommandPath } from './command_contracts';
import { isProductOptions, recipeUpdateCommand } from './product_availability';
import { canonicalJson, exactKeys, isNonblankText, isNonnegativeInt, isUuid, isValidScope, matchesScope as matchesRecoveryScope, type RecoveryScope } from './primitives';

export type AdminRecoveryScope = RecoveryScope;
export type PendingAdminCommand = Mutation & {
  hubOrigin: string; authorityId: string; role: 'owner' | 'manager'; createdAt: number;
};
export type AdminRecoveryState = { pending: PendingAdminCommand | null };
export type RecoveryKey = { id: string; key: CryptoKey };
export type RecoverySnapshot = { key: RecoveryKey | null; record: string | null };
export interface RecoveryBackend {
  read(): Promise<RecoverySnapshot>;
  initializeKey(candidate: RecoveryKey, encryptedInitial: string): Promise<RecoverySnapshot>;
  replace(expected: { record: string | null; keyId: string }, next: string): Promise<void>;
  close?(): void;
}

export class AdminRecoveryError extends Error {
  constructor(message = 'Saved operations could not be loaded or saved. Retry saved state before making changes.') {
    super(message);
    this.name = 'AdminRecoveryError';
  }
}
const invalid = () => new AdminRecoveryError('Saved recovery data is unreadable or unsupported. Preserve the browser data and contact your administrator.');
const locked = () => new AdminRecoveryError('A saved operation changed in another tab or belongs to another account or hub. Reload saved state before making changes.');

function validScope(value: AdminRecoveryScope): void {
  if (!isValidScope(value)) throw invalid();
}
type SignedOptionPath = 'root' | 'options' | 'entry' | 'delta';
function immutableJson(value: unknown, depth = 0, signedPath?: SignedOptionPath): unknown {
  if (depth > 12) throw invalid();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { if (value.length > 32768) throw invalid(); return value; }
  if (typeof value === 'number') {
    if (!isNonnegativeInt(value) && !(signedPath === 'delta' && Number.isSafeInteger(value) && value >= -100_000_000_000)) throw invalid();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw invalid();
    return Object.freeze(value.map(item => immutableJson(item, depth + 1, signedPath === 'options' ? 'entry' : undefined)));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  if (Object.keys(value).length > 100) throw invalid();
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const compact = key.toLowerCase().replaceAll(/[_-]/g, '');
    if (key.length > 120 || /pin|password|secret|token|authorization|credential/.test(compact) ||
      ['commandid', 'actorid', 'branchid', 'role', 'huborigin', 'authorityid', 'proto', 'constructor', 'prototype'].includes(compact)) throw invalid();
    const nextPath = signedPath === 'root' && (key === 'sizes' || key === 'substitutions') ? 'options'
      : signedPath === 'entry' && key === 'priceDeltaCentavos' ? 'delta' : undefined;
    Object.defineProperty(result, key, { value: immutableJson(entry, depth + 1, nextPath), enumerable: true });
  }
  return Object.freeze(result);
}

export function pendingAdminCommand(command: Mutation, scope: AdminRecoveryScope, createdAt: number): PendingAdminCommand {
  try {
    validScope(scope);
    if (!command || !isUuid(command.id) || command.actorId !== scope.actorId || command.branchId !== scope.branchId ||
      !isNonblankText(command.label, 300) || !isNonblankText(command.path, 400) || !isNonnegativeInt(createdAt)) throw invalid();
    // Only validated recipe size/substitution adjustments may carry signed values.
    const signedOptions = isProductOptions(command.data) &&
      (command.path === '/api/v1/products' || recipeUpdateCommand(command.path, command.data) !== null);
    const data = immutableJson(command.data, 0, signedOptions ? 'root' : undefined);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !validCommandPath(command.path, data as Record<string, unknown>)) throw invalid();
    const pending = Object.freeze({
      id: command.id, path: command.path, data: data as Record<string, unknown>, label: command.label,
      actorId: scope.actorId, branchId: scope.branchId, hubOrigin: scope.hubOrigin, authorityId: scope.authorityId,
      role: scope.role, createdAt,
    });
    if (new TextEncoder().encode(JSON.stringify(pending)).length > 32768) throw invalid();
    return pending;
  } catch { throw invalid(); }
}

export function matchesScope(command: PendingAdminCommand, scope: AdminRecoveryScope): boolean {
  return matchesRecoveryScope(command, scope);
}

function decodePending(value: unknown): PendingAdminCommand {
  if (!exactKeys(value, ['id', 'path', 'data', 'label', 'actorId', 'branchId', 'hubOrigin', 'authorityId', 'role', 'createdAt'])) throw invalid();
  return pendingAdminCommand(value as unknown as Mutation, value as unknown as AdminRecoveryScope, value.createdAt as number);
}
function validateKey(value: unknown): RecoveryKey {
  if (!exactKeys(value, ['id', 'key']) || !isUuid(value.id)) throw invalid();
  const key = value.key as CryptoKey;
  if (!key || key.type !== 'secret' || key.extractable !== false || key.algorithm?.name !== 'AES-GCM' ||
    (key.algorithm as AesKeyAlgorithm).length !== 256 || key.usages?.length !== 2 ||
    !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) throw invalid();
  return { id: value.id, key };
}
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function unbase64(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > 100000) throw invalid();
  const result = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (base64(result) !== value) throw invalid();
  return result;
}

/** The encrypted journal is a single shared record per portal origin. */
export class AdminRecoveryStore {
  private queue = Promise.resolve();
  private closed = false;
  private listeners = new Set<() => void>();
  private readonly changed = (event: MessageEvent) => {
    if (event.data === 'changed') for (const listener of this.listeners) queueMicrotask(listener);
  };
  constructor(private backend: RecoveryBackend, private crypto: Crypto, private channel?: BroadcastChannel) {
    channel?.addEventListener('message', this.changed);
  }
  private serialize<T>(perform: () => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      if (this.closed) throw new AdminRecoveryError();
      try { return await perform(); }
      catch (error) { throw error instanceof AdminRecoveryError ? error : new AdminRecoveryError(); }
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
  private async encryptedRecord(key: RecoveryKey, revision: number, pending: PendingAdminCommand | null): Promise<string> {
    if (!isNonnegativeInt(revision) || revision === 0) throw invalid();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(JSON.stringify([1, revision, key.id]));
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, pending }));
    const encrypted = await this.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key.key, bytes);
    return JSON.stringify({ schemaVersion: 1, revision, keyId: key.id, iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) });
  }
  private async read(): Promise<{ state: AdminRecoveryState; key: RecoveryKey; raw: string; revision: number }> {
    let snapshot = await this.backend.read();
    if (snapshot.key === null && snapshot.record === null) {
      const candidate = { id: this.crypto.randomUUID(), key: await this.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) };
      const initial = await this.encryptedRecord(candidate, 1, null);
      await this.backend.initializeKey(candidate, initial);
      // Another tab may have won initialization or already saved a command.
      snapshot = await this.backend.read();
    }
    if (snapshot.key === null || snapshot.record === null) throw invalid();
    const key = validateKey(snapshot.key);
    if (typeof snapshot.record !== 'string' || snapshot.record.length > 100000) throw invalid();
    const envelope: unknown = JSON.parse(snapshot.record);
    if (!exactKeys(envelope, ['schemaVersion', 'revision', 'keyId', 'iv', 'ciphertext']) || envelope.schemaVersion !== 1 ||
      !isNonnegativeInt(envelope.revision) || envelope.revision === 0 || envelope.keyId !== key.id) throw invalid();
    const iv = unbase64(envelope.iv);
    const ciphertext = unbase64(envelope.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 16) throw invalid();
    const aad = new TextEncoder().encode(JSON.stringify([1, envelope.revision, key.id]));
    const decrypted = await this.crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key.key, ciphertext);
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted));
    if (!exactKeys(decoded, ['version', 'pending']) || decoded.version !== 1) throw invalid();
    const pending = decoded.pending === null ? null : decodePending(decoded.pending);
    return { state: Object.freeze({ pending }), key, raw: snapshot.record, revision: envelope.revision };
  }
  private async write(current: Awaited<ReturnType<AdminRecoveryStore['read']>>, pending: PendingAdminCommand | null): Promise<AdminRecoveryState> {
    const next = await this.encryptedRecord(current.key, current.revision + 1, pending);
    await this.backend.replace({ record: current.raw, keyId: current.key.id }, next);
    // Notifications are advisory; the committed CAS remains the write authority.
    try { this.channel?.postMessage('changed'); }
    catch {
      this.channel?.removeEventListener('message', this.changed);
      this.channel?.close();
      this.channel = undefined;
    }
    return Object.freeze({ pending });
  }
  load(): Promise<AdminRecoveryState> { return this.serialize(async () => (await this.read()).state); }
  savePending(command: PendingAdminCommand): Promise<AdminRecoveryState> {
    return this.serialize(async () => {
      const saved = decodePending(command);
      const current = await this.read();
      if (current.state.pending !== null) {
        if (canonicalJson(current.state.pending) !== canonicalJson(saved)) throw locked();
        return current.state;
      }
      return this.write(current, saved);
    });
  }
  clearPending(commandId: string, scope: AdminRecoveryScope): Promise<AdminRecoveryState> {
    return this.serialize(async () => {
      validScope(scope);
      if (!isUuid(commandId)) throw invalid();
      const current = await this.read();
      if (current.state.pending === null) return current.state;
      if (current.state.pending.id !== commandId || !matchesScope(current.state.pending, scope)) throw locked();
      return this.write(current, null);
    });
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.channel?.removeEventListener('message', this.changed);
    this.channel?.close();
    this.backend.close?.();
  }
}

/** No asynchronous cryptography runs inside an IndexedDB transaction. */
class IndexedDbRecoveryBackend implements RecoveryBackend {
  private opening?: Promise<IDBDatabase>;
  private database?: IDBDatabase;
  private closed = false;
  constructor(private factory: IDBFactory) {}
  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new AdminRecoveryError());
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      let settled = false;
      const request = this.factory.open('kape-doz-admin-recovery', 1);
      const fail = () => { settled = true; this.opening = undefined; reject(new AdminRecoveryError()); };
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('keys');
        database.createObjectStore('state');
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        if (settled || this.closed) { request.result.close(); if (!settled) fail(); return; }
        const database = request.result;
        this.database = database;
        const forgetConnection = () => {
          if (this.database === database) { this.database = undefined; this.opening = undefined; }
        };
        database.onversionchange = () => { database.close(); forgetConnection(); };
        database.addEventListener('close', forgetConnection);
        settled = true;
        resolve(database);
      };
    });
    return this.opening;
  }
  async read(): Promise<RecoverySnapshot> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['keys', 'state'], 'readonly');
      const key = transaction.objectStore('keys').get('active');
      const record = transaction.objectStore('state').get('journal');
      transaction.onabort = transaction.onerror = () => reject(new AdminRecoveryError());
      transaction.oncomplete = () => {
        try {
          if (record.result !== undefined && typeof record.result !== 'string') throw invalid();
          resolve({ key: key.result === undefined ? null : validateKey(key.result), record: record.result === undefined ? null : record.result as string });
        } catch { reject(invalid()); }
      };
    });
  }
  async initializeKey(candidate: RecoveryKey, encryptedInitial: string): Promise<RecoverySnapshot> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['keys', 'state'], 'readwrite', { durability: 'strict' });
      const keys = transaction.objectStore('keys');
      const key = keys.get('active');
      const record = transaction.objectStore('state').get('journal');
      let chosen: RecoverySnapshot;
      transaction.onabort = transaction.onerror = () => reject(new AdminRecoveryError());
      record.onsuccess = () => {
        try {
          if (key.result !== undefined) {
            if (typeof record.result !== 'string') throw invalid();
            chosen = { key: validateKey(key.result), record: record.result };
          }
          else {
            if (record.result !== undefined) throw invalid();
            chosen = { key: validateKey(candidate), record: encryptedInitial };
            keys.add(chosen.key, 'active');
            transaction.objectStore('state').add(encryptedInitial, 'journal');
          }
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(chosen);
    });
  }
  async replace(expected: { record: string | null; keyId: string }, next: string): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['keys', 'state'], 'readwrite', { durability: 'strict' });
      const key = transaction.objectStore('keys').get('active');
      const state = transaction.objectStore('state');
      const record = state.get('journal');
      let error: AdminRecoveryError | null = null;
      transaction.onabort = transaction.onerror = () => reject(error ?? new AdminRecoveryError());
      record.onsuccess = () => {
        try {
          const current = record.result === undefined ? null : record.result;
          if (current !== expected.record || validateKey(key.result).id !== expected.keyId) throw locked();
          state.put(next, 'journal');
        } catch (caught) { error = caught instanceof AdminRecoveryError ? caught : invalid(); transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
    });
  }
  close(): void { this.closed = true; this.database?.close(); }
}

export function createAdminRecoveryStore(): AdminRecoveryStore {
  try {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID ||
      (typeof window !== 'undefined' && !window.isSecureContext)) throw new AdminRecoveryError('This browser cannot save recovery data. Use a supported browser on HTTPS or localhost.');
    let channel: BroadcastChannel | undefined;
    try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kape-doz-admin-recovery') : undefined; }
    catch {
      channel = undefined;
    }
    return new AdminRecoveryStore(new IndexedDbRecoveryBackend(globalThis.indexedDB), globalThis.crypto, channel);
  } catch (error) { throw error instanceof AdminRecoveryError ? error : new AdminRecoveryError(); }
}
