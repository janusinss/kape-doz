import assert from 'node:assert/strict';
import test from 'node:test';
import { HubError, validateSalesReport } from '../src/api';

const period = { from: '2026-11-01', through: '2026-11-04' };
function report() {
  return {
    ...period,
    settledOrderCount: 2,
    grossSalesCentavos: 34500,
    discountCentavos: 1500,
    settledSalesCentavos: 33000,
    refundCentavos: 0,
    returnedUnsettledCentavos: 0,
    netSalesCentavos: 33000,
    refundsWithUnknownAttribution: 0,
    unknownRefundLegs: 0,
    dailySales: [
      { businessDate: '2026-11-01', settledOrderCount: 1, settledSalesCentavos: 16500 },
      { businessDate: '2026-11-04', settledOrderCount: 1, settledSalesCentavos: 16500 },
    ],
    unattributedLegacySettlements: 0,
    finalIngredientCostCentavos: 8000,
    estimatedIngredientCostCentavos: 4000,
    ordersWithUnknownIngredientCost: 0,
    enteredExpensesCentavos: 23000,
    wasteCostCentavos: 1000,
    wasteEntriesWithUnknownCost: 0,
    stockLossCostCentavos: 0,
    stockLossEntriesWithUnknownCost: 0,
    cancellationCostCentavos: 0,
    cancellationsWithUnresolvedCost: 0,
    cancelledOrdersAwaitingDisposition: 0,
    cancelledPaymentsAwaitingRefundCentavos: 0,
    cancelledPendingPaymentCentavos: 0,
    expenseCoverageConfirmed: true,
    estimatedGrossProfitCentavos: 21000,
    estimatedGrossMarginBps: 6363,
    estimatedOperatingProfitCentavos: -3000,
  };
}
function rejects(value: unknown) {
  assert.throws(() => validateSalesReport(value, period), (error: unknown) => error instanceof HubError);
}

test('valid reports preserve negative profit, nullable incompleteness and zero sales', () => {
  const valid = report();
  assert.deepEqual(validateSalesReport(valid, period), valid);
  const incomplete = { ...valid, ordersWithUnknownIngredientCost: 1, estimatedGrossProfitCentavos: null, estimatedGrossMarginBps: null, estimatedOperatingProfitCentavos: null };
  assert.deepEqual(validateSalesReport(incomplete, period), incomplete);
  const zero = { ...valid, settledOrderCount: 0, grossSalesCentavos: 0, discountCentavos: 0, settledSalesCentavos: 0, netSalesCentavos: 0, dailySales: [], finalIngredientCostCentavos: 0, estimatedIngredientCostCentavos: 0, estimatedGrossProfitCentavos: 0, estimatedGrossMarginBps: null, estimatedOperatingProfitCentavos: -24000 };
  assert.deepEqual(validateSalesReport(zero, period), zero);
});

test('gross sales less approved discounts must reconcile with settled sales', () => {
  rejects({ ...report(), grossSalesCentavos: undefined });
  rejects({ ...report(), grossSalesCentavos: 32999 });
  rejects({ ...report(), discountCentavos: -1500 });
  rejects({ ...report(), discountCentavos: 1501 });
});

test('confirmed settled refunds reduce net sales, while returned unsettled money does not', () => {
  const refunded = { ...report(), refundCentavos: 1000, returnedUnsettledCentavos: 500, netSalesCentavos: 32000,
    estimatedGrossProfitCentavos: 20000, estimatedGrossMarginBps: 6250, estimatedOperatingProfitCentavos: -4000 };
  assert.deepEqual(validateSalesReport(refunded, period), refunded);
  rejects({ ...refunded, netSalesCentavos: 31500 });
  rejects({ ...refunded, refundCentavos: -1 });
  rejects({ ...refunded, returnedUnsettledCentavos: undefined });
  const negative = { ...refunded, refundCentavos: 35000, netSalesCentavos: -2000,
    estimatedGrossProfitCentavos: -14000, estimatedGrossMarginBps: null, estimatedOperatingProfitCentavos: -38000 };
  assert.deepEqual(validateSalesReport(negative, period), negative);
  rejects({ ...negative, estimatedGrossMarginBps: 70000 });
});

test('unknown refund payouts or sale attribution suppress every profit output', () => {
  for (const field of ['refundsWithUnknownAttribution', 'unknownRefundLegs']) {
    rejects({ ...report(), [field]: undefined });
    rejects({ ...report(), [field]: 1 });
    const unresolved = { ...report(), [field]: 1,
      estimatedGrossProfitCentavos: null, estimatedGrossMarginBps: null, estimatedOperatingProfitCentavos: null };
    assert.deepEqual(validateSalesReport(unresolved, period), unresolved);
  }
});

test('missing fields and invalid safe-integer subtotals are controlled errors', () => {
  rejects({ ...report(), dailySales: undefined });
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    rejects({ ...report(), finalIngredientCostCentavos: value });
    rejects({ ...report(), settledOrderCount: value });
    rejects({ ...report(), wasteCostCentavos: value });
    rejects({ ...report(), wasteEntriesWithUnknownCost: value });
  }
  rejects({ ...report(), estimatedOperatingProfitCentavos: NaN });
  rejects({ ...report(), expenseCoverageConfirmed: 'true' });
});

