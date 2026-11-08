# KAPE DOZ — Mobile app project handoff

**Audience:** developers and designers  
**Status:** design handoff; flow maps and wireframes describe intended behavior, not a production-ready implementation.  
**Primary design source:** [`wireframes/kape-doz.pen`](../wireframes/kape-doz.pen), including the eight detailed flow maps.  
**Related working specification:** [`BACKEND_ARCHITECTURE.md`](../BACKEND_ARCHITECTURE.md). Its PWA-specific proposal predates the Android-first decision and must be revised for the mobile client.

## 1. Product and device scope

KAPE DOZ is a café point-of-sale system for cashiers, baristas and administrators. The first installable staff app targets **Android tablets and phones**, with a tablet-first counter layout and phone adaptation. Administrators use a **separate responsive web portal** for tablets and computers, confirmed during execution planning, with stronger separate sign-in. The agreed goal is complete software with passing software checks; actual physical-device checks are tracked separately.

The first release is planned for one branch. A powered-on local hub is the proposed shared authority for offline service, but its actual hardware, network arrangement and printer support remain unconfirmed. Staff accounts have **one assigned role each**: cashier or barista. An employee who needs a different role must use an appropriately assigned account; do not infer automatic role switching.

### Design assets and navigation

- The editable `.pen` file is the source of truth for layouts. Its lower canvas contains eight numbered flow maps; staff and admin screens are grouped separately.
- Staff sign in using an individual PIN. Cashiers see cashier functions; baristas see the station and waste functions. Admin screens belong to the separate admin experience.
- Main screens use role-specific navigation. Workflow screens provide a back action. On phones, adapt navigation and panels without removing the assigned role's functions.
- Wireframe prices, names, metrics and orders are examples, not verified client data.

## 2. Roles and permissions

| Role | Intended access | Boundaries |
| --- | --- | --- |
| Cashier | Open/close shift, create orders, collect payments, request approvals, print a paid receipt, view operational issues | No barista navigation or admin-only costs, margins, expected drawer cash or variance. |
| Barista | View and prepare station orders, mark ready, recall, log waste and dial-in | No cashier or admin navigation. |
| Owner/manager | Separate admin sign-in; sales, recipes, inventory, customers, settings, approvals and shift review as assigned | Only authorized owner/manager accounts approve restricted actions and review financial controls. |

Enforce permissions in the application services and data access as well as in navigation. Screen visibility alone is not a security boundary. Admin approval authority and employee access must be checked against the authenticated account.

## 3. Flow 01 — Staff access and cashier

1. **Sign in:** select the staff account and enter its PIN. On failure, retry or ask a manager for help.
2. **Apply the role:** the system opens the cashier experience for a cashier account. Barista accounts follow Flow 02.
3. **Open shift:** enter opening cash and open the cashier shift. Drawer assignment and real equipment details require client confirmation.
4. **Create or select an order:** choose dine-in or takeout, add products and quantities, and attach a customer when needed.
5. **Customize:** choose applicable size, milk, sweetness and notes. Add the item to the order and review the ticket and total.
6. **Choose the order branch:**
   - **Dine-in:** explicitly send the order to the barista before payment; keep the unpaid order available for later settlement.
   - **Takeout:** collect and confirm full payment before the order is released to the barista.
7. **Collect payment:** select cash, GCash or card and record the amount. GCash/card are manually verified in the external merchant app or terminal before confirmation. Multiple tenders can settle one order; the balance remains visible until fully paid.
8. **Complete payment:** after full confirmation, enable **Print receipt** on the payment screen. Printing is optional and does not open a separate receipt page. Return to cashier for the next order.
9. **Modify sent dine-in orders:** notify the barista of changes. A cancellation follows manager approval and notifies the barista when applied. A price-changing correction after payment requires a manager-approved cancellation or refund followed by a new order. Keep the original settlement and tender history. Resolve outstanding tickets during shift review.

The receipt's legal classification and required contents must be confirmed before live checkout. Printing behavior in the wireframe is a design decision, not proof that a printer integration exists.

## 4. Flow 02 — Barista and waste

1. Sign in with the assigned barista account and PIN. Open the station or waste functions.
2. Receive dine-in orders after the cashier sends them; receive takeout orders after full payment. The station is designed to show six active cards.
3. Review order number, elapsed time, items, quantities, modifiers and notes. Surface changes and cancellations to the barista.
4. Prepare the drinks and select **Mark ready** when the order is complete. The ready order leaves the active queue; use **Recall** to find an order marked ready.
5. For waste or dial-in, select the entry type, ingredient, quantity, unit and reason. Review and save, then return to the station.
6. Finish assigned work and sign out or switch user. Record outstanding service issues for the next shift.

