ALTER TABLE orders ADD COLUMN preparing_at INTEGER CHECK(preparing_at >= 0);
ALTER TABLE orders ADD COLUMN cancelled_at INTEGER CHECK(cancelled_at >= 0);
ALTER TABLE reservations ADD COLUMN released INTEGER NOT NULL DEFAULT 0 CHECK(released IN (0,1) AND consumed+released<=1);

CREATE TABLE order_approvals_next (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_version INTEGER NOT NULL CHECK(order_version > 0),
  action TEXT NOT NULL CHECK(action IN ('discount','cancel')),
  amount_centavos INTEGER NOT NULL,
  subtotal_centavos INTEGER NOT NULL CHECK(subtotal_centavos BETWEEN 1 AND 100000000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
  requester_id TEXT NOT NULL REFERENCES accounts(id),
  requester_device_id TEXT NOT NULL REFERENCES devices(id),
  requested_at INTEGER NOT NULL CHECK(requested_at >= 0),
  request_command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  superseded_by TEXT,
  decision TEXT CHECK(decision IN ('approve','deny')),
  decision_reason TEXT CHECK(length(decision_reason) BETWEEN 1 AND 300),
  decided_at INTEGER CHECK(decided_at >= 0),
  reviewer_id TEXT REFERENCES accounts(id),
  decision_command_id TEXT UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  requested_kitchen_state TEXT CHECK(requested_kitchen_state IN ('not_released','queued','preparing','ready')),
  requested_payment_state TEXT CHECK(requested_payment_state IN ('unpaid','pending_verification','partially_paid','paid')),
  collected_centavos INTEGER CHECK(collected_centavos BETWEEN 0 AND 100000000000),
  pending_centavos INTEGER CHECK(pending_centavos BETWEEN 0 AND 9007199254740991),
  UNIQUE(branch_id,order_id,id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  FOREIGN KEY(branch_id,order_id,superseded_by) REFERENCES order_approvals_next(branch_id,order_id,id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK((action='discount' AND amount_centavos>0 AND amount_centavos<subtotal_centavos)
    OR (action='cancel' AND amount_centavos>0 AND amount_centavos<=subtotal_centavos
      AND requested_kitchen_state IS NOT NULL AND requested_payment_state IS NOT NULL
      AND collected_centavos IS NOT NULL AND pending_centavos IS NOT NULL)),
  CHECK(superseded_by IS NULL OR (superseded_by<>id AND decision IS NULL)),
  CHECK(decision<>'deny' OR decision_reason IS NOT NULL),
  CHECK((decision IS NULL AND decision_reason IS NULL AND decided_at IS NULL
      AND reviewer_id IS NULL AND decision_command_id IS NULL)
    OR (decision IS NOT NULL AND decided_at IS NOT NULL
      AND reviewer_id IS NOT NULL AND reviewer_id<>requester_id AND decision_command_id IS NOT NULL))
) STRICT;

INSERT INTO order_approvals_next(id,branch_id,order_id,order_version,action,amount_centavos,
  subtotal_centavos,reason,requester_id,requester_device_id,requested_at,request_command_id,
  superseded_by,decision,decision_reason,decided_at,reviewer_id,decision_command_id)
SELECT id,branch_id,order_id,order_version,action,amount_centavos,subtotal_centavos,reason,
  requester_id,requester_device_id,requested_at,request_command_id,superseded_by,
  decision,decision_reason,decided_at,reviewer_id,decision_command_id FROM order_approvals ORDER BY rowid;
DROP TABLE order_approvals;
ALTER TABLE order_approvals_next RENAME TO order_approvals;
CREATE INDEX order_approvals_branch ON order_approvals(branch_id);
CREATE UNIQUE INDEX one_current_order_approval ON order_approvals(branch_id,order_id,action)
  WHERE decision IS NULL AND superseded_by IS NULL;
CREATE UNIQUE INDEX one_approved_order_action ON order_approvals(branch_id,order_id,action) WHERE decision='approve';

CREATE TABLE waste_entries_next (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
  reason TEXT NOT NULL,
  note TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  accepted_at INTEGER NOT NULL,
  command_id TEXT NOT NULL REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(branch_id,id),
  UNIQUE(command_id,ingredient_id),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;
INSERT INTO waste_entries_next SELECT * FROM waste_entries;
DROP TABLE waste_entries;
ALTER TABLE waste_entries_next RENAME TO waste_entries;

CREATE TABLE order_cancellations (
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  approval_id TEXT NOT NULL UNIQUE,
  cancelled_at INTEGER NOT NULL CHECK(cancelled_at>=0),
  status TEXT NOT NULL CHECK(status IN ('awaiting_disposition','resolved')),
  outcome TEXT CHECK(outcome IN ('unprepared','used','already_consumed')),
  disposition_note TEXT CHECK(length(disposition_note) BETWEEN 1 AND 300),
  resolved_at INTEGER CHECK(resolved_at>=0),
  resolved_by TEXT REFERENCES accounts(id),
  resolution_command_id TEXT UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(branch_id,order_id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  FOREIGN KEY(branch_id,order_id,approval_id) REFERENCES order_approvals(branch_id,order_id,id),
  CHECK((status='awaiting_disposition' AND outcome IS NULL AND disposition_note IS NULL
      AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_command_id IS NULL)
    OR (status='resolved' AND outcome IS NOT NULL AND disposition_note IS NOT NULL
      AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_command_id IS NOT NULL))
) STRICT;
CREATE INDEX cancellation_accepted ON order_cancellations(branch_id,cancelled_at);

CREATE TABLE cancellation_waste (
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  waste_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(branch_id,order_id,waste_id),
  FOREIGN KEY(branch_id,order_id) REFERENCES order_cancellations(branch_id,order_id),
  FOREIGN KEY(branch_id,waste_id) REFERENCES waste_entries(branch_id,id)
) STRICT;
CREATE INDEX stock_waste_source ON stock_movements(waste_id) WHERE kind='waste';
