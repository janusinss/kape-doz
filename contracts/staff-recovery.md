# Staff enrollment and command recovery

Persist one encrypted version-1 state containing a validated enrollment and at most one pending command. Android uses private application storage protected by Android Keystore and an atomic durable write. The web review preview uses an explicit memory adapter. PINs and session tokens remain in memory. Unreadable or unsupported state blocks operation and retains the stored bytes for recovery.

## Dart contract

`StaffRecoveryStorage` exposes `bool get durable`, `Future<String?> read()`, and `Future<void> write(String value)`. Completion of a durable write means the adapter has committed the replacement. Failures throw without silently deleting the original file.

The Android adapter sends its previously read value with every replacement. A process-wide native lock compares that expected value with current storage before committing. A stale writer receives a failure and must reload before retrying.

`StaffEnrollment({required Uri hubOrigin,required String deviceId,required String deviceSecret})` is immutable.

`PendingStaffCommand({required String commandId,required String label,required Uri hubOrigin,required String deviceId,required String actorId,required String branchId,required HubRole role,required String path,required Map<String,dynamic> payload,int? expectedVersion,required int createdAt})` deeply copies its JSON payload and rejects credentials, invalid scope, unsupported routes, unsafe numeric values and unsupported staff roles. Its `matches({required Uri hubOrigin,required String deviceId,required HubActor actor})` method verifies origin, device, actor, branch and role.

`StaffRecoveryState` exposes nullable `StaffEnrollment enrollment` and `PendingStaffCommand pending`.

`StaffRecoveryStore(StaffRecoveryStorage storage,{bool allowInsecureLoopback=false})` exposes `bool get durable`, `Future<StaffRecoveryState> load()`, `Future<void> saveValidatedEnrollment(StaffEnrollment enrollment)`, `Future<void> savePending(PendingStaffCommand command)`, and `Future<void> clearPending(String commandId)`. Mutations serialize and read existing state before replacing it. Saving a different pending command or changing enrollment with unresolved work fails. Clearing checks the original ID. `MemoryStaffRecoveryStorage` implements the same interface for tests and preview.

All controlled failures use `StaffRecoveryException.message`. Error strings and object stringification exclude device keys, PINs, tokens, raw payloads and storage contents. Invalid or future records never trigger a reset.

## Staff integration

The staff app accepts an optional shared `StaffRecoveryStore recoveryStore` and `Future<void> Function(HubActor)? onAuthenticated`. It loads state before permitting mutations. Successful staff authentication saves validated enrollment and invokes the callback before operational data becomes usable.

Replace callback-only pending actions with declarative paths, named versions and payloads. Save the journal before transmitting its original UUID through `HubClient.mutate`. A failed save prevents the POST. Logout, expiry and unauthorized responses clear the session while retaining unresolved commands.

`HubClient.commandStatus(String commandId)` validates accepted, rejected or unrecorded for a matching command ID. Accepted and rejected status permit authoritative refresh followed by conditional durable cleanup. Unrecorded is a point-in-time observation and retains the original command for exact retry. Another actor, role, branch, device or hub cannot replay it.

A confirmed accepted POST is cleaned up before new mutations are enabled. Failed cleanup keeps the original descriptor locked for reconciliation. A raw error response alone never permits cleanup. A rejected lookup refreshes current records before clearing the matching journal; a rejected order creation preserves the local cart. Interrupted local cart editing remains separate pending work under F01-03.

## Terminal business rejection

Schema 10 preserves earlier receipts as accepted. A controlled business rejection (HTTP 400, 404, 409 or 413 thrown during the business operation) rolls back all partial business effects to a savepoint. The outer transaction records the original command ID, actor, branch, device, action, target/payload fingerprint and error. Its receipt, audit and outbox commit together before the HTTP rejection is returned. The audit/outbox action ends in `.rejected`; raw submitted payloads and credentials are excluded.

An identical retry returns the same rejection even if the order, drawer or stock later becomes eligible. A different actor, device, action or payload cannot reuse that ID. A previously accepted receipt always wins before the operation runs. SQLite serializes the receipt check and operation, including concurrent connections.

The authenticated lookup returns exactly `{commandId,status:'rejected',action,rejectedAt,error:{code,message}}`. The timestamp is a nonnegative safe integer. Original actions may contain dots, underscores and hyphens. Lookup scope is the original actor, branch and enrolled device; other scopes receive `unrecorded`. This does not authorize them to retry the saved command.

Authentication/permission failures, schema validation before the operation, throttling and infrastructure errors have no terminal receipt. Their commands remain pending. Malformed lookup replies, unavailable refresh, changed sessions and failed durable cleanup also retain the journal. No client discard button bypasses this boundary.

A rejection confirms only that this command did not change hub records. It does not prove whether cash was physically handed over or an external provider transferred money. Staff must review those records and evidence before entering a replacement financial command.
