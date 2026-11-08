# Sent-order amendments

The cashier can change a released order until it is Ready or cancelled. Each command identifies the saved order version and records a reason. A note can change without changing prices, including on a paid ticket before Ready. Item additions, replacements and quantity changes use server pricing and are limited to orders with no confirmed or pending tender and no applied discount. A price-changing correction after payment requires the existing manager cancellation or refund flow followed by a new order. Removing the last line uses whole-order cancellation.

Additions, quantity increases and notes are sent to the station directly. Removing, replacing or decreasing a line requires a manager decision against the exact saved terms. A newer order version makes an undecided request stale. The record preserves the before/after line snapshots, requester, decision, reason and timestamps. Retired lines keep their number and historical recipe. New lines receive a new number and a captured product/recipe version.

A queued change updates the ticket immediately and waits for station acknowledgment. A change during preparation stays staged until the barista checks the affected work. The barista can record the actual discarded ingredients from the affected original recipe. The hub posts the waste and applies the line/reservation changes in one transaction. Ready is blocked until acknowledgment. New tenders are blocked while a staged price change could alter the amount due. Approved whole-order cancellation supersedes unresolved changes and retains the disposition of the lines actually in preparation.

The initial release and label remain the same. Active reservations reconcile to the revised recipe. Unchanged estimates keep their values. Consumed or settled history remains in its original ledger. The station receives before/after preparation details without prices. The command receipt fences delayed retries and the original order version prevents an outdated Ready or manager approval from completing.

| Route | Permission | Result |
| --- | --- | --- |
| `POST /api/v1/orders/:id/amendments` | Cashier | Requests or applies one `add`, `quantity`, `remove`, `replace` or `note` operation. |
| `GET /api/v1/amendments` | Manager or owner | Manager-reviewed requests with awaiting, denied, stale, station and resolved outcomes. |
| `POST /api/v1/amendments/:id/decision` | Manager or owner | Approves or denies the saved terms with a reason. |
| `POST /api/v1/orders/:id/amendments/:amendmentId/acknowledge` | Barista | Records acknowledgment and any measured discarded use against the current order version. |
| `GET /api/v1/orders/:id/amendments` | Authenticated branch role | Returns scoped amendment history. The barista sees only accepted work. |

Edits after Ready, remakes, and structured recipe modifiers have separate acceptance work. Historical proof still requires the persistent service and rendered cross-role scenarios in F02-03, F03-04 and X02.
