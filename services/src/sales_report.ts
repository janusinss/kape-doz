import type { DatabaseSync } from 'node:sqlite';
import type { ExpensePeriodInput } from './business_validation.js';
import { exact } from './errors.js';

const manilaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function manilaBusinessDate(timestamp: number) {
  const parts = manilaDate.formatToParts(timestamp);
  const year = parts.find(part => part.type === 'year')!.value.padStart(4, '0');
  const month = parts.find(part => part.type === 'month')!.value;
  const day = parts.find(part => part.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

function safeInteger(value: bigint) {
  return exact(Number(value), 'The report total exceeds the supported range.');
}

function roundedCentavos(microcentavos: bigint) {
  return (microcentavos + 500_000n) / 1_000_000n;
}

export function salesReport(db: DatabaseSync, branchId: string, period: ExpensePeriodInput, enteredExpensesCentavos: number) {
  const args = [branchId, period.from, period.through];
  const start = Date.parse(`${period.from}T00:00:00+08:00`);
  const end = Date.parse(`${period.through}T00:00:00+08:00`) + 86_400_000;
  const settlementQuery = db.prepare(`
    SELECT s.order_id, s.business_date, s.total_centavos, s.discount_centavos, o.ready_at, c.resolved_at
    FROM order_settlements s
    JOIN orders o ON o.branch_id=s.branch_id AND o.id=s.order_id
    LEFT JOIN order_cancellations c ON c.branch_id=o.branch_id AND c.order_id=o.id
    WHERE s.branch_id=? AND s.business_date BETWEEN ? AND ?
    ORDER BY s.business_date
  `);
  settlementQuery.setReadBigInts(true);
  const settled = settlementQuery.all(...args);
  const totalsByDate = new Map<string, { count: number; sales: bigint }>();
  const costsByOrder = new Map<string, { ready: boolean; found: boolean; unknown: boolean }>();
  let settledSales = 0n;
  let settledDiscounts = 0n;
  for (const order of settled) {
    const businessDate = String(order.business_date);
    const amount = order.total_centavos as bigint;
    const day = totalsByDate.get(businessDate) ?? { count: 0, sales: 0n };
    day.count++;
    day.sales += amount;
    totalsByDate.set(businessDate, day);
    settledSales += amount;
    settledDiscounts += order.discount_centavos as bigint;
    costsByOrder.set(String(order.order_id), {
      ready: order.ready_at !== null,
      found: order.ready_at === null && order.resolved_at !== null && (order.resolved_at as bigint) < BigInt(end),
      unknown: false,
    });
  }
  const costQuery = db.prepare(`
    WITH period_orders AS (
      SELECT s.branch_id, s.order_id, o.ready_at, c.resolved_at
      FROM order_settlements s
      JOIN orders o ON o.branch_id=s.branch_id AND o.id=s.order_id
      LEFT JOIN order_cancellations c ON c.branch_id=o.branch_id AND c.order_id=o.id
      WHERE s.branch_id=? AND s.business_date BETWEEN ? AND ?
    )
    SELECT o.order_id, v.value_microcentavos AS cost
    FROM period_orders o
    JOIN stock_movements m ON m.branch_id=o.branch_id AND m.order_id=o.order_id AND m.kind='consumption'
    LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id
    WHERE o.ready_at IS NOT NULL
    UNION ALL
    SELECT o.order_id, e.cost_microcentavos AS cost
    FROM period_orders o
    JOIN reservations r ON r.branch_id=o.branch_id AND r.order_id=o.order_id
    LEFT JOIN order_recipe_valuation_estimates e
      ON e.branch_id=r.branch_id AND e.order_id=r.order_id AND e.ingredient_id=r.ingredient_id
    WHERE o.ready_at IS NULL AND (r.released=0 OR o.resolved_at>=?)
  `);
  costQuery.setReadBigInts(true);
  const costs = costQuery.iterate(...args, end);
  let finalMicrocentavos = 0n;
  let estimatedMicrocentavos = 0n;
  for (const row of costs) {
    const state = costsByOrder.get(String(row.order_id))!;
    state.found = true;
    if (row.cost === null) state.unknown = true;
    else if (state.ready) finalMicrocentavos += row.cost as bigint;
    else estimatedMicrocentavos += row.cost as bigint;
  }
  let ordersWithUnknownIngredientCost = 0;
  for (const state of costsByOrder.values()) {
    if (!state.found || state.unknown) ordersWithUnknownIngredientCost++;
  }
  const legacy = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT o.id
      FROM orders o
      JOIN payments p ON p.branch_id=o.branch_id AND p.order_id=o.id AND p.status='confirmed'
      WHERE o.branch_id=? AND (o.cancelled_at IS NULL OR EXISTS (
        SELECT 1 FROM order_cancellations c JOIN order_approvals a ON a.id=c.approval_id
        WHERE c.branch_id=o.branch_id AND c.order_id=o.id AND a.collected_centavos=o.total_centavos
      )) AND NOT EXISTS (
        SELECT 1 FROM order_settlements s WHERE s.branch_id=o.branch_id AND s.order_id=o.id
      )
      GROUP BY o.id, o.total_centavos
      HAVING SUM(p.amount_centavos)>=o.total_centavos
    )
  `).get(branchId)!;
  const unattributedLegacySettlements = Number(legacy.count);
  const expenseCoverageConfirmed = !!db.prepare(`
    SELECT 1 FROM expense_coverage_confirmations
    WHERE branch_id=? AND starts_on=? AND ends_on=? AND invalidated_by IS NULL
    LIMIT 1
  `).get(...args);
  const finalCost = roundedCentavos(finalMicrocentavos);
  const estimatedCost = roundedCentavos(estimatedMicrocentavos);
  const wasteStatement = db.prepare(`
    SELECT v.value_microcentavos AS cost
    FROM stock_movements m
    LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id
    WHERE m.branch_id=? AND m.kind='waste' AND m.accepted_at>=? AND m.accepted_at<?
  `);
  wasteStatement.setReadBigInts(true);
  let wasteMicrocentavos = 0n;
  let wasteEntriesWithUnknownCost = 0;
  for (const row of wasteStatement.iterate(branchId, start, end)) {
    if (row.cost === null) wasteEntriesWithUnknownCost++;
    else wasteMicrocentavos += row.cost as bigint;
  }
  const wasteCost = roundedCentavos(wasteMicrocentavos);
  const stockLosses = db.prepare(`SELECT v.value_microcentavos AS cost FROM stock_movements m
    LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id
    WHERE m.branch_id=? AND m.kind='count_adjustment' AND m.quantity_milli<0 AND m.accepted_at>=? AND m.accepted_at<?`);
  stockLosses.setReadBigInts(true);
  let stockLossMicrocentavos = 0n;
  let stockLossEntriesWithUnknownCost = 0;
  for (const row of stockLosses.iterate(branchId, start, end)) {
    if (row.cost === null) stockLossEntriesWithUnknownCost++;
    else stockLossMicrocentavos += row.cost as bigint;
  }
  const stockLossCost = roundedCentavos(stockLossMicrocentavos);
  const cancellationCosts = db.prepare(`
    SELECT c.order_id, v.value_microcentavos AS cost
    FROM order_cancellations c
    JOIN orders o ON o.branch_id=c.branch_id AND o.id=c.order_id
    JOIN order_approvals a ON a.id=c.approval_id
    LEFT JOIN stock_movements m ON m.branch_id=c.branch_id AND m.order_id=c.order_id AND m.kind='consumption'
    LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id
    WHERE c.branch_id=? AND c.cancelled_at>=? AND c.cancelled_at<? AND o.ready_at IS NOT NULL
      AND a.collected_centavos<o.total_centavos
      AND NOT EXISTS (SELECT 1 FROM order_settlements s WHERE s.branch_id=c.branch_id AND s.order_id=c.order_id)
  `);
  cancellationCosts.setReadBigInts(true);
  const unresolvedCancellationCosts = new Set<string>();
  let cancellationMicrocentavos = 0n;
  for (const row of cancellationCosts.iterate(branchId, start, end)) {
    if (row.cost === null) unresolvedCancellationCosts.add(String(row.order_id));
    else cancellationMicrocentavos += row.cost as bigint;
  }
  const unvaluedCancellationWaste = db.prepare(`
    SELECT DISTINCT c.order_id FROM cancellation_waste c
    JOIN stock_movements m ON m.branch_id=c.branch_id AND m.waste_id=c.waste_id AND m.kind='waste'
    LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id
    WHERE c.branch_id=? AND m.accepted_at>=? AND m.accepted_at<? AND v.value_microcentavos IS NULL
  `).iterate(branchId, start, end);
  for (const row of unvaluedCancellationWaste) unresolvedCancellationCosts.add(String(row.order_id));
  const cancellationCost = roundedCentavos(cancellationMicrocentavos);
  const pendingDisposition = Number(db.prepare(`SELECT COUNT(*) AS count FROM order_cancellations
    WHERE branch_id=? AND cancelled_at<? AND status='awaiting_disposition'`).get(branchId, end)!.count);
  const retainedTenders = db.prepare(`
    SELECT p.status,p.amount_centavos-COALESCE((SELECT SUM(l.amount_centavos) FROM refund_legs l
      WHERE l.payment_id=p.id AND l.branch_id=p.branch_id AND l.status='completed'),0) AS amount_centavos
    FROM order_cancellations c
    JOIN payments p ON p.branch_id=c.branch_id AND p.order_id=c.order_id
    WHERE c.branch_id=? AND c.cancelled_at<? AND p.status IN ('confirmed','pending')
  `);
  retainedTenders.setReadBigInts(true);
  let cancelledPaymentsAwaitingRefund = 0n;
  let cancelledPendingPayment = 0n;
  for (const row of retainedTenders.iterate(branchId, end)) {
    if (row.status === 'confirmed') cancelledPaymentsAwaitingRefund += row.amount_centavos as bigint;
    else cancelledPendingPayment += row.amount_centavos as bigint;
  }
  const completedRefunds = db.prepare(`SELECT amount_centavos,revenue_centavos FROM refund_legs
    WHERE branch_id=? AND status='completed' AND completed_at>=? AND completed_at<?`);
  completedRefunds.setReadBigInts(true);
  let revenueRefunds = 0n;
  let returnedUnsettled = 0n;
  let refundsWithUnknownAttribution = 0;
  for (const row of completedRefunds.iterate(branchId,start,end)) {
    if (row.revenue_centavos===null) refundsWithUnknownAttribution++;
    else {
      revenueRefunds += row.revenue_centavos as bigint;
      returnedUnsettled += (row.amount_centavos as bigint)-(row.revenue_centavos as bigint);
    }
  }
  const unknownRefundLegs = Number(db.prepare(`SELECT COUNT(*) AS count FROM refund_legs l
    JOIN refund_requests r ON r.id=l.refund_id AND r.branch_id=l.branch_id
    WHERE l.branch_id=? AND l.status='unknown' AND r.decided_at<?`).get(branchId,end)!.count);
  const netSales = settledSales-revenueRefunds;
  const gross = ordersWithUnknownIngredientCost || unattributedLegacySettlements ||
    unresolvedCancellationCosts.size || pendingDisposition || cancelledPaymentsAwaitingRefund > 0n || cancelledPendingPayment > 0n ||
    refundsWithUnknownAttribution || unknownRefundLegs
    ? null : netSales - finalCost - estimatedCost;
  return {
    ...period,
    settledOrderCount: settled.length,
    settledSalesCentavos: safeInteger(settledSales),
    refundCentavos: safeInteger(revenueRefunds),
    returnedUnsettledCentavos: safeInteger(returnedUnsettled),
    netSalesCentavos: safeInteger(netSales),
    refundsWithUnknownAttribution,
    unknownRefundLegs,
    grossSalesCentavos: safeInteger(settledSales + settledDiscounts),
    discountCentavos: safeInteger(settledDiscounts),
    dailySales: [...totalsByDate].map(([businessDate, day]) => ({
      businessDate, settledOrderCount: day.count, settledSalesCentavos: safeInteger(day.sales),
    })),
    unattributedLegacySettlements,
    finalIngredientCostCentavos: safeInteger(finalCost),
    estimatedIngredientCostCentavos: safeInteger(estimatedCost),
    ordersWithUnknownIngredientCost,
    enteredExpensesCentavos,
    wasteCostCentavos: safeInteger(wasteCost),
    wasteEntriesWithUnknownCost,
    stockLossCostCentavos: safeInteger(stockLossCost),
    stockLossEntriesWithUnknownCost,
    cancellationCostCentavos: safeInteger(cancellationCost),
    cancellationsWithUnresolvedCost: unresolvedCancellationCosts.size,
    cancelledOrdersAwaitingDisposition: pendingDisposition,
    cancelledPaymentsAwaitingRefundCentavos: safeInteger(cancelledPaymentsAwaitingRefund),
    cancelledPendingPaymentCentavos: safeInteger(cancelledPendingPayment),
    expenseCoverageConfirmed,
    estimatedGrossProfitCentavos: gross === null ? null : safeInteger(gross),
    estimatedGrossMarginBps: gross === null || netSales <= 0n ? null : safeInteger(gross * 10_000n / netSales),
    estimatedOperatingProfitCentavos: gross === null || !expenseCoverageConfirmed || wasteEntriesWithUnknownCost > 0 || stockLossEntriesWithUnknownCost > 0
      ? null : safeInteger(gross - BigInt(enteredExpensesCentavos) - wasteCost - cancellationCost - stockLossCost),
  };
}
