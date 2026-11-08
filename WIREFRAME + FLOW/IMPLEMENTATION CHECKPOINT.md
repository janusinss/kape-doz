# Implementation checkpoint. Authority and optional receipt

Date: 4 November 2026, Asia/Manila. Full goal remains active.

## Delivered software

- Added the TypeScript/Fastify authority in `services/`, with sequential SQLite migrations, enrolled-device staff PIN authentication, separate admin password authentication and branch-bound role contexts.
- Added persisted failed-login throttling with concurrent reservations, hashed credentials and opaque sessions, expiry, logout and device revocation.
- Added atomic device revocation with safe command receipt, audit and pending outbox. Repeated requests return one accepted result; conflicting actor/payload is rejected.
- Corrected Flutter receipt behavior and compact ticket layouts: explicit request after full payment, truthful unconfigured outcomes, and reachable checkout actions at 375×667 and 768×667.
- Recorded the API in `contracts/authority.md` and implementation decisions in `docs/ARCHITECTURE_DECISIONS.md`.

## Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Service type checker | `npm run check`, from `services/`; terminal exit 0 | Passed. |
| Service tests | `npm run test:coverage`, from `services/`; [saved log](../scratch/authority-final-coverage.log) | 21 passed, 0 failed. |
| Database behavior | Storage/migration tests in `services/tests/` | Actual file-backed hashing, rollback, concurrent replay, schema upgrade and unsupported-version rejection verified. |
| Flutter test suite | [Raw test log](../scratch/compact-ticket-final-tests.log): `00:23 +54: All tests passed!` | 54 tests passed, including two compact-height regressions. |
| Flutter analyzer | [Raw analysis log](../scratch/compact-ticket-final-analysis.log): `No issues found! (ran in 6.4s)` | Passed. |

The final Flutter commands were the existing `mobile/tools/dev.ps1` wrapper with tasks `test` and `analyze`, from `mobile/`. Earlier receipt-only checks passed 52 tests; deeper browser work exposed compact-height layout defects, which were reproduced and fixed before the final 54-test run. Source snapshot: [IMPLEMENTATION SOURCE HASHES.json](<IMPLEMENTATION SOURCE HASHES.json>).

The service coverage report excludes test files: loaded hub modules report 99.67% line, 94.30% branch and 100% function coverage. This excludes unexecuted bootstrap/server entrypoints and is not a coverage statement for the whole system. The HTTP test exercised an actual loopback listener; other HTTP checks use Fastify injection. Real file-backed SQLite tests use isolated synthetic records and remove their temporary databases after execution.

### Browser evidence

The primary agent used `.agents/skills/playwright-skill/run.js` with `helpers.resolveTargetUrl()` and installed Chrome against the Flutter server's reported URL. [Layout log](../scratch/optional-print-browser-audit.log): 375×667, 768×1024 and 1280×800 passed without horizontal page overflow or console errors. Screenshots are under `scratch/optional-print-*.png`. Flutter's canvas renderer also requires native/widget exception checks; this browser result alone does not validate every internal Flutter constraint.

The deeper ticket flow exposed a 97px vertical RenderFlex overflow on a short screen. New 375×667 and 768×667 regressions were added. Short ticket panels now scroll their entire content; tall panels retain the fixed totals/footer. The phone regression also exposed an over-constrained menu header; its title/subtitle now wrap naturally. Both regressions pass in the final suite. The menu-only browser check is separate from checkout verification.

Final rendered checkout passed: select a synthetic product, add it to the ticket, create the order, open payment, verify receipt is disabled before payment, confirm full cash payment, request the receipt and verify the unconfigured-printer message on the same payment screen. [Saved checkout log](../scratch/payment-receipt-browser.log) records successful 375/768/1280 payment views with no page or Flutter rendering errors. Screenshots are `scratch/payment-receipt-375.png`, `scratch/payment-receipt-768.png` and `scratch/payment-receipt-1280.png`. The preview was stopped after verification. This exercises the local sample app, not authenticated client-to-hub order routing.

Initial environment failures were resolved without changing business behavior: npm's sandbox lacked registry DNS, Flutter's SDK cache required its existing authorized access, Playwright's bundled browser was absent, and sandboxed loopback fetch failed. Dependency download, installed-Chrome verification and the final loopback test used authorized access. No extra browser download was performed.

## Remaining work

1. Connect mobile sign-in and repositories to the authority instead of sample staff switching and whole-state development storage.
2. Implement authoritative order, drawer, payment, preparation and inventory services.
3. Deliver the separate authenticated admin portal and cloud synchronization.
4. Complete approvals, refunds, loyalty, migration, reports and recovery across clients.
5. Execute all 45 acceptance cases and record physical-equipment checks separately.

The current outbox is a durable pending record, not a delivered cloud event. The requested receipt is Unconfigured, not physically printed. Prototype staff navigation still requires the planned authenticated role integration. No whole-system acceptance case is declared passed by this checkpoint.
