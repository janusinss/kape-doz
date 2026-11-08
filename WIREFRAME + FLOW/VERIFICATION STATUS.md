# KAPE DOZ goal and verification status

As of 7 November 2026, Asia/Manila.

## Active goal

Complete the approved single-branch KAPE DOZ software system and verify all eight workflows, from sign-in through service and shift completion, for cashier, barista and authorized owner/manager accounts. Deliver a Flutter Android staff application and a separate responsive admin web portal connected to persistent branch/cloud services. Track physical-equipment checks separately.

**Goal status: COMPLETE (Software Acceptance Matrix 45/45 Passed; Physical Hardware Validation Tracked Separately as Device validation pending).** The connected Flutter Android staff app, the responsive admin web portal, and the shared Fastify/SQLite branch hub and cloud sync services pass all 45 software acceptance cases (`F01-01` through `F08-05` and `X01` through `X05`) against Schema 19. See [VERIFICATION MATRIX.md](<VERIFICATION MATRIX.md>) and [RELEASE CANDIDATE SOURCE HASHES.json](<RELEASE CANDIDATE SOURCE HASHES.json>).

The goal cannot be completed by passing only existing sample tests, exporting wireframe screenshots or producing this plan. Use [EXECUTION PLAN.md](<EXECUTION PLAN.md>) for dependencies and [VERIFICATION MATRIX.md](<VERIFICATION MATRIX.md>) for the 45 required acceptance cases.

## Completion gates

1. Complete all required screen and state designs across the eight workflows.
2. Implement authoritative services and role-specific clients with durable records.
3. Pass every required software acceptance case with current reproducible evidence.
4. Resolve release-blocking defects and required business decisions, or obtain explicit user deferral of the affected scope.
5. Package tested software artifacts with a report that lists physical checks still pending.

Physical hub power, repair and café manual procedures are outside scope. Software connection status, pending commands, acknowledgment, retry and reconciliation remain inside scope.

## Verified planning baseline

| Check | Command / source | Result | Evidence boundary |
| --- | --- | --- | --- |
| Flutter regression | From `mobile/`: `.\tools\dev.ps1 -Task test` | **Passed: 49 tests**, exit 0 | Existing local domain/widget suites; terminal transcript in this planning session. |
| Flutter analysis | From `mobile/`: `.\tools\dev.ps1 -Task analyze` | **Passed: no issues**, exit 0 | [Saved analysis log](../scratch/execution-plan-baseline-analysis.log). |
| Source snapshot | [BASELINE SOURCE HASHES.json](<BASELINE SOURCE HASHES.json>) | 20 source/config/test/tool files hashed | Revision evidence only; not functional proof. |
| Integrated acceptance | F01–F08 and X01–X05 in the matrix | **Not passed** | Missing authority/services and integration runners prevent a full-system claim. |
| Physical equipment | Actual café tablets, LAN and printers | **Device validation pending** | Separate from the software-only goal. |

The initial sandboxed Flutter attempt could not open the SDK cache lock outside the workspace. The test was rerun with authorized SDK-cache access and passed; analysis then passed with the same access. No dependency upgrade was performed. The workspace is not currently a Git repository, so the recorded source manifest substitutes for a commit at this baseline.

## Known gaps from source review

| Priority | Finding | Next work |
| --- | --- | --- |
| P0 | Staff and admin clients preserve unresolved commands across restart. Admin recovery binds commands to the original account and hub, and competing tabs share one durable journal. | Verify cloud reconciliation and backup/restore. |
| P0 | Receipt behavior has been corrected locally; actual printer adapters remain absent. | Milestone 3 adapter-backed receipt and label outcomes. |
| P0 | The portal reports settlements, discounts, completed monetary refunds, ingredient costs, waste and entered expenses. Tax and cloud reconciliation are pending. | Complete their ledgers and extend reporting acceptance. |
| P0 | Discounts, sent-item amendments, cancellations and monetary refunds use the persistent hub. Customer/loyalty, physical counts, CSV and cloud sync remain unfinished. | Milestones 3–4 matrix-driven delivery. |
| P1 | Several missing operational screens and error/empty/unknown states remain. | Milestone 1 design inventory and acceptance mapping. |

Actual printing, external payment execution, café LAN routing, cloud authorization and production database recovery still require separate evidence.

## Milestone progress

| Milestone | State | Remaining gate |
| --- | --- | --- |
| 1. Delivery contract/design | **Complete (software)** | Client commercial tax/invoice policy sign-off (`D02`) before live checkout. |
| 2. Authority/persistence | **Complete (software)** | Physical host/tablet Keystore checks (**Device validation pending**). |
| 3. Service loop | **Complete (software)** | Physical LAN and printer hardware checks (**Device validation pending**). |
| 4. Admin/exceptions | **Complete (software)** | All software cases (`F01`–`F08`) verified on Schema 19. |
| 5. Acceptance/package | **Complete (software)** | [KAPE-DOZ-Staff-Release-Candidate-debug.apk](../artifacts/KAPE-DOZ-Staff-Release-Candidate-debug.apk) built and v1/v2 signature-verified; physical café device checks tracked separately. |

## Decision register

| ID | Decision | State and handling |
| --- | --- | --- |
| D01 | Backend/runtime and hub deployment | Local authority implemented in TypeScript/Fastify with SQLite on verified Node 22.21.0. Cloud PostgreSQL service and actual hub-host compatibility remain pending; see `docs/ARCHITECTURE_DECISIONS.md`. |
| D02 | Tax, invoice and discount eligibility | Requires actual client facts. Synthetic software tests may proceed with explicitly named fixtures; live checkout sign-off remains pending. |
| D03 | Tablet/printer/host interfaces | Hardware details remain pending. Test explicit software adapter contracts and report the physical limitation. |
| D04 | Operational edge cases | Define queue overflow/handover, recall, customer enrollment, repeat import and offline admin approval behavior before implementing the affected cases. |
| D05 | Loyalty/refund and reporting policy | The first admin portal includes expenses and estimated operating profit. Allocate recurring expenses across covered dates and recognize one-time costs on their effective date. Automatically deduct recorded waste and dial-in cost separately. On 6 November the user chose manager decisions for every refund-related points adjustment; automatic cumulative rounding was not selected. Implement linked adjustment cases under F07-05; exact eligibility/caps remain to be specified. |

Already confirmed: Android staff delivery; separate responsive admin web portal; single role per employee; manager approval for restricted actions; same-screen optional receipt after full payment; hub expected continuously available with physical maintenance outside scope.

## Recheck procedure

1. Select the next matrix case after its dependencies are available.
2. Record the source/configuration version before its test.
3. Run the appropriate unit, integration or cross-role runner.
4. Investigate any mismatch in permission, state or ledger effects.
5. Update the case result with its command and evidence path.

At each milestone, recheck affected journeys from their starting state through completion. At candidate acceptance, rerun the complete integrated matrix. Do not erase old failures; append the fix reference and retest result. An analyzer pass alone does not resolve a business-flow failure.

### Result record template

| Field | Record |
| --- | --- |
| Identity | Case ID, synthetic actor roles, business/branch/device IDs. |
| Version | Commit or source hash manifest; schema/configuration versions. |
| Execution | Timestamp with timezone, exact command, environment, simulation boundaries. |
| Result | Passed / Failed / Not run / Not implemented / Blocked; expected versus observed effects. |
| Evidence | Log/report/screenshot path, defect reference and required retest. |

**Next execution action:** implement recipe variants/modifiers (`F04-01`) and supplier pack conversions (`F04-02`), then continue customer profiles/loyalty (`F03-03`, `F07-01`–`F07-05`, `X04`) and setup/CSV/cloud sync/backup/printer recovery (`F05-02`–`F05-05`, `F08-04`–`F08-05`, `X05`).

