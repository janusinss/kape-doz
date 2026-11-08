# KAPE DOZ admin portal

The portal connects to the KAPE DOZ hub for owner and manager sign-in, order approvals, refund review, drawer review, recipe creation, ingredient balances, stock intake, expenses and sales reporting. Owners and managers review discount and cancellation requests in Approvals. Refunds has its own workspace for approval, exact allocations against original tenders, and separate payout outcomes. External refunds are recorded from verified merchant evidence. Cashiers record actual cash payouts from an open drawer. Each request preserves its order version, amount, cashier and reason. Cancellation requests also show payment and preparation snapshots, followed by preparation resolution status. A denial requires a decision note. An uncertain submission keeps the same command for retry. Owners can review and revoke enrolled devices. The sales view deducts confirmed sales refunds from captured settled sales and shows returned unsettled payments separately. Historical ingredient costs, allocated expenses, recorded waste and cancellation preparation losses remain in their corresponding ledgers. Unresolved preparation or retained cancelled-order payments suppress profit estimates. Operating profit also requires complete valuation and confirmed expense coverage. See the [sales contract](../contracts/sales-report.md) for the captured scope and incomplete-data rules.

## Run locally

Use Node 22.21.x. From this directory:

```powershell
npm ci
$env:KAPE_DOZ_ADMIN_HUB_ORIGIN = '<actual loopback hub origin>'
npm run dev
```

Allow the resulting portal origin in the hub's `KAPE_DOZ_ALLOWED_ORIGINS`. For deployment, run `npm run build` and publish only the generated `dist/` files to the HTTPS portal host. Proxy `/api/v1` to the hub, or set `VITE_HUB_ORIGIN` before building for a separate HTTPS API. Allow the exact portal origin on the hub. Keep the source workspace, test fixtures and databases outside the served document root.

## Rehearse with synthetic data

1. Set `KAPE_DOZ_TEST_DATABASE_PATH` to a new file under `scratch/`.
2. Set `KAPE_DOZ_TEST_BROWSER_ORIGIN` to the chosen loopback portal origin.
3. Run `node --import tsx tests/fixtures/transport_hub.ts` in `services/`.
4. Launch Vite with the fixture hub origin and the chosen portal port.
5. Run the script below from the project root.

```powershell
.\admin\tests\rehearse.ps1 -PortalUrl '<running portal URL>' -FixtureHubUrl '<printed fixture hub URL>'
```

The rehearsal writes screenshots under `scratch/`. Use a fresh fixture for each run because the test closes a drawer and revokes the synthetic barista tablet. See the [verification record](<../WIREFRAME + FLOW/VERIFICATION STATUS.md>) for scope and results.

Use `admin/tests/rehearse-durable-recovery.ps1` with the same URL arguments to verify a full Chrome restart, exact retry, original-account checks, competing tabs and corrupt-state handling. The portal stores one encrypted pending command before sending it and requires a fresh sign-in after restart. The current checkpoint passes 50 admin tests and a production build. See [admin recovery](../contracts/admin-recovery.md).

Approvals now includes sent-item reductions, removals and replacements. The manager sees the saved before/after lines, totals and reason and records a decision. The current amendment checkpoint passes 54 admin tests and a production build. See [sent-order amendments](../contracts/sent-order-amendments.md).

Inventory supports saved physical counts, stale measurement refusal, reasoned approval/discard and separate cost confirmation for found stock. An authorized whole-balance review can restore a prospective value when later stock use made it unresolved. Sales shows count shortages as a separate stock-loss cost and deducts known losses from the operating estimate. See [count contract](../contracts/inventory-counts.md).

Run `admin/tests/rehearse-stock-counts.ps1` with the portal and fresh fixture URLs to exercise the rendered manager workflow. The rehearsal uses authenticated cashier/barista HTTP operations for concurrent receiving, preparation and waste. It drops a committed cost response, reloads the portal, checks both conflict paths, and closes the drawer. From `services/`, run `node --import tsx tests/fixtures/check_inventory_counts.ts <fixture.sqlite> <browser.log>` to reconcile the final trace. The current admin source passes 59 tests, type checking and the production build.

The Inventory workspace also configures low-stock thresholds and shows active and resolved incidents. Acknowledgment records a note while the condition stays active. Threshold changes retain their previous value, new value, actor and reason. The current alert and threshold-history source passes 64 admin tests and a production build. [Alert contract](../contracts/inventory-alerts.md)
