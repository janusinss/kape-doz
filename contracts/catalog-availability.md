# Catalog availability

The owner or manager can make a product unavailable or available again with a reason. Availability has its own version. Recipe versions and accepted price snapshots remain independent. Existing products become available when schema 16 is applied. A change, actor, before and after states, reason and command are recorded together.

Unavailable products remain visible with their status but cannot be added to a new order. A cashier with an unreleased order containing a newly unavailable product is prompted to replace it before continuing. A replacement retains the quantity and note. The original line and the replacement decision remain available for audit. If the price changes, the replacement requires an order without confirmed or pending tenders and without an applied discount. After payment, a price-changing correction follows manager-approved cancellation or refund and a new order. A same-price replacement preserves existing tenders and discount.

An external payment already pending can still be verified or rejected. The hub records confirmed money and a completed settlement even if the order is temporarily held for an unavailable item. It does not release that order until the unavailable lines are addressed. A same-price replacement that clears the final hold releases a fully settled order once. Cancellation and refund remain available to reconcile collected money.

An already released order retains its captured recipe and can proceed through preparation, payment, cancellation and refund. New sent-order additions, replacements and quantity increases check availability at request and again before manager approval dispatches a pending change. An amendment already dispatched to the station retains its captured recipe and remains completable.

## Interfaces

Owners and managers use `POST /api/v1/products/:id/availability` with a command ID, expected availability version, Boolean `available` and reason. The response contains the resulting product. Product projections contain `available` and `availabilityVersion`. Staff can view availability without financial inventory fields.

An unreleased order projection contains `unavailableLines`, each with `lineNo`, `productId` and `name`. `POST /api/v1/orders/:id/replace-unavailable` takes a command ID, expected order version, line number, available replacement product ID and reason. Exact command retries return the original receipt. Staff clients retain their cart and unresolved payment records if availability changed after their last refresh.
