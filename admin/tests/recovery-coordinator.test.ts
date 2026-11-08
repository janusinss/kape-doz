import assert from 'node:assert/strict';
import test from 'node:test';
import { HubError, type Mutation, type Session } from '../src/api';
import { recoverCommand } from '../src/command_recovery';

const command: Mutation = { id: '4d6376ba-562a-4d27-a7f6-386d344bec99', actorId: 'owner', branchId: 'branch',
  path: '/api/v1/ingredients', data: { ingredientId: 'beans', name: 'Beans', unit: 'g' }, label: 'Ingredient created.' };
const session: Session = { token: 'fixture-token', expiresAt: Date.now() + 60_000,
  authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
  actor: { id: 'owner', displayName: 'Owner', branchId: 'branch', role: 'owner' } };
const accepted = { commandId: command.id, status: 'accepted', action: 'ingredient.create', acceptedAt: 1000 };
const rejected = { commandId: command.id, status: 'rejected', action: 'ingredient.create', rejectedAt: 1001,
  error: { code: 'conflict', message: 'The command conflicts with the accepted state.' } };
const unrecorded = { commandId: command.id, status: 'unrecorded' };

function fixture(statuses: unknown[]) {
  const calls: string[] = [];
  let current = true;
  const dependencies = {
    isCurrent: () => current,
    status: async (active: Session, saved: Mutation) => { assert.equal(active, session); assert.equal(saved, command); calls.push('status'); return statuses.shift(); },
    mutate: async (active: Session, saved: Mutation) => { assert.equal(active, session); assert.equal(saved, command); calls.push('mutate'); },
    refresh: async (active: Session, saved: Mutation) => { assert.equal(active, session); assert.equal(saved, command); calls.push('refresh'); },
  };
  return { calls, dependencies, changeSession() { current = false; } };
}

test('accepted and rejected saved commands refresh before resolving without mutation', async () => {
  for (const status of [accepted, rejected]) {
    const f = fixture([status]);
    assert.equal(await recoverCommand(session, command, f.dependencies), status.status);
    assert.deepEqual(f.calls, ['status', 'refresh']);
  }
});

test('an unrecorded observation retains pending unless exact retry is explicitly enabled', async () => {
  const f = fixture([unrecorded]);
  assert.equal(await recoverCommand(session, command, f.dependencies, false), 'unrecorded');
  assert.deepEqual(f.calls, ['status']);
  const retry = fixture([unrecorded]);
  assert.equal(await recoverCommand(session, command, retry.dependencies, true), 'accepted');
  assert.deepEqual(retry.calls, ['status', 'mutate', 'refresh']);
});

test('a lost retry response reconciles accepted or rejected before another mutation', async () => {
  for (const status of [accepted, rejected]) {
    const f = fixture([unrecorded, status]);
    f.dependencies.mutate = async () => { f.calls.push('mutate'); throw new HubError('Unconfirmed', undefined, true); };
    assert.equal(await recoverCommand(session, command, f.dependencies, true), status.status);
    assert.deepEqual(f.calls, ['status', 'mutate', 'status', 'refresh']);
  }
});

test('unknown, malformed, failed lookup or failed refresh never resolves a saved command', async () => {
  const unknown = fixture([unrecorded, unrecorded]);
  unknown.dependencies.mutate = async () => { throw new HubError('Unconfirmed', undefined, true); };
  await assert.rejects(recoverCommand(session, command, unknown.dependencies), HubError);
  const malformed = fixture([{ ...accepted, action: 'inventory.waste' }]);
  await assert.rejects(recoverCommand(session, command, malformed.dependencies), HubError);
  assert.deepEqual(malformed.calls, ['status']);
  const failed = fixture([accepted]);
  failed.dependencies.refresh = async () => { throw new HubError('Refresh unavailable'); };
  await assert.rejects(recoverCommand(session, command, failed.dependencies), /Refresh unavailable/);
  const disconnected = fixture([accepted]);
  disconnected.dependencies.status = async () => { throw new HubError('Lookup unavailable'); };
  await assert.rejects(recoverCommand(session, command, disconnected.dependencies), /Lookup unavailable/);
});

test('wrong actor and session changes cannot resolve or replay the previous command', async () => {
  const wrong = fixture([accepted]);
  await assert.rejects(recoverCommand({ ...session, actor: { ...session.actor, id: 'other-owner' } }, command, wrong.dependencies), HubError);
  assert.deepEqual(wrong.calls, []);
  const changed = fixture([accepted]);
  changed.dependencies.status = async () => { changed.changeSession(); return accepted; };
  await assert.rejects(recoverCommand(session, command, changed.dependencies), HubError);
  assert.deepEqual(changed.calls, []);
  const afterRefresh = fixture([rejected]);
  afterRefresh.dependencies.refresh = async () => { afterRefresh.changeSession(); };
  await assert.rejects(recoverCommand(session, command, afterRefresh.dependencies), HubError);
});
