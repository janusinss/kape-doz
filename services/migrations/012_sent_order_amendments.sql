ALTER TABLE order_lines ADD COLUMN retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1));

CREATE TABLE order_amendments (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_version INTEGER NOT NULL CHECK(order_version>0),
  operation TEXT NOT NULL CHECK(operation IN ('add','quantity','remove','replace','note')),
  status TEXT NOT NULL CHECK(status IN ('awaiting_approval','denied','stale','awaiting_station','resolved')),
  requires_approval INTEGER NOT NULL CHECK(requires_approval IN (0,1)),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)),
  new_recipe_json TEXT CHECK(new_recipe_json IS NULL OR json_valid(new_recipe_json)),
  disposition_recipe_json TEXT NOT NULL CHECK(json_valid(disposition_recipe_json)),
  total_before INTEGER NOT NULL CHECK(total_before BETWEEN 1 AND 100000000000),
  total_after INTEGER NOT NULL CHECK(total_after BETWEEN 1 AND 100000000000),
  requester_id TEXT NOT NULL REFERENCES accounts(id),
  requested_at INTEGER NOT NULL CHECK(requested_at>=0),
  request_command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  reviewer_id TEXT REFERENCES accounts(id),
  decision_reason TEXT CHECK(decision_reason IS NULL OR length(decision_reason) BETWEEN 1 AND 300),
  decided_at INTEGER CHECK(decided_at>=0),
  decision_command_id TEXT UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  applied_at INTEGER CHECK(applied_at>=0),
  resolved_at INTEGER CHECK(resolved_at>=0),
  resolved_by TEXT REFERENCES accounts(id),
  disposition_note TEXT CHECK(disposition_note IS NULL OR length(disposition_note)<=300),
  resolution_command_id TEXT UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(branch_id,id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  CHECK((operation='add')=(before_json IS NULL)),
  CHECK((operation='remove')=(after_json IS NULL)),
  CHECK((operation IN ('add','replace'))=(new_recipe_json IS NOT NULL)),
  CHECK(status<>'resolved' OR (applied_at IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_command_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX order_amendments_station_lock ON order_amendments(branch_id,order_id) WHERE status='awaiting_station';
CREATE INDEX order_amendments_history ON order_amendments(branch_id,order_id,requested_at);
CREATE INDEX order_amendments_manager ON order_amendments(branch_id,requires_approval,requested_at);

CREATE TABLE amendment_waste (
  branch_id TEXT NOT NULL,
  amendment_id TEXT NOT NULL,
  waste_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(branch_id,amendment_id,waste_id),
  FOREIGN KEY(branch_id,amendment_id) REFERENCES order_amendments(branch_id,id),
  FOREIGN KEY(branch_id,waste_id) REFERENCES waste_entries(branch_id,id)
) STRICT;
