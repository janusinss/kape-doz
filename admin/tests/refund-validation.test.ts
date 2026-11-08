import assert from 'node:assert/strict';
import test from 'node:test';
import { api, HubError, validateRefunds, type Mutation, type Session } from '../src/api';

const cash = { paymentId: 'payment-cash', method: 'cash', amountCentavos: 10000, reference: null, refundableCentavos: 10000 };
const gcash = { paymentId: 'payment-gcash', method: 'gcash', amountCentavos: 6500, reference: 'Original-86F2', refundableCentavos: 6500 };
const requestedAt = 1_793_836_800_000;
const refund = {
  id: 'refund-51', orderId: 'order-40', orderNo: 40, orderVersion: 6,
  requesterId: 'cashier-mia', requesterName: 'Mia', requestedAt, amountCentavos: 5500,
  reason: 'One drink was returned', status: 'pending', decidedAt: null, decisionReason: null,
  lines: [{ lineNo: 0, name: 'Latte', quantity: 1, unitPriceCentavos: 16500 }],
  tenders: [cash, gcash], legs: [],
};
const cashLeg = { id: 'leg-cash', paymentId: cash.paymentId, method: 'cash', amountCentavos: 2000, version: 1, status: 'pending', reference: null, note: null, completedAt: null };
const gcashLeg = { id: 'leg-gcash', paymentId: gcash.paymentId, method: 'gcash', amountCentavos: 3500, version: 2, status: 'unknown', reference: null, note: 'Check the transfer history', completedAt: null };
const approved = { ...refund, status: 'approved', decidedAt: requestedAt + 1, legs: [cashLeg, gcashLeg] };

test('refund projection preserves original tenders and distinct leg states', () => {
  assert.deepEqual(validateRefunds({ refunds: [refund] }), { refunds: [refund] });
  assert.deepEqual(validateRefunds({ refunds: [approved] }), { refunds: [approved] });
  assert.deepEqual(validateRefunds({ refunds: [] }), { refunds: [] });
  const cashCompleted = { ...approved, legs: [{ ...cashLeg, status: 'completed', version: 2, completedAt: requestedAt + 2 }, gcashLeg] };
  assert.deepEqual(validateRefunds({ refunds: [cashCompleted] }), { refunds: [cashCompleted] });
});

test('malformed amounts, tender associations and refund outcomes fail closed', () => {
  for (const entry of [
    { ...refund, tenders: [{ ...cash, refundableCentavos: 10001 }] },
    { ...refund, tenders: [cash, cash] },
    { ...refund, legs: [cashLeg] },
    { ...approved, legs: [cashLeg] },
    { ...approved, legs: [cashLeg, { ...gcashLeg, paymentId: cash.paymentId }] },
    { ...approved, legs: [cashLeg, { ...gcashLeg, status: 'completed' }] },
    { ...approved, legs: [cashLeg, { ...gcashLeg, status: 'completed', completedAt: requestedAt + 2 }] },
    { ...approved, legs: [cashLeg, { ...gcashLeg, status: 'refunded' }] },
    { ...approved, legs: [cashLeg, { ...gcashLeg, reference: 'Unverified-transfer' }] },
    { ...approved, legs: [{ ...cashLeg, status: 'unknown', note: 'Unknown' }, gcashLeg] },
  ]) assert.throws(() => validateRefunds({ refunds: [entry] }), HubError);
});

test('refund acknowledgements match the approved tender split and the exact leg transition', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://127.0.0.1' } } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const session: Session = { token: 'fixture-token', expiresAt: requestedAt + 60_000,
    authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
    actor: { id: 'manager', displayName: 'Fixture manager', branchId: 'branch', role: 'manager' } };
  const base = { id: 'c6cb43ea-159b-449c-bbcb-ad75f2b45176', actorId: 'manager', branchId: 'branch', label: 'Saved.' };
  const command: Mutation = { ...base, path: `/api/v1/refunds/${refund.id}/decision`, data: {
    decision: 'approve', allocations: [{ paymentId: cash.paymentId, amountCentavos: 2000 }, { paymentId: gcash.paymentId, amountCentavos: 3500 }],
  } };
  const confirm: Mutation = { ...base, path: `/api/v1/refunds/${refund.id}/legs/${gcashLeg.id}`, data: {
    expectedVersion: gcashLeg.version, action: 'confirm_external', note: 'Transfer receipt checked', reference: 'Verified-4B03',
  } };
  let result: unknown = approved;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ commandId: base.id, refund: result }), { status: 200 }));
  await api.mutate(session, command);
  result = { ...approved, legs: [{ ...cashLeg, amountCentavos: 1000 }, { ...gcashLeg, amountCentavos: 4500 }] };
  await assert.rejects(api.mutate(session, command), error => error instanceof HubError && error.unknown);

  const completeLeg = { ...gcashLeg, version: 3, status: 'completed', note: confirm.data.note, reference: confirm.data.reference, completedAt: requestedAt + 2 };
  result = { ...approved, legs: [cashLeg, completeLeg] };
  await api.mutate(session, confirm);
  result = { ...approved, legs: [cashLeg, { ...completeLeg, version: 2 }] };
  await assert.rejects(api.mutate(session, confirm), error => error instanceof HubError && error.unknown);
  result = { ...approved, legs: [cashLeg, { ...completeLeg, reference: 'Another-transfer' }] };
  await assert.rejects(api.mutate(session, confirm), error => error instanceof HubError && error.unknown);
  result = approved;
  await assert.rejects(api.mutate(session, confirm), error => error instanceof HubError && error.unknown);
});