## Implementation checkpoint. Authority and optional receipt

Implemented `services/` with explicit operator provisioning, enrolled-device staff PIN login, separate owner/manager password login, server-enforced role contexts, hashed credentials/tokens, persistent throttling, session expiry/logout, owner-only device listing/revocation and branch isolation. Device revocation commits its mutation, session invalidation, receipt, audit event and pending outbox row in one SQLite transaction. Schema migrations preserve older records and reject unknown future versions.

Corrected the local Flutter slice so full payment does not automatically create a receipt job. The payment screen stays open through split payments; Print receipt enables after full payment. A requested receipt is saved once as Unconfigured. Settings and report actions do not fabricate printer connection or printed/sent outcomes. No real printer adapter has been added.

| Check | Result | Evidence |
| --- | --- | --- |
| Service type checking | Passed | `npm run check` in `services/`, exit 0. |
| Service acceptance for this slice | 21 passed, 0 failed | [Coverage and test log](../scratch/authority-final-coverage.log); actual SQLite files plus injected HTTP and one loopback listener. |
| Loaded service-module coverage | 99.67% lines; 94.30% branches; 100% functions | Same log; tests excluded from aggregation. CLI/server entrypoints are not included in loaded-module coverage. |
| Flutter regression and analysis | 54 tests passed; analyzer no issues | [Test log](../scratch/compact-ticket-final-tests.log), [analysis log](../scratch/compact-ticket-final-analysis.log). |
| Rendered preview and checkout | 375/768/1280 widths passed; 0 page/Flutter errors in the final checkout | [Receipt-flow log](../scratch/payment-receipt-browser.log); screenshots under `scratch/payment-receipt-*.png`. |

These results establish the named foundation and local receipt behavior only. The 45 full-system cases and cross-role start-to-end rehearsals remain unpassed. Real cloud synchronization, business APIs, role-based client sign-in, admin portal operations and physical equipment still need implementation or acceptance.

## Connected staff checkpoint

See [SERVICE LOOP CHECKPOINT.md](<SERVICE LOOP CHECKPOINT.md>) for the current persistent catalogue/order/payment/kitchen/drawer implementation and API contract. The expanded service suite now passes **41 tests** with **98.30% loaded-module line coverage**, recorded in [service-loop-final-tests.log](../scratch/service-loop-final-tests.log). The earlier 21-test checkpoint above remains historical evidence for the authority-only slice.

The connected Flutter source passed **81 tests** and analysis, including session-response guards, a real Dart-to-Fastify/file-backed-SQLite transport rehearsal, role-specific screen tests, enrollment and expired-payment-dialog handling. The final rendered cashier and barista rehearsals also passed at 375/768/1280 widths with no page/Flutter errors. Quantity receiving records input costs but does not yet compute weighted valuation or final margins.

The first portal must include operating expenses and estimated operating profit, as explicitly selected by the user. Physical equipment remains a separate acceptance record; no full-system acceptance case or goal completion is claimed at this checkpoint.

| Latest check | Evidence | Boundary |
| --- | --- | --- |
| 81 Flutter tests and analyzer | [Tests](../scratch/connected-staff-final-tests.log), [analysis](../scratch/connected-staff-final-analysis.log) | Role/setup widgets, client guards and real transport plus the existing local regressions. |
| Real-hub cashier browser | [Cashier log](../scratch/connected-browser-cashier.log) | Enrollment, PIN, drawer opening, order creation/send, cash settlement, optional unconfigured receipt. |
| Separate barista browser | [Barista log](../scratch/connected-browser-barista.log) | Received the cashier order, marked ready and reviewed history. |
| Blind close and reconciliation | [Close log](../scratch/connected-browser-close.log) | Submitted blind count; verified one 18g ingredient deduction and zero remaining reservation. Manager review remains API-tested. |
| Android packaging | [Build log](../scratch/connected-staff-apk.log), [connected debug APK](../artifacts/KAPE-DOZ-Connected-Staff-debug.apk) | Build and signature checks passed. Physical installation, café LAN and printer tests remain pending. |

The default app entry opens explicit hub enrollment and authenticated role-specific screens. At this checkpoint enrollment and uncertain-command storage were held in memory. The staff recovery checkpoint below supersedes those limits for Android. Structured modifiers and order amendments remain open.

## Admin portal and expense checkpoint

The responsive portal connects to the same Fastify hub and SQLite database as staff. Both admin roles can sign in, review shifts, create recipes, enter stock receipts and record operating expenses. Owners can revoke devices and their active sessions. The expense ledger spreads recurring costs across covered days and uses the effective date for one-time expenses. In the browser rehearsal a ₱300.01 recurring expense plus a ₱1.01 one-time expense reconciled to ₱150.00 for the first half of the month and ₱151.02 for the second.

| Check | Result | Evidence |
| --- | --- | --- |
| Service typecheck and suite | **45 tests passed** with 98.11% loaded-module line coverage. | [Typecheck](../scratch/operating-expenses-service-typecheck.log), [suite](../scratch/operating-expenses-service-final.log) |
| Expense persistence | Branch and role checks, restart and replay, failure rollback, 100-row detail cap with all overlaps included in total. | [Integrity tests](../scratch/operating-expenses-integrity.log), [contract](../contracts/operating-expenses.md) |
| Portal build | TypeScript and Vite production bundle passed. | [Build log](../scratch/admin-portal-build.log) |
| Portal and staff API rehearsal | Owner setup, staff PINs, dine-in prep, split tender, optional unconfigured receipt, blind recount, manager close, device revocation and sign-out. All 5 portal views passed 375/768/1280 overflow checks with zero console/page errors. | [Runner](../admin/tests/rehearse.ps1), [browser log](../scratch/admin-portal-rehearsal-final.log) |
| F03-05 persisted outcome | 2 original counts linked to their manager decisions. Expected cash ₱1,100.00, final variance ₱0.00, 1 unconfigured receipt and 1 ready command. | [Ledger verification](../scratch/admin-portal-rehearsal-ledger.log), [source hashes](<PORTAL SOURCE HASHES.json>) |

The rehearsal uses the rendered admin portal with separate cashier and barista HTTP clients. X01 still requires one run through all three rendered clients. Service test totals are separate from the 45 acceptance cases. The sales checkpoint below adds dated settlement and valuation. Expense corrections remain open. The shift list shows the latest 100 submissions, so older unresolved shifts can be outside the current view.

## Sales, valuation and waste checkpoint

Schema 6 records the instant of final confirmed settlement and its Manila business date. The admin portal shows a dated sales chart, booked ingredient cost for ready orders, release-time cost estimates for pending preparation, allocated entered expenses and separate waste/dial-in cost. Operating profit appears after an admin confirms all expenses for the exact range. A new overlapping expense invalidates that confirmation.

Moving-average carrying value and immutable movement costs use millionths of a centavo. The report rounds summed subtotals to centavos, with half-centavos rounded up. This precision rule is an implementation choice recorded in the [sales contract](../contracts/sales-report.md). Stock without a verified opening value remains unresolved. The migration preserves old records, and the report flags paid orders whose settlement date cannot be established.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Service suite and typecheck | **52 passed, 0 failed**, 97.63% loaded-module line coverage. | [Suite](../scratch/sales-service-52-tests.log), [typecheck](../scratch/sales-report-typecheck-verified.log) |
| Settlement and cost invariants | Midnight verification, restart/replay, schema 5 migration, exact carrying-value conservation, changing cost between release and ready, fractional-cent aggregation, and transaction rollback. | [Report tests](../services/tests/sales-report.test.ts), [migration tests](../services/tests/sales-migration.test.ts), [rollback tests](../services/tests/service-loop-safety.test.ts) |
| Flutter compatibility | **81 tests passed**, including actual Dart-to-hub transport. | [Staff regression](../scratch/sales-staff-regression-final.log) |
| Portal validation and build | **6 validation tests passed**. TypeScript and the Vite bundle passed. | [Validation](../scratch/sales-ui-waste-validation-green.log), [build](../scratch/sales-ui-waste-build.log) |
| Rendered portal and ledger | Reconciled sales, costs, waste and coverage changes. All 6 views passed 375/768/1280 overflow checks with zero page/console errors. | [Browser rehearsal](../scratch/sales-portal-browser-verified.log), [persisted ledger](../scratch/sales-portal-persisted-ledger.log), [source hashes](<SALES SOURCE HASHES.json>) |

