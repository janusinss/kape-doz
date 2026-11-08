CREATE TABLE refund_requests (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_version INTEGER NOT NULL CHECK(order_version>0),
  amount_centavos INTEGER NOT NULL CHECK(amount_centavos BETWEEN 1 AND 100000000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
  requester_id TEXT NOT NULL REFERENCES accounts(id),
  requester_device_id TEXT NOT NULL REFERENCES devices(id),
  requested_at INTEGER NOT NULL CHECK(requested_at>=0),
  request_command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  superseded_by TEXT,
  decision TEXT CHECK(decision IN ('approve','deny')),
  decision_reason TEXT CHECK(length(decision_reason) BETWEEN 1 AND 300),
  reviewer_id TEXT REFERENCES accounts(id),
  decided_at INTEGER CHECK(decided_at>=0),
  decision_command_id TEXT UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(branch_id,order_id,id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  FOREIGN KEY(branch_id,order_id,superseded_by) REFERENCES refund_requests(branch_id,order_id,id) DEFERRABLE INITIALLY DEFERRED,
  CHECK(superseded_by IS NULL OR (superseded_by<>id AND decision IS NULL)),
  CHECK(decision<>'deny' OR decision_reason IS NOT NULL),
  CHECK((decision IS NULL AND decision_reason IS NULL AND reviewer_id IS NULL AND decided_at IS NULL AND decision_command_id IS NULL)
    OR (decision IS NOT NULL AND reviewer_id IS NOT NULL AND reviewer_id<>requester_id
      AND decided_at IS NOT NULL AND decision_command_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX refund_current_request ON refund_requests(branch_id,order_id) WHERE decision IS NULL AND superseded_by IS NULL;
CREATE INDEX refund_branch_requests ON refund_requests(branch_id);
CREATE UNIQUE INDEX payment_branch_order_identity ON payments(branch_id,order_id,id);

CREATE TABLE refund_lines (
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity>0),
  unit_price_centavos INTEGER NOT NULL CHECK(unit_price_centavos>0),
  PRIMARY KEY(refund_id,line_no),
  FOREIGN KEY(branch_id,order_id,refund_id) REFERENCES refund_requests(branch_id,order_id,id),
  FOREIGN KEY(branch_id,order_id,line_no) REFERENCES order_lines(branch_id,order_id,line_no)
) STRICT;

CREATE TABLE settlement_payment_links (
  payment_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  FOREIGN KEY(branch_id,order_id) REFERENCES order_settlements(branch_id,order_id),
  FOREIGN KEY(branch_id,order_id,payment_id) REFERENCES payments(branch_id,order_id,id)
) STRICT;

CREATE TABLE refund_legs (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  amount_centavos INTEGER NOT NULL CHECK(amount_centavos BETWEEN 1 AND 100000000000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','unknown','failed','completed','voided')),
  revenue_centavos INTEGER CHECK(revenue_centavos BETWEEN 0 AND amount_centavos),
  reference TEXT,
  note TEXT CHECK(length(note) BETWEEN 1 AND 300),
  completed_at INTEGER CHECK(completed_at>=0),
  completion_command_id TEXT UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(branch_id,id),
  UNIQUE(refund_id,payment_id),
  FOREIGN KEY(branch_id,order_id,refund_id) REFERENCES refund_requests(branch_id,order_id,id),
  FOREIGN KEY(branch_id,order_id,payment_id) REFERENCES payments(branch_id,order_id,id),
  CHECK((status='completed' AND completed_at IS NOT NULL AND completion_command_id IS NOT NULL)
    OR (status<>'completed' AND completed_at IS NULL AND completion_command_id IS NULL))
) STRICT;
CREATE INDEX refund_tender_reservations ON refund_legs(branch_id,payment_id,status);
CREATE INDEX refund_completions ON refund_legs(branch_id,completed_at) WHERE status='completed';

CREATE TABLE refund_leg_events (
  command_id TEXT PRIMARY KEY REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT NOT NULL,
  leg_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>1),
  action TEXT NOT NULL,
  reference TEXT,
  note TEXT,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  accepted_at INTEGER NOT NULL,
  UNIQUE(leg_id,version),
  FOREIGN KEY(branch_id,leg_id) REFERENCES refund_legs(branch_id,id)
) STRICT;

CREATE TABLE external_refund_references (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  method TEXT NOT NULL CHECK(method IN ('gcash','card')),
  reference TEXT NOT NULL CHECK(length(reference) BETWEEN 1 AND 120),
  leg_id TEXT NOT NULL UNIQUE REFERENCES refund_legs(id),
  PRIMARY KEY(branch_id,method,reference)
) STRICT;

CREATE TABLE refund_cash_movements (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  leg_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),
  FOREIGN KEY(branch_id,leg_id) REFERENCES refund_legs(branch_id,id)
) STRICT;
CREATE INDEX refund_cash_shift ON refund_cash_movements(branch_id,shift_id);