**Stock relationship:** the working specification calls for reservation at kitchen release and a single ingredient deduction when the drink is marked ready. Waste and cancellation movements must avoid a second deduction for ingredients already consumed. These are design requirements, not verified current behavior.

## 5. Flow 03 — Admin sign-in, sales and customers

1. Sign in through the separate administrator experience. Navigate to Sales, Recipes, Inventory, Customers or Settings according to permission.
2. Open **Sales & margin**, choose a reporting period, and review sales, estimated gross profit, margin charts and top products. Identify data that needs investigation; report freshness and unresolved costs must remain visible when relevant.
3. Open **Customers** to review customer counts, visits, returning customers and available loyalty activity. Search for and select a customer to review their available information.
4. Open manager approvals to review a cashier's request and reason. Approve or deny within the account's authority.
5. Review submitted shifts: compare expected and counted cash and the difference; approve closing or request a recount. Expected cash and variance are manager-only.
6. Navigate to another permitted area or sign out.

The first portal includes operating expenses and estimated operating profit alongside sales and ingredient margins. Owner and manager accounts can access these figures. Recurring costs are spread across the calendar days they cover. One-time expenses appear on their effective date. Partial periods must reconcile to the original amount down to the centavo. The system automatically deducts the ingredient cost of recorded waste and espresso dial-in as a separate loss. Approved physical count shortages appear as a separate stock-loss deduction. The portal must flag incomplete expense, loss or ingredient-cost inputs before presenting an operating result.

## 6. Flow 04 — Recipes and inventory

1. Open **Recipes & raw materials**, search for a product and review its selling price and recipe.
2. Add ingredients with quantities and units, including applicable variant and modifier effects. Review estimated recipe cost and margin, then save.
3. Open **Inventory & thresholds** and select a raw material to inspect stock on hand, unit, recent activity and low-stock threshold.
4. Start a physical count from the saved stock snapshot. Enter the amount in the ingredient's stock unit and review the difference. An authorized admin approves the adjustment with a reason. If the count finds extra stock, the approved adjustment updates the quantity and the manager confirms the cost separately. Inventory shows that cost as pending until confirmation.
5. Review low-stock alerts and affected recipes. A recorded shortage warns staff but does not by itself prevent a sale; reconcile the shortage without erasing transaction history.
6. Review costs after relevant ingredient changes. The working specification selects branch-scoped moving weighted-average costing; actual units, pack conversions and recipes require client data.
7. Continue to another admin section or sign out.

## 7. Flow 05 — Settings, devices and CSV migration

1. Open **Settings** and choose the relevant business, staff, devices, sync or migration area.
2. Manage staff accounts and their single assigned role; administrators use separate stronger sign-in.
3. Open **Devices & printers**, select receipt or label printer and configure the supported connection. Verify the actual printer model, protocol, tablet OS and network before implementation or purchase decisions.
4. If printing fails, show the issue and inspect job status before retrying to reduce duplicate printouts. Receipt printing remains optional after full payment.
5. For CSV migration, select the data type and file. Map source columns to destination fields and run validation.
6. Preview additions, updates, duplicates and errors. Return to mapping or resolve issues before confirming; review the import result.
7. Review available sync and backup settings. Backup, restore, printer setup and recovery details remain dependent on confirmed equipment and implementation.

## 8. Flow 06 — Exceptions, recovery and shift close

### Restricted actions

1. The cashier requests manager approval for a discount, refund or cancellation, giving the reason.
2. The manager reviews and approves or denies. The cashier continues according to the decision.
3. For an approved cancellation of an order already sent to the bar, notify the barista. Handle preparation and ingredient disposition without duplicate stock deductions.

### Payments and printing

1. Record each confirmed partial payment against the outstanding balance. Release takeout and enable receipt printing only after full payment.
2. For GCash/card, verify the transaction in the external merchant app or terminal before confirmation. Failed or unverified payments must not be treated as confirmed.
3. Show printer failures and provide a recovery path. Check job status before retrying. A printer issue alone does not stop service when the local hub is available.

### Offline operation

1. When connection or printer issues occur, show the relevant status and pending work. Continue taking orders when the local hub is available.
2. Check hub, internet and pending sync status; retry synchronization when connectivity returns. Keep unacknowledged work visible.
3. The hub is intended to run continuously. Physical power provision, repair and the café's manual operating procedure are outside this system project's scope. If the hub is unavailable, the system must show that status and any pending work; do not assume normal multi-device operation without it.

### Shift close

1. The cashier performs a blind cash count, enters the counted amount and optional notes, and submits it for manager review.
2. The manager sees expected cash, counted cash and variance, then approves the close or requests a recount.
3. The working specification pauses cash transactions and cash movements on a drawer awaiting closure approval across assigned registers. Resolve pending tickets rather than silently closing them.
4. Sign out after assigned work and required approvals are complete.

