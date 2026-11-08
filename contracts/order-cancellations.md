# Order cancellation and preparation disposition

Cashiers request whole-order cancellation through the existing approval endpoint. The manager reviews the exact order version, reason, preparation state and payment snapshot. Cancellation stops service. Recorded payments remain attached for refund review. Refund execution is a separate ledger operation.

## Requests and decisions

`POST /api/v1/orders/:id/approvals` accepts `{commandId,expectedVersion,action:"cancel",reason}` for a cashier. The amount comes from the saved order. The existing manager/owner decision endpoint accepts approval or denial. A new cancellation request supersedes the earlier pending cancellation request. An order change invalidates an older request. The discount request format and response remain supported.

A cancellation approval response extends the common approval fields with `requestedKitchenState`, `requestedPaymentState`, `collectedCentavos`, `pendingCentavos` and `cancellationStatus`. The first four fields preserve the request-time snapshot. The last field reports `null` before approval, `awaiting_disposition` or `resolved` after approval. The approval value is the net order amount. `subtotalCentavos` preserves the gross order amount.

Approval sets the cancellation timestamp and increments the order version atomically with the decision, command receipt, audit and outbox. New tenders, kitchen release, preparation and readiness are rejected on the cancelled order. Exact command replay retains its original accepted response. An unreleased order resolves as unprepared without a stock movement. Released orders keep their outstanding reservations until the barista records actual disposition. An unsettled cancellation cannot become a newly settled sale through later verification of a previously pending external tender. Verification and rejection preserve the external evidence and references for refund review.

## Barista actions

| Route | Input | Result |
| --- | --- | --- |
| `POST /api/v1/orders/:id/prepare` | `commandId`, `expectedVersion` | Records the first preparation start and version change. Existing direct Mark ready remains supported. |
| `POST /api/v1/orders/:id/cancellation/disposition` | `commandId`, `expectedVersion`, `outcome`, `used`, `note` | Records actual preparation disposition and releases remaining reservations once. |

Disposition notes contain 1–300 trimmed characters. Before ready, `unprepared` requires an empty `used` array, and `used` requires at least one `{ingredientId,quantityMilli}` entry. Ingredients must belong to the captured recipe and appear once each. Quantities are positive integer thousandths of the ingredient unit, up to 1 billion per ingredient. Actual use may exceed the recipe estimate. At ready, the accepted outcome is `already_consumed` with an empty `used` array.

Used ingredients create linked, valued waste movements in the same transaction as disposition. A failure rolls back every ingredient leg. Ready disposal records disposition without another stock deduction. Ingredient recovery requires a later approved recovery operation. These whole-order and ingredient-selection boundaries are recorded implementation choices.

Order responses add `cancelled`, `preparing`, `preparingAt` and nullable `cancellation`. The cancellation object contains `approvalId`, `reason`, `status`, `cancelledAt`, `resolvedAt`, `outcome`, `dispositionNote`, `recipe` and `actualUsed`. Recipe and actual-use rows contain `ingredientId`, `name`, `unit` and `quantityMilli`. Cashier/admin projections also include `confirmedPaymentCentavos` and `pendingPaymentCentavos`. Barista projections exclude monetary fields.

Active station results include cancelled orders awaiting disposition. History includes resolved cancellations. Mark ready, prepare and disposition all require the current version. The cancellation remains visible until the barista resolves it. Both approved and denied requests remain in the permitted users' approval history.

## Costs and financial attention

Reports add `cancellationCostCentavos`, `cancellationsWithUnresolvedCost`, `cancelledOrdersAwaitingDisposition`, `cancelledPaymentsAwaitingRefundCentavos` and `cancelledPendingPaymentCentavos`.

Unsettled ready cancellations contribute the original immutable consumption cost as a cancellation loss on the cancellation's Manila business date. Settled ready orders retain their recorded ingredient cost in sales COGS until refund accounting supplies the appropriate adjustment. Partial preparation loss enters existing waste cost on its actual disposition date. Each physical loss enters one cost category. Operating profit subtracts the cancellation loss separately.

The report shows current unresolved dispositions and retained payment status for orders cancelled by the end of the selected period. A later disposition leaves the earlier period's release estimate in place. Unknown cancellation cost, unresolved disposition or retained confirmed/pending money suppresses all cost-derived profit outputs. Gross and net captured sales remain visible. Retained payments await reconciliation.

## Migration and verification

Schema 8 preserves schema 7 orders, approval chains, raw waste, movements, valuations and command history. Rebuilding the referenced approval and waste tables requires disabling foreign-key enforcement before the startup migration transaction. The migration performs an explicit foreign-key check before commit and reenables enforcement before service startup. A failed migration rolls back and closes the connection.

Tests must cover restart between approval and disposition, competing order versions, branch/role boundaries, multiple ingredient legs, failure rollback, ready disposal, pending external verification after cancellation and historical cost preservation. Physical preparation and payment transfers remain separate device/provider checks.