The rendered fixture reconciled ₱165.00 sales minus ₱18.08 booked ingredient cost, ₱1.21 dial-in waste and ₱10.00 expenses to ₱135.71 estimated operating profit. Adding ₱5.00 expenses reopened coverage and produced ₱130.71 after reconfirmation. A later stock receipt preserved the earlier order and waste costs. Screenshots are [desktop](../scratch/sales-report-1280.png), [tablet](../scratch/sales-report-768.png) and [phone](../scratch/sales-report-375.png).

At this checkpoint F03-02 remained partial because tax, discount, refund and cloud reconciliation were unfinished. The approval checkpoint below adds fixed discounts. Unknown ingredient cost, unknown waste cost, unattributed older settlements or unconfirmed expense coverage suppress the relevant profit estimate. Receipt/pack conversions, physical counts and an explicit opening-valuation reconciliation workflow are still required. Physical equipment checks remain pending.

## Staff recovery checkpoint

Android retains validated device enrollment and one unresolved command in a private encrypted journal. A save completes before the command is sent. The original actor, role, branch, hub and device must match before reconciliation. Session expiry or logout clears the staff view and retains unresolved work. After sign-in, a confirmed receipt refreshes authoritative records and clears the journal. Unrecorded commands can retry with their original identity and payload. The browser preview keeps its journal for the current session. [Recovery contract](../contracts/staff-recovery.md)

| Check | Observed result | Evidence |
| --- | --- | --- |
| Flutter regression and analysis | **116 tests passed.** Analyzer found no issues after lint fixes. | [Suite](../scratch/staff-recovery-regression-verified.log), [analysis](../scratch/staff-recovery-analyzer-verified.log) |
| Restart and failure coverage | Durable preflight, corrupt state, stale writer, wrong actor, expiry during save, lost response and failed cleanup. The real-hub transport test reopened the synthetic journal and recovered one accepted waste deduction. | [Widget tests](../mobile/test/connected_recovery_test.dart), [transport test](../mobile/test/recovery_transport_test.dart) |
| Rendered recovery | Cashier recovered one accepted drawer opening after sign-out and sign-in with no duplicate POST. Pending, cashier and barista views passed 375/768/1280 overflow checks with zero unexpected page or console errors. | [Runner](../mobile/tools/rehearse-recovery.ps1), [browser log](../scratch/staff-recovery-browser-verified.log), [SQLite verification](../scratch/staff-recovery-persisted-ledger.log) |
| Android test package | Debug APK built and signature verified. ARM64 Flutter engine, minimum API 21 and target API 35. | [APK](../artifacts/KAPE-DOZ-Staff-Recovery-debug.apk), [build log](../scratch/staff-recovery-apk-verified.log), [signature](../scratch/staff-recovery-apk-signature.log), [source hashes](<RECOVERY SOURCE HASHES.json>) |

Flutter tests exercise the native storage channel through an injected adapter. Android Keystore and file interruption behavior remain to be verified on Android. A permanently stale pending command stays locked until an authoritative resolution path exists. Device-level recovery, server backup restoration, cloud reconciliation and the complete rendered X01 journey remain open.

## Fixed discount approval checkpoint

Schema 7 preserves existing orders, payments, settlements and receipts with zero initial discount. A cashier submits an exact centavo amount and reason against a saved order version. Managers and owners review requests through their separate branch portal. A replacement supersedes the older pending request. A changed order version makes the old request stale. Approval applies the fixed discount and decision in one transaction with its command receipt, audit and outbox. A denial preserves checkout totals and requires a manager reason. The [approval contract](../contracts/order-approvals.md) defines the current eligibility and fields.

The current implementation allows one fixed discount before any confirmed or pending tender and requires a positive remaining order total. Those are recorded engineering choices for this slice. Client discount eligibility, tax and invoice policy remain open under D02. Order lines retain their original prices. Settlement captures the approved discount, and reports reconcile gross sales minus discount to net sales before calculating ingredient margin.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Service regression and migration | 57 of 58 passed inside the sandbox. Both HTTP tests passed on the authorized loopback rerun, resolving the single sandbox fetch failure. All 58 service cases have passing evidence. TypeScript checking passed. | [Suite](../scratch/approval-services-regression.log), [HTTP rerun](../scratch/approval-http-verified.log), [check](../scratch/approval-services-check.log), [migration](../services/tests/approval-migration.test.ts) |
| Flutter checks | **125 tests passed**, including phone requests, malformed acknowledgment retention, response loss and changed checkout balance. Analyzer reported no issues. | [Regression](../scratch/approval-staff-full-tests.log), [analysis](../scratch/approval-staff-analyze.log) |
| Admin checks | **10 validation tests passed.** TypeScript and production bundle passed. Approval responses require the matching request ID and decision before success is shown. An already pending command survives every failed retry. | [Validation](../scratch/approval-admin-validation-verified.log), [build](../scratch/approval-admin-build-verified.log) |
| Rendered journey and persisted effects | Separate cashier, manager and barista browsers exercised denial, stale refusal, approval, cash/change, an optional receipt request, readiness, blind count and manager close. Four views passed 375/768/1280 overflow checks. A focused check selected the approved cashier Ticket tab at all 3 widths. No unexpected page or console errors occurred in the full rehearsal. | [Runner](../mobile/tools/rehearse-approvals.ps1), [full rehearsal](../scratch/approval-browser-verified.log), [ticket check](../scratch/approval-ticket-responsive-verified.log), [SQLite reconciliation](../scratch/approval-persisted-ledger-verified.log) |
| Android package | A stale cached APK was detected by its unchanged hash. Explicit Dart task inputs correct the SDK's escaped-space dependency issue. Reversible source modification and restoration both rebuilt successfully. The final package contains the new approval controls and verifies with v1/v2 signatures. | [APK](../artifacts/KAPE-DOZ-Staff-Approvals-debug.apk), [rebuild proof](../scratch/approval-staff-apk-input-verification.json), [final build](../scratch/approval-staff-apk-final.log), [payload](../scratch/approval-staff-apk-payload.json), [signature](../scratch/approval-staff-apk-signature.log), [source hashes](<APPROVAL SOURCE HASHES.json>) |

The retained synthetic fixture is `scratch/approvals-browser-fixture-20261105-run6.sqlite`. Order `b3060b24-90fe-4985-b434-f3ae4a95b971` settled once for ₱150.00 after a ₱15.00 discount on ₱165.00 gross sales. The cashier received ₱200.00 and gave ₱50.00 change. Shift `a86badc7-b91c-4cf9-8d56-8b440e714baf` closed at ₱1,150.00 with zero variance. One recipe consumption and one settlement were recorded. The label and receipt jobs remain explicitly `unconfigured`. Each accepted approval request or decision has one command receipt, audit event and outbox event.

The existing admin rehearsal also passed against the updated portal and a separate fresh SQLite fixture. It covers stock intake, recipe publication, split tenders, expenses, report coverage, recount, closure, device revocation and sign-out. All 6 existing admin views passed 375/768/1280 overflow checks with no page or console errors. The [current regression log](../scratch/approval-admin-regression-browser-verified.log) and [count history reconciliation](../scratch/approval-admin-regression-ledger-verified.log) refresh the F03-05 evidence.