test('recorded waste is deducted once and unresolved waste blocks only operating profit', () => {
  const valid = report();
  rejects({ ...valid, estimatedOperatingProfitCentavos: -2000 });
  rejects({ ...valid, wasteEntriesWithUnknownCost: 1 });
  rejects({ ...valid, wasteCostCentavos: undefined });
  rejects({ ...valid, wasteEntriesWithUnknownCost: undefined });
  const unresolvedWaste = { ...valid, wasteEntriesWithUnknownCost: 1, estimatedOperatingProfitCentavos: null };
  assert.deepEqual(validateSalesReport(unresolvedWaste, period), unresolvedWaste);
});

test('resolved cancellation loss reduces operating profit once without changing sales or settled COGS', () => {
  const resolved = { ...report(), cancellationCostCentavos: 1800, estimatedOperatingProfitCentavos: -4800 };
  assert.deepEqual(validateSalesReport(resolved, period), resolved);
  rejects({ ...resolved, estimatedOperatingProfitCentavos: -3000 });
});

test('stock loss is a separate operating deduction that leaves gross profit intact', () => {
  const resolved = { ...report(), stockLossCostCentavos: 1200, estimatedOperatingProfitCentavos: -4200 };
  assert.deepEqual(validateSalesReport(resolved, period), resolved);
  rejects({ ...resolved, estimatedOperatingProfitCentavos: -3000 });
  rejects({ ...resolved, estimatedOperatingProfitCentavos: -5400 });
  rejects({ ...resolved, estimatedGrossProfitCentavos: 19800, estimatedGrossMarginBps: 6000, estimatedOperatingProfitCentavos: -5400 });
});

test('unknown stock loss preserves gross figures but blocks the operating estimate', () => {
  const unresolved = { ...report(), stockLossCostCentavos: 1200, stockLossEntriesWithUnknownCost: 1, estimatedOperatingProfitCentavos: null };
  assert.deepEqual(validateSalesReport(unresolved, period), unresolved);
  rejects({ ...unresolved, estimatedOperatingProfitCentavos: -4200 });
  rejects({ ...unresolved, estimatedGrossProfitCentavos: null, estimatedGrossMarginBps: null });
  for (const field of ['stockLossCostCentavos', 'stockLossEntriesWithUnknownCost']) {
    for (const invalid of [undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      rejects({ ...report(), [field]: invalid });
    }
  }
});

test('unresolved preparation, cost and retained cancellation tenders suppress every profit estimate', () => {
  const fields = ['cancellationsWithUnresolvedCost', 'cancelledOrdersAwaitingDisposition', 'cancelledPaymentsAwaitingRefundCentavos', 'cancelledPendingPaymentCentavos'];
  for (const field of fields) {
    rejects({ ...report(), [field]: 1 });
    const blocked = { ...report(), [field]: 1, estimatedGrossProfitCentavos: null, estimatedGrossMarginBps: null, estimatedOperatingProfitCentavos: null };
    assert.deepEqual(validateSalesReport(blocked, period), blocked);
  }
  for (const field of ['cancellationCostCentavos', ...fields]) {
    rejects({ ...report(), [field]: undefined });
    rejects({ ...report(), [field]: -1 });
  }
});

test('response dates must be real calendar dates matching the requested period', () => {
  rejects({ ...report(), from: '2026-10-01' });
  rejects({ ...report(), through: '2026-02-30' });
  rejects({ ...report(), from: '2026-11-05' });
});

test('daily rows must be ordered, unique, in range and reconcile to totals', () => {
  const valid = report();
  rejects({ ...valid, dailySales: valid.dailySales.slice(0, 1) });
  rejects({ ...valid, dailySales: [...valid.dailySales].reverse() });
  rejects({ ...valid, dailySales: [valid.dailySales[0], valid.dailySales[0]] });
  rejects({ ...valid, dailySales: [{ ...valid.dailySales[0], businessDate: '2026-10-31' }, valid.dailySales[1]] });
  rejects({ ...valid, dailySales: [{ ...valid.dailySales[0], settledSalesCentavos: -1 }, valid.dailySales[1]] });
});

test('incomplete inputs and unconfirmed coverage cannot carry profit claims', () => {
  rejects({ ...report(), ordersWithUnknownIngredientCost: 1 });
  rejects({ ...report(), unattributedLegacySettlements: 1 });
  rejects({ ...report(), expenseCoverageConfirmed: false });
  rejects({ ...report(), estimatedGrossProfitCentavos: 1 });
  rejects({ ...report(), estimatedGrossMarginBps: 1 });
  const uncovered = { ...report(), expenseCoverageConfirmed: false, estimatedOperatingProfitCentavos: null };
  assert.deepEqual(validateSalesReport(uncovered, period), uncovered);
});
