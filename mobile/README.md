# KAPE DOZ Android staff app

The connected staff app requires explicit hub enrollment and individual PIN sign-in. It opens cashier or barista/waste screens according to the authenticated role. Cashiers can request discounts, cancellations and refunds. They record approved cash returned from the currently assigned open drawer. [Verification record](<../WIREFRAME + FLOW/VERIFICATION STATUS.md>)

Android saves validated enrollment and one unresolved operation in a device-bound encrypted journal. Staff PINs and session tokens stay in memory. The browser preview keeps its state for the current session. [Recovery contract](../contracts/staff-recovery.md)

Android phones and tablets are the first supported development target. The user-authorized source of behavior is `../docs/CAFE_DOS_Sample_Client_Answers.json`; selected visual references are `../wireframes/cafe-theme/`.

## Legacy UI regression fixtures

- Register: sample menu/search/categories, size and sweetness choices, extra shots, quantities, multi-line tickets, dine-in explicit Send to bar, takeout release after full verified settlement.
- Payment: cash/change, manually verified GCash/card with reference, split allocations, duplicate-payment guards. No money is charged by this app.
- Kitchen: adaptive warm cards (3 columns on wide tablets), multiple tickets, ready history, one-time ingredient consumption at Mark ready.
- Waste: ingredient/unit, reason and note, local history, separate stock deduction.
- Sample state saved locally between restarts; saved state is published only after persistence succeeds. Corrupt loads display a recovery error rather than resetting data silently.

## Remaining workflows

Cashiers can request whole-order cancellation. The active station checks for updates every 5 seconds and marks approved cancellations for disposition. The barista records unused, partly used or already consumed ingredients. Customer loyalty, CSV migration, cloud sync and printer delivery remain open. Refund eligibility and item discount allocation need production confirmation. Stale pending commands require authoritative resolution before staff can resume changes. Café deployment needs its actual catalog, equipment and invoice configuration.

Physical Android installation, encrypted storage interruption, café LAN and printer checks remain pending.

## Local tooling

Flutter 3.32.6 and Dart 3.8.1 were found on this PC. Android command-line tools and API 35 packages were installed in the ignored workspace `scratch/android-sdk/`. Pub and Gradle caches are also under ignored scratch paths. `tools/dev.ps1` discovers Flutter and Java from PATH and scopes environment variables to its process. It uses Windows certificate trust without disabling TLS verification.

From the mobile directory:

```powershell
.\tools\dev.ps1 -Task test
.\tools\dev.ps1 -Task analyze
.\tools\dev.ps1 -Task apk
.\tools\dev.ps1 -Task preview
```

The debug APK supports software testing. Production signing, distribution and café tablet compatibility need separate verification.

## Recovery rehearsal

Start the Flutter preview, then start the isolated transport fixture with its allowed browser origin set to the preview origin and a fresh database under `scratch/`. Run `tools/rehearse-recovery.ps1` with the printed staff and fixture hub URLs. The runner exercises response loss after commit against SQLite using synthetic credentials. Use `-Terminal` with a separate fresh fixture to exercise a competing drawer opening, uncertain response, staff sign-in recovery and a persisted stale-command rejection. The rejected command stays fenced against delayed retries; the current shift becomes usable after authoritative refresh.

## Available test build

The [staff inventory alerts debug APK](../artifacts/KAPE-DOZ-Staff-Inventory-Alerts-debug.apk) is 58,665,598 bytes with an ARM64 Flutter engine. v1/v2 signature and shortage warning payload checks passed. SHA-256 is `2748DCEA00812AE9E297EFE20620BBC839D9E2350577749BB262ECD1C911A027`. The current source passes 198 Flutter tests and analysis. Use `-TakeoutCorrection` as described in [Approval rehearsal](#approval-rehearsal) to verify the paid order replacement. Use `-Amendment` to verify a change to a sent dine-in order. See [sent-order amendments](../contracts/sent-order-amendments.md).

The Android Gradle task explicitly tracks project Dart sources because this Flutter SDK's Windows dependency parser mishandles escaped spaces in the workspace path. A reversible source change and restoration both triggered successful ordinary rebuilds. The previous [recovery APK](../artifacts/KAPE-DOZ-Staff-Recovery-debug.apk) has its original hash in the verification record.

## Approval rehearsal

Start the staff preview and portal against a fresh synthetic transport fixture. Set `KAPE_DOZ_TEST_BROWSER_ORIGIN` to the staff origin and `KAPE_DOZ_TEST_ADDITIONAL_ORIGIN` to the portal origin. An optional `KAPE_DOZ_TEST_PORT` reserves the fixture listener used by the portal proxy. Run the following from the project root using the observed server URLs.

```powershell
.\mobile\tools\rehearse-approvals.ps1 -StaffUrl '<staff URL>' -PortalUrl '<portal URL>' -FixtureHubUrl '<fixture hub URL>'
```

The runner uses synthetic credentials and exercises denial, stale version refusal, approval, discounted cash/change, a receipt request, barista readiness and drawer closure. Screenshots and logs belong in `scratch/`.

Use `-Cancellation` with a separate fresh fixture to exercise cancellation approval, the station's automatic update, actual ingredient waste and the updated admin report.

Use `-Refund` with a separate fresh fixture to exercise a split cash/GCash sale, manager refund allocation, a later-shift cash payout, manual external evidence, net sales and closure.

Use `-TakeoutCorrection` with a fresh fixture started with `KAPE_DOZ_TEST_TAKEOUT_CORRECTION=1`. The extra fixture espresso lets the rehearsal replace a paid latte with a differently priced order. Save the browser output to a log under `scratch/`. From `services/`, run `node --import tsx tests/fixtures/check_takeout_correction.ts <fixture.sqlite> <browser.log>` to reconcile orders, payments, refund legs, waste and drawer cash. Use synthetic merchant evidence for this test.

Use `tools/rehearse-inventory-alerts.ps1` with a fresh local staff preview, admin portal and synthetic fixture to test threshold history, a cashier shortage warning, barista Ready, replenishment and drawer closure. From `services/`, run `node --import tsx tests/fixtures/check_inventory_alerts.ts <fixture.sqlite> <browser.log>` to reconcile the resulting records.

The earlier sample APK and its [build record](../docs/MOBILE_BUILD_STATUS.md) remain available as historical evidence.