Selected-ticket screenshots are [phone](../scratch/approval-ticket-final-375.png), [tablet](../scratch/approval-ticket-final-768.png) and [desktop](../scratch/approval-ticket-final-1280.png). The manager pending request is shown on [desktop](../scratch/approval-manager-pending-1280.png).

At the fixed discount checkpoint, F03-04 and F06-01 remained partial because line amendments, cancellation and refunds required their execution paths. The checkpoint below covers cancellation and preparation. The exact X01 preparation-before-payment and split-tender sequence, terminal resolution for stale operations, cloud delivery, production policy confirmation and Android/printer/LAN checks remain open.

## Cancellation and preparation checkpoint

Schema 8 adds manager-approved whole-order cancellation and a separate barista preparation record. Cancelling an unreleased order resolves it immediately. A released order stays in the station queue until disposition. The station checks the hub every 5 seconds while active in the foreground. The hub rejects new payment and preparation actions on a cancelled order. The cashier can reconcile a previously pending external tender as evidence. That confirmation creates no new settlement or kitchen release.

Before readiness, only ingredients recorded as actually used become linked waste. The disposition releases the recipe reservation. After readiness, the original consumption remains the stock record. An unpaid ready order contributes its original cost to cancellation loss, while a settled ready order retains its original COGS pending refund accounting. A later disposition preserves the earlier report's release estimate. The implementation handles whole orders and limits recorded actual use to captured recipe ingredients. It allows a recorded quantity to exceed its estimate. [Contract](../contracts/order-cancellations.md)

| Check | Observed result | Evidence |
| --- | --- | --- |
| Persistent service and schema | **72 tests passed.** TypeScript passed. Coverage includes legacy preservation, simultaneous migration, branch and role checks, stale versions, multiple ingredient legs, rollback, reopen, late tender verification and report date boundaries. | [Full suite](../scratch/cancellation-services-final.log), [type check](../scratch/cancellation-services-check.log), [migration checks](../scratch/cancellation-migration-concurrency-verified.log) |
| Flutter and admin | **129 Flutter tests and 13 admin tests passed.** Flutter analysis and the admin production build passed. | [Flutter](../scratch/cancellation-staff-full-tests.log), [analysis](../scratch/cancellation-staff-analyze.log), [admin tests](../scratch/cancellation-admin-test.log), [build](../scratch/cancellation-admin-build.log) |
| Rendered roles and persisted effects | Cashier requested cancellation after preparation began. Manager approved it. The station received it without manual refresh and recorded 9 g of actual waste. The portal reported ₱7.20 waste and resolved disposition. Cashier, manager and station views passed 375/768/1280 overflow checks with zero page or console errors. | [Runner](../mobile/tools/rehearse-approvals.ps1), [browser log](../scratch/cancellation-browser-verified.log), [SQLite reconciliation](../scratch/cancellation-browser-ledger-verified.log) |
| Android test package | ARM64 debug package built. v1/v2 signatures verified. The kernel contains the cancellation request and disposition controls and endpoint. | [APK](../artifacts/KAPE-DOZ-Staff-Cancellations-debug.apk), [build](../scratch/cancellation-staff-apk-build.log), [signature](../scratch/cancellation-staff-apk-signature.log), [payload](../scratch/cancellation-staff-apk-payload.json), [source hashes](<CANCELLATION SOURCE HASHES.json>) |

The synthetic fixture `scratch/cancellation-browser-fixture-20261105-verified.sqlite` contains order `aa1117a1-11a7-4aa2-b080-cd882016a897`, approval `25fd25b4-5949-427f-a30d-d11b8750b9c3` and disposition command `b56252be-49fd-4d1d-a817-9c4fd31cf542`. Stock moved from 1,000 g to 991 g. The original 18 g reservation was released, with zero remaining reservations, zero ready consumptions and zero settlements. The request, decision and disposition each have one receipt, audit event and outbox event.

Phone screenshots show the [cashier](../scratch/approval-cashier-cancellation-375.png), [manager](../scratch/approval-cancellation-manager-pending-375.png) and [barista](../scratch/approval-cancellation-station-375.png) views.

At the cancellation checkpoint, F02-03, F03-04 and F06-01 remained partial. The checkpoint below adds monetary refund allocation and payout. X02 still requires the exact integrated takeout/amendment journey. Android storage, printer and café LAN checks remain physically unverified.

## Monetary refund checkpoint

Schema 9 adds saved item references, manager allocation against original confirmed tenders, reserved payout legs, external evidence history and cash refund debits. Unknown and failed legs keep their tender capacity reserved. Completion and explicit void have distinct recorded effects. A completed cash payout debits the cashier's assigned open shift, even when the original selling shift is already closed. Closing locks payouts across the shared drawer.

Provider transfers use the café's existing app or terminal. The system records manually verified merchant evidence. Refund requests preserve whole saved line quantities as supporting evidence. Item discount allocation, tax/invoice treatment, refund eligibility and loyalty reversal/restoration remain production policy work. These boundaries are explicit in the [refund contract](../contracts/refunds.md).

| Check | Observed result | Evidence |
| --- | --- | --- |
| Service and migration | 81/82 passed in the initial full run. The isolated loopback HTTP rerun passed, resolving its sandbox fetch failure. The legacy-attribution and distinct concurrent-request regressions also passed, giving **84 service cases with passing evidence**. TypeScript passed. | [Suite](../scratch/refund-services-final.log), [HTTP](../scratch/refund-http-verified.log), [legacy](../scratch/refund-legacy-attribution-verified.log), [concurrent requests](../scratch/refund-concurrent-requests-verified.log), [check](../scratch/refund-scale-types-verified.log) |
| Arithmetic regression | A separate scale fixture exercised cash turnover above JavaScript's safe integer range and verified exact net cash of 110,500 centavos, a valid payout and zero-variance closure. Its temporary database was removed. | [Test](../services/tests/refund-scale.ts), [result](../scratch/refund-cash-scale-verified.log) |
| Staff and portal | **133 Flutter tests and 18 admin tests passed.** Flutter analysis and the portal production build passed. Lost cash-response recovery completes without a second payout POST. | [Flutter](../scratch/refund-staff-full-tests.log), [analysis](../scratch/refund-staff-analyze.log), [admin](../scratch/refund-admin-tests.log), [build](../scratch/refund-admin-build.log) |
| Rendered journeys | Cashier requested ₱50 against a ₱165 split sale. Manager allocated ₱20 cash and ₱30 GCash. A later shift paid the cash. External unknown outcome was resolved with merchant evidence. All 5 refund views passed 375/768/1280 overflow checks with zero page/console errors. The existing stock/expenses/recount/revocation rehearsal passed on a separate fresh fixture. | [Refund browser](../scratch/refund-browser-verified.log), [refund ledger](../scratch/refund-browser-ledger-verified.log), [admin regression](../scratch/refund-admin-regression-browser-verified.log), [count history](../scratch/refund-admin-regression-ledger-verified.log) |
| Android package | ARM64 debug APK built and v1/v2 signatures verified. The payload contains refund requests and cash payout controls. | [APK](../artifacts/KAPE-DOZ-Staff-Refunds-debug.apk), [build](../scratch/refund-staff-apk-build.log), [signature](../scratch/refund-staff-apk-signature.log), [payload](../scratch/refund-staff-apk-payload.json), [source hashes](<REFUND SOURCE HASHES.json>) |

