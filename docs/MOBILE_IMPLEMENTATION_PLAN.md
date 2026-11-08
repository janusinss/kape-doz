# CAFE DOS mobile implementation plan

Planning baseline: 3 November 2026. User authorized implementation from the answered sample questionnaire and confirmed Android tablets and phones first. The sample is now the development baseline; it is not evidence that the client has confirmed unknown hardware or invoice details.

Confirmed during implementation: the five administrative screens belong in a separate owner/manager app or portal. The Android staff binary contains register, barista and waste only. Staff approval requests will be connected to the separate authenticated authority; no local role switcher unlocks financial data. The user also authorized local Android SDK setup for a test APK.

## Sources and boundaries

1. Use `docs/CAFE_DOS_Sample_Client_Answers.json` for the 52 operating choices.
2. Use `BACKEND_ARCHITECTURE.md` for invariants and audit requirements.
3. Preserve `wireframes/cafe-theme/` as the visual reference.
4. Treat printer models, connections, paper/label size, hub equipment, invoice/tax setup and live migration data as unresolved external facts.
5. Deliver Android tablet and phone layouts; defer iOS distribution and live multi-branch operations.

The approved visual language is warm wood/cream, dark brown navigation, rounded surfaces and large touch targets. Preserve cashier option B, a six-ticket barista view with warm cards, quick waste presets and the five selected admin layouts. The phone is an adapted workflow, not a shrunken tablet screenshot.

## Recommended implementation direction

Use Flutter for the Android client if the installed SDK passes its environment checks. Flutter is present at `C:\Users\janus\dev\flutter\bin\flutter.bat`; Node, npm, Java and Git also exist. No application source or package manifest exists yet. Android SDK/emulator availability and Flutter SDK compatibility have not been verified. Do not claim an installable APK until compilation succeeds.

Use a modular application with testable domain logic and repository/transport interfaces. Keep printer, local database, local authority and cloud adapters separate. Do not hardwire the client to a cloud-only data source because internet outage operation is part of the brief. A printer adapter is not complete merely because a mock queue exists.

Suggested layout:

```text
mobile/
  lib/app/                  application shell, routes, theme, session
  lib/domain/               orders, tender allocation, kitchen, quantities
  lib/data/                 durable store and outbox repositories
  lib/features/register/    menu, modifiers, cart, tenders
  lib/features/kitchen/     queue, preparing/ready, recall
  lib/features/waste/       presets, quantity entry, saved history
  lib/features/admin/       reports, recipes, inventory, CRM, settings
  lib/platform/             printing and device integration contracts
  test/                     domain, repository and widget tests
  integration_test/         native user journeys
services/                   local/cloud authority when topology is settled
docs/                       decisions, setup and acceptance evidence
```

Client repositories must not become a substitute for server authorization. The staff device contract excludes purchase costs, recipe costs, margins, expected cash, variance and OPEX. A demo role switcher is not production authentication. If a prototype uses sample data or simulated peripherals, identify those states visibly and in delivery notes.

## Milestone 1: Runnable Android staff workflow

Goal: one native Android development application with persistent cashier-to-barista-to-waste workflows on the same device, preserving adapter boundaries for actual multi-device routing. This is the recommended first runnable milestone; it is not a declaration of complete production scope.

1. Scaffold `mobile/` with Android support after environment verification. Dependency: confirmed Android target. Risk: SDK/toolchain availability.
2. Specify failing domain and repository tests through the TDD role. Dependency: domain contracts. Risk: monetary and stock invariants.
3. Implement the theme, responsive shell and role-specific navigation in `mobile/lib/app/`. Dependency: scaffold. Risk: compact phone navigation.
4. Implement register, kitchen and waste features against durable local repositories. Dependency: tests. Risk: restart/retry consistency.
5. Verify domain tests, widget tests, analyzer and the available Android run/build target. Dependency: working slice. Risk: emulator or hardware unavailable.

First-slice acceptance:

- Drink selection and customization create an order with integer-centavo totals and fixed-unit recipe quantities.
- Dine-in explicitly sends before payment; takeout releases only after confirmed full payment.
- Cash and externally verified GCash/card allocations support split payment without over-settlement.
- Release reserves ingredients; Mark ready consumes once; replay and recall do not deduct twice.
- Waste entry changes stock without changing sales, and saved work survives repository reopen/restart.

