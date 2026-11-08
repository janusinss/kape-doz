# CAFE DOS backend working specification

Status: reviewed design, not implemented. Source: the user-provided backend architecture JSON and the CAFE DOS sprint brief. Current project artifacts are static wireframes. No payment, printer, offline routing, authentication, or inventory engine has been validated.

Implementation update, 3 November 2026: the user authorized building from the sample answers, selected Android phones/tablets first, and selected a separate admin app/portal. A Flutter staff development slice now exists under mobile/. Pure domain and widget tests cover the local sample workflow; production backend, hardware routing, authentication and cloud behavior remain unimplemented. The PWA topology below is an earlier proposal to revise for the selected native client, not a requirement to deliver a PWA.

## 1. Confirmed scope and unresolved decisions

- Staff: cashier register, six-ticket barista display, waste and dial-in entry.
- Admin: sales and margins, recipes and raw materials, inventory and thresholds, customers and loyalty, settings and CSV migration.
- Confirmed rollout decision A: one operating branch in the first release. Preserve business/branch IDs, isolated stock/cost ledgers and configuration boundaries for later expansion. Multi-branch activation, inter-branch transfers and cross-branch reporting are future scope, not first-release requirements.
- Preserve the selected cafe-theme wireframes, including warm barista cards. Do not substitute connected/refined variants.
- Staff may receive retail prices, operational ingredient names/units, and permitted customer details. They must not receive purchase costs, recipe costs, profit reports, or OPEX.
- User response: a local hub appears acceptable, but current equipment is believed to be tablets; details will follow. The hub is a PROVISIONAL proposal. No dedicated hardware purchase or topology is confirmed.
- Confirmed kitchen policy: support both release modes, configurable by service type. Initial assignments: dine-in uses explicit Send to bar before payment; takeout releases automatically after confirmed payment.
- Confirmed initial payments: cash plus manually verified GCash/card payments through existing external apps or terminals.
- Confirmed split payments: one order may use multiple tenders, including cash plus manually verified GCash/card.
- Confirmed partial-refund allocation: owner/manager chooses the refund split across original tenders, capped by each tender's remaining refundable amount.
- Confirmed cash drawers: support shared and separate drawers; owner assigns registers to drawers. Initial physical assignments await equipment confirmation.
- Confirmed shift closing: blind staff count; expected cash and variance are owner/manager-only.
- Confirmed shift finalization: staff submit the count; owner/manager reviews and approves closure.
- Confirmed closing lock: pause cash transactions and other cash movements on a drawer awaiting closure approval, across all assigned registers.
- Confirmed customer inactivity: owner-configurable, initially 30 days without a qualifying purchase.
- Confirmed VIP qualification: owner selects a spending-based or completed-purchase-count rule and its threshold; no numeric threshold has been confirmed.
- Confirmed offline loyalty: queue earned points offline; redemption requires successful cloud authorization.
- Confirmed loyalty redemption value: 1 point gives PHP1 off the eligible checkout amount.
- Confirmed loyalty earning: award whole points per settled transaction, rounding down; spending remainders do not carry over.
- Confirmed loyalty earning basis: the amount paid after discounts and loyalty redemption; redeemed points do not earn new points.
- Confirmed loyalty expiry: owner-configurable, with no expiry initially.
- Latest loyalty-refund decision, 6 November 2026: require an owner/manager decision for each points adjustment. Create a linked pending case; do not automatically post proportional or rounded refund points.
- Confirmed spent-point refund exception: flag for owner/manager reconciliation instead of automatically creating a negative points balance.
- Confirmed approval authority: only owner or manager may approve refunds and cancellations after preparation starts; staff may submit requests.
- Confirmed discount authority: preset and custom discounts require owner/manager approval; loyalty redemption also requires owner/manager approval plus cloud validation.
- Confirmed ingredient costing: moving weighted average, scoped to ingredient and branch.
- Confirmed ingredient consumption timing: deduct once when the barista marks the drink ready. Kitchen release reserves quantities without reducing physical stock.
- Confirmed stock-shortage policy: warn staff, permit the sale and flag the shortage for reconciliation; no manager override is required solely for insufficient recorded stock.
- Confirmed low-stock notifications: owner/manager dashboard alerts only for the first version; no email, SMS or external push delivery.
- Confirmed invoice-scope decision C: owner will confirm whether checkout issues official sales invoices or internal slips. Treat this as a live-checkout launch blocker; prototype and design work may continue.
- Still pending: tablet OS/browser, printer model/protocol, router client isolation, available always-on host, remaining loyalty redemption rules and refund edge cases, tax/discount rules and customer segment definitions.

