# Staff layout modernization implementation checklist

Scope confirmed 3 November 2026: implement the three staff screens beyond wireframes. Tablet counter first, with menu and ticket side by side; adapt deliberately for phones. Keep the warm CAFE DOS palette. The Facebook page could not be fetched; no identity, menu, logo or business facts from similarly named businesses are accepted as source material.

## Initial source assessment (historical)

The pre-modernization Flutter register used a 150-unit category rail, tall 150/180-unit product tiles and a ticket ListView containing both the draft and open orders. This spends counter width on navigation and lets the total/action scroll away. Kitchen already supports six visible actions on a wide tablet but can improve visual hierarchy inside each warm ticket. Waste is a long single-column form even on wide screens. Domain/payment/persistence behavior is already tested and must survive layout changes.

## Numbered implementation checklist

1. Restructure the register into a compact category/search/catalog workspace beside a stable ticket workspace at tablet widths.
2. Anchor the ticket total and primary draft action outside the scrolling item region while retaining clear access to saved operational orders.
3. Adapt compact widths into menu and ticket views with a visible ticket count and easy return path; retain 48-unit minimum controls and keyboard/IME insets.
4. Refine the six-card kitchen layout around order identity, age, drink details, payment state and a consistently positioned ready action.
5. Split waste entry and recent activity into two tablet columns while stacking both regions in task order on phones.

## State and behavior constraints

- Preserve product search, category filtering, customization, quantity editing, table reference and multi-line order creation.
- Preserve dine-in explicit send, takeout full verified payment, split payments, one-time ready consumption, waste accounting and failed-save rollback.
- Keep busy, empty, no-match, validation and save-failure states visible. No real printer/LAN/cloud status may be invented.
- Keep staff data operational; do not add admin figures, role switches, margins or expected cash.
- Preserve sample-data/development disclosure without making it compete with checkout actions.

## Verification checklist

1. Run the meaningful existing 22-test native domain/widget suite; adapt assertions only when interaction structure intentionally changes, never to conceal a lost workflow.
2. Run Flutter analysis with zero issues.
3. Inspect browser preview at 375, 768 and 1280 widths for horizontal overflow, exceptions and actual menu/ticket/waste interactions.
4. Capture representative register, populated ticket, six-order kitchen and waste states; compare against the confirmed tablet-first direction.
5. Record native Android device/emulator testing as outstanding if unavailable; browser captures are supplementary evidence, not native acceptance.

The parent implements the source changes. This planning pass changed no application or test files.

## Layout implementation static review — 3 November 2026

Scope: register, kitchen, waste layout and their callbacks in `mobile/lib/main.dart`. This source review applies the build-error-resolver, silent-failure-hunter and security-auditor roles; domain and storage implementation remain outside the layout change.

1. Added braces to the five analyzer-reported single-line conditionals; the conditions and bodies remain identical.
2. Confirmed order creation, sending, payment, ready and waste callbacks retain their existing domain calls and busy guards.
3. Confirmed failed persistence retains the existing visible error and rollback path; success-dependent field clearing and messages remain conditional on successful saving.
4. Confirmed the staff layouts expose operational data without adding admin costs, margins or expected cash; development and unconfigured hardware disclosures remain present.
5. Found no new material swallowed-error or security regression in the reviewed layout paths. This is a static review, not production authentication, printer, LAN or Android-device acceptance.

Root reported all 24 tests passing, including the two new layout regressions, before the five brace-only corrections. Final analysis, browser captures and responsive runtime verification belong to the root verification pass.

## Zillo-inspired update — 3 November 2026

The user selected the Zillo restaurant POS as the visual reference for the staff app, adapted for KAPE DOZ coffee service. The implementation retains the existing operational workflows and development boundaries. It uses a light header and surface, orange selected navigation, a wide-screen icon-and-label rail, and a drink grid with sample stock photography. The barista grid retains warm order cards. `DESIGN.md` records current native tokens and layout details.

At a viewport width of 900 logical pixels, an 84-pixel rail appears. Register and waste split layouts require 900 pixels of remaining content width, so the effective viewport threshold is approximately 984 pixels. The barista grid uses its padded content width for its column thresholds; a wide layout displays six orders when enough height is available.

The six menu photographs are illustrative stock images, not the client's products. Photographer names, source pages, and license details are recorded in `mobile/assets/menu/SOURCES.md`. The sample menu and local development state are not verified café records. Printer connections, cloud synchronization, production authentication, local branch authority, and Android hardware acceptance remain unfinished.

This section documents the current implementation; the earlier checklist and static review describe the previous layout iteration. Current test and browser outcomes should be recorded only after the present verification completes.
