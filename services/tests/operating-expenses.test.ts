import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHub } from '../src/hub.js';

const scratchRoot = fileURLToPath(new URL('../../scratch/operating-expenses-tests/', import.meta.url));
const endpoint = '/api/v1/admin/expenses';
const password = 'Fixture-Expenses-Admin-Password!';
const deviceSecret = 'Fixture-Expenses-Device-Secret-2026!';

type Expense = {
  id: string;
  category: string;
  description: string;
  amountCentavos: number;
  startsOn: string;
  endsOn: string;
  recordedAt: number;
};
type ExpenseList = {
  from: string;
  through: string;
  allocatedCentavos: number;
  expenses: (Expense & { allocatedCentavos: number })[];
  truncated: boolean;
};
type Shift = { id: string; version: number };

function ok<T>(response: { statusCode: number; body: string; json(): unknown }): T {
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as T;
}

test('operating expenses allocate exact centavos by effective dates and stay isolated from branch cash and stock', async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'expenses-'));
  const databasePath = join(folder, 'hub.sqlite');
  // This UTC instant falls on November 5 in the branch, outside the effective first day.
  const now = Date.UTC(2026, 10, 4, 18);
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
  await hub.provisionDevice({ id: 'tablet-a', branchId: 'branch-a', secret: deviceSecret });

  const login = async (accountId: string, staff = false) => ok<{ token: string }>(await hub.app.inject({
    method: 'POST', url: `/api/v1/auth/${staff ? 'staff' : 'admin'}`,
    payload: staff ? { accountId, pin: '4826', deviceId: 'tablet-a', deviceSecret } : { accountId, password },
  })).token;
  const owner = await login('owner-a');
  const manager = await login('manager-a');
  const cashier = await login('cashier-a', true);
  const otherOwner = await login('owner-b');
  const headers = (token?: string) => token ? { authorization: `Bearer ${token}` } : {};
  const post = (url: string, token: string | undefined, payload: Record<string, unknown>, commandId: string = randomUUID()) => hub.app.inject({
    method: 'POST', url, headers: headers(token), payload: { commandId, ...payload },
  });
  const get = (url: string, token?: string) => hub.app.inject({ method: 'GET', url, headers: headers(token) });
  const period = (from: string, through: string) => `${endpoint}?from=${from}&through=${through}`;
  const list = async (token: string, from: string, through: string) => ok<ExpenseList>(await get(period(from, through), token));

  ok(await post('/api/v1/drawers', owner, { drawerId: 'counter', name: 'Counter', deviceIds: ['tablet-a'] }));
  ok(await post('/api/v1/shifts/open', cashier, { openingCashCentavos: 20000 }));
  ok(await post('/api/v1/ingredients', owner, { ingredientId: 'beans', name: 'Fixture beans', unit: 'g' }));
  const startingStock = ok(await get('/api/v1/ingredients', cashier));
  const startingShift = ok<{ shift: Shift }>(await get('/api/v1/shifts/current', cashier));

  const rent = { category: 'Rent', description: 'November rent', amountCentavos: 30001, startsOn: '2026-11-01', endsOn: '2026-11-30' };
  const commandId = randomUUID();
  const recorded = ok<{ commandId: string; expense: Expense }>(await post(endpoint, owner, rent, commandId));
  assert.equal(recorded.commandId, commandId);
  assert.match(recorded.expense.id, /^[\da-f-]{36}$/i);
  assert.deepEqual(recorded.expense, { id: recorded.expense.id, ...rent, recordedAt: now });
  const oneTime = { category: 'Utilities', description: 'Meter adjustment', amountCentavos: 101, startsOn: '2026-11-16', endsOn: '2026-11-16' };
  const adjustment = ok<{ expense: Expense }>(await post(endpoint, manager, oneTime)).expense;
  ok(await post(endpoint, owner, { ...oneTime, amountCentavos: 10, startsOn: '2026-12-01', endsOn: '2026-12-01' }));
  ok(await post(endpoint, otherOwner, { ...rent, amountCentavos: 987654, description: 'Other branch rent' }));

  const november = period('2026-11-01', '2026-11-30');
  assert.equal((await get(november, cashier)).statusCode, 403);
  assert.equal((await get(november)).statusCode, 401);
  assert.equal((await post(endpoint, cashier, rent)).statusCode, 403);
  assert.equal((await post(endpoint, undefined, rent)).statusCode, 401);
  for (const invalid of [
    { ...rent, startsOn: '2026-02-29' },
    { ...rent, endsOn: '2026-11-31' },
    { ...rent, endsOn: '2026-10-31' },
    { ...rent, amountCentavos: 0 },
    { ...rent, amountCentavos: 1000000001 },
  ]) {
    assert.equal((await post(endpoint, owner, invalid)).statusCode, 400);
  }
  assert.equal((await get(period('2026-11-31', '2026-12-01'), owner)).statusCode, 400);
  assert.equal((await get(period('2026-11-30', '2026-11-01'), owner)).statusCode, 400);
  assert.equal((await post(endpoint, owner, { ...rent, amountCentavos: 30002 }, commandId)).statusCode, 409);

  const first = await list(owner, '2026-11-01', '2026-11-15');
  const last = await list(manager, '2026-11-16', '2026-11-30');
  assert.deepEqual(first, {
    from: '2026-11-01', through: '2026-11-15', allocatedCentavos: 15000,
    expenses: [{ ...recorded.expense, allocatedCentavos: 15000 }], truncated: false,
  });
  assert.equal(last.allocatedCentavos, 15102);
  assert.deepEqual(new Map(last.expenses.map((entry) => [entry.id, entry.allocatedCentavos])), new Map([
    [recorded.expense.id, 15001], [adjustment.id, 101],
  ]));
  assert.equal((await list(owner, '2026-11-16', '2026-11-16')).allocatedCentavos, 1101);
  assert.equal((await list(owner, '2026-11-17', '2026-11-17')).allocatedCentavos, 1000);
  assert.equal((await list(owner, '2026-12-01', '2026-12-01')).allocatedCentavos, 10);
  assert.equal((await list(otherOwner, '2026-11-01', '2026-11-30')).allocatedCentavos, 987654);
  assert.deepEqual(ok(await get('/api/v1/ingredients', cashier)), startingStock);
  assert.deepEqual(ok(await get('/api/v1/shifts/current', cashier)), startingShift);
  const counted = ok<{ shift: Shift }>(await post(`/api/v1/shifts/${startingShift.shift.id}/submit-count`, cashier, {
    expectedVersion: startingShift.shift.version, countedCashCentavos: 20000,
  }));
  const reviewed = ok<{ expectedCashCentavos: number; varianceCentavos: number }>(await post(`/api/v1/shifts/${startingShift.shift.id}/review`, manager, {
    expectedVersion: counted.shift.version, decision: 'approve',
  }));
  assert.equal(reviewed.expectedCashCentavos, 20000);
  assert.equal(reviewed.varianceCentavos, 0);

  await hub.close();
  hub = await createHub({ databasePath, now: () => now });
  assert.deepEqual(ok(await post(endpoint, owner, rent, commandId)), recorded);
  const reopened = await list(owner, '2026-11-01', '2026-11-30');
  assert.equal(reopened.allocatedCentavos, first.allocatedCentavos + last.allocatedCentavos);
  assert.equal(reopened.allocatedCentavos, 30102);
  assert.equal(reopened.expenses.length, 2);
});