## 2. Proposed topology and failure boundaries

Preferred topology, subject to device confirmation:

    Cashier PWA / Barista PWA
             | authenticated HTTPS commands and WSS updates over cafe LAN
             v
    Local hub: durable database + command handlers + print queue + sync outbox
             |                               |
             | native printer adapter        | outbound HTTPS sync
             v                               v
    Local sticker/receipt printer       Cloud service + database
                                             |
                                      Authenticated admin portal

Use a modular application, with modules for orders, payments, kitchen, printing, inventory, recipes/costing, loyalty, identity, imports and reporting. Avoid splitting these into independently deployed microservices initially.

An installed PWA may keep its shell and unsent commands in IndexedDB. Browser storage is not the shared branch database or the only durable copy of business records. The hub is the operational authority for its branch during service; the cloud stores acknowledged events and builds centralized reports. Every record is scoped to its business and branch where applicable.

Browsers connect to an explicit local server; do not assume a page can listen to arbitrary LAN broadcasts or write raw TCP print jobs. A printer adapter must support the actual printer language and transport; ESC/POS support alone does not prove sticker alignment, label gaps, or cutter compatibility. Local HTTPS trust, discovery/pairing and offline app availability must be tested on the actual tablets.

Internet loss with a healthy LAN/hub: continue sales, kitchen updates, printing and waste logging. Show cloud sync as pending. Router/LAN or hub loss: the cashier may retain a draft or queued command locally, but must not claim the kitchen received it or that a sale was centrally accepted. Establish a manual service fallback. Tablet loss before hub acknowledgement can lose local work; show the acknowledgement state.

## 3. Order, payment and kitchen state machines

Keep independent states rather than one ambiguous completed flag:

- Order: draft, submitted, cancelled, closed.
- Payment: unpaid, pending verification, paid, partially refunded, refunded, failed.
- Kitchen: not released, queued, preparing, ready, handed over, cancelled.
- Printing: queued, dispatched, failed, outcome unknown; use confirmed only if the hardware can report physical completion.

Confirmed user decisions C then A: support both kitchen release modes, configured by service type by an authorized admin. Initial configuration: dine-in uses `explicit_send`, permitting the cashier to Send to bar before payment; takeout uses `after_payment`, releasing automatically on confirmed settlement. If a dine-in order is paid before it has been explicitly sent, release it at settlement so it cannot be omitted from preparation. Other service types require an explicit configuration before activation. Snapshot the policy on each order so configuration changes do not reroute existing tickets. Changing service type after release must not undo preparation or create a duplicate release. Record release once with an idempotent command and preserve amendment history. Settlement of an already released order must not generate another kitchen ticket, print job or ingredient deduction.

The register must show payment and kitchen states separately. In explicit-send mode, provide a Send to bar action and show Sent / Unpaid until settlement; in after-payment mode, show that preparation starts after payment. KDS must identify unpaid tickets for operational awareness without exposing costs or margins. Audit service-policy changes and cancellations of unpaid prepared orders.

Each drink captures size, temperature, milk, sweetness, add-ons, quantity, dining option and table/order reference. Accepted changes produce amendments, not invisible replacement of an in-progress ticket. Ready tickets can be recalled with a recorded reason. Order timers use the hub's accepted timestamp and elapsed duration, not independently trusted tablet clocks.

For a price-changing correction after payment, the cashier requests manager approval for a cancellation or refund, then creates a new order. Keep the original settlement and tender history linked to the original order. Record the approved return separately. Notify the station if the original ticket was sent and keep the preparation disposition visible.

Confirmed consumption decision B: capture the recipe/BOM version and ingredient quantities when the order is released, then reserve those quantities. Post physical ingredient consumption once when the barista marks the drink ready, using the captured quantities and the applicable branch valuation at consumption time. Commit the ready state, reservation conversion, inventory movements and outbox messages atomically. For a ticket-level Mark ready action, consume only lines/quantities not previously marked ready; repeated taps, replayed events and recalled tickets must not deduct again. Track amendments and genuine remakes explicitly rather than treating recall as new consumption.

