# Monetary refunds and tender returns

Cashiers request a specific amount against saved order lines and a current order version. Owners or managers approve a split across the original confirmed tenders. Each leg reserves its amount until completed or explicitly voided. A request and an approval both preserve the original payment records. Physical ingredient disposition remains in the cancellation workflow.

## API

| Route | Roles | Input |
| --- | --- | --- |
| `GET /api/v1/refunds` | Cashier, manager, owner | Branch refund list. Cashiers see their requests and approved work available to the branch. |
| `POST /api/v1/orders/:id/refunds` | Cashier | `commandId,expectedVersion,amountCentavos,lineNumbers,reason`. Line numbers are zero-based saved order line references. |
| `POST /api/v1/refunds/:id/decision` | Manager, owner | `commandId,decision,reason?` plus `allocations:[{paymentId,amountCentavos}]` for approval. Denial requires a reason and excludes allocations. |
| `POST /api/v1/refunds/:id/legs/:legId` | Cashier for cash, manager/owner for external evidence and recovery | `commandId,expectedVersion,action,note?,reference?`. Version belongs to the leg. |

Amounts use integer centavos. Reasons and notes contain 1–300 trimmed characters. References contain 1–120 characters. Every successful mutation returns `{commandId,refund}`. The list returns `{refunds}`.

The refund includes `id,orderId,orderNo,orderVersion,requesterId,requesterName,requestedAt,amountCentavos,reason,status,decidedAt,decisionReason,lines,tenders,legs`. Request status is `pending,stale,denied,approved`. Lines preserve `lineNo,name,quantity,unitPriceCentavos`. Tenders contain `paymentId,method,amountCentavos,reference,refundableCentavos`, including exhausted original tenders. Each leg contains `id,paymentId,method,amountCentavos,version,status,reference,note,completedAt`. Nullable references, notes and completion timestamps remain explicit.

## Authority and capacity

A new pending request supersedes an older pending request on the order. Exact replay returns the original receipt. The request records whole saved line quantities as evidence. It does not allocate original discounts to units. Current eligibility covers settled or cancelled orders with confirmed money. Production item eligibility, statutory tax treatment and discount allocation require remaining D02/D05 decisions. The latest user decision (6 November 2026) requires a manager decision for each refund-related points adjustment, superseding automatic proportional/rounded posting. Linked loyalty adjustment cases and exact eligibility/caps remain implementation work.

Approval requires the bound order version and exact allocation sum. Each payment's capacity is its original confirmed amount minus completed and reserved nonvoided legs. Pending external payments cannot be allocated. Manager approval and reservation are atomic. Completed and unknown legs retain their identities across restarts. Already approved legs remain executable when another leg changes the order version.

## Leg actions

- `record_cash` records cash physically handed back by a cashier through an enrolled register. It requires that register's assigned open drawer, sufficient recorded cash, and a pending cash leg. The debit belongs to the actual paying shift and retains the original order and tender references.
- `confirm_external` records merchant-side confirmation and a reference for a pending or unknown external leg. It records evidence from the café's existing provider app or terminal. A completed external reference is unique within its branch and method.
- `mark_unknown` preserves a pending external leg when merchant evidence is inconclusive. `mark_failed` records a failure for a pending or unknown external leg.
- `retry` returns a failed external leg to pending under the same leg ID. `void` releases a failed external leg after a manager records evidence of no payout. A manager can void a pending cash leg with confirmation that cash was not paid.
- Unknown legs retain their reservations and require explicit merchant confirmation or failure evidence. Completion is immutable. Replayed commands return their original result. New commands with an old leg version are rejected.

Cash payout, its debit, leg completion, order/shift versions, command receipt, audit and outbox commit together. Closing locks refund cash movement across every register sharing the drawer. Staff views exclude expected drawer cash and variance.

## Reports

Reports preserve captured gross and discounted settlements. `refundCentavos` totals completed legs attributable to settled sales by completion's Manila business date. `returnedUnsettledCentavos` records returned deposits and later overpayments separately. `netSalesCentavos` equals captured settled sales minus revenue refunds in the period and can be negative. Original ingredient consumption and settlement dates stay attached to their original records. Net sales at or below zero has undefined margin.

Completed legs reduce cancelled payment attention. Pending, failed and unknown legs remain visible. `refundsWithUnknownAttribution` counts completed legs whose legacy settlement evidence is insufficient. `unknownRefundLegs` counts currently unknown payout legs approved through the report end date. Either flag makes profit unavailable. New settlements explicitly link their original payment IDs. Legacy attribution uses preserved creation/verification command order when sufficient. Loyalty reversal/restoration and physical/provider checks remain separate acceptance work.
