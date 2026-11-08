CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL DEFAULT 'kape-doz'
) STRICT;
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cashier','barista','manager','owner')),
  credential_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  secret_hash TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT REFERENCES devices(id),
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1))
) STRICT;
CREATE INDEX sessions_device ON sessions(device_id);
CREATE TABLE auth_attempts (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (scope, subject)
) STRICT;
CREATE TABLE command_receipts (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
) STRICT;
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
) STRICT;
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged')),
  created_at INTEGER NOT NULL
) STRICT;