Sale revenue and tender are posted at settlement independently of kitchen readiness. Until a paid drink is ready, reports distinguish estimated/reserved ingredient cost from posted consumption cost. Do not present missing pending consumption as zero COGS. Preserve both valuation timestamps and original snapshots so reporting can explain these timing differences.

Cancellation before preparation consumes no ingredients and releases any reservation. If a drink is cancelled during preparation before ready, record actual used ingredients as a linked waste movement and release its outstanding reservation; unused quantities are not deducted. If a ready drink is cancelled/refunded, its ingredients are already consumed: record disposal/disposition without a second stock deduction, and restore stock only for explicitly recoverable material with approval. Post-preparation cancellation still requires owner/manager approval. Do not silently clear pending preparation or reservations at shift close; flag unresolved tickets for review.

## 4. Atomic writes, sync and reconciliation

Every command has an immutable event/command ID, business ID, branch ID, device ID, actor ID, payload/schema version, entity ID, expected entity version, device sequence, and occurred/accepted timestamps. Authority comes from the authenticated device/session; caller-supplied identity is not trusted.

Commit the accepted business mutation, its ledger entries and its outbox message within one local transaction. Return an acknowledgement only after that commit. Event IDs and ledger source references have unique constraints. Replaying a command returns its prior result rather than repeating payments, stock deductions or loyalty movements.

Sync uses acknowledged batches, retry with backoff, per-device cursors and per-entity versions. Delivery may repeat; effects must be idempotent. One global sequential queue is insufficient for concurrent devices. Server-side application order must respect entity dependencies; conflicts and rejected events remain visible for review. Never erase an unacknowledged event on retry failure.

Inventory is derived from ledger movements; do not synchronize it by overwriting quantities with each tablet's last value. Historical transactions retain their original price, recipe and cost versions. New configuration is versioned and activated prospectively. Offline devices retain the last valid published configuration and report its version.

Cloud acknowledgements, failures, lag and last successful sync must be inspectable. Cloud reports display an as-of time and pending-branch caveat. Background Sync is an enhancement; the active app and hub worker must also retry, since browser background scheduling is not universally available or guaranteed.

## 5. Recipes, quantities, inventory and costing

Use fixed-point decimal quantities with canonical units (g, ml, piece) and explicit purchase-to-stock conversions. Monetary totals use integer centavos or exact decimal arithmetic with one documented rounding policy. Never use floating-point subtraction as the stock authority.

Each recipe version contains the base BOM, variant changes and modifier replacements. Oat milk replaces whole milk unless the recipe explicitly calls for both. Extra shots add ingredients. Dine-in packaging differs from takeout. A syrup pump needs a calibrated ml conversion. Purchase pack size, usable yield and wastage allowances must be explicit inputs, not guessed.

Call the proposed stock model an append-only inventory movement ledger. The original received-minus-sales-minus-waste formula is not a double-entry model by itself. If balanced stock postings are implemented, name the source/destination stock accounts and require the postings to balance.

Stock equation:

    opening + receipts + transfer-in + approved recoveries + positive adjustments
    - consumption - unconsumed-stock waste - transfer-out - negative adjustments

Reservations reduce available-to-promise stock, not on-hand stock; convert each reservation to consumption once. Do not subtract both reservation and consumption from the physical balance. Record physical counts against a snapshot/version so concurrent sales do not corrupt the reconciliation.

Waste classification distinguishes grinder dial-in, spillage, expiry, damage and count discrepancy. Ingredients already deducted through a ready drink must not be deducted again when that drink is discarded. Ingredients actually used before a cancelled drink reaches ready require a linked waste deduction instead of a ready-consumption entry. Corrections use reversing entries, actor identity and a reason. Retain original records.

Receiving requires supplier, pack quantity, base-unit conversion and unit cost. Future inter-branch transfers will use dispatched/in-transit/received states and paired branch movements; their UI and execution are deferred from the single-branch first release. Low-stock evaluation uses the branch-specific threshold, with deduplicated alert lifecycle and acknowledgement.

