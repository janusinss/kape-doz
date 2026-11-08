ALTER TABLE orders ADD COLUMN discount_centavos INTEGER NOT NULL DEFAULT 0
  CHECK(discount_centavos BETWEEN 0 AND 100000000000 - total_centavos);

ALTER TABLE order_settlements ADD COLUMN discount_centavos INTEGER NOT NULL DEFAULT 0
  CHECK(discount_centavos BETWEEN 0 AND 100000000000 - total_centavos);

CREATE TABLE order_approvals (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_version INTEGER NOT NULL CHECK(order_version > 0),
  action TEXT NOT NULL CHECK(action = 'discount'),
  amount_centavos INTEGER NOT NULL CHECK(amount_centavos > 0 AND amount_centavos < subtotal_centavos),
  subtotal_centavos INTEGER NOT NULL CHECK(subtotal_centavos BETWEEN 1 AND 100000000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
  requester_id TEXT NOT NULL REFERENCES accounts(id),
  requester_device_id TEXT NOT NULL REFERENCES devices(id),
  requested_at INTEGER NOT NULL CHECK(requested_at >= 0),
  request_command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  superseded_by TEXT,
  decision TEXT CHECK(decision IN ('approve', 'deny')),
  decision_reason TEXT CHECK(length(decision_reason) BETWEEN 1 AND 300),
  decided_at INTEGER CHECK(decided_at >= 0),
  reviewer_id TEXT REFERENCES accounts(id),
  decision_command_id TEXT UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(branch_id, order_id, id),
  FOREIGN KEY(branch_id, order_id) REFERENCES orders(branch_id, id),
  FOREIGN KEY(branch_id, order_id, superseded_by) REFERENCES order_approvals(branch_id, order_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK(superseded_by IS NULL OR (superseded_by <> id AND decision IS NULL)),
  CHECK(decision <> 'deny' OR decision_reason IS NOT NULL),
  CHECK((decision IS NULL AND decision_reason IS NULL AND decided_at IS NULL
         AND reviewer_id IS NULL AND decision_command_id IS NULL)
     OR (decision IS NOT NULL AND decided_at IS NOT NULL
         AND reviewer_id IS NOT NULL AND reviewer_id <> requester_id AND decision_command_id IS NOT NULL))
) STRICT;

CREATE INDEX order_approvals_branch ON order_approvals(branch_id);
CREATE UNIQUE INDEX one_current_order_approval ON order_approvals(branch_id, order_id, action)
  WHERE decision IS NULL AND superseded_by IS NULL;
CREATE UNIQUE INDEX one_approved_order_discount ON order_approvals(branch_id, order_id)
  WHERE action = 'discount' AND decision = 'approve';