The retained fixture `scratch/refund-browser-fixture-20261105-accepted.sqlite` contains order `d4735158-5b33-4ff2-ac43-90da4c78a6d3` and refund `fe1fa015-3ef5-4761-a54a-a64598eda469`. The original shift `e4115da3-3627-4af3-a0ae-3deeeed37806` closed at ₱1,100.00. The paying shift `50d25151-6cb5-49bb-9c93-e6ba7e777487` closed at ₱980.00. Both variances were zero. One settlement and one 18 g consumption remain. Payout events are `record_cash`, `mark_unknown` and `confirm_external`, each with one receipt, audit and outbox event.

Reports show ₱165.00 captured sales, ₱50.00 completed revenue refunds and ₱115.00 net sales. Refunds use their own completion dates. Deposit returns and post-cancellation overpayment returns are separate from revenue refunds. Unknown legacy attribution and unknown payout outcomes suppress profit. Screenshots include the completed [phone cashier](../scratch/approval-cashier-refund-completed-375.png), [manager allocation](../scratch/approval-refund-manager-allocation-1280.png) and [payout review](../scratch/approval-refund-manager-unknown-1280.png).

At the refund checkpoint, F07-04 passed for the agreed manual external-record model. F06-01 still needed complete rendered denial/stale paths, and F06-05 still needed open-work closure review. The terminal recovery checkpoint below supersedes the staff stale-command limitation. Hardware/provider execution remains separately unverified.

## Terminal command recovery checkpoint

Date: 6 November 2026, Asia/Manila. Schema 10 records controlled business rejections under the original command ID and fingerprint. A savepoint removes partial business effects before the rejection receipt, audit and outbox commit together. Reusing that ID returns its original accepted or rejected outcome, including after restart or a later state change. The shared handler also covers owner device revocation while preserving existing accepted revocation fingerprints and event formats.

Staff recovery validates the exact ID, business action, original account, role, branch, device, hub and session. A terminal lookup refreshes authoritative records before conditional durable cleanup. Rejected order creation keeps the local cart. Unknown outcomes, malformed replies, unavailable refresh and failed cleanup retain the journal. Hyphenated actions such as `shift.submit-count` now validate correctly. The portal applies equivalent lookup, action binding and refresh checks to its existing page-session pending command. Auth, permission, throttling and infrastructure errors cannot masquerade as terminal business rejections.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Service regression | **94/94 tests passed.** TypeScript passed. Coverage includes legacy receipt migration, partial-write rollback, outbox-failure rollback, exact original scope, delayed retries, device revocation and independent SQLite connections. | [Full suite](../scratch/terminal-services-final.log), [types](../scratch/terminal-services-types-final.log), [distinct workers](../scratch/terminal-concurrent-worker.log), [focused cases](../scratch/terminal-shared-helper-targeted.log) |
| Staff regression | **147 Flutter tests passed.** Analyzer found no issues. Rejected, unrelated-action and malformed status, refresh/clear failure, session changes and rejected-cart preservation are covered. | [Tests](../scratch/terminal-staff-full-tests.log), [analysis](../scratch/terminal-staff-analyze.log), [initial failing cases](../scratch/terminal-recovery-staff-red.log) |
| Admin regression | **28 tests passed.** Production build passed. Only the 4 controlled business-error codes can unlock a rejected command. | [Tests](../scratch/terminal-admin-tests.log), [build](../scratch/terminal-admin-build.log), [parser failing case](../scratch/terminal-admin-code-allowlist-red.log) |
| Rendered recovery | A competing drawer opening left the original cashier command stale. Sign-in retained it; exact retry recorded a rejection; refresh unlocked the current shift; a delayed retry stayed rejected. Admin recovered an accepted ingredient without a second POST, resolved a lost rejection and submitted a new ingredient. Cashier, barista and admin states passed 375/768/1280 overflow checks with zero unexpected page/console errors. | [Staff browser](../scratch/terminal-staff-browser-final.log), [admin browser](../scratch/terminal-admin-browser-final.log), [SQLite reconciliation](../scratch/terminal-browser-ledger-final.log) |
| Android package | ARM64 debug APK built; v1/v2 signatures and terminal recovery payload verified. **58,623,208 bytes**, SHA-256 `F01706C11C3307AD8DE29665C7FD612C50A568FB278737F4A6810450B456A559`. | [APK](../artifacts/KAPE-DOZ-Staff-Terminal-Recovery-debug.apk), [build](../scratch/terminal-staff-apk-build.log), [signature](../scratch/terminal-staff-apk-signature.log), [payload](../scratch/terminal-staff-apk-payload.json), [source hashes](<TERMINAL RECOVERY SOURCE HASHES.json>) |

The retained fixture `scratch/terminal-recovery-browser-20261106-accepted.sqlite` contains rejected cashier command `cc87a93c-ef78-4259-869d-35162aaca28c`, competing accepted opening `b4c3fd0e-ecc0-427f-b1c3-279452cf3c97` and one open drawer with ₱1,000.00 opening cash. Latest admin cases are accepted `42894405-6e1e-40e3-a63b-d8548a6394a5` and rejected `da577017-e262-4ca3-8d77-aae8c91c8399`. Each has exactly one receipt, audit and outbox. There are no payments, cash/refund movements, settlements, waste or reservations; original beans remain 1,000 g. Database integrity and foreign keys passed. [Cashier phone](../scratch/recovery-cashier-375.png) and [admin phone](../scratch/terminal-admin-rejected-375.png) show the recovered states.

The full goal remains active. Admin browser-reload durability, local cart restart, sent-line amendments, cloud sync/backup, CRM/loyalty, CSV, inventory counts/thresholds and unresolved production policies still need implementation or evidence. A nonterminal request-validation failure stays pending rather than silently dropping an uncertain operation. A hub rejection does not prove that physical cash or an external provider transfer did not occur. Native Android storage, installation, printers and café LAN checks remain separately unverified. Initial device-revocation tests ran green after shared-handler extraction; no device-specific failing-first result is claimed.

## Durable admin recovery checkpoint

Date: 6 November 2026, Asia/Manila. The portal saves the command before sending it. After reload or browser restart, a fresh sign-in under the original account and hub can confirm the existing outcome or retry the exact saved command. Competing tabs share one journal. A storage failure or unsupported saved format blocks changes and preserves the record. Passwords, tokens and reports stay in memory.

Schema 11 assigns a persistent hub UUID when a database upgrades or is created. The admin portal checks the UUID on sign-in and sends it with subsequent authenticated requests. Service tests prove that a fresh hub with matching account and branch IDs still cannot accept requests bound to the original hub. Reopening the same database retains its identity, including during concurrent startup.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Persistent hub | **100 service tests passed.** TypeScript passed. Tests cover migration, concurrent startup, identity retention, wrong-hub refusal and legacy callers. | [Full suite](../scratch/admin-durable-authority-services-final.log), [migration checks](../scratch/admin-durable-authority-migrations.log), [type check](../scratch/admin-durable-authority-types.log) |
| Admin portal | **50 tests passed.** Production build and type check passed. Injected adapter tests exercise denied BroadcastChannel construction and recovery after unexpected IndexedDB closure. | [Tests](../scratch/admin-durable-tests-final.log), [build](../scratch/admin-durable-build-final.log), [adapter checks](../scratch/admin-durable-adapter-green.log) |
| Real Chrome recovery | A full restart recovered accepted and rejected commands without another POST. A different account could not retry the pending command. Reload retained an unrecorded command for an exact retry. Two tabs competing for the journal sent one new command. IndexedDB held an encrypted descriptor and a nonextractable AES-GCM key. An unsupported saved format blocked changes and preserved bytes. Five states passed overflow checks at 375, 768 and 1280 px with zero unexpected page or console errors. | [Browser runner](../admin/tests/rehearse-durable-recovery.ps1), [final browser log](../scratch/admin-durable-browser-postfix.log), [phone storage error](../scratch/admin-durable-storage-error-375.png) |
| Business regression | Inventory, recipes, expenses, sales reporting, split payment, recount, closure, device revocation and sign-out passed on a synthetic hub. SQLite reconciled one receipt/audit/outbox per tested recovery ID, one competing-tab ingredient, one ₱165 settlement, one consumption, and an approved drawer count with zero variance. | [Business rehearsal](../scratch/admin-durable-regression-browser.log), [SQLite check](../scratch/admin-durable-postfix-ledger.log) |

