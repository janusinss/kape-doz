CREATE TABLE customer_policies (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
  inactivity_days INTEGER NOT NULL DEFAULT 30 CHECK(inactivity_days BETWEEN 1 AND 3650),
  vip_rule TEXT NOT NULL DEFAULT 'unconfigured' CHECK(vip_rule IN ('unconfigured','lifetime_spend','purchase_count')),
  vip_threshold INTEGER CHECK((vip_rule='unconfigured' AND vip_threshold IS NULL) OR (vip_rule<>'unconfigured' AND vip_threshold IS NOT NULL AND vip_threshold>0)),
  points_expiry_days INTEGER CHECK(points_expiry_days IS NULL OR (points_expiry_days BETWEEN 1 AND 3650)),
  updated_by TEXT REFERENCES accounts(id),
  updated_at INTEGER CHECK(updated_at>=0)
) STRICT;

CREATE TABLE customers (
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
  phone TEXT NOT NULL DEFAULT '' CHECK(length(phone)<=40),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=500),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
  created_by TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  PRIMARY KEY(branch_id,id)
) STRICT;
CREATE UNIQUE INDEX customers_unique_phone ON customers(branch_id,phone) WHERE phone<>'';

ALTER TABLE orders ADD COLUMN customer_id TEXT;
ALTER TABLE orders ADD COLUMN redeemed_points INTEGER NOT NULL DEFAULT 0 CHECK(redeemed_points>=0);
ALTER TABLE orders ADD COLUMN loyalty_redemption_centavos INTEGER NOT NULL DEFAULT 0 CHECK(loyalty_redemption_centavos>=0);

ALTER TABLE order_settlements ADD COLUMN customer_id TEXT;
ALTER TABLE order_settlements ADD COLUMN earned_points INTEGER NOT NULL DEFAULT 0 CHECK(earned_points>=0);
ALTER TABLE order_settlements ADD COLUMN redeemed_points INTEGER NOT NULL DEFAULT 0 CHECK(redeemed_points>=0);
ALTER TABLE order_settlements ADD COLUMN loyalty_redemption_centavos INTEGER NOT NULL DEFAULT 0 CHECK(loyalty_redemption_centavos>=0);

CREATE TABLE branch_cloud_state (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id),
  loyalty_cloud_mode TEXT NOT NULL DEFAULT 'online' CHECK(loyalty_cloud_mode IN ('online','offline','timeout')),
  last_synced_at INTEGER CHECK(last_synced_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=0)
) STRICT;

CREATE TABLE loyalty_ledger (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),
  id TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  order_id TEXT,
  redemption_id TEXT,
  refund_case_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('earn','redeem','redeem_cancel_restore','refund_reversal','refund_restoration')),
  points_delta INTEGER NOT NULL CHECK(points_delta<>0),
  status TEXT NOT NULL CHECK(status IN ('pending','available')),
  eligible_spend_centavos INTEGER CHECK(eligible_spend_centavos>=0),
  command_id TEXT NOT NULL REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  acknowledged_at INTEGER CHECK(acknowledged_at>=0),
  FOREIGN KEY(branch_id,customer_id) REFERENCES customers(branch_id,id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id)
) STRICT;
CREATE UNIQUE INDEX one_order_earning ON loyalty_ledger(branch_id,order_id) WHERE kind='earn';
CREATE UNIQUE INDEX one_redemption_debit ON loyalty_ledger(branch_id,redemption_id) WHERE kind='redeem';
CREATE UNIQUE INDEX one_redemption_cancel_restore ON loyalty_ledger(branch_id,redemption_id) WHERE kind='redeem_cancel_restore';
CREATE UNIQUE INDEX one_refund_case_reversal ON loyalty_ledger(branch_id,refund_case_id) WHERE kind='refund_reversal';
CREATE UNIQUE INDEX one_refund_case_restoration ON loyalty_ledger(branch_id,refund_case_id) WHERE kind='refund_restoration';

CREATE TABLE loyalty_redemptions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_version INTEGER NOT NULL CHECK(order_version>=1),
  customer_id TEXT NOT NULL,
  requested_points INTEGER NOT NULL CHECK(requested_points>0),
  discount_centavos INTEGER NOT NULL CHECK(discount_centavos=requested_points*100),
  subtotal_centavos INTEGER NOT NULL CHECK(subtotal_centavos>0),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 300),
  requester_id TEXT NOT NULL REFERENCES accounts(id),
  requester_device_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL CHECK(requested_at>=0),
  request_command_id TEXT NOT NULL REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  superseded_by TEXT REFERENCES loyalty_redemptions(id),
  decision TEXT CHECK(decision IN ('approve','deny')),
  decision_reason TEXT,
  reviewer_id TEXT REFERENCES accounts(id),
  decided_at INTEGER CHECK(decided_at>=0),
  decision_command_id TEXT REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  cloud_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(cloud_status IN ('pending_approval','awaiting_cloud','cloud_unknown','applied','failed','cancelled')),
  cloud_reference TEXT,
  cloud_validated_at INTEGER CHECK(cloud_validated_at>=0),
  cloud_command_id TEXT REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  FOREIGN KEY(branch_id,customer_id) REFERENCES customers(branch_id,id)
) STRICT;

CREATE TABLE loyalty_refund_cases (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  refund_id TEXT NOT NULL UNIQUE REFERENCES refund_requests(id),
  order_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  refund_amount_centavos INTEGER NOT NULL CHECK(refund_amount_centavos>0),
  order_settled_centavos INTEGER NOT NULL CHECK(order_settled_centavos>=0),
  original_earned_points INTEGER NOT NULL CHECK(original_earned_points>=0),
  original_redeemed_points INTEGER NOT NULL CHECK(original_redeemed_points>=0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','insufficient_balance_review','resolved')),
  reversed_earned_points INTEGER CHECK(reversed_earned_points>=0),
  restored_redeemed_points INTEGER CHECK(restored_redeemed_points>=0),
  requested_reversal_points INTEGER CHECK(requested_reversal_points>=0),
  reason TEXT,
  resolution_note TEXT,
  decided_by TEXT REFERENCES accounts(id),
  decided_at INTEGER CHECK(decided_at>=0),
  decision_command_id TEXT REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  FOREIGN KEY(branch_id,customer_id) REFERENCES customers(branch_id,id)
) STRICT;
