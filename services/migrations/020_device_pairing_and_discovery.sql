CREATE TABLE device_pairing_codes (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  account_id TEXT REFERENCES accounts(id),
  hub_origin TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