Confirmed alert-channel decision A: show low-stock notifications in the owner/manager dashboard only for the first version. Include ingredient, branch, current quantity, configured threshold, alert status and last evaluated time. Maintain one active alert per ingredient/branch condition; acknowledging an alert does not resolve the shortage, and resolution follows replenishment or an authorized threshold change. Record acknowledgement and resolution history. Cloud dashboards show their last synchronized data and must not imply current branch stock during an outage. Staff retain the operational shortage warnings described below, without receiving admin-only financial data. Email, SMS and external push delivery are outside the initial notification scope.

Confirmed shortage decision B: show staff a warning identifying the affected operational ingredient/packaging and quantity shortfall, but permit the sale. Consider outstanding reservations when warning about available quantities. Apply consumption at Mark ready even if the stock ledger becomes negative; do not clamp to zero, omit the deduction or silently invent stock. Record the source order, branch and shortage for admin reconciliation, with deduplicated alerts. Do not expose ingredient purchase costs or margins in this warning. This policy concerns recorded inventory shortages; an explicit admin-disabled menu item remains unavailable.

Negative-stock reconciliation must preserve sales and consumption history. An authorized count correction or missing receipt resolves the quantity through new ledger entries. Costing on uncovered quantities remains provisional/unresolved under the valuation policy below; permit the sale without presenting an incomplete margin as final. Surface the affected transactions and reconcile valuation through auditable adjustments rather than rewriting their original cost snapshots.

Confirmed costing decision A: use moving weighted average for each ingredient within each branch. On receipt, calculate new average unit cost = (existing inventory carrying value + received inventory cost) / (existing base-unit quantity + received base-unit quantity). Record quantities and costs in canonical units and use exact decimal arithmetic. Example: 1,000 g valued at PHP800 plus 1,000 g received for PHP1,000 gives 2,000 g valued at PHP1,800, averaging PHP0.90/g. An 18 g recipe portion then has an estimated bean cost of PHP16.20.

Apply each receipt and its cost update atomically in the branch ledger's accepted order. Consumption and waste remove carrying value at the applicable recorded average; receipts update the average. Transfer-out carries source cost, which enters the destination's weighted-average calculation on receipt. An unreceived supplier quote or a price-field edit must not revalue existing stock; future estimates may show such a scenario separately. Define treatment of recoveries, valuation rounding and approved cost corrections before production. Zero or negative stock must not cause division by zero or fabricated valuation: flag costing as unresolved and require reconciliation under an explicit policy.

Separate current recipe estimates from transaction cost snapshots. Receipt-driven average changes update future recipe estimates; they must not rewrite historical sale costs or margins. Missing costs are flagged as incomplete, never treated as zero. Recipe-based cost remains an estimate until actual yield and consumption are validated.

## 6. Revenue, payments, refunds and OPEX

Define gross sales, discounts, refunds, tax, service charges, net sales, estimated COGS and gross profit separately. Gross profit is net sales minus COGS; gross margin is that amount divided by net sales. Zero net sales produces an undefined margin displayed as a dash. Compare periods on the branch business date with Asia/Manila as the initial reporting timezone.

Keep cash received and change separate from sale revenue. Track tender allocations, external payment reference and verification state. Recording a tender does not authorize a card or e-wallet charge. Provider-dependent payments cannot be promised offline without an approved provider flow. Refunds, voids, discounts and price overrides require explicit permissions and an audit reason.

Confirmed approval decision A: refunds and cancellations after preparation starts require approval by an authenticated owner or manager. Staff can request these actions but cannot self-approve or complete them by changing a client-side role. Bind approval to the specific order, requested action, amount/lines, reason and current order version; changes invalidate the approval. Record requester, approver, timestamps and resulting ledger reversals. A request alone must not mark a payment refunded or restore ingredients. External refunds still require actual provider confirmation. Offline approval is allowed only if the local authority can validate a currently permitted owner/manager session under the documented offline validity rules; otherwise keep the request pending.

Confirmed discount decision B: both approved presets and custom discounts require owner/manager approval for each application. Staff may request a discount but cannot activate it without approval. Bind approval to the order version, affected lines, discount type/value, reason and resulting total; edits affecting those values invalidate approval. Revalidate tender allocations and loyalty earning/redemption amounts after an approved price change. Record requester and approver; do not silently alter a settled sale. Confirmed follow-up decision B: loyalty redemption also requires owner/manager approval and cloud validation; neither gate substitutes for the other. Applicable tax or statutory-discount rules still require business-specific confirmation.

