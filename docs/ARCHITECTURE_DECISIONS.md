# KAPE DOZ implementation decisions

## ADR 001. Authority foundation

Status: selected for the local software implementation, 4 November 2026.

The staff client remains Flutter Android. The owner/manager client is a separate responsive web portal. Each staff employee has one assigned cashier or barista role. Administrative authority uses a separate password sign-in channel.

The first shared authority is a Node 22.21 TypeScript/Fastify service with on-disk SQLite. The installed runtime was checked with a real `node:sqlite` query. Its SQLite API remains experimental in this runtime; keep the repository boundary explicit, pin the runtime and revalidate upgrades. A long-lived single writer connection uses foreign keys, WAL and FULL synchronization. Transactions contain no asynchronous work. The cafe's physical hub host is still unconfirmed; this implementation proves software behavior on this workstation, not equipment suitability.

The cloud adapter, PostgreSQL storage and admin portal remain required subsequent delivery. The local SQLite service must not be presented as an implemented cloud service. Deployment transport must use TLS; local development is bound to loopback until TLS is configured. No paid host or production deployment is authorized by this decision.

## ADR 002. Credential and command boundary

Store bcrypt credential hashes at cost 12 or higher. PINs require an enrolled device; administrative passwords use a distinct endpoint. Opaque 256-bit session tokens are returned once and stored only as hashes. Every protected request checks session expiry, account status and staff-device revocation. Initial session duration is configurable; 8 hours is an engineering default pending operational validation. Five invalid attempts in a 15-minute window trigger persistent account throttling; IP protection complements it.

The first real idempotent mutation is owner-authorized device revocation. Authenticate and authorize before reading any prior command receipt. Bind command ID to actor, target and validated payload. Persist the mutation, safe response receipt, audit event and pending outbox row together. Exact retries return the original result; changed payload or actor returns a conflict. Neither credentials nor raw session tokens belong in command receipts, audit payloads or outbox records.

Missing business-policy decisions remain in the handoff status register. This foundation does not select tax, invoice, loyalty rounding or real printer behavior.

## ADR 003. Durable admin recovery and authority binding

Status: selected for the software implementation, 6 November 2026.

The admin portal persists one immutable unresolved command per browser origin/profile before transmission. IndexedDB commits an AES-GCM encrypted journal and nonextractable origin key; transactional comparison prevents competing tabs from replacing unresolved work or clearing a newer command. Session tokens, passwords and reports remain in memory. Missing, corrupted and unsupported saved state blocks changes without a reset. Notifications are advisory; storage comparison remains authoritative.

Schema 11 assigns one persistent UUID to the logical hub database. Admin sign-in confirms its identity through the authenticated `/api/v1/authority` handshake. Subsequent requests carry `X-Kape-Doz-Authority`, checked before status or business operations. Saved commands bind the API origin, authority, account, branch and role. A fresh database receives a different identity. Intended backup/restore and database copies preserve their logical identity; this does not implement a complete backup or clone-reconciliation policy.

After reload or browser restart, a fresh original-account sign-in is required. Accepted/rejected receipts trigger authoritative refresh and conditional durable cleanup. An unrecorded operation keeps its original ID for explicit exact retry. Unknown outcomes, changed sessions, wrong scope and storage/refresh failures preserve pending work. The origin key is not password-gated or hardware-backed; same-origin script or browser-profile control remains a separate security boundary. Browser data removal can erase the journal. See [admin recovery contract](../contracts/admin-recovery.md) and the verification record for tested browsers and remaining scope.

## ADR 004. Manager decisions for refund-related loyalty adjustments

Status: explicitly selected by the user, 6 November 2026.

Every refund-related points adjustment requires an owner/manager decision. Automatic cumulative proportional rounding was offered and not selected. The implementation must create linked pending cases, preserve original/prior point entries and apply reasoned decisions once. This supersedes earlier automatic proportional-posting wording. Exact eligibility/caps and the adjustment-case implementation remain open; this decision does not certify CRM/loyalty as complete.

## ADR 005. Price-changing corrections after payment

Status: explicitly selected by the user, 6 November 2026.

When a paid order needs a price-changing correction, require manager approval for cancellation or refund, then enter a new order. Keep the original order, settlement and tenders available for audit. Apply the existing refund allocation and payout rules to any return of money. If the original ticket reached the station, notify the barista and preserve preparation disposition. This decision governs price changes after payment. Same-price preparation changes and line-level ingredient handling remain part of the amendment implementation.

## ADR 006. Cost confirmation for stock found during a physical count

Status: explicitly selected by the user, 6 November 2026.

Post an approved positive count variance to on-hand quantity. Record the cost as pending until an owner or manager confirms it. Keep the count, approval, quantity movement and later cost decision linked for audit. Availability follows the corrected quantity. Cost-dependent reports identify incomplete valuation until the relevant cost has been confirmed. Keep historical cost records intact and apply the confirmed basis prospectively. See the [execution plan](<../WIREFRAME + FLOW/EXECUTION PLAN.md>).

## ADR 007. Physical stock loss in operating profit

Status: explicitly selected by the user, 6 November 2026.

An approved count shortage contributes its recorded ingredient value to a separate stock-loss cost in the reporting period when the adjustment posts. Deduct this cost once from estimated operating profit. Show unknown stock-loss costs and leave the operating estimate unavailable when required loss values are missing. A positive count variance updates inventory value after confirmation without creating sales income.

## ADR 008. Disabled item on an unreleased order

Status: explicitly selected by the user, 6 November 2026.

If a manager disables a menu item after an order is created but before barista release, ask the cashier to replace the item before continuing. The implementation must preserve the order and any recorded or unresolved tenders. For a price-changing correction after payment, follow ADR 005 and the approved cancellation or refund followed by a new order. A pending external tender that the merchant later confirms must still be recorded accurately and remain available for manager reconciliation. Existing dispatched preparation retains its captured recipe and can be completed.
