# Service-loop API v1

## Command reconciliation

`GET /api/v1/commands/:commandId` requires the original actor and device, or the original admin actor for commands without a device. The result is `{commandId,status:"accepted",action,acceptedAt}` for a matching receipt or `{commandId,status:"unrecorded"}` otherwise. Staff receipts created before schema 4 lack a device binding and are outside staff lookup. Unrecorded is a point-in-time observation. The original request may still be running. Reuse the original command ID and payload to retry an uncertain write. The lookup excludes the command payload and receipt body.

This is the next implementation slice of the full goal. All mutations use a UUID `commandId`; retries bind actor, authenticated device, action, target and validated payload. Responses include `commandId`. Unknown fields and claimed prices/roles/device identities are rejected. All reads and writes are scoped to the authenticated branch. Quantities use integer **milliunits** (1 g/ml/piece = 1,000); money uses integer centavos. Receipt costs are recorded; weighted-average valuation/reporting remains subsequent work and must not be represented as zero cost.

## Configuration and operational reads

| Route | Role | Payload / response |
| --- | --- | --- |
| POST `/api/v1/ingredients` | owner/manager | `{commandId,ingredientId,name,unit:'g'|'ml'|'piece'}` → `{ingredient}`. Initial quantity is zero. |
| GET `/api/v1/ingredients` | authenticated | `{ingredients:[{id,name,unit,onHandMilli,reservedMilli}]}`. No purchase-cost fields. |
| POST `/api/v1/inventory/receipts` | owner/manager | `{commandId,ingredientId,quantityMilli,totalCostCentavos,reference}` → `{ingredient}`. Persists a source-linked receipt movement. |
| POST `/api/v1/products` | owner/manager | `{commandId,productId,name,priceCentavos,recipe:[{ingredientId,quantityMilli}]}` → `{product}`. Version 1, immutable order snapshots. |
| GET `/api/v1/products` | authenticated | `{products:[{id,name,priceCentavos,version,recipe}]}`. Retail and operational fields only. |

| Route | Role | Payload / response |
| --- | --- | --- |
| POST `/api/v1/drawers` | owner | `{commandId,drawerId,name,deviceIds}` → `{drawer}`. All devices must be active in this branch and unassigned. |
| GET `/api/v1/shifts/current` | cashier | `{shift:null|{id,drawerId,status,version,openingCashCentavos,countedCashCentavos}}`. No expected cash or variance. |
| POST `/api/v1/shifts/open` | cashier | `{commandId,openingCashCentavos}` → `{shift}`. Drawer comes from the authenticated device assignment. |
| POST `/api/v1/shifts/:id/submit-count` | cashier on that drawer | `{commandId,expectedVersion,countedCashCentavos,note?}` → `{shift}`. Append a blind count; lock cash while awaiting review. |
| POST `/api/v1/shifts/:id/review` | owner/manager | `{commandId,expectedVersion,decision:'approve'|'recount'}` → `{shift,expectedCashCentavos,varianceCentavos}`. Recount remains cash-locked pending a fresh count. |

## Orders and preparation

| Route | Role | Payload / response |
| --- | --- | --- |
| POST `/api/v1/orders` | cashier | `{commandId,dineIn,table?,items:[{productId,quantity,note?}]}` → `{order}` with UUID id and branch sequence orderNo. Server resolves prices/recipe. |
| GET `/api/v1/orders` | authenticated | `{orders}`. Baristas receive released tickets only; no receipt/payment references. Includes orders beyond six visible cards. |
| GET `/api/v1/orders/:id` | authenticated, branch scoped | `{order}`. An unreleased order is not visible to a barista. |
| POST `/api/v1/orders/:id/send` | cashier | `{commandId,expectedVersion}` → `{order}`. Unpaid takeout cannot release. Repeated send cannot reserve or label twice. |
| POST `/api/v1/orders/:id/payments` | cashier | `{commandId,expectedVersion,method:'cash'|'gcash'|'card',amountCentavos,verified,reference?,cashReceivedCentavos?}` → `{order,payment}`. Confirmed allocations cannot exceed the remainder. Cash requires an open assigned drawer. External verification and reference are recorded; pending external allocations do not settle. |