## 9. Mobile implementation handoff

- **Responsive behavior:** keep tablet order entry and ticket review usable together; provide a clear phone-sized path between menu, ticket and payment. Preserve role-specific navigation and accessible back actions.
- **Touch and accessibility:** use legible text, sufficient contrast, large touch targets, clear focus/order and labels that do not depend on color. Validate on real tablets and phones.
- **Transactional integrity:** prevent duplicate payment confirmations, order release, printing retries and stock deductions. Preserve payment, order and inventory history through retries and recovery.
- **Financial separation:** never deliver purchase costs, margin reports or drawer variance to staff roles that lack permission. Store money and quantities with exact arithmetic and consistent units.
- **Verification:** test dine-in and takeout, partial payments, approval and notification branches, order-ready stock movements, disconnected recovery, printer failure and shift review. Physical devices, printers and the local network require separate real-world tests.

## 10. Open questions and delivery boundaries

| Topic | What needs confirmation |
| --- | --- |
| Hub and network | Exact always-on device, connectivity, system behavior during a hub disconnection, and tablet-to-hub behavior. Physical power and repair procedures are outside project scope. |
| Printing and checkout | Printer models, connection and label format; whether checkout produces an official sales invoice or an internal slip. Invoice scope is a live-checkout launch blocker in the working specification. |
| Operations | Actual products, modifiers, recipes, units, opening procedures, drawer assignments and approval account assignments. |
| Admin delivery | Separate responsive web portal confirmed; define the supported browsers and deployment/local-approval mode. |
| Business rules | Client validation of tax/discount details, loyalty and refund edge cases, customer definitions, and receipt contents. |

The eight flow maps and this document are handoff artifacts. Existing sample mobile code, if present, does not by itself establish that authentication, payments, printers, offline routing, inventory or production deployment are complete. Confirm implementation status and run appropriate tests before treating a capability as delivered.

## 11. Flow 07 — Customer loyalty and refunds

1. Attach an existing customer to an order. Customer enrollment, editing and consent screens require further design.
2. On settlement, calculate whole earned points from eligible spend after discounts and redemption. Earned points may queue offline until acknowledged. The documented starting rate is one point per ₱100; one redeemed point gives ₱1 off eligible checkout.
3. Redemption requires both manager approval and cloud authorization. If cloud authorization is unavailable, do not redeem; resolve an unknown authorization outcome before retrying. The latest refund-points decision (6 November 2026) requires manager decisions for every adjustment; automatic cumulative rounding was not selected. Exact eligibility and caps still need their implementation contract.
4. For a refund, the cashier submits the order, relevant items, amount and reason for manager review. On approval, the manager allocates a partial refund across original tenders up to the refundable amount. External refunds require provider confirmation; show pending, failed or unknown outcomes and check status before retrying.
5. Create a linked manager case for each refund-related points adjustment. Record reasoned reversal/restoration decisions once, preserving original points and prior partial-refund adjustments. If available points cannot cover a reversal, keep it for manager reconciliation instead of silently creating a negative balance.

## 12. Flow 08 — Inventory, security and recovery

1. Receive stock by recording supplier, pack quantity, conversion to stock units and unit cost. Accept the receipt before updating stock and moving weighted-average cost.
2. Record physical counts against a versioned stock snapshot. Start a fresh count if stock moves before the count is submitted. After submission, apply the approved difference to the current balance so later receipts and consumption stay recorded. Preserve count history, approval reasons and the separate manager cost confirmation for any positive adjustment. An acknowledged low-stock alert stays active until resolved.
3. Release reserves ingredients; marking ready consumes them once. For cancellation or waste, record actual disposition without a second deduction.
4. Enroll and revoke devices; protect PIN access with throttling, lockout and session expiry. Exact settings and offline access validity need design and confirmation.
5. Distinguish work queued on a tablet from work acknowledged by the hub. A locally queued order must not be represented as accepted by the hub or received by the barista. Reconcile pending work after recovery and check uncertain payment or print outcomes before retrying.
6. If dine-in is paid before explicit send, release it once at settlement. Settlement of an already released order must not create another kitchen ticket. Queue overflow, collection/handover and recall behavior require further design.

## 13. Wireframe gaps to resolve

The maps describe required journeys, but several dedicated screens and states remain to be designed: loyalty identification and redemption, refund allocation and provider status, receiving and stock count, device enrollment and access recovery, pending/failed sync and print jobs, queue overflow and order handover, and import result/retry and backup/restore. Specify success, error, empty, permission-denied and offline states for each relevant flow. System behavior during hub disconnection and the operational equipment remain open decisions; physical power and repair procedures are outside project scope.
