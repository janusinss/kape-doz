# CAFE DOS mobile development audit

Review date: 3 November 2026. Scope: `mobile/lib/main.dart`, `mobile/lib/domain/cafe_engine.dart`, `mobile/lib/data/development_store.dart`, and the targeted regression tests in `mobile/test/domain_test.dart`.

This is a read-only defensive review of the Android staff development slice. It is not a production security certification. No browser, physical printer, Android-device, backend or cloud tests were performed by this reviewer. APK compilation and final test execution are owned by the implementation agent; this document does not establish their results.

## Targeted findings and recheck

| Original finding | Targeted fix inspected | Recheck status |
| --- | --- | --- |
| Repeated confirmed tenders could affect a balance more than once (CWE-841). | `addPayment` accepts a stable `paymentId`, returns the previous effect for an identical retry, and rejects changed allocation content. Confirmed non-cash references are checked against recorded tenders. The payment dialog retains one ID through its retries. | Addressed for the implemented UI and tested command paths. A caller that omits `paymentId` still receives a new allocation, so production command endpoints must require stable IDs. |
| The caller could mutate a captured order recipe after reservation (CWE-664). | `OrderLine` copies the recipe into `Map.unmodifiable`; newly created tickets use `List.unmodifiable`. | Addressed for order creation. The regression test mutates the original recipe map after release and checks unchanged reservations and consumption. |
| Negative recipe quantities could increase stock at ready time (CWE-20). | `createTicket` rejects ingredient values at or below zero as well as unknown ingredient keys. | Addressed for command-created tickets. The regression test checks rejection without changing serialized state. |
| Staff could receive internal exceptions through the save message (CWE-209). | `change` displays a fixed safe save-failure message instead of `exception.toString()`. | Addressed for the visible save-error path. Add structured internal diagnostics when the repository/authority layer is introduced. |

The regression suite also contains explicit checks for unchanged effects on stable payment replay and rejection of a confirmed external reference reused on another order. These tests were inspected, not executed by this reviewer.

## Existing protective behavior

- UI mutations clone the engine, apply the action to the clone, await persistence, and publish the new engine only after success. The busy guard prevents overlapping local UI commands.
- Startup load failure shows a retry state and does not silently replace corrupt or unreadable saved data with a fresh sample account.
- Kitchen release and ready commands guard repeated execution; ready consumption is distinct from reservation. Print jobs are identified as unconfigured rather than physically printed.
- The explicit staff projection currently contains operational fields only. Purchase costs, production costs, margins, OPEX, expected cash and cash variance are absent from the reviewed staff implementation.
- The app visibly identifies its development state and unavailable cloud/printer capabilities. The plan records a separate owner/manager app or portal rather than an admin role switcher in the staff binary.

## Production work still required

1. **Durable authority and recovery.** SharedPreferences is explicitly development persistence. It is not a transactional inventory/payment ledger or a multi-device authority. Introduce a durable database, atomic command/outbox transactions, recovery and backup validation before live business data.
2. **Authentication and authorization.** The reviewed slice has no real staff authentication, device enrollment, manager approval enforcement or branch-scoped server authorization. The separate administrative application must not be treated as a security boundary without an authenticated authority.
3. **Validated commands and restored state.** Validate full saved/network schemas and state invariants, freeze restored collections where appropriate, and avoid exposing mutable domain objects as authority. Require payment IDs, normalize and validate external references, constrain quantities/amounts, and define pending-payment confirmation transitions before exposing domain commands remotely.
4. **Real integrations and operations.** LAN routing, cloud synchronization, actual printer language/transport support, physical print outcomes, refunds, loyalty, cash drawers and closing are not established by this source review. Test the actual equipment and outage/retry paths. Official invoice/tax setup remains an owner-confirmed launch prerequisite.
5. **Final execution evidence.** Record the final analyzer/test outputs, APK build result and device acceptance separately. Native widget tests establish only their exercised layouts and interactions; neither they nor an APK compilation prove physical peripheral compatibility or production readiness.

## Verification recommendations for the implementation gate

- Re-run domain and widget tests after the final fixes, including persistence failure and restart cases.
- Verify identical and changed payment retries, duplicate external references, negative recipe rejection and recipe snapshot immutability.
- Before production, add malformed persistence, unknown schema, recovery interruption, cross-role, multi-device concurrency and uncertain external-payment outcome tests.

Verdict: the four targeted source-level findings have been addressed within the development slice. Production release remains blocked by the outstanding architecture and integration work above.