Confirmed first-version scope: accept cash and record manually verified GCash/card payments made using the cafe's existing external apps or payment terminals. There is no integrated gateway charge or automatic provider reconciliation in this scope. Cash settlement records amount received and change. External payment settlement requires staff to confirm successful payment using merchant-side evidence and record amount, tender type, available reference, verifier and verification time. Until verified, retain pending verification and do not trigger after-payment kitchen release. A customer screenshot alone is not merchant confirmation. Do not store full card numbers, security codes or payment credentials. Suspected duplicate external references require review rather than silently settling another ticket.

Internet loss in the POS does not prove the external provider is offline or online. Recording a verified external payment locally is supported when the hub is available; completing the external transfer or terminal charge depends on that provider's actual connection and authorization. Cash remains available through the local operational flow. Reversing a recorded external tender does not execute a provider refund; record the actual external refund confirmation separately.

Confirmed split-payment decision A: accept multiple tender allocations against one order, for example PHP100 cash plus PHP65 verified GCash on a PHP165 balance. Give each tender its own immutable ID, amount, verification state and external reference where available. Display amount due, confirmed allocations, pending allocations and remaining balance separately. Settle the order only when confirmed allocations exactly cover the payable amount after discounts and points; cash change is not a tender allocation. Validate allocation updates atomically against the current order version to prevent simultaneous terminals from over-settling it. Partial funding does not trigger takeout kitchen release or credit earned loyalty points. Settlement triggers those effects once per order, not once per tender.

Pending or failed external tenders must not erase already confirmed payments; preserve partial funding across retries and app restarts. Changing an externally confirmed allocation requires an audited correction/refund, not deletion. Refunds track the original tender allocations and actual external refund confirmations. The payment screen must support adding a tender, verifying external payment and reviewing the remaining balance before completion.

Confirmed partial-refund allocation decision B: an authenticated owner/manager selects how the approved monetary refund is distributed across the original tenders. Each allocation is capped by that tender's original confirmed amount minus completed refunds and pending refund reservations. Require allocation totals to equal the approved monetary refund, excluding the discount value returned as loyalty points. Validate and reserve refundable amounts atomically to prevent concurrent over-refunds. Example: for PHP100 cash plus PHP65 GCash with no prior refunds, a PHP50 partial refund may be allocated entirely to cash; it cannot refund more than PHP100 through cash over the sale's lifetime. No allocation may route money through an unrelated payment method.

Bind the allocation to the manager's approval and order version. Track each refund leg independently: recorded cash payout, external refund awaiting confirmation, completed, failed or outcome unknown. A partially completed external refund must remain visible and must not be marked fully refunded. Retry under stable refund IDs without repeating completed legs; resolve uncertain external outcomes using merchant-side evidence. Cash payouts update the relevant drawer/shift ledger. Loyalty refund calculations use refunded sale portions, not the manager's tender split.

Confirmed drawer decision C: support shared and separate cash drawers, configured by the owner through explicit register-to-drawer assignments. Registers on one shared drawer contribute to the same drawer shift; registers on separate drawers have distinct balances and closing counts. Scope each drawer to its branch and allow at most one open shift per drawer. Initial assignments require confirmation of the actual counter equipment; do not invent physical drawers from tablet count.

Track shift open/close, starting float, cash pay-in/out, net cash sale allocations, actual refund payouts, expected cash, counted cash and variance. Every cash movement records drawer ID, shift ID, register/device, actor and source event. Count a split sale's net cash allocation only, not the full order or cash tender before change; exclude GCash/card allocations from drawer cash. Serialize cash writes and shift closure through the local branch authority, returning explicit conflicts for stale writes. A cash action requires an assigned drawer with an open shift.

Confirmed closing decision A: staff submit a blind physical cash count. Do not send expected drawer cash or computed variance to staff UI, API responses, caches, exports or closing-print payloads; these are owner/manager-only throughout closing. Show staff their entered count and submission status without revealing whether it matches. Commit the counted amount, count version, actor, drawer, shift and timestamp before reconciliation. Validate closing against the authoritative drawer ledger so shared-register activity cannot silently change the count basis. Retain the first submission; any recount is a new audited submission rather than an overwrite.

