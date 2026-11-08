# Hub order approvals

Cashiers submit a request from a saved order. Owners and managers review the request in the separate portal connected to the same branch hub. The hub authorizes both actions from existing sessions and records the requester and reviewer from those sessions. This contract covers a fixed order discount. The [cancellation contract](order-cancellations.md) extends the same approval inbox. Refund and loyalty approval require their own execution rules.

## Routes

| Route | Roles | Input |
| --- | --- | --- |
| `POST /api/v1/orders/:id/approvals` | Cashier | `commandId`, `expectedVersion`, `action: "discount"`, `amountCentavos`, `reason` |
| `GET /api/v1/approvals` | Cashier, manager, owner | No query fields. Cashiers receive their own requests. Managers and owners receive requests for their branch. |
| `POST /api/v1/approvals/:id/decision` | Manager, owner | `commandId`, `decision: "approve"` or `"deny"`, optional `reason` required on denial |

Amounts use whole centavos. Reasons are trimmed, required at request, and limited to 300 characters. Mutation responses contain `approval` and `commandId`. The list contains `approvals` ordered newest first. Each approval includes `id`, `orderId`, `orderNo`, `orderVersion`, `action`, `amountCentavos`, `subtotalCentavos`, `requesterId`, `requesterName`, `reason`, `requestedAt`, `status`, `decisionReason` and `decidedAt`. Timestamps are epoch milliseconds. The two decision fields are nullable. Status is `pending`, `approved`, `denied` or `stale`.

## Invariants

1. A discount must leave a positive order total. This slice supports one order-level discount before any confirmed or pending payment. A previously rejected tender is retained in history. The production rules for discount eligibility remain subject to client confirmation under D02.
2. A request records the current order version, which binds the order lines and price. Changing that version makes any pending request stale. A fresh request supersedes the prior pending request even at the same version. Same-command replay returns the stored result and preserves any newer request.
3. A decision is bound to the original request. Self-review, foreign-branch access, repeat decisions with new command IDs and stale requests are rejected. A denial requires a reason and leaves the order unchanged.
4. Approval atomically records the decision, reduces the total and increments the order version in the command transaction. Approved discounts do not change preparation, reservations or print jobs. The cashier collects the discounted amount through normal settlement. Cashier and admin order projections expose `subtotalCentavos`, `discountCentavos` and net `totalCentavos`. Barista projections omit those fields.
5. The settlement snapshot carries the discount. The sales report exposes `grossSalesCentavos`, `discountCentavos` and net `settledSalesCentavos` for settled orders. Ingredient margin uses net sales. Preexisting records migrate with zero discount.
