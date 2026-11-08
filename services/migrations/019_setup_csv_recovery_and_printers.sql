CREATE TABLE branch_configs (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  receipt_header TEXT NOT NULL DEFAULT 'KAPE DOZ',
  receipt_footer TEXT NOT NULL DEFAULT 'Thank you for visiting KAPE DOZ',
  tax_display_note TEXT NOT NULL DEFAULT 'Tax policy pending client confirmation',
  station_visible_cards INTEGER NOT NULL DEFAULT 6 CHECK(station_visible_cards >= 1 AND station_visible_cards <= 24),
  offline_access_expiry_minutes INTEGER NOT NULL DEFAULT 480 CHECK(offline_access_expiry_minutes >= 5 AND offline_access_expiry_minutes <= 10080),
  updated_at INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES accounts(id)
) STRICT;

CREATE TABLE branch_config_versions (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  version INTEGER NOT NULL CHECK(version > 0),
  receipt_header TEXT NOT NULL,
  receipt_footer TEXT NOT NULL,
  tax_display_note TEXT NOT NULL,
  station_visible_cards INTEGER NOT NULL,
  offline_access_expiry_minutes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES accounts(id),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(branch_id, version)
) STRICT;

CREATE TABLE order_service_states (
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version > 0),
  handover_at INTEGER,
  recalled_count INTEGER NOT NULL DEFAULT 0 CHECK(recalled_count >= 0),
  PRIMARY KEY(branch_id, order_id),
  FOREIGN KEY(branch_id, order_id) REFERENCES orders(branch_id, id)
) STRICT;

CREATE TABLE printer_adapters (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  type TEXT NOT NULL CHECK(type IN ('receipt','label')),
  mode TEXT NOT NULL DEFAULT 'unconfigured' CHECK(mode IN ('unconfigured','confirmed','pending','failed','unknown')),
  failure_reason TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES accounts(id),
  PRIMARY KEY(branch_id, type)
) STRICT;

CREATE TABLE print_job_states (
  job_id TEXT PRIMARY KEY REFERENCES print_jobs(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  order_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('receipt','label')),
  adapter_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK(adapter_status IN ('unconfigured','pending','failed','unknown','confirmed')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts >= 1),
  original_job_id TEXT NOT NULL,
  last_error TEXT,
  simulated INTEGER NOT NULL DEFAULT 1 CHECK(simulated IN (0,1)),
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(branch_id, order_id) REFERENCES orders(branch_id, id)
) STRICT;

CREATE TABLE print_job_events (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  job_id TEXT NOT NULL REFERENCES print_jobs(id),
  original_job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK(attempt_no >= 1),
  action TEXT NOT NULL CHECK(action IN ('initial','retry','reprint','resolve')),
  status TEXT NOT NULL CHECK(status IN ('unconfigured','pending','failed','unknown','confirmed')),
  error_message TEXT,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  recorded_at INTEGER NOT NULL,
  command_id TEXT NOT NULL REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE waste_corrections (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  waste_id TEXT NOT NULL REFERENCES waste_entries(id),
  ingredient_id TEXT NOT NULL,
  previous_quantity_milli INTEGER NOT NULL CHECK(previous_quantity_milli > 0),
  corrected_quantity_milli INTEGER NOT NULL CHECK(corrected_quantity_milli >= 0),
  delta_milli INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  recorded_at INTEGER NOT NULL,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(branch_id, ingredient_id) REFERENCES ingredients(branch_id, id)
) STRICT;

CREATE TABLE csv_imports (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  kind TEXT NOT NULL CHECK(kind IN ('catalog','customers')),
  duplicate_policy TEXT NOT NULL CHECK(duplicate_policy IN ('skip','update')),
  file_hash TEXT NOT NULL,
  added_count INTEGER NOT NULL CHECK(added_count >= 0),
  updated_count INTEGER NOT NULL CHECK(updated_count >= 0),
  skipped_count INTEGER NOT NULL CHECK(skipped_count >= 0),
  error_count INTEGER NOT NULL CHECK(error_count >= 0),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  imported_at INTEGER NOT NULL,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE cloud_sync_state (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id),
  mode TEXT NOT NULL DEFAULT 'online' CHECK(mode IN ('online','offline')),
  last_synced_at INTEGER,
  last_synced_outbox_rowid INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE sync_envelopes (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  envelope_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('applied','duplicate','conflict')),
  processed_at INTEGER NOT NULL,
  PRIMARY KEY(branch_id, envelope_id)
) STRICT;

CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  envelope_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  incoming_version INTEGER NOT NULL,
  local_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolution_note TEXT,
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES accounts(id)
) STRICT;