Confirmed finalization decision A: staff submission moves the shift to Awaiting manager review; only an authenticated owner/manager can approve final closure after reviewing expected cash, count and variance. Bind approval to the submitted count and ledger version. A stale approval cannot close against new movements. A requested recount creates a new blind submission while preserving prior counts; staff never receive expected cash or variance. Record reviewer, decision, timestamp and explanation for exceptions.

Confirmed closing-lock decision A: atomically pause new cash transactions and cash movements on every register assigned to a drawer awaiting closure approval. This includes cash tender allocations, cash refund payouts and pay-in/out entries; server-side enforcement is required. In-flight cash commands must either commit before the closing snapshot or fail explicitly without modifying it. Do not abandon an already accepted payment or silently move it to another drawer. Show Drawer awaiting approval with the option to use another explicitly assigned open drawer. Fully non-cash orders may continue through their normal payment-verification flow. Reopening for further cash activity requires an authorized audited return to Open and a fresh closing count; approval alone transitions to Closed and does not resume the old shift.

Snapshot drawer/shift identity on every cash movement; later register reassignment must not relocate history. Reassignment cannot silently transfer cash: reconcile open work and record any physical cash transfer as paired movements. Freeze the closed shift's ledger and record corrections through audited adjustments rather than reopening history implicitly. Refund payouts from later shifts belong to the drawer that actually pays out and retain the original sale reference. Aggregate daily reports separately from drawer reconciliation so shared shifts and multiple registers do not double-count transactions.

OPEX records have category, effective period, amount, author and attachments/references if used. Allocate monthly expenses using a documented rule. Show an estimated operating result only when period expenses and inventory costs are sufficiently complete; otherwise label missing inputs. Accounting/tax issuance requirements require separate confirmation before production use.

Confirmed invoice-scope decision C: defer the official-invoice versus internal-slip decision until the owner confirms the existing process and required scope. Do not assume either path is authorized for live checkout. Before production checkout, obtain the business details, actual tax/pricing configuration, applicable discount and invoice rules, document numbering requirements and the intended relationship with existing invoice issuance. Validate applicable requirements against current authoritative sources and the business's responsible adviser before implementation sign-off. Test/demo output must be clearly identified as such and must not imply approval for official invoice issuance. This pending decision does not block wireframe refinement or non-production prototyping.

## 7. Customers and loyalty

Capture only operationally needed name, contact, history and notes. Limit lookup access and list exposure for staff. Customer notes must be plain text and cannot confer permissions or alter transaction logic. Admin controls export and retention.

Store loyalty in its own append-only ledger. The brief's earning rate is 1 point per PHP100. Confirmed earning decision A: award whole points per settled transaction using floor(eligible spend in centavos / 10,000). Do not carry spending remainders across transactions or issue fractional points. PHP165 of eligible spend earns 1 point; PHP99 earns 0; PHP200 earns 2. Calculate from the transaction total, not separately per line or tender, and credit once per sale.

Confirmed earning-basis decision A: eligible spend is the amount actually paid after discounts and loyalty redemption. Example: a PHP200 eligible purchase less PHP20 of redeemed points leaves PHP180 paid and earns 1 point. Cash change and payment over-tender are not spending; a fully points-funded purchase earns 0 points. Tax/service-charge eligibility remains pending and must be configured explicitly before launch.

Confirmed redemption decision A: each redeemed point gives PHP1 off the eligible checkout amount (100 centavos per point). The cloud validates the redeemable balance and discount cap using exact monetary arithmetic. Redemption cannot exceed the eligible amount, make the checkout negative, or pay change in cash. Store redeemed points and the resulting discount explicitly in the sale snapshot. Still decide tax/service-charge eligibility, minimum redemption and whether points earned in the current sale may be used immediately.

Latest confirmed refund-points decision, 6 November 2026: require manager decisions for each points adjustment. This supersedes the earlier automatic proportional-adjustment decision. Create a pending owner/manager case linked to the approved refund and original sale. Record each reasoned reversal/restoration decision in the append-only loyalty ledger; retries must not duplicate the decision or its effects. Use original policy/value snapshots and retain prior adjustments for review. Cashiers cannot resolve the case. Refund only the appropriate monetary tender amount; restoring redeemed points must not also refund their discount value in cash.