Print jobs may be durably queued as pending/unconfigured in this slice. Never label them physically printed. Multi-device kitchen routing and cloud-dependent loyalty redemption remain unavailable until the appropriate authority adapter is connected; do not present same-device updates as LAN verification.

## Milestone 2: Administrative management

1. Specify permission and ledger/reporting tests before privileged feature implementation.
2. Implement recipe versions, material receiving and moving weighted-average valuation.
3. Implement inventory thresholds, count corrections and dashboard-only alerts.
4. Implement sales/margin, customer/loyalty and manual OPEX screens.
5. Implement settings, staged CSV preview and audit history.

Acceptance: revenue derives from settled sales; pending preparation is not reported as zero-cost profit; missing costs are visible; staff DTOs never include privileged fields; owner-selected VIP thresholds remain unset until configured; imports cannot silently duplicate opening stock.

## Milestone 3: Identity, approvals and closing

1. Implement enrolled-device authentication and individual staff unlock.
2. Implement order-bound manager approvals for discounts, redemption and refunds.
3. Implement shared/separate drawer assignments and cash movement ledgers.
4. Implement blind counts, manager closing review and drawer cash locks.
5. Verify cross-role requests, stale approvals, wrong-drawer actions and restart recovery.

Acceptance: backend/local authority enforces permissions; expected cash and variance are absent from staff responses and caches; pending closure blocks cash movements across all assigned registers; confirmed external payment/refund legs are never silently deleted.

## Milestone 4: Local authority, cloud and printing

1. Confirm the actual tablet, router, printer and hub topology.
2. Implement authenticated local command routing with acknowledgements and entity versions.
3. Implement durable cloud outbox synchronization with idempotent application.
4. Implement verified printer adapters and calibrated receipt/sticker templates.
5. Exercise internet-loss, LAN-loss, hub restart and uncertain-print recovery on physical equipment.

Acceptance: loss of internet does not stop supported LAN operations; loss of hub/LAN is shown distinctly; one cup produces one label at release; fully paid sale queues one customer slip; duplicate sends do not produce duplicate business effects; uncertain physical print outcomes require controlled reprint instead of blind retry.

No printer model, Bluetooth behavior or host device is guaranteed until inspected and tested. Native Android support does not by itself solve local discovery, printer language differences or hub availability.

## Milestone 5: Loyalty, migration and live readiness

1. Implement cloud-authorized, manager-approved loyalty reservations and settlement.
2. Implement proportional refund points adjustments and spent-point reconciliation cases.
3. Validate real menu, recipe, stock and customer exports through staged migration.
4. Complete invoice/tax configuration after owner/accountant confirmation.
5. Run staff trial, backup restore and final acceptance before live checkout activation.

Acceptance: 1 point per PHP100 of post-discount paid amount, rounded down per transaction; 1 point redeems for PHP1; earnings may queue offline but redemption cannot; automatic negative-point balances are not created for spent-point refund conflicts; migration retains source references; sample/demo slips do not imply official invoice authorization.

## Verification obligations

1. Run domain tests for idempotency, split tenders, recipe snapshots, quantity conversions, loyalty rounding and refund caps.
2. Run repository tests for durable transactions, unique source effects, failure rollback and restart/outbox recovery.
3. Run native widget tests for tablet/phone layouts, touch targets, keyboard entry, loading/error/disabled states and critical navigation.
4. Run native integration checks on Android for checkout, six-ticket kitchen queue, waste, approval and closing; use browser checks only for a web preview if one exists.
5. Delegate the required defensive and delivery audits under `AGENTS.md`; report actual results and unresolved hardware gaps.

Do not create tests merely for decorative colors or fixed text. Do not substitute browser screenshots for native Android execution evidence. Preserve existing questionnaire and approved wireframes throughout implementation.

## Interview decisions that can wait without blocking the first code

1. Exact tablet models and Android versions: needed before declaring device support and acceptance, not before writing pure domain logic.
2. Printer models, connection types and paper sizes: needed before hardware adapter completion; queue contracts can be implemented first.
3. Local hub host and router setup: needed before multi-device offline routing is accepted; keep the interface explicit now.
4. Invoice, tax and statutory discount requirements: launch blockers for live checkout; prototype can remain clearly marked as development.
5. Actual menu/recipes, opening stock, customer exports and business-day cutoff: needed before migration and production configuration; use identified fixtures during development.

No additional product interview question must block the first implementation once Android-first is confirmed. The next useful grill-me question is the local authority deployment choice, asked after the first runnable workflow makes its consequences concrete.
