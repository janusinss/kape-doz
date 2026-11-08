# Frontend rules application plan

Scope: bounded polish of the existing Flutter staff application using `.codex/rules/frontend.md`, preserving the approved cafe-theme layouts and behavior. Web-specific syntax maps to native Flutter equivalents; no framework migration is required.

Visitor mode: Operate. Primary path is drink selection → ticket review → payment or Send to bar. Kitchen prioritizes order identity, preparation details and Mark ready. Waste prioritizes preset → measured quantity → explicit save. Stable visual groups and large controls should lead; decoration should recede.

## Numbered implementation checklist

1. Centralize native theme roles from `DESIGN.md` in `mobile/lib/`, including canvas, surface, ink, muted text, border, accent, kitchen-card fill and geometry.
2. Define control states in the Flutter theme, including visible keyboard focus, hover/pressed feedback, disabled appearance, validation borders and a minimum 48-pixel hit area.
3. Clarify selection in navigation and waste presets using persistent selected styling plus semantics; current staff navigation changes only weight/color, and waste presets have no visible selected state.
4. Refine hierarchy in `main.dart` through consistent title/body/metadata sizes, tabular monetary figures and clearer field/helper/error contrast while retaining cream panels, dark navigation and warm kitchen cards.
5. Verify the existing native behavior suite and analyzer, followed by browser checks at 375, 768 and 1280 pixels with screenshots in `scratch/` and no claim of Android hardware validation.

## Findings before implementation

- Theme roles are partially centralized, but several surfaces/control colors and radii remain inline. Inputs and buttons use radius 10 while `DESIGN.md` specifies controls at 8.
- Body type is specified only for `bodyMedium`; labels, metadata and button states otherwise inherit defaults. No explicit tabular figure treatment is present.
- Staff navigation selection uses only text weight and color. A persistent position/selection cue is useful without changing navigation placement.
- Waste presets update ingredient and reason but do not show which preset is selected. The quantity field relies on a snackbar for invalid input rather than a local error state.
- Theme lacks explicit focused/error/enabled input borders; default component states must be checked against the warm palette rather than assumed compliant.
- Existing 48-pixel FilledButton/OutlinedButton targets are appropriate. Text buttons and icon buttons need the same minimum-target check. Keep no-shadow panels and avoid decorative icons or new card nesting.

## Verification limits

This is visual/control polish, so do not create tests that merely assert colors or mirror fixed labels. Run the meaningful existing 22-test suite. Changes to domain logic, production auth, printing, cloud or local-authority boundaries are outside this pass. Contrast measurements should be recorded for the actual selected tokens; static source inspection cannot establish all rendered accessibility states.

## Targeted review after implementation

Reviewed `mobile/lib/app/cafe_theme.dart` and the affected presentation paths in `mobile/lib/main.dart`. No domain changes were found in this bounded review. Removed the redundant `dart:ui` FontFeature import as the only reviewer source edit; Material already exports that name.

1. Theme roles now define surface/ink/muted/error/selection colors, panel/control geometry, native text styles and tabular numeric features.
2. Inputs now have distinct enabled/focused/error/disabled borders; buttons and icon buttons specify 48-pixel minimum targets. Native Material retains default hover/pressed behavior. Keyboard and assistive-technology behavior still require rendered verification.
3. Top navigation now exposes selected semantics and a persistent underline. Waste presets use selected ChoiceChip states. The quantity field displays a local validation error and clears it on input changes.
4. `SafeArea(top: false)` protects the lower inset; the AppBar handles the upper inset. The warm six-ticket layout, dark header and cream register surfaces remain.
5. Save-before-publish, safe generic error copy and explicit development limitations remain intact. No new network, role, printing or financial claims were introduced.

Source-token contrast measurements: ink on white 14.61:1; muted on field 4.62:1; accent on white 5.12:1; error on field 6.42:1; white on selected fill 7.15:1; ink on warm kitchen fill 10.30:1. The initial controlBorder `#9B8975` on field `#F4EADC` measures 2.83:1 and should be darkened to meet a 3:1 component-boundary target. Root was notified; this finding needs rechecking after its token update.

Verification ownership: root runs analyzer, the existing behavior suite and browser screenshots. This reviewer has not rerun those checks. No native Android emulator or physical-device check is claimed; browser preview is supplementary to native widget tests.

## Delivery gate assessment

- Accuracy: 4/5. Source supports the claimed presentation improvements; final rendered states are pending root verification.
- Completeness: 4/5 for this bounded frontend pass. One control-border contrast finding was identified; this is not a full product or native-device accessibility audit.
- Clarity: 5/5. Selected screens, saved/error feedback and development boundaries have explicit labels.
- Actionability: 4/5. The root must resolve the boundary contrast and record final tests/screenshots before handoff.
- Conciseness: 5/5. Changes target shared theme and existing controls without decorative content or workflow expansion.

Verdict at review time: resolve the one token-contrast finding, then record root verification. Do not claim complete accessibility certification or hardware acceptance.

## Root verification after refinement

- Shared Material theme extracted to mobile/lib/app/cafe_theme.dart. Native role tokens replace inherited arbitrary control defaults.
- Controls have 48-unit minimum targets, explicit focused/error/disabled borders, and distinct 8-unit control / 14-unit panel radii. Navigation shows a persistent underline and selected semantics; waste presets use selected ChoiceChips. Quantity validation stays beside the field. The content boundary respects bottom system insets.
- Phone product tile height and compact header action were adjusted after actual native widget overflow failures. All 22 existing domain/widget tests then passed. Flutter analysis returned No issues found. Impeccable detect mobile/lib exited 0 with no output; this is not proof of comprehensive Dart/native accessibility coverage.
- Computed contrast: body on white 14.61:1, muted text on field 4.62:1, timer on warm kitchen card 4.95:1, control boundary on field 3.14:1. The originally flagged control token was corrected to #94816D.
- Native device/emulator checks remain unavailable. Browser screenshots verify only the review build. Existing Android APK is the previous UI build until rebuilt separately.

Browser verification completed: the refreshed Flutter preview rendered at 375, 768 and 1280 pixels with no document horizontal overflow, no page exceptions and no console errors. Used installed Chrome with SwiftShader software rendering because default headless rendering timed out. Screenshots: scratch/frontend-375.png, frontend-768.png and frontend-1280.png. Confirmed Waste navigation through accessible button locators and captured scratch/frontend-waste-phone.png. Native Android hardware/emulator acceptance remains unverified. The current browser preview has these UI changes; the previously delivered APK has not been replaced in this frontend-only pass.
