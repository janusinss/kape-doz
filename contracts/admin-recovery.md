# Durable admin command recovery

## Scope

The separate admin portal stores at most one unresolved command per browser origin/profile. It must finish loading recovery state before enabling changes. Owner/manager authentication remains separate from staff PIN access. Passwords, session tokens, reports and credential fields never enter the recovery journal.

An authenticated admin session obtains the canonical API origin and `GET /api/v1/authority` identity before it can submit changes. Saved scope includes the origin, authority UUID, actor ID, branch ID and exact owner/manager role. After this initial bearer-authenticated handshake, every authenticated request sends `X-Kape-Doz-Authority`. A changed endpoint identity rejects the request before command execution, including status lookup. The UUID identifies the authority; it is not a credential.

## Descriptor and storage

`AdminRecoveryScope` contains `hubOrigin`, `authorityId`, `actorId`, `branchId` and `role`. A `PendingAdminCommand` adds the immutable mutation ID, allowlisted route, JSON payload, label and creation timestamp. The payload is copied before storage and transmission. Nested credentials, forged scope/command-ID overrides, unsupported routes, unsafe numbers and unsupported versions are rejected.

The browser adapter uses IndexedDB and WebCrypto. One nonextractable AES-GCM key protects a versioned encrypted state. Each replacement uses a fresh 96-bit IV. Envelope version, key identity and revision participate in authenticated metadata. The key and envelope are read consistently. Encryption/decryption happen outside the IndexedDB transaction; a readwrite transaction compares the original state before committing its replacement with strict durability. A stale writer cannot overwrite another tab's command or clear a newer command.

`AdminRecoveryStore.load()` returns the validated nullable pending command. `savePending(command)` rereads current state and refuses replacement of unresolved work. `clearPending(commandId,scope)` verifies the exact current ID and original scope before committing. Failures retain the prior record. Missing keys, authentication failure, corruption and future formats fail closed; there is no automatic reset or discard control.

Notifications between tabs contain no command payload. They request a reread; they do not grant mutation authority. Transactional comparison protects the journal even if a notification is delayed or lost. One shared pending command deliberately blocks competing new changes until the original operation is resolved.

## Send and recovery sequence

1. Validate the descriptor against the current authenticated scope.
2. Commit the immutable command to the journal.
3. Recheck the current session and original scope.
4. Send the original command ID and payload to the bound authority.
5. Clear only the matching journal after confirmed acceptance or terminal recovery.

On reload or browser restart, the portal requires a fresh sign-in. It displays no private journal payload before authentication. Another account, role, branch or hub cannot replay or replace the saved command. Sign-out and expiry preserve unresolved work.

Recovery uses the existing scoped accepted/rejected/unrecorded command endpoint. Accepted and rejected outcomes must match the original action and ID. An authoritative refresh precedes conditional cleanup and unlocking. A rejected command confirms no effect in hub records, not the outcome of a physical cash handover or external payment transfer. An unrecorded observation retains the saved ID and requires an explicit exact retry. Changed sessions, malformed replies, failed refresh and failed cleanup retain the lock.

## Boundaries

The nonextractable key protects against accidental plaintext exposure and detects tampering. Same-origin script execution or browser-profile control can invoke that key; this is not hardware-backed or password-gated storage. Browser data clearing/eviction and a lost browser profile can remove the journal. Software checks must report storage failures without inventing acceptance. Cloud backup and native Android Keystore verification are separate acceptance work.

Required evidence includes durable-before-send failure, accepted/rejected/unrecorded recovery, original-account and changed-hub refusal, cross-tab compare-and-swap, corrupt/future state preservation, actual browser restart, and unchanged authoritative ledgers on duplicate retries.
