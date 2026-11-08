CREATE TABLE inventory_threshold_events (
  command_id TEXT PRIMARY KEY REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  old_threshold_milli INTEGER CHECK(old_threshold_milli BETWEEN 0 AND 1000000000000),
  new_threshold_milli INTEGER CHECK(new_threshold_milli BETWEEN 0 AND 1000000000000),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 160),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  at INTEGER NOT NULL CHECK(at>=0),
  UNIQUE(branch_id,ingredient_id,version),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;