| Route | Role | Payload / response |
| --- | --- | --- |
| POST `/api/v1/orders/:id/payments/:paymentId/verify` | cashier | `{commandId,expectedVersion}` → `{order,payment}`. Confirms the original pending external tender after merchant verification; does not create a second allocation. |
| POST `/api/v1/orders/:id/payments/:paymentId/reject` | cashier | `{commandId,expectedVersion,reason}` → `{order,payment}`. Rejects only an unconfirmed pending tender, preserving its history. Confirmed tenders require the later approved refund/correction flow. |

| Route | Role | Payload / response |
| --- | --- | --- |
| POST `/api/v1/orders/:id/ready` | barista | `{commandId,expectedVersion}` → `{order}`. Requires release; consumes snapshot recipe and releases reservations once. |
| POST `/api/v1/orders/:id/receipt` | cashier | `{commandId,expectedVersion}` → `{job:{id,orderId,type:'receipt',status:'unconfigured'}}`. Only fully paid; explicit request, never automatic at settlement. |
| POST `/api/v1/waste` | barista | `{commandId,ingredientId,quantityMilli,reason,note?}` → `{waste:{id,ingredientId,quantityMilli,reason,note}}`. Raw ingredient waste only; ready-drink disposal must not use this to deduct twice. |

Operational order shape: `{id,orderNo,version,acceptedAt,releasedAt,dineIn,table,lines:[{productId,name,quantity,unitPriceCentavos,note}],released,ready,paymentState,hasPendingPayments,kitchenState,totalCentavos,paidCentavos,payments}`. Cashier/admin payments contain `{id,method,amountCentavos,status,reference,cashReceivedCentavos,changeCentavos}` for restart review. Barista projections omit payments, totalCentavos, paidCentavos and line unitPriceCentavos, but retain paymentState and preparation details. Pending funding is summarized as `pending_verification` until fully paid; fully paid orders can still expose `hasPendingPayments:true` for outstanding attempts needing reconciliation. A version is incremented only on accepted order changes. Stable retries return the original response, even after later order changes; changed-payload or changed-actor reuse conflicts.

GET orders accepts only optional `status=active|ready|all`. Default is active for barista, all for cashier/admin. Active barista tickets are released and not ready; history contains released ready tickets. Sort by hub acceptedAt then orderNo. Queue timers use hub acceptedAt; tablets do not supply timestamps. Price is frozen at order acceptance. Recipe/BOM quantities and the recipe version are captured when released, as selected in the backend specification. Kitchen policy is frozen on the order at acceptance (dine-in explicit-send, takeout after-payment). Later recipe work must preserve this distinction.

Cash receipt allocation records amount received and change independently of sale revenue. The cash ledger records the net allocation, not over-tender. Every cash movement increments the shift version. An unverified external reference cannot release takeout; duplicate active or confirmed references for the same branch/method require review. Confirm the original pending payment by ID instead of adding a confirmed copy. On full settlement, release an unsent order once; an already released order is not re-reserved or re-labeled. Validate aggregate order totals against the money ceiling, and every stock, reservation and drawer update with safe-integer arithmetic before committing it.

An external tender saved without verification shows as pending in the cashier app. Receipt printing becomes available after full confirmed payment. The connected client checks the payment acknowledgment against the command, expected next order version, tender details and returned totals before clearing its recovery journal. An inconsistent reply keeps the original command for reconciliation.

The first printed-job adapter remains unconfigured. Kitchen release creates one unconfigured label job; it does not claim physical printing. Ready consumes inventory even if recorded stock becomes negative. No costing/margin result is produced by this quantity slice. Synthetic catalogue prices are test data; invoice/tax configuration and live-sale approval remain open. Schema 4 adds device metadata and cash validation to schema 3 without deleting records; invalid legacy cash blocks that migration for explicit reconciliation instead of silently repairing it.
