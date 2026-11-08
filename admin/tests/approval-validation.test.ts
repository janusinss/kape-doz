import assert from 'node:assert/strict';
import test from 'node:test';
import { api, HubError, validateApprovals, type Mutation, type Session } from '../src/api';

const pending = {
  id: '7d34953c-3a1b-4a07-ac2c-bbc5b5ed99be', orderId: 'e72a1939-de90-4885-85fd-d464a215581f',
  orderNo: 12, orderVersion: 2, action: 'discount', amountCentavos: 1500, subtotalCentavos: 16500,
  requesterId: 'cashier-mia', requesterName: 'Mia', reason: 'Order was prepared again', requestedAt: 1_793_836_800_000,
  status: 'pending', decisionReason: null, decidedAt: null,
};
const cancellation = {
  ...pending, action: 'cancel', amountCentavos: 15000,
  requestedKitchenState: 'queued', requestedPaymentState: 'partially_paid', collectedCentavos: 5000,
  pendingCentavos: 0, cancellationStatus: null,
};

test('approval list preserves request details and recorded decisions', () => {
  const denied = { ...pending, id: 'b4fe1304-187e-4920-ad8a-8852056f2877', status: 'denied', decisionReason: 'Check the original ticket', decidedAt: pending.requestedAt + 60_000 };
  assert.deepEqual(validateApprovals({ approvals: [pending, denied] }), { approvals: [pending, denied] });
  assert.deepEqual(validateApprovals({ approvals: [] }), { approvals: [] });
});

test('malformed or unsupported approval details fail closed', () => {
  for (const entry of [
    null,
    { ...pending, id: '../other/decision' },
    { ...pending, action: 'refund' },
    { ...pending, amountCentavos: 0 },
    { ...pending, amountCentavos: pending.subtotalCentavos },
    { ...pending, amountCentavos: 12.5 },
    { ...pending, requestedAt: Number.MAX_SAFE_INTEGER },
    { ...pending, reason: '  ' },
    { ...pending, status: 'invalid' },
    { ...pending, status: 'approved' },
    { ...pending, decidedAt: pending.requestedAt + 60_000 },
  ]) {
    assert.throws(() => validateApprovals({ approvals: [entry] }), HubError);
  }
  assert.throws(() => validateApprovals({ approvals: [pending, pending] }), HubError);
  assert.throws(() => validateApprovals({ approvals: null }), HubError);
});

test('cancellation requests preserve preparation and payment snapshots separately from disposition', () => {
  assert.deepEqual(validateApprovals({ approvals: [cancellation] }), { approvals: [cancellation] });
  const stopped = { ...cancellation, status: 'approved', decidedAt: pending.requestedAt + 60_000, cancellationStatus: 'awaiting_disposition' };
  assert.deepEqual(validateApprovals({ approvals: [stopped] }), { approvals: [stopped] });
  assert.deepEqual(validateApprovals({ approvals: [{ ...stopped, cancellationStatus: 'resolved' }] }), { approvals: [{ ...stopped, cancellationStatus: 'resolved' }] });
  for (const entry of [
    { ...cancellation, requestedKitchenState: 'cancelled' },
    { ...cancellation, requestedPaymentState: 'refunded' },
    { ...cancellation, collectedCentavos: -1 },
    { ...cancellation, pendingCentavos: undefined },
    { ...cancellation, cancellationStatus: 'refunded' },
    { ...cancellation, amountCentavos: pending.subtotalCentavos + 1 },
    { ...stopped, cancellationStatus: null },
  ]) assert.throws(() => validateApprovals({ approvals: [entry] }), HubError);
});

test('approval decisions require an acknowledged result for the same request and decision', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://127.0.0.1' } } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const session: Session = { token: 'fixture-token', expiresAt: Date.now() + 60_000,
    authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
    actor: { id: 'manager', displayName: 'Fixture manager', branchId: 'branch', role: 'manager' } };
  const command: Mutation = { id: '2d79907c-813a-4684-b1b2-c3a6b10c6282', path: `/api/v1/approvals/${pending.id}/decision`,
    data: { decision: 'approve' }, actorId: 'manager', branchId: 'branch', label: 'Discount approved.' };
  const approved = { ...pending, status: 'approved', decidedAt: pending.requestedAt + 60_000 };
  let acknowledgement: unknown = { commandId: command.id, approval: approved };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(acknowledgement), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await api.mutate(session, command);
  for (const result of [undefined, pending, { ...approved, id: 'other-request' }, { ...approved, status: 'denied', decisionReason: 'Denied' }]) {
    acknowledgement = { commandId: command.id, ...(result ? { approval: result } : {}) };
    await assert.rejects(api.mutate(session, command), error => error instanceof HubError && error.unknown);
  }
});
