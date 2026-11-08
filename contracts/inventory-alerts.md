# Inventory thresholds and shortage warnings

Owners and managers configure a low-stock threshold in the ingredient's canonical unit. A missing or cleared threshold stays unconfigured. Low stock means physical on-hand quantity is at or below the configured threshold. A separate shortage condition exists whenever physical stock minus active reservations is negative. Staff shortage warnings consider the recipe and other outstanding reservations. A shortage warning permits the normal order action.

## Lifecycle and authority

The hub evaluates conditions within the transaction that changes stock, reservations or thresholds. Each branch/ingredient/condition has at most one active incident. Acknowledging an incident records the administrator and note. The condition remains active. Changed quantities update the same incident and its version. Replenishment, released reservations or an authorized threshold change resolves a cleared condition. If it recurs, a new incident preserves the prior episode.

Read requests leave the ledger and alert history intact. Migration seeds existing negative availability as a legacy incident with an unknown original occurrence time. It does not fabricate an employee or order. All administrative alert/configuration endpoints require the authenticated owner or manager's branch. Staff receive operational ingredient names, units and quantity shortfalls.

## Staff warning calculation

For a cart or unreleased order, aggregate recipe quantities and compare them with on-hand stock minus all outstanding reservations. After release, use the order's captured, unconsumed reservation and subtract other orders' reservations from stock. This avoids counting the ticket's own reservation twice. Ready and cancelled tickets have no live warning. Accepted released-order warnings and the shortage immediately before Ready retain their source order, command, phase and quantities. They form audit evidence alongside the deduplicated incident.

The optional `order.shortages` array contains `ingredientId`, `name`, `unit`, `requiredMilli`, `availableMilli` and `shortfallMilli`. A positive shortfall equals required quantity minus available quantity. Quantities use exact integer thousandths and can represent negative availability. Older saved projections without the array remain readable.

## API

`GET /api/v1/inventory/alerts` returns thresholds, alert incidents, `nextCursor` and `evaluatedAt`. The latter is the hub clock at the read. After a backward clock correction, incident transition times retain their logical order and can appear later than that read time. The optional status is `active` or `resolved`. An optional `before` UUID continues a page of 50 incidents ordered by opening time and ID. Each ingredient has threshold version zero until first configuration. `GET /api/v1/inventory/alerts/:id/history` returns the selected incident's events and linked order shortage observations.

`POST /api/v1/inventory/thresholds/:ingredientId` takes a command UUID, expected configuration version, nullable threshold and a reason. `POST /api/v1/inventory/alerts/:id/acknowledge` takes a command UUID, expected incident version and a note. Exact retries reuse the original response. Changed payload reuse and stale versions conflict. Business effects, condition transitions, source observations, receipts, audit and outbox commit together.

Threshold changes preserve the previous and new values, actor, reason, time and command in an append-only history even when no alert condition changes. `GET /api/v1/inventory/thresholds/:ingredientId/history` returns 50 entries in descending configuration version with an optional `beforeVersion` cursor.

Schema 15 preserves thresholds and incidents created under schema 14. It begins recording threshold-change history for new commands. Earlier reasons that were not stored remain unavailable.

Alert versions advance on quantity, threshold, acknowledgment and resolution changes. A repeated evaluation of the same condition updates its evaluation time. The threshold version advances on each accepted configuration. An acknowledgment does not close an incident. The dashboard is the initial notification channel selected in the backend requirements.
