import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../src/database.js';
import { createHub } from '../src/hub.js';

test('schema-1 database upgrades without replacing existing identity records', async () => {
  const root = fileURLToPath(new URL('../../scratch/authority-tests/', import.meta.url));
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'migration-'));
  const path = join(folder, 'hub.sqlite');
  let original: DatabaseSync | undefined;
  let migrated: HubDatabase | undefined;
  try {
    original = new DatabaseSync(path);
    original.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
    original.exec(await readFile(new URL('../migrations/001_authority.sql', import.meta.url), 'utf8'));
    original.prepare('INSERT INTO schema_migrations VALUES(1,?)').run('001_authority.sql');
    original.prepare('INSERT INTO branches(id) VALUES(?)').run('branch-before-upgrade');
    original.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)').run('cashier-before','branch-before-upgrade','Preserved cashier','cashier','existing-credential-digest');
    original.close(); original = undefined;
    migrated = new HubDatabase(path);
    assert.equal(migrated.connection.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()!.version, 20);
    assert.equal(migrated.connection.prepare('SELECT credential_hash FROM accounts WHERE id=?').get('cashier-before')!.credential_hash, 'existing-credential-digest');
    migrated.connection.prepare('INSERT INTO auth_attempts(scope,subject,started_at,attempts,in_flight) VALUES(?,?,?,?,?)').run('staff:ip','digest',0,1,2);
    assert.equal(migrated.connection.prepare('SELECT in_flight FROM auth_attempts').get()!.in_flight, 2);
  } finally {
    original?.close(); migrated?.close();
    assert.ok(resolve(folder).startsWith(resolve(root) + sep));
    await rm(folder, { recursive: true, force: true });
  }
});

test('unsupported future schema is rejected instead of being reset', async () => {
  const root = fileURLToPath(new URL('../../scratch/authority-tests/', import.meta.url));
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'future-schema-'));
  const path = join(folder, 'hub.sqlite');
  try {
    const future = new DatabaseSync(path);
    future.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT; INSERT INTO schema_migrations VALUES(20,'future'); CREATE TABLE retained_data(value TEXT); INSERT INTO retained_data VALUES('preserve');");
    future.close();
    assert.throws(() => new HubDatabase(path), /Unsupported database schema/);
    const inspect = new DatabaseSync(path);
    try { assert.equal(inspect.prepare('SELECT value FROM retained_data').get()!.value, 'preserve'); }
    finally { inspect.close(); }
  } finally {
    assert.ok(resolve(folder).startsWith(resolve(root) + sep));
    await rm(folder, { recursive: true, force: true });
  }
});

test('configured session lifetime expires at the authority boundary', async () => {
  let time = Date.UTC(2026,10,4);
  const hub = await createHub({ databasePath: ':memory:', now: () => time, sessionLifetimeMs: 60_000 });
  try {
    await hub.provisionAccount({ id:'owner-session',branchId:'branch',displayName:'Fixture owner',role:'owner',secret:'Fixture-Session-Password!' });
    const login = await hub.app.inject({ method:'POST',url:'/api/v1/auth/admin',payload:{accountId:'owner-session',password:'Fixture-Session-Password!'} });
    assert.equal(login.statusCode,200);
    assert.equal(login.json().expiresAt, time + 60_000);
    time += 60_000;
    const expired = await hub.app.inject({ method:'GET',url:'/api/v1/me',headers:{authorization:`Bearer ${login.json().token}`} });
    assert.equal(expired.statusCode,401);
  } finally { await hub.close(); }
  await assert.rejects(createHub({ databasePath: ':memory:',sessionLifetimeMs: -1 }));
});
