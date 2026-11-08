# Physical stock counts

Owners and managers open, submit, review and value counts in the admin Inventory workspace. Each ingredient can have one open or submitted count. Cashier and barista accounts retain their existing quantity projections and cannot read count evidence or costs.

## Quantity and approval

The hub saves the ingredient's unit, physical balance and latest movement sequence when the count opens. Movement sequences change for receiving, ingredient use, waste and quantity adjustments. Reservations affect availability but leave this sequence alone. An observation uses the original unit and a nonnegative integer number of thousandths. If any physical movement happened since the count opened, discard the stale count with a reason and start a fresh one. This applies even if stock returned to the same quantity.

An accepted observation freezes the variance. Approval posts the difference between the observed quantity and the original balance to the current ledger, so a later receipt or use remains accounted for. Approval and discard require a reason. A zero variance records the decision without a stock movement. A negative variance can leave the live ledger negative. Each adjustment links to its count and command. The hub persists the decision, movement, valuation, audit and outbox together.

## Valuation

A decrease uses the moving average of the stock available when the adjustment posts. An unsupported basis leaves the movement cost unknown. Count shortages appear as a separate stock-loss cost in the Manila date range containing the adjustment. The report sums microcentavo values before rounding the period total. Estimated operating profit deducts the stock loss once. Unknown loss values keep that estimate unavailable. A positive variance does not create sales income.

A positive adjustment posts quantity immediately and shows cost pending. The manager confirms the total cost of the added stock with an evidence reference. If the pre-adjustment balance had a known value and only known receipts or confirmed gains followed, the hub restores the prospective carrying value. Multiple gains in the same unresolved balance must all have confirmed costs.

An outgoing movement at unknown cost, a shortage crossing, or an unknown opening value can make the remaining stock value impossible to derive. When all gains in that unresolved balance have confirmed costs, a manager can separately confirm the total value of the whole current balance. The submission binds the count version and current stock movement sequence. If stock moves, the manager must review the new quantity before confirming. Depletion to zero ends the prior valuation period. A late confirmation still records the old gain's cost without adding it to newer stock.

The count movement's original valuation, existing release estimates, sale consumption and waste costs stay as recorded. A prospective carrying value applies to later operations. Historic periods with missing costs still show those costs as unresolved.

## API

All routes require an owner or manager session in the count's branch. All POST requests carry a UUID `commandId`. Exact retries return the original receipt, with the journal reconciled against a fresh projection. A different payload under the same ID conflicts. Each count transition after start requires `expectedVersion`.

| Method and path | Fields besides command and version |
| --- | --- |
| GET `/api/v1/inventory/counts` | Returns `{counts}` |
| POST `/api/v1/inventory/counts` | `ingredientId`. Start does not take a version. |
| POST `/api/v1/inventory/counts/:id/observe` | `unit`, `observedMilli` |
| POST `/api/v1/inventory/counts/:id/decide` | `decision` of `approve` or `discard`, `reason` |
| POST `/api/v1/inventory/counts/:id/confirm-cost` | `totalCostCentavos`, `reference` for the gain |
| POST `/api/v1/inventory/counts/:id/revalue` | `expectedStockVersion`, `totalCostCentavos`, `reference` for all live stock |

POST returns `{commandId,count}`. The projection includes the snapshot, observation, decision, gain cost status, live physical stock and whether a whole-balance confirmation is available. Currency values use integer Philippine centavos. The ledger stores carrying value in integer microcentavos.
