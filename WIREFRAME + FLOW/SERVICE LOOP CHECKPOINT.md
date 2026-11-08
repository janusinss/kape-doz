# Service loop implementation checkpoint

Date: 4 November 2026, Asia/Manila. The full software goal remains active.

## Shared authority delivered

The hub now supports an operational catalogue, raw-material receiving quantities, assigned shared drawers, shift opening, server-priced orders, pending and verified split tenders, kitchen release, ready consumption, raw waste, explicit receipt requests and blind counts with manager review. Each mutation is bound to the authenticated branch, actor and originating staff device. Receipts, ledger changes, audit events and pending outbox records commit together.

Price is captured at order acceptance. Recipe quantities and version are captured at release, matching the accepted backend rule. The barista receives released tickets with preparation details and payment state, excluding financial amounts and payment references. The order feed exposes active and ready-history filters without restricting history to six tickets. External tenders retain their original payment ID when verified or rejected. Pending funds are visibly distinguished from unpaid orders.

Cash movement requires an open shift on the authenticated device's assigned drawer. Cash locks across registers while a blind count awaits review or recount. Each cash movement advances the shift version. Cash received and change are stored separately; drawer totals use the net cash allocation. Staff responses omit expected cash and variance. Manager review retains the count and decision history.

Schema 4 upgrades the new schema 3 by adding device metadata and storage-level cash integrity guards. Valid existing payments survive the upgrade. Invalid legacy cash data blocks the migration without deletion or silent reset; reconciliation is required. A future database schema is rejected without clearing its records.

## Verified service evidence

| Check | Observed result | Evidence |
| --- | --- | --- |
| Service static checking | Passed | `npm run check`, from `services/`. |
| Full service suite | 41 passed, 0 failed | [Saved service log](../scratch/service-loop-final-tests.log). |
| Loaded service coverage | 98.30% lines; 90.89% branches; 99.35% functions | Same log; CLI/server and unexecuted files are outside loaded-module coverage. |
| Persistent safety | Real SQLite rollback/reopen, device-bound replay, shared-drawer lock, aggregate bounds and migration cases pass | `services/tests/service-loop*.test.ts`, `business-migration.test.ts` and saved service log. |
| Origin policy | Allowed exact browser origin receives preflight; untrusted origins and headers are denied | `services/tests/http.test.ts`, [targeted log](../scratch/hub-origin-green.log), full service log. |

Tests use synthetic accounts, stock and payments in isolated files. A real loopback listener is included, while many HTTP assertions use Fastify's injection interface. Failure-injection cases interrupt outbox writes and verify that payment, drawer, release or consumption effects are rolled back together.

## Flutter connection delivered

The new `mobile/lib/data/hub_client.dart` sends authenticated requests to the hub, keeps sessions in memory, blocks redirects and insecure non-loopback transport, preserves caller-supplied command UUIDs, and never automatically repeats a POST. Timeouts and lost responses identify an unknown mutation outcome. Responses from an older session cannot return privileged data after account switching. A delayed logout/401 cannot erase a newer session.

A real Dart HTTP transport test starts Fastify and a file-backed SQLite database, then uses separate owner, cashier and barista clients through configuration, preparation, settlement, optional receipt, blind count and owner review. This is transport/service integration; UI journeys and physical device acceptance are separate checks.

New staff screens are under `mobile/lib/connected/`. `main.dart` now starts hub enrollment rather than a sample authenticated staff session. The enrollment asks for an explicit hub address and device credentials; they remain in memory for this slice. The Android manifest includes internet access and uses the KAPE DOZ app label.

Connected staff navigation uses the server-issued role. Cashier sees cashier work; barista sees station/waste. Manual refresh retrieves current orders and stock. No background polling or real-time push is claimed. Receipt requests remain on the payment screen and display the unconfigured adapter outcome. Instruction notes do not silently implement structured ingredient substitutions.

### Connected screen verification

The complete Flutter source suite passes 81 tests and static analysis. The tests include role-specific login/navigation, wrong PIN, sign-out, secure enrollment validation, delayed responses during session changes and dismissal of a payment dialog on 401. That last regression found a controller-lifecycle bug; dialog controllers now remain alive until the dialog route's exit transition completes.

The primary agent used the workspace Playwright runner and its target resolver against the actual Flutter web preview and a separately running Fastify hub. No browser API responses were mocked. Synthetic setup data came from an isolated fixture database. Browser logs:

- [Cashier](../scratch/connected-browser-cashier.log): enrolled-device login, shared shift opening, server-priced order, dine-in release, full cash confirmation and optional unconfigured receipt.
- [Barista](../scratch/connected-browser-barista.log): separately enrolled role, the cashier's ticket, Mark ready and ready history.
- [Blind count](../scratch/connected-browser-close.log): cashier count submission and API reconciliation showing exactly 18g consumed with zero reserved stock remaining.

Phone, tablet and desktop-width views (375/768/1280) passed horizontal-overflow checks and recorded no page or Flutter rendering errors. Final cashier screenshots are `scratch/connected-cashier-final-*.png`; barista screenshots are `scratch/connected-barista-*.png`. Both servers were stopped after verification. The web preview is software evidence; it does not prove physical Android/LAN/printer acceptance.

## Scope still required

1. Durable enrollment and pending-command storage with restart-safe reconciliation, structured product variants, amendments, cancellations, handover and recall.
2. Complete owner/manager web portal with actual account/device management, approvals, expense tracking and operating-profit reporting.
3. Weighted-average valuation, receiving pack conversions, counts, threshold alerts, refund allocation and customer/loyalty workflows.
4. Cloud synchronization, CSV migration, software backup/restore, printer adapters and candidate Android packaging.
5. Full matrix acceptance, unresolved business-policy decisions and separately recorded physical-equipment tests.

Pending outbox records are not delivered cloud events. Unconfigured print jobs are not printed receipts. The current receiving slice records input costs without claiming a completed weighted-average valuation engine. No full-system acceptance case is marked passed solely from these tests.

### Current recovery limitations

Uncertain staff mutations are held only in memory and block other mutations until retried under their original command ID. Durable pending storage, restart reconciliation and safe lock/sign-out around unresolved commands remain required before service recovery is accepted. Enrollment credentials also remain memory-only. Session expiry is enforced by the hub; an idle UI must still gain local expiration/resume handling before shared-tablet session lifecycle is considered complete.

A concurrent barista action can make an open payment dialog's version stale. The current safe recovery is Back → Refresh → reopen payment; an explicit in-dialog refresh is planned. A rejected stale command cannot change the authoritative order. This limitation is distinct from the controller-disposal defect found during 401 dismissal, which was fixed by awaiting dialog route completion before disposing its text controllers.
