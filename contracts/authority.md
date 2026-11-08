# Authority API v1

This contract defines the first implemented hub slice. Full order, payment, inventory, approval, loyalty and sync APIs remain subsequent work.

| Method and path | Actor | Input / output |
| --- | --- | --- |
| `GET /health` | Public | Minimal ready status after a database query; no filesystem paths. |
| `POST /api/v1/auth/staff` | Enrolled staff device | Strict `{accountId,pin,deviceId,deviceSecret}`; returns token, expiry and safe actor projection. |
| `POST /api/v1/auth/admin` | Admin | Strict `{accountId,password}`; returns token, expiry and safe actor projection. |
| `GET /api/v1/me` | Authenticated | Safe actor and expiry; authority is derived from the session. |
| `GET /api/v1/authority` | Manager/owner | Exact `{authorityId: UUID,branchId}` for binding durable admin commands to the authenticated database. |
| `POST /api/v1/auth/logout` | Authenticated | Revokes the current token. |

| Method and path | Actor | Input / output |
| --- | --- | --- |
| `GET /api/v1/staff/context` | Cashier/barista | Cashier module only, or station/waste modules; no privileged financial fields. |
| `GET /api/v1/admin/context` | Manager/owner | Admin module navigation; no credential hashes. |
| `GET /api/v1/devices` | Owner | Branch-scoped devices with id, version and revoked flag. |
| `POST /api/v1/devices/:id/revoke` | Owner | Strict `{commandId: UUID,expectedVersion: integer}`; atomic device version change and safe receipt/outbox. |

Success authentication output: `{token,expiresAt,actor:{id,displayName,role,branchId}}`. Device revocation output: `{commandId,device:{id,branchId,version,revoked:true}}`. Unknown body keys are rejected. Token, device and account identifiers are never taken from a claimed request role. An exact command replay does not require the old entity version to remain current, but does require current authorization.

Errors use `{error:{code,message},requestId}`. Invalid credentials use a generic response. Validation is 400; authentication 401; permission 403; missing branch object 404; command or entity-version conflict 409; throttle 429. Public errors never include SQL, secrets or stack traces.

Operator provisioning is a trusted CLI/bootstrap interface, not a public signup endpoint. No default production users or credentials are bundled. The test fixture methods are unavailable over HTTP.

Schema 11 seeds one authority UUID atomically when the database upgrades. Restart and backup preserve it; a fresh database receives a different identity. A missing or invalid stored identity fails startup instead of silently replacing it. New admin clients send `X-Kape-Doz-Authority` on authenticated requests. When present, the hub validates this UUID after authentication and before rate-limit accounting or business/status operations. A mismatch returns `409 authority_mismatch` without business effects. Explicit CORS origins may use this header. Headerless existing staff clients remain compatible. See [admin recovery](admin-recovery.md).
