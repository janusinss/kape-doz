import assert from 'node:assert/strict';
import test from 'node:test';
import { HubError, type Session } from '../src/api';
import * as recovery from '../src/command_recovery';

const session = { token: 'fixture-token', expiresAt: Date.now() + 60_000, authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
  actor: { id: 'owner', displayName: 'Owner', branchId: 'branch', role: 'owner' } } as Session;
const command = { id: '4d6376ba-562a-4d27-a7f6-386d344bec99', actorId: 'owner', branchId: 'branch', hubOrigin: 'http://127.0.0.1',
  authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', role: 'owner', createdAt: 1000,
  path: '/api/v1/ingredients', data: { ingredientId: 'beans', name: 'Beans', unit: 'g' }, label: 'Ingredient created.' };
const accepted = { commandId: command.id, status: 'accepted', action: 'ingredient.create', acceptedAt: 1000 };
const rejected = { commandId: command.id, status: 'rejected', action: 'ingredient.create', rejectedAt: 1001, error: { code: 'conflict', message: 'Conflicting record.' } };
const unrecorded = { commandId: command.id, status: 'unrecorded' };
const submit = (...args: any[]) => (recovery as any).submitDurableCommand(...args);
const recover = (...args: any[]) => (recovery as any).recoverDurableCommand(...args);

function fixture() {
  const calls: string[] = [];
  let pending: any = null;
  let current = true;
  let failSave = false, failClear = false;
  const store = {
    load: async () => { calls.push('load'); return { pending }; },
    savePending: async (saved: any) => { calls.push('save'); if (failSave) throw new Error('Save unavailable'); pending = saved; return { pending }; },
    clearPending: async (id: string, scope: any) => { calls.push('clear'); assert.equal(id, command.id); assert.equal(scope.authorityId, command.authorityId); if (failClear) throw new Error('Clear unavailable'); pending = null; return { pending }; },
  };
  const deps = {
    store, isCurrent: () => current,
    status: async (_session: Session, saved: any): Promise<unknown> => { calls.push('status'); assert.deepEqual(saved, command); return accepted; },
    mutate: async (_session: Session, saved: any) => { calls.push('mutate'); assert.deepEqual(saved, command); },
    refresh: async () => { calls.push('refresh'); },
  };
  return { calls, deps, setPending(value: any) { pending = value; }, get pending() { return pending; }, expire() { current = false; }, failSave() { failSave = true; }, failClear() { failClear = true; } };
}

test('durable submission saves before transmission and refreshes before exact cleanup', async () => {
  const f = fixture();
  assert.equal(await submit(session, command, f.deps), 'accepted');
  assert.deepEqual(f.calls, ['save', 'mutate', 'refresh', 'clear']);
  assert.equal(f.pending, null);
});

test('failed persistence or a replaced session prevents transmission', async () => {
  const failed = fixture(); failed.failSave();
  await assert.rejects(submit(session, command, failed.deps), /Save unavailable/);
  assert.deepEqual(failed.calls, ['save']);
  const expired = fixture();
  const save = expired.deps.store.savePending;
  expired.deps.store.savePending = async saved => { const result = await save(saved); expired.expire(); return result; };
  await assert.rejects(submit(session, command, expired.deps), HubError);
  assert.deepEqual(expired.calls, ['save']);
  assert.deepEqual(expired.pending, command);
});

test('reloaded accepted or rejected commands refresh and clear without another POST', async () => {
  for (const status of [accepted, rejected]) {
    const f = fixture(); f.setPending(command); f.deps.status = async () => { f.calls.push('status'); return status; };
    assert.equal(await recover(session, command, f.deps, false), status.status);
    assert.deepEqual(f.calls, ['load', 'status', 'refresh', 'clear']);
  }
});

test('unknown replies, failed refresh and failed cleanup keep the saved command', async () => {
  const unknown = fixture(); unknown.deps.mutate = async () => { unknown.calls.push('mutate'); throw new HubError('Unknown', undefined, true); };
  await assert.rejects(submit(session, command, unknown.deps), HubError);
  assert.deepEqual(unknown.pending, command); assert.deepEqual(unknown.calls, ['save', 'mutate']);
  const refresh = fixture(); refresh.setPending(command); refresh.deps.refresh = async () => { throw new Error('Refresh unavailable'); };
  await assert.rejects(recover(session, command, refresh.deps), /Refresh unavailable/); assert.deepEqual(refresh.pending, command);
  const clear = fixture(); clear.setPending(command); clear.failClear();
  await assert.rejects(recover(session, command, clear.deps), /Clear unavailable/); assert.deepEqual(clear.pending, command);
});

test('wrong actor, branch, role, hub or authority cannot look up, replay or clear saved work', async () => {
  for (const changed of [
    { ...session, authorityId: '014fa126-a2f1-43c0-a7c4-bb580eb629ec' }, { ...session, hubOrigin: 'http://127.0.0.1:9000' },
    { ...session, actor: { ...session.actor, id: 'other-owner' } }, { ...session, actor: { ...session.actor, branchId: 'other' } },
    { ...session, actor: { ...session.actor, role: 'manager' } },
  ]) {
    const f = fixture(); f.setPending(command);
    await assert.rejects(recover(changed, command, f.deps), HubError);
    assert.deepEqual(f.calls, []);
  }
});

test('unrecorded recovery retries the saved identity and a newer journal cannot be cleared', async () => {
  const f = fixture(); f.setPending(command); f.deps.status = async () => { f.calls.push('status'); return unrecorded; };
  assert.equal(await recover(session, command, f.deps, true), 'accepted');
  assert.deepEqual(f.calls, ['load', 'status', 'mutate', 'refresh', 'clear']);
  const newer = fixture(); newer.setPending({ ...command, id: 'ae56f373-d68d-4b1e-9d5c-727683ef184c' });
  await assert.rejects(recover(session, command, newer.deps), HubError);
  assert.deepEqual(newer.calls, ['load']);
});

test('scope or expiry changes during lookup prevent refresh, replay and cleanup', async () => {
  for (const change of [(active: Session) => { active.authorityId = '014fa126-a2f1-43c0-a7c4-bb580eb629ec'; },
    (active: Session) => { active.hubOrigin = 'http://127.0.0.1:7442'; },
    (active: Session) => { active.actor.role = 'manager'; },
    (active: Session) => { active.expiresAt = 0; }]) {
    const active = { ...session, actor: { ...session.actor } };
    const f = fixture(); f.setPending(command);
    f.deps.status = async () => { f.calls.push('status'); change(active); return unrecorded; };
    await assert.rejects(recover(active, command, f.deps), HubError);
    assert.deepEqual(f.calls, ['load', 'status']);
    assert.deepEqual(f.pending, command);
  }
});