The proposed cumulative whole-point rounding rule was not selected. The system must not silently apply it to refund adjustments. Exact eligibility, original-point caps and zero-adjustment handling still need their implementation contract. Preserve deterministic original line/discount allocations for the manager's review and reject duplicate effects across multiple partial refunds.

Confirmed spent-point exception decision B: if the required earned-point reversal cannot be covered by available points, create an owner/manager reconciliation case rather than automatically creating a negative balance. Preserve the original refund and intended points adjustment; do not treat the unresolved reversal as completed or execute it twice on retry. Do not silently skip it or recover it by deducting cash from the customer. The manager records the resolution and reason through audited adjustment entries; staff cannot resolve the case. Any automatic restriction of further redemption while a case is open requires a separately agreed policy.

Refund adjustments accepted offline queue for cloud processing and are not redeemable until acknowledged. Restoration expiry behavior must be defined before enabling an expiry policy.

Confirmed expiry decision C: provide an owner-configurable expiry policy, initially disabled so points do not expire. Record policy versions, effective times and the owner who changes them. Proposed implementation safeguard: snapshot the expiry policy and nullable expiry timestamp on each earning lot; later policy changes apply to newly earned points unless a separately approved migration explicitly changes existing balances. Do not silently assign expiry to previously non-expiring points. When expiry is enabled, apply idempotent expiry ledger debits to remaining unredeemed, unreserved points in each lot, using server time. Define duration, customer notice and treatment of refunded/restored points before enabling expiry.

Confirmed user decision A: earning may queue offline, while every redemption requires successful cloud authorization, including same-branch redemptions. Cached tablet or hub balances must never authorize redemption. Show offline-earned points as pending until acknowledged by the cloud; only the authoritative available balance can be redeemed. While cloud access is unavailable, disable redemption with a clear explanation and permit checkout without points.

Cloud authorization must atomically reserve/debit points against a unique checkout/redemption ID, with idempotent retries. A lost response has an unknown outcome: query that ID before retrying or changing the tender; never assume failure and issue another debit. Finalize the redemption with the accepted sale, or release/reverse it through a recoverable workflow if the sale is cancelled. Surface unresolved reservations for reconciliation. Prevent duplicate earning credits on replay. Refunds apply the confirmed proportional reversal/restoration policy above.

Confirmed redemption-approval decision B: the cashier requests a specified number of points against a named customer and order version. An authenticated owner/manager approves that request, then the cloud validates the approval and atomically authorizes the points reservation. Bind the approval to customer, order, requested points, discount amount and approval validity; changing them requires a new approval. Do not deduct points or reduce the checkout total while either gate is pending. Disable redemption offline even when a manager is present. If approval is denied or unavailable, permit checkout without redemption. Show Requested, Awaiting approval, Validating points, Applied and Failed states without exposing admin-only data on staff devices.

Confirmed inactivity decision C: the owner may configure the inactivity period, initially 30 days without a qualifying purchase. Proposed classification rule: compare the most recent settled, not fully refunded purchase against the reporting date using Asia/Manila calendar dates; inactive at 30 elapsed calendar days or more, active below that threshold. Profiles with no qualifying purchase are a separate No purchases segment, not inactive customers. A pending or cancelled order does not reset last purchase. Customer merges and refunds must recompute the qualifying history consistently.

Audit threshold changes and refresh segment counters together using one reporting snapshot and as-of timestamp. The dashboard labels the configured period and filters profiles when a counter is selected.

Confirmed VIP decision C: the owner selects either lifetime spending or completed-purchase count as the qualification rule and sets the threshold. Do not invent a starting threshold: show VIP as Not configured until a valid rule and threshold are saved. For spending, use settled customer spending net of refunds, excluding cash change; for purchase count, count qualifying settled orders rather than individual tenders and exclude fully refunded orders. Recompute after customer merges and refund adjustments. Audit policy changes and refresh the dashboard and profile labels from the same policy version. Proposed display rule: VIP is an independent label, so a VIP may also be active or inactive; never add overlapping counters as if they partitioned total customers. This overlap rule remains a recommendation until confirmed.

Counters must come from the defined rules, not invented labels. Order history and lifetime spend must account consistently for refunds and customer merges.