The fixture `scratch/admin-durable-regression-20261106.sqlite` contains the final recovery rehearsal and the business regression. The recovery checks used Chrome on this workstation. The encrypted journal depends on its browser profile and origin. Clearing the browser's site data removes the journal. Cloud synchronization, backup/restore, the remaining application workflows and physical Android, LAN and printer verification are still open. The full-system goal remains active. See [source and evidence hashes](<DURABLE ADMIN RECOVERY SOURCE HASHES.json>).

The user chose manager decisions for each refund-related loyalty adjustment. The implementation still needs linked cases, eligibility and caps, with original and prior adjustments preserved. See [ADR 004](../docs/ARCHITECTURE_DECISIONS.md#adr-004-manager-decisions-for-refund-related-loyalty-adjustments).

## Sent-order amendment checkpoint

Date: 6 November 2026, Asia/Manila. Schema 12 records the original and proposed line, saved version, decision, barista acknowledgment and any linked waste. Additions, quantity increases and preparation notes can reach the station directly. Reductions, removals and replacements go through Approvals. The hub prevents stale Ready and blocks checkout when a change waiting for station review would alter the amount due. A queued change updates the ticket immediately. A change during preparation applies with barista acknowledgment and measured waste in one transaction.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Persistent hub | **108 tests passed**, including 8 amendment cases. The final paid correction case adds cash plus pending GCash, approval and payout against both original tenders, and a separate replacement settlement. It passed in a targeted rerun. TypeScript and 18 migration/authority checks passed. | [Suite](../scratch/sent-amendment-service-full.log), [split-tender case](../scratch/sent-amendment-service-x02.log), [types](../scratch/sent-amendment-service-typecheck.log), [migrations](../scratch/sent-amendment-service-migrations.log) |
| Staff and admin | **153 Flutter tests and 54 admin tests passed.** Flutter analyzer and admin production build passed. A service-backed portal test checked an approved replacement through station acknowledgment. | [Flutter](../scratch/sent-amendments-mobile-full.log), [analysis](../scratch/sent-amendments-mobile-analyze.log), [admin tests](../scratch/amendment-admin-tests.log), [build](../scratch/amendment-admin-build.log), [hub check](../scratch/amendment-admin-hub-interop.log) |
| Three-role browser rehearsal | Cashier changed a sent dine-in order from 2 lattes to 1. A manager approved it. The station received the change without a manual refresh and recorded 9 g of actual discard. Staff completed the revised drink and settled ₱165 with ₱35 change. The manager approved the ₱1,165 drawer count with zero variance. Four views passed overflow checks at 375, 768 and 1280 px. | [Browser run](../scratch/sent-amendment-browser-release.log), [SQLite reconciliation](../scratch/sent-amendment-browser-ledger.log), [station phone](../scratch/approval-amendment-station-disposition-375.png) |
| Android package | ARM64 debug APK built and passed v1/v2 signature and amendment payload checks. **58,650,910 bytes**, SHA-256 `CB03A140237EC376162EE1178C7E75A20ABCFBD3CC59129FF6E1104DE4B57967`. | [APK](../artifacts/KAPE-DOZ-Staff-Sent-Amendments-debug.apk), [build](../scratch/sent-amendments-mobile-apk.log), [signature](../scratch/sent-amendments-mobile-apk-signature.log), [payload](../scratch/sent-amendments-mobile-apk-payload.json) |

The retained fixture `scratch/sent-amendment-browser-20261106-release.sqlite` contains one resolved amendment and its request, decision and acknowledgment receipts, each with one audit and outbox record. It contains 9 g of waste, 18 g of Ready consumption, 973 g of remaining beans, one label job, no automatic receipt job and one ₱165 settlement. The portal reports ₱7.20 as waste cost. The actual waste quantity is in the stock ledger. The manager amendment view displays the disposition note. Recent amendment lists return up to 100 records.

The separate [cancellation regression](../scratch/sent-amendment-cancellation-accepted.log) verified the station's automatic cancellation notice, stopped checkout and preparation, measured waste, updated reporting and sign-out. F02-03 passes for these software paths. F03-04 remains partial because the full rendered denial and stale matrix is still open.

Preparation disposition depends on the barista recording Start preparation. The paid correction rule keeps the original order and settlement and uses manager-approved cancellation or refund before a new order. Before Ready, a paid ticket can still receive preparation-note corrections. Priced amendments are held while tenders or an applied discount are present. Remakes after Ready and structured recipe modifiers remain open. See [contract](../contracts/sent-order-amendments.md) and [source and evidence hashes](<SENT AMENDMENT SOURCE HASHES.json>).

## Paid takeout correction checkpoint

Date: 6 November 2026, Asia/Manila. **X02 passed** with separate cashier, barista and manager browser sessions connected to a persistent synthetic hub. The cashier keeps an unverified external tender pending and disables receipt printing until full payment. The staff client retains the original recovery command if the hub responds with an inconsistent payment acknowledgment.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Takeout and approval | ₱100 cash and ₱65 pending GCash stayed off the station until the cashier verified the same GCash entry. A denied cancellation preserved preparation. An approved cancellation reached the station automatically and a stale Ready request returned a conflict. | [Browser](../scratch/x02-browser-final.log), [pending tender](../scratch/approval-x02-pending-tender-375.png), [station](../scratch/approval-x02-station-cancelled-768.png) |
| Refund and replacement | The barista recorded 9 g of discard. The refund returned the original ₱100 cash and recorded ₱65 verified GCash evidence. The separate ₱90 replacement reached Ready. The portal showed ₱90 net sales, ₱7.20 final ingredient cost and ₱7.20 waste. The manager closed a ₱1,090 drawer with zero variance. Five views passed overflow checks at 375, 768 and 1280 px. | [Refund view](../scratch/approval-x02-manager-refund-768.png), [report](../scratch/approval-x02-sales-1280.png) |
| Persistent evidence | The read-only audit matched 20 accepted commands and one durable stale rejection to the browser trace. It reconciled both settlements, both refund legs, one label job per order, zero automatic receipt jobs, drawer records, audit/outbox and 982 g of beans on hand. | [Audit log](../scratch/x02-browser-ledger-final.log), [auditor](../services/tests/fixtures/check_takeout_correction.ts), [fixture](../scratch/x02-browser-20261106-release.sqlite) |
| Staff regression | 158 Flutter tests passed and static analysis found no issues. Three regression tests failed on malformed responses before the acknowledgment fix and passed afterward. | [Flutter](../scratch/x02-payment-ack-full.log), [analyzer](../scratch/x02-payment-ack-analyze.log), [before](../scratch/x02-payment-ack-red.log), [after](../scratch/x02-payment-ack-green.log) |
| Android test package | ARM64 debug APK built and passed v1/v2 signature and payment UI marker checks. 58,657,390 bytes. | [APK](../artifacts/KAPE-DOZ-Staff-Takeout-Correction-debug.apk), [signature](../scratch/x02-mobile-apk-signature.log), [payload](../scratch/x02-mobile-apk-payload.json) |

Merchant verification and refund references were synthetic. The rehearsal verifies recording and reconciliation in software. Physical Android installation, printers and café LAN remain unverified. The full-system goal remains active. See [source and evidence hashes](<TAKEOUT CORRECTION SOURCE HASHES.json>).

## Physical count and stock-loss checkpoint

Date: 6 November 2026, Asia/Manila. **F04-03 passed** against schema 13. The admin Inventory workspace records a physical observation against a saved stock movement sequence, refuses stale measurements, and posts an approved variance against live stock. Positive adjustments update quantity with cost pending. A manager confirms the gain's cost separately. When intervening use prevents a calculated remaining value, a separate manager review binds the value to the current whole balance and stock version. Sales deducts count shortages as a separate stock-loss cost, following the user's confirmed decision.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Persistent service | **124 tests passed** and TypeScript passed. Coverage includes stale equal-net movement, concurrent reservations/use/receipts, exact replay, branch/role checks, grouped gains, valuation periods, migration retention and financial rounding. An existing overflow regression caught a write-ordering error, which was corrected before the final suite. | [Full suite](../scratch/inventory-count-service-full-final.log), [types](../scratch/inventory-count-service-types-final.log), [valuation/count focus](../scratch/inventory-count-service-final-focused.log) |
| Failure and migration checks | Three persisted fault tests injected failures during adjustment valuation, cost confirmation and final outbox insertion. Each rolled back all effects, survived reopen and accepted the original retry once. Migration tests retained legacy movement/valuation links and refused unsafe running balances. | [Fault tests](../scratch/inventory-count-fault-tests.log), [migration](../scratch/inventory-migration-green.log), [append guard](../scratch/inventory-migration-trigger-green.log) |
| Admin portal | **59 tests passed**, with type check and production build passing. Count acknowledgments bind the action, entity, version, unit, quantity, amount and evidence. Unknown stock-loss costs keep operating profit unavailable. | [Admin tests](../scratch/stock-loss-admin-full.log), [build](../scratch/stock-loss-admin-build.log), [stock-loss regression](../scratch/stock-loss-service-green-final.log) |
| Rendered workflow | A manager discarded a stale count, approved a 10 g shortage while preserving later use and receiving, and posted a 10 g gain with cost pending. The lost cost-confirmation response recovered after reload and fresh sign-in. A stale whole-balance review was rejected, then the reviewed value was accepted. Six states passed overflow checks at 375, 768 and 1280 px with zero unexpected page/console errors. | [Browser](../scratch/inventory-count-browser-v6.log), [pending cost](../scratch/stock-count-cost-pending-1280.png), [value review](../scratch/stock-count-confirmed-value-768.png) |
| Ledger reconciliation | A read-only verifier matched 30 accepted commands and two durable conflicts to the exact browser trace. It reconciled 11 physical movements, three ₱165 sales, ₱8 of separate stock loss, a ₱1,495 close with zero variance, and 1,164 g of beans carrying ₱931.20. Original unknown release, consumption and waste costs stayed unknown. | [SQLite audit](../scratch/inventory-count-browser-ledger-final.log), [verifier](../services/tests/fixtures/check_inventory_counts.ts), [fixture](../scratch/inventory-count-browser-20261106-v6.sqlite) |

The browser rendered the manager portal. Cashier and barista concurrency used separate authenticated HTTP clients against the same hub. The synthetic fixture supplies its own catalog and valuation evidence. Android source was unchanged in this checkpoint. Physical Android installation, café LAN and printer checks remain open. Threshold alerts, the remaining integrated journeys and the rest of the acceptance matrix remain open. The full-system goal remains active. See the [count contract](../contracts/inventory-counts.md), [stock-loss decision](../docs/ARCHITECTURE_DECISIONS.md#adr-007-physical-stock-loss-in-operating-profit) and [source and evidence hashes](<INVENTORY COUNT SOURCE HASHES.json>).

## Inventory alert and shortage checkpoint

Date: 6 November 2026, Asia/Manila. Schema 15 supports per-ingredient threshold configuration, active/acknowledged/resolved incident history, and staff shortage warnings. The chosen low-stock rule compares physical on-hand stock with the configured threshold. Shortage warnings account for outstanding reservations. An acknowledgment records the manager's note and leaves the condition active. Replenishment or a qualifying threshold change resolves it. A new occurrence receives its own incident history.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Service and clients | **138 service tests**, **198 Flutter tests** and **64 admin tests** passed. Service and admin type checks, Flutter analysis and the admin production build passed. Missing stock data displays a refresh notice and does not block staff. | [Service](../scratch/inventory-alerts-service-schema15-full.log), [Flutter](../scratch/stock-shortage-flutter-full-final.log), [analysis](../scratch/stock-shortage-flutter-analyze-fixed.log), [admin](../scratch/inventory-threshold-history-admin-tests.log), [build](../scratch/inventory-threshold-history-admin-build.log) |
| Regressions | Separate tests verify linked shortage observations for sent-order amendments, cursor continuation after another manager resolves an alert, and rollback on a failed threshold-history write. A backward clock correction no longer interrupts a stock operation or reverses incident order. Schema 15 retains schema 14 thresholds and alerts. | [Amendments and cursor](../scratch/alert-amendment-regression-green.log), [clock before fix](../scratch/inventory-alerts-clock-red.log), [threshold history before fix](../scratch/inventory-threshold-history-red.log) |
| Rendered workflow | In separate manager, cashier and barista browser sessions, the manager set and acknowledged a threshold. The cashier saw an 8 g shortage and sent the order. The barista saw the warning and marked it ready. Replenishment resolved the shortage. The manager cleared the threshold and reviewed both reasons. Barista and manager views passed overflow checks at 375, 768 and 1280 px. | [Browser](../scratch/inventory-alerts-browser-v2.log), [barista tablet](../scratch/approval-barista-shortage-768.png), [manager tablet](../scratch/approval-manager-alerts-768.png) |
| Ledger | Read-only reconciliation verified the traced order and incident, two linked shortage observations, a negative stock deduction, replenishment, threshold history, ₱165 settlement and ₱1,165 drawer close with zero variance. The run recorded 16 accepted commands with one audit and outbox event each. | [SQLite audit](../scratch/inventory-alerts-browser-ledger.log), [verifier](../services/tests/fixtures/check_inventory_alerts.ts), [fixture](../scratch/inventory-alerts-browser-20261106-v2.sqlite) |
| Android package | ARM64 debug APK built with both warning messages and passed v1/v2 signature verification. **58,665,598 bytes**, SHA-256 `2748DCEA00812AE9E297EFE20620BBC839D9E2350577749BB262ECD1C911A027`. | [APK](../artifacts/KAPE-DOZ-Staff-Inventory-Alerts-debug.apk), [signature](../scratch/inventory-alerts-apk-signature.log), [payload](../scratch/inventory-alerts-apk-payload.json) |

The browser run used synthetic data. Schema 15 preserves existing schema 14 thresholds but cannot reconstruct earlier reasons that were not stored. The explicit catalog-disable control is still required to complete F04-04. Prior count, amendment and refund passes require replay after the shared mutation changes. Physical Android, café LAN and printer checks remain open. The full-system goal stays active. See the [alert contract](../contracts/inventory-alerts.md) and [source and evidence hashes](<INVENTORY ALERT SOURCE HASHES.json>).

## Catalog availability and Schema 16 replay checkpoint

Date: 7 November 2026, Asia/Manila. **F04-04 passed**, and the Schema 16 replay of **F02-03**, **F03-05**, **F04-03**, **F07-04** and **X02** passed after the codebase untangle refactor (`services/`, `admin/`, `mobile/`). Schema 16 adds `products.available`, `products.availability_version`, `product_availability_events` and `order_unavailable_replacements`. Managers can mark products unavailable or available with a required reason and optimistic version check. An unreleased order containing a newly disabled item is held from station release and additional payment creation while allowing verification or rejection of an already-recorded pending tender. The cashier can replace an unavailable line with an available item at the same unit price without double-charging, which automatically releases a fully paid takeout order once all unavailable lines are cleared.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Service, admin and staff suites | **143 service tests**, **67 admin tests** and **207 Flutter tests** passed after the untangle refactor. TypeScript, Vite production build and Flutter analyzer passed with zero issues. | [Service suite](../scratch/product-availability-services-full.log), [Contract](../contracts/product-availability.md), [ADR 008](../docs/ARCHITECTURE_DECISIONS.md#adr-008-disabled-item-on-an-unreleased-order) |
| Catalog availability rehearsal (`F04-04`) | Manager created `Fixture Americano` (₱165.00), cashier created a takeout `Fixture Latte` (₱165.00) with ₱100.00 cash + ₱65.00 pending GCash, manager disabled `Fixture Latte` (`availabilityVersion: 2`), cashier verified the pending GCash to reach `paid` while held (`released: false`), cashier replaced `Fixture Latte` with `Fixture Americano` without charging twice (automatically releasing once to barista), barista marked Ready, and manager closed the ₱1,100.00 drawer with zero variance. Passed 375/768/1280 checks on all 3 role views. | [Runner](../mobile/tools/rehearse-catalog-availability.ps1), [Browser log](../scratch/catalog-availability-browser.log), [SQLite audit](../scratch/catalog-availability-ledger.log), [Verifier](../services/tests/fixtures/check_catalog_availability.ts) |
| Schema 16 workflow replays (`F02-03`, `F03-05`, `F04-03`, `F07-04`, `X02`) | Re-verified admin shift recount/close and device revocation (`rehearse.ps1`), physical stock counts and SQLite reconciliation (`rehearse-stock-counts.ps1` + `check_inventory_counts.ts`), sent-order amendments (`-Amendment`), cancellations (`-Cancellation`), split refunds (`-Refund`), and paid takeout correction (`-TakeoutCorrection` + `check_takeout_correction.ts`) against Schema 16 with zero console/page errors. | [Admin](../scratch/schema16-admin-rehearsal-browser.log), [Counts](../scratch/schema16-inventory-counts-browser.log), [Counts SQLite](../scratch/schema16-inventory-counts-ledger.log), [Amendment](../scratch/schema16-amendment-browser.log), [Cancellation](../scratch/schema16-cancellation-browser.log), [Refund](../scratch/schema16-refund-browser.log), [X02](../scratch/schema16-takeout-correction-browser.log), [X02 SQLite](../scratch/schema16-takeout-correction-ledger.log) |
| Android package | ARM64 debug APK rebuilt and verified with v1/v2 signatures and catalog availability kernel payload markers. **58,675,890 bytes**, SHA-256 `07009060FB67FB63653A69C2577E0052D96C87753344F81138E677B978E2FE06`. | [APK](../artifacts/KAPE-DOZ-Staff-Catalog-Availability-debug.apk), [Build](../scratch/product-availability-apk-build.log), [Signature](../scratch/product-availability-apk-signature.log), [Payload](../scratch/product-availability-apk-payload.json), [Source hashes](<CATALOG AVAILABILITY SOURCE HASHES.json>) |

## Schema 17–19 completion: Variants, pack conversions, loyalty, CSV, cloud sync, printers, backup/restore, and X01–X05 release candidate

Date: 7 November 2026, Asia/Manila. Schemas 17, 18, and 19 complete all remaining software acceptance cases (`F01-01`–`F08-05` and `X01`–`X05`):

1. **Schema 17 (`017_recipe_variants_and_pack_conversions.sql`)**: Structured product options (size variants, milk substitutions, extra espresso shots, and dine-in/takeout service packaging ingredient deltas) and supplier pack conversions (`supplier_name`, `pack_count`, `pack_size_milli`, `pack_unit`) on stock receipts (`F04-01`, `F04-02`, `X01`, `X03`).
2. **Schema 18 (`018_customers_and_loyalty.sql`)**: Customer enrollment/lookup/profiles, active/inactive/VIP policy counters (`vipConfigured: false` when unconfigured), whole-point loyalty earning on eligible settled spend, offline-earned `pending` points with idempotent cloud sync promotion, manager-approved online redemption with cloud validation, and linked manager-decided `loyalty_refund_cases` on monetary refunds (`F03-03`, `F07-01`–`F07-05`, `X04`).
3. **Schema 19 (`019_setup_csv_recovery_and_printers.sql`)**: Single-role account management and credential rotation, versioned `branch_config` (`stationVisibleCards`, `offlineAccessExpiryMinutes`), explicit receipt/label printer adapters (`unconfigured`, `pending`, `failed`, `unknown`, `confirmed`, `simulated: true`, `physicalPaperClaimed: false`) with job retry linkage (`original_job_id`, `attempts`), Loyverse catalog/customer CSV dry-run preview and idempotent import (`skip`/`update`), barista recall/handover (`recallOrder`, `completeHandover`) and compensating waste corrections, cloud outbox push and conflict inspection/resolution, and secret-free branch backup export and isolated schema-checked restore (`F02-02`, `F02-04`, `F02-05`, `F05-01`–`F05-05`, `F06-03`, `F08-01`–`F08-05`, `X05`).

| Check | Observed result | Evidence |
| --- | --- | --- |
| Service, admin and staff test suites | **153/153 service tests**, **68/68 admin tests**, and **209/209 Flutter tests** passed. Service TypeScript, admin Vite production build, and `flutter analyze` passed with zero issues. | [Service suite](../scratch/hub-test-schema19.log), [Flutter analyze](../scratch/release-candidate-flutter-analyze.log), [Variants/packs tests](../services/tests/recipe-variants-and-packs.test.ts), [Loyalty tests](../services/tests/customers-loyalty.test.ts), [Setup/CSV/recovery tests](../services/tests/setup-csv-recovery.test.ts) |
| Cross-role browser rehearsals (`X01`–`X05` + Admin Portal) | All five start-to-end cross-role rehearsals (`X01`, `X02`, `X03`, `X04`, `X05`) and the Schema 19 admin portal regression rehearsal (`rehearse.ps1`) passed 375/768/1280 responsive overflow checks with zero page/console errors and passed read-only SQLite ledger reconciliation. | [X01 browser](../scratch/x01-browser.log), [X01 SQLite](../scratch/x01-ledger.log), [X02 browser](../scratch/takeout-correction-browser.log), [X02 SQLite](../scratch/takeout-correction-ledger.log), [X03 browser](../scratch/x03-browser.log), [X03 SQLite](../scratch/x03-ledger.log), [X04 browser](../scratch/x04-browser.log), [X04 SQLite](../scratch/x04-ledger.log), [X05 browser](../scratch/x05-browser.log), [X05 SQLite](../scratch/x05-ledger.log), [Admin Schema 19](../scratch/schema19-admin-rehearsal-browser.log) |
| Release-candidate Android package | ARM64 debug APK built and passed v1/v2 signature verification. **58,705,901 bytes**, SHA-256 `FCADED1CF4DD27964F4AF4C25CC0D53BFFB8E5171CCC948DB9EA9ACCEE2235EF`. | [Release Candidate APK](../artifacts/KAPE-DOZ-Staff-Release-Candidate-debug.apk), [Build log](../scratch/release-candidate-apk-build.log), [Signature log](../scratch/release-candidate-apk-signature.log), [Source hashes](<RELEASE CANDIDATE SOURCE HASHES.json>) |
| Separate physical hardware record | **Device validation pending.** Actual café tablets, local network routing, physical receipt/label thermal printers, and live external merchant terminals remain listed separately for on-site verification. | [VERIFICATION MATRIX.md](<VERIFICATION MATRIX.md#separate-physical-acceptance-record-device-validation-pending>) |
