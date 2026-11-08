import assert from 'node:assert/strict';
import test from 'node:test';
import { api, commandAction, HubError, refreshCommand, validateAmendments, validateCommandStatus, type Mutation, type Session } from '../src/api';
import { AdminRecoveryError, pendingAdminCommand } from '../src/admin_recovery';

const before = { lineNo: 107, productId: 'latte', name: 'Latte', quantity: 2, note: 'Extra hot', unitPriceCentavos: 16_500 };
const after = { ...before, quantity: 1 };
const request = {
  id: '7d34953c-3a1b-4a07-ac2c-bbc5b5ed99be', orderId: 'e72a1939-de90-4885-85fd-d464a215581f',
  orderNo: 12, orderVersion: 5, operation: 'quantity', status: 'awaiting_approval', before, after,
  reason: 'Customer changed the quantity', decisionReason: null, requestedAt: 1_793_836_800_000,
  appliedAt: null, resolvedAt: null, needsDisposition: true, dispositionNote: null,
  recipe: [{ ingredientId: 'beans', name: 'Espresso beans', unit: 'g', quantityMilli: 18_000 }],
  totalBeforeCentavos: 49_500, totalAfterCentavos: 33_000,
};
const approved = { ...request, status: 'awaiting_station', decisionReason: 'Approved after review' };
const denied = { ...request, status: 'denied', decisionReason: 'Original drink still wanted' };
const command: Mutation = {
  id: '2d79907c-813a-4684-b1b2-c3a6b10c6282', path: `/api/v1/amendments/${request.id}/decision`,
  data: { decision: 'approve', reason: approved.decisionReason }, actorId: 'manager', branchId: 'branch', label: 'Item change approved.',
};
const session: Session = {
  token: 'fixture-token', expiresAt: Date.now() + 60_000,
  authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
  actor: { id: 'manager', displayName: 'Fixture manager', branchId: 'branch', role: 'manager' },
};

test('manager amendment records preserve exact submitted before and after terms through approval and disposition', () => {
  for (const amendment of [request, approved, denied, { ...request, status: 'stale' }, {
    ...approved, status: 'resolved', appliedAt: request.requestedAt + 1000, resolvedAt: request.requestedAt + 1000,
    dispositionNote: 'One drink partly prepared',
  }]) assert.deepEqual(validateAmendments({ amendments: [amendment] }), { amendments: [amendment] });
  assert.deepEqual(validateAmendments({ amendments: [] }), { amendments: [] });
});

test('a same-product replacement retains both distinct saved line identities', () => {
  const replacement = {
    ...request, operation: 'replace', after: { ...before, lineNo: before.lineNo + 1, note: 'Warm' },
    totalAfterCentavos: request.totalBeforeCentavos,
  };
  assert.deepEqual(validateAmendments({ amendments: [replacement] }), { amendments: [replacement] });
  assert.throws(() => validateAmendments({ amendments: [{ ...replacement, after: { ...replacement.after, lineNo: before.lineNo } }] }), HubError);
});

test('unsupported amendment records and inconsistent line deltas cannot reach the manager', () => {
  for (const amendment of [null, { ...request, id: '../wrong' }, { ...request, operation: 'refund' },
    { ...request, status: 'pending' }, { ...request, before: null }, { ...request, after: { ...after, note: 'x'.repeat(301) } },
    { ...request, after: { ...after, quantity: 0 } }, { ...request, before: { ...before, providerSecret: 'hidden' } },
    { ...request, after: { ...after, lineNo: 108 } }, { ...request, totalAfterCentavos: request.totalAfterCentavos + 1 },
    { ...request, totalAfterCentavos: Number.MAX_SAFE_INTEGER + 1 }, { ...request, resolvedAt: request.requestedAt - 1 },
    { ...request, recipe: [...request.recipe, ...request.recipe] }, { ...request, recipe: [{ ...request.recipe[0], unit: 'litre' }] },
    { ...request, decisionReason: '  ' }, { ...request, needsDisposition: 1 }, { ...request, needsDisposition: false }, { ...request, reason: undefined },
    { ...request, rawCustomer: 'unexpected' }]) {
    assert.throws(() => validateAmendments({ amendments: [amendment] }), HubError);
  }
  assert.throws(() => validateAmendments({ amendments: [request, request] }), HubError);
  assert.throws(() => validateAmendments({ amendments: [request], debug: true }), HubError);
});

test('amendment decisions bind the saved route, action, authority, request and decision note', async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: session.hubOrigin } } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'window', prior); else Reflect.deleteProperty(globalThis, 'window'); });

  const saved = pendingAdminCommand(command, {
    hubOrigin: session.hubOrigin, authorityId: session.authorityId, actorId: command.actorId,
    branchId: command.branchId, role: session.actor.role,
  }, 1000);
  assert.equal(commandAction(saved), 'order.amendment.decide');
  const status = { commandId: command.id, status: 'accepted', action: 'order.amendment.decide', acceptedAt: 1000 };
  assert.deepEqual(validateCommandStatus(status, saved), status);
  assert.throws(() => validateCommandStatus({ ...status, action: 'approval.decide' }, saved), HubError);
  assert.throws(() => pendingAdminCommand({ ...command, data: { ...command.data, reason: '' } }, saved, 1000), AdminRecoveryError);

  let acknowledgement: unknown = { commandId: command.id, amendment: approved };
  let list: unknown = { amendments: [approved] };
  const calls: { path: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ path: new URL(url).pathname, init });
    return new Response(JSON.stringify(init?.method === 'POST' ? acknowledgement : list), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  await api.mutate(session, saved);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { commandId: command.id, ...command.data });
  assert.equal(calls[0]?.path, command.path);
  assert.equal(new Headers(calls[0]?.init?.headers).get('X-Kape-Doz-Authority'), session.authorityId);
  for (const amendment of [undefined, request, denied, { ...approved, id: 'another-request' },
    { ...approved, decisionReason: 'Different approval note' }, { ...approved, appliedAt: 'broken' }]) {
    acknowledgement = { commandId: command.id, ...(amendment ? { amendment } : {}) };
    await assert.rejects(api.mutate(session, saved), error => error instanceof HubError && error.unknown);
  }
  acknowledgement = { commandId: command.id, amendment: denied };
  await api.mutate(session, { ...saved, data: { decision: 'deny', reason: denied.decisionReason } });
  await refreshCommand(session, saved);
  assert.equal(calls.at(-1)?.path, '/api/v1/amendments');
  list = { amendments: [{ ...approved, after: false }] };
  await assert.rejects(refreshCommand(session, saved), HubError);
});