## 8. Authentication and authorization

Store salted PIN/password hashes rather than reversible encrypted credentials. A four-digit PIN is only a proposed fast-unlock mechanism on an enrolled device; add attempt throttling, lockout, session timeout, device revocation and offline access expiry. Owners use stronger authentication. Do not embed signing secrets or admin credentials in browser bundles.

Cashier permission covers retail checkout and permitted customer operations. Barista permission covers assigned kitchen tickets and waste. Manager permissions are granular (refunds, stock adjustments, recipe changes, imports); owner permissions include role/device management. Enforce business/branch/object authorization on local and cloud endpoints.

Use positive allowlists for operational API responses, broadcasts, IndexedDB records, caches, print payloads, sync downloads and logs. Exclude ingredient costs, margins and OPEX from every staff channel. Staff waste entries may contain ingredient identifiers, names and units; these are operational exceptions to the original menu-only wording.

An offline session cannot know of a cloud revocation immediately. Bound offline validity and document that limit. A shared tablet requires a new PIN check when switching staff. Audit mutations with actor/device IDs; exclude PINs and sensitive customer values from diagnostics.

## 9. CSV migration

Import is an admin-only staged process: upload, classify, map fields, preview, validate, confirm, commit and report. Support file selection and keyboard access as well as drag/drop. Validate limits, CSV parsing, required columns, numeric values, units, duplicate SKU/handle/variant identifiers and branch mapping.

Do not assume Loyverse menu quantities contain recipe grams, purchase costs, modifier recipes or meaningful raw-material opening stock. Import only supplied, mapped fields and explicitly flag the rest for completion. No fabricated conversions or costing inputs.

Opening stock is an auditable ledger event, not a direct balance overwrite. Distinguish a new opening import from later corrections, avoid adding stock twice, identify repeated file/row imports, and require explicit update/skip choices for existing records. Store source references and row-level error reports. Use atomic validated chunks with progress and safe resume. CSV exports must neutralize spreadsheet formula injection in untrusted text.

## 10. UI additions required before implementation

- Register: acknowledgement/payment state, visible print failures and authorized reprint action; drink customization and tender screens; refund/cancellation request and manager approval states.
- Barista: preparing/ready controls, amended/cancelled item treatment, recall, plus queued-order access beyond six visible tickets.
- Waste: reason and quantity confirmation, saved/pending/error state, and correction route.
- Admin: stock receiving/count flows, recipe versions and costing warnings, refunds/cash shifts/OPEX, customer-segment definitions, and CSV preview/errors. Defer transfer UI and branch-switching controls until multi-branch activation.
- Settings: enrolled devices, printer test/calibration, staff permissions, sync diagnostics and backup/restore access.

Keep the approved main layouts; these can be supporting dialogs, drawers or tabs rather than new top-level navigation entries. They are requirements here and have not yet been drawn or implemented.

## 11. Recovery and acceptance gates

Back up the local hub automatically to encrypted storage when connectivity permits; define recovery-point and recovery-time targets, retention and restore ownership. A restore must retain event IDs/cursors to avoid reposting historical sales. Alert on storage exhaustion, queue backlog and failed backups. Verify recovery through a restore drill.

Before accepting this architecture, demonstrate on actual supported devices:

1. Internet disconnected with LAN intact: accept sale, route/acknowledge kitchen ticket, print label, record waste and recover after app restart.
2. Replay one event batch repeatedly and concurrently: one revenue effect, one stock effect and one loyalty effect per source event.
3. Reconnect two devices with conflicting edits: preserve accepted history, reject stale commands and expose a reviewable conflict.
4. Printer timeout after possible print: show uncertain result; explicit reprint is marked as duplicate and does not create a second sale.
5. PIN/session expiry, cross-role requests and staff-cache inspection: no unauthorized data or mutations; successful local restore retains unsynced records.

Also validate refund/stock disposition, modifier unit conversions, repeated CSV imports, concurrent loyalty debits, hub/LAN failure fallback, reported totals and timezone boundaries. This list specifies future checks; none have run against a backend yet.

## Reference checks

- Web Bluetooth has limited availability, uses BLE, and requires a secure context: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
- WebSocket clients use an explicit connection to a server: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Browser background sync support and lifecycle must be checked: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