test('expense and audit rollback together on outbox failure, and a capped period totals every overlap', async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(join(scratchRoot, 'expenses-integrity-'));
  const databasePath = join(folder, 'hub.sqlite');
  let now = Date.UTC(2026, 10, 4, 18);
  const hub = await createHub({ databasePath, now: () => now });
  const inspector = new DatabaseSync(databasePath);
  t.after(async () => {
    inspector.close();
    await hub.close();
    const target = resolve(folder);
    assert.equal(dirname(target), resolve(scratchRoot));
    await rm(target, { recursive: true, force: true });
  });
  await hub.provisionAccount({ id: 'owner', displayName: 'Fixture owner', role: 'owner', branchId: 'branch-a', secret: password });
  const { token } = ok<{ token: string }>(await hub.app.inject({
    method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'owner', password },
  }));
  const headers = { authorization: `Bearer ${token}` };
  const day = '2026-11-15';
  const post = (description: string, amountCentavos: number, commandId: string = randomUUID()) => hub.app.inject({
    method: 'POST', url: endpoint, headers,
    payload: { commandId, category: 'Utilities', description, amountCentavos, startsOn: day, endsOn: day },
  });
  const list = async () => ok<ExpenseList>(await hub.app.inject({
    method: 'GET', url: `${endpoint}?from=${day}&through=${day}`, headers,
  }));
  const effectCounts = () => ({
    expenses: inspector.prepare('SELECT COUNT(*) AS count FROM operating_expenses').get()!.count,
    receipts: inspector.prepare('SELECT COUNT(*) AS count FROM command_receipts').get()!.count,
    audit: inspector.prepare('SELECT COUNT(*) AS count FROM audit_events').get()!.count,
    outbox: inspector.prepare('SELECT COUNT(*) AS count FROM outbox').get()!.count,
  });

  const command = randomUUID();
  inspector.exec("CREATE TRIGGER fail_expense_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected expense outbox failure'); END;");
  const failed = await post('Retriable expense', 777, command);
  assert.equal(failed.statusCode, 500);
  assert.ok(!failed.body.includes('injected expense outbox failure'));
  assert.deepEqual(effectCounts(), { expenses: 0, receipts: 0, audit: 0, outbox: 0 });
  assert.deepEqual(await list(), { from: day, through: day, allocatedCentavos: 0, expenses: [], truncated: false });
  inspector.exec('DROP TRIGGER fail_expense_outbox;');

  const accepted = ok<{ commandId: string; expense: Expense }>(await post('Retriable expense', 777, command));
  assert.equal(accepted.commandId, command);
  assert.deepEqual(ok(await post('Retriable expense', 777, command)), accepted);
  assert.deepEqual(effectCounts(), { expenses: 1, receipts: 1, audit: 1, outbox: 1 });
  const recorded = [accepted.expense];
  for (let i = 1; i <= 100; i++) {
    // Keep each batch inside the mutation limit, with tied recorded times at the cap boundary.
    if (i === 51) now += 60_001;
    recorded.push(ok<{ expense: Expense }>(await post(`Overlapping expense ${i}`, i)).expense);
  }
  const expectedOrder = [...recorded].sort((a, b) => b.recordedAt - a.recordedAt || a.id.localeCompare(b.id));
  const capped = await list();
  assert.equal(capped.truncated, true);
  assert.equal(capped.expenses.length, 100);
  assert.equal(capped.allocatedCentavos, 5827);
  assert.deepEqual(capped.expenses, expectedOrder.slice(0, 100).map((expense) => ({ ...expense, allocatedCentavos: expense.amountCentavos })));
  assert.deepEqual(await list(), capped);
});
