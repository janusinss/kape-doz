# Android staff development build

Date: 3 November 2026. This is an initial working milestone, not the completed CAFE DOS production system.

## Confirmed this session

- Android tablets and phones first.
- Use the answered sample questionnaire as the implementation baseline.
- Owner/manager uses a separate admin app or portal.
- Local Android build tools may be installed for an installable test APK.

## Implemented

- Flutter Android project and adaptive register/barista/waste interfaces matching the selected cafe palette.
- Sample multi-line tickets, customization, dine-in send, takeout settlement, split payments and manual external verification.
- Reservation on kitchen release; one-time physical deduction at Mark ready; independent waste entries.
- Development state storage with save-before-publish and failed-save rollback; explicit unconfigured print jobs.
- Operational staff projection without purchase costs, margins, OPEX or expected cash.

## Verification evidence

`scratch/mobile-test-results.log` records 22 passing tests, including 375/768/1280-width native widget checks, six simultaneously tappable kitchen tickets, phone payment entry, persistence failure/retry, repeated payment IDs and duplicate external references. These run in Flutter's widget test environment, not on a physical Android tablet.

Flutter analysis previously returned no issues after the initial lint cleanup. Final build results are to be appended once compilation finishes. A Flutter browser preview compiled successfully; one desktop rendering was inspected. The automated browser matrix encountered browser startup/renderer readiness issues and is not reported as a passing responsive browser audit. Native width tests passed independently.

The defensive review is in `MOBILE_DEVELOPMENT_AUDIT.md`. It is scoped to this development slice and records remaining production-hardening work.

## Required next work

- Separate admin portal, authenticated identities, approvals, and blind cash-drawer closing.
- Transactional production storage, branch authority, authenticated LAN routing and cloud reconciliation.
- Actual printer integration, label calibration, controlled reprints and uncertainty handling.
- Customer/loyalty service, real menu/recipe configuration and staged CSV migration.
- Invoice/tax confirmation, backup/restore acceptance, actual-device installation and supervised staff trial.

Do not enter real customer information or use this development build for live sales. No real payment is processed by the app. A generated APK does not validate cross-device routing, printing or production readiness.

## Final verification, 3 November 2026

- Debug APK built successfully after Flutter automatically retried two Maven artifact download timeouts. Build log: `scratch/mobile-apk-build.log`.
- Deliverable: `artifacts/CAFE-DOS-Dev-0.1.0.apk`, 44,270,907 bytes, SHA-256 `4D671BA61FB6E43A9F99BA6224E57233BEC82B36E46138338A15BE2764920822`.
- APK package: `com.cafedos.cafe_dos`, version 0.1.0 (1), label CAFE DOS Dev; minimum SDK 21 and target SDK 35. Flutter build targeted Android arm64; actual cafe hardware compatibility remains untested.
- Final suite: 22 tests passed. Final Flutter analysis: No issues found. Logs: `scratch/mobile-test-results.log`, `scratch/mobile-analysis.log`.
- One tablet browser preview was visually inspected at 1280x900 with no page/console errors or document overflow on that capture. The full automated browser width matrix was not completed successfully; native widget width checks did pass.
- `adb devices` showed no attached Android device. The APK has not been installed or exercised on a physical tablet/emulator.
- Admin portal, authenticated production backend, cloud/LAN routing, actual printing and production storage remain required implementation work. Do not represent this milestone as the completed product.
