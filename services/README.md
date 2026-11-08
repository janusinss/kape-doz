# KAPE DOZ authority service

The persistent hub handles enrolled-device staff login, admin sign-in, device revocation, catalogue and quantity receiving, drawers, split/pending tenders, kitchen release, ready consumption, raw waste, blind shift review and operating expenses. Schema 6 adds dated settlements, inventory valuation and estimated profit. Schemas 7–8 add discounts, cancellations and preparation disposition. Schema 9 adds manager refund allocation, per-tender payout records, actual-shift cash debits and refund-date reporting. The Flutter staff client and separate admin portal connect to these APIs. Cloud synchronization, loyalty and hardware adapters remain open. See the [approval contract](../contracts/order-approvals.md), [cancellation contract](../contracts/order-cancellations.md) and [refund contract](../contracts/refunds.md).

Schema 10 records controlled terminal business rejections with their original command identity. A rejected retry cannot become a later accepted mutation. Accepted and rejected receipts support scoped staff recovery; transport, authentication and infrastructure failures remain unresolved. See the [recovery contract](../contracts/staff-recovery.md).

Schema 11 binds the admin client to a persistent hub identity. Schema 12 records versioned changes to sent orders, manager decisions, station acknowledgment, measured waste and reservation changes. See [admin recovery](../contracts/admin-recovery.md) and [sent-order amendments](../contracts/sent-order-amendments.md).

## Development checks

From this directory:

```powershell
npm ci --cache '..\scratch\npm-cache'
npm run check
npm test
npm run test:coverage
```

Use Node 22.21.x. The lockfile pins dependency resolution. `node:sqlite` is experimental in this runtime; tests use actual isolated SQLite files under workspace `scratch/authority-tests/`. No real customer data or café credentials are used.

## Operator setup

Set the environment variables listed in `.env.example` through the host's protected environment configuration; this service does not automatically load `.env`. Choose a durable database path outside publicly served directories. Provision each account/device with `npm run bootstrap`. Every provisioning call needs explicit identity, branch, kind and secret values. Account roles are cashier, barista, manager or owner; kind `device` creates an enrolled device. Existing identities are not overwritten. Generate a high-entropy device secret of at least 32 characters; staff PINs contain 4–8 digits; admin passwords contain at least 12 characters and at most 72 UTF-8 bytes.

There are no built-in accounts or default passwords. Trusted provisioning methods are available to local operator code only, not public HTTP routes. Normal device revocation is owner-authorized and recorded through the command endpoint. Later software slices must provide the rest of the authenticated account/device management experience.

Set `KAPE_DOZ_DATABASE_PATH` before `npm start`. Default binding is `127.0.0.1:8787` for local development. Non-loopback binding requires a certificate/key through `KAPE_DOZ_TLS_CERT` and `KAPE_DOZ_TLS_KEY`; real LAN deployment must use a certificate trusted by the clients. Raw database files, secrets and service sources must never be exposed through Apache or a public static server. The included `.htaccess` denies Apache access to this service folder when its configuration permits overrides; deployment still needs an explicit protected storage configuration.

Browser clients require `KAPE_DOZ_ALLOWED_ORIGINS`, a comma-separated list of exact origins. HTTPS origins and explicit loopback development origins are accepted; all other browser origins are rejected. No wildcard CORS or ambient credential cookies are enabled. Native Android clients authenticate with bearer sessions and do not need an Origin header. See [service-loop contract](../contracts/service-loop.md) for quantities, payments, retry behavior and strict role boundaries.

## Scope and evidence

See [authority API](../contracts/authority.md), [expense ledger](../contracts/operating-expenses.md), [architecture decisions](../docs/ARCHITECTURE_DECISIONS.md) and [goal status](<../WIREFRAME + FLOW/VERIFICATION STATUS.md>). Pending outbox records establish local durable acceptance. Cloud delivery and physical-device compatibility have separate acceptance checks.
