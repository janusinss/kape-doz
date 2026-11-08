# Sales, ingredient cost and expense coverage

Only owner and manager sessions may read or confirm report data for their own branch. Both report dates are inclusive Manila business dates. The hub records one settlement per fully confirmed order in the same transaction as the final tender, release, command receipt and audit. Pending, rejected and partial tenders contribute no sales. Cash received, cash change and opening floats are excluded.

`GET /api/v1/admin/sales?from=YYYY-MM-DD&through=YYYY-MM-DD` returns:

| Field | Meaning |
| --- | --- |
| `from`, `through` | Applied Manila date range. |
| `settledOrderCount`, `settledSalesCentavos` | Fully settled orders with dated records in the period and their charged totals after approved discounts. |
| `refundCentavos`, `returnedUnsettledCentavos`, `netSalesCentavos` | Completed refunds of settled sales, returns of unsettled deposits or overpayments, and captured settlements less revenue refunds. Completion uses its own Manila business date. Net sales may be negative. |
| `refundsWithUnknownAttribution`, `unknownRefundLegs` | Legacy refund legs with insufficient settlement attribution, and current unknown payout legs approved through the report end date. Either suppresses profit estimates. |
| `grossSalesCentavos`, `discountCentavos` | Settled totals before approved discounts and the applied discounts captured with each settlement. Gross minus discounts equals net settled sales. |
| `dailySales` | Ascending array of `{businessDate,settledOrderCount,settledSalesCentavos}` for days with sales. |
| `unattributedLegacySettlements` | Branch-wide count of paid orders without authoritative settlement records. These sales remain excluded from dated totals. |
| `finalIngredientCostCentavos`, `estimatedIngredientCostCentavos` | Known subtotals for ready orders and release-time estimates for unready orders, respectively. |
| `ordersWithUnknownIngredientCost` | Settled orders missing one or more costs. |
| `enteredExpensesCentavos`, `expenseCoverageConfirmed` | Allocated entered operating expenses and whether an admin confirmed coverage for this exact period. |
| `wasteCostCentavos`, `wasteEntriesWithUnknownCost` | Known ingredient cost of waste and dial-in recorded within the reporting dates, and the number of entries with unresolved cost. |
| `stockLossCostCentavos`, `stockLossEntriesWithUnknownCost` | Ingredient cost of approved negative physical count adjustments posted within the reporting dates, and the number with unresolved cost. Deducted separately from operating profit. |
| `cancellationCostCentavos`, `cancellationsWithUnresolvedCost` | Known ready-drink loss from cancelled orders without a settled sale, and the number of cancellations with unresolved recorded ingredient cost. |
| `cancelledOrdersAwaitingDisposition`, `cancelledPaymentsAwaitingRefundCentavos`, `cancelledPendingPaymentCentavos` | Current preparation and payment attention for orders cancelled through the report end date. |
| `estimatedGrossProfitCentavos`, `estimatedGrossMarginBps`, `estimatedOperatingProfitCentavos` | Estimates from this recorded ledger. Profit fields are null with unknown ingredient costs, unattributed settlements or unresolved cancellations. Margin is null with zero sales. Operating profit also requires confirmed expense coverage. |

`POST /api/v1/admin/expense-coverage` accepts `{commandId,from,through}` and returns `{commandId,coverage:{from,through,confirmedAt}}`. The action confirms all expenses for that exact range have been entered. It can confirm a period with zero expenses. Coverage cannot include future Manila dates. A newly entered expense invalidates all overlapping confirmations, so affected ranges need reconfirmation. The original receipt remains available for exact replay.

Inventory uses a branch-and-ingredient moving average. Carrying value and immutable movement costs are held in millionths of a centavo. Partial consumption floors at that scale. Full depletion transfers the remaining value. Report subtotals round to the nearest centavo after summing, with half-centavos rounded up. Receipt cost is saved even when prior carrying value is unknown. Shortage, negative stock or unknown opening value leaves the affected removal cost unresolved. A confirmed zero balance provides a clean starting point for subsequent receipts. Pre-migration positive stock starts unresolved and old consumption costs are preserved as unknown.

Release snapshots estimates from stock available at that instant. Mark Ready posts the actual recorded carrying cost then in effect. Later receipts preserve both snapshots. Estimated gross profit uses captured sales less completed revenue refunds, posted ingredient costs and estimated ingredient costs. Margin is undefined when net sales are zero or negative. Operating profit also deducts allocated expenses, recorded waste, dial-in, cancellation losses and physical stock losses. Unknown loss costs make the relevant profit unavailable. Managers enter other expenses separately to avoid counting waste twice. Tax and cloud reconciliation require their corresponding ledgers.
