CREATE TABLE inventory_counts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  unit TEXT NOT NULL CHECK(unit IN ('g','ml','piece')),
  snapshot_milli INTEGER NOT NULL CHECK(snapshot_milli BETWEEN -9007199254740991 AND 9007199254740991),
  snapshot_stock_version INTEGER NOT NULL CHECK(snapshot_stock_version BETWEEN 0 AND 9007199254740991),
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('open','submitted','approved','discarded')),
  observed_milli INTEGER CHECK(observed_milli BETWEEN 0 AND 9007199254740991),
  variance_milli INTEGER CHECK(variance_milli BETWEEN -9007199254740991 AND 9007199254740991),
  reason TEXT CHECK(length(trim(reason)) BETWEEN 1 AND 160),
  basis_before_microcentavos INTEGER CHECK(basis_before_microcentavos>=0),
  created_by TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  observed_by TEXT REFERENCES accounts(id),
  observed_at INTEGER CHECK(observed_at>=0),
  decided_by TEXT REFERENCES accounts(id),
  decided_at INTEGER CHECK(decided_at>=0),
  UNIQUE(branch_id,id,ingredient_id),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id),
  CHECK((observed_milli IS NULL AND variance_milli IS NULL AND observed_by IS NULL AND observed_at IS NULL)
    OR (observed_milli IS NOT NULL AND variance_milli IS NOT NULL AND observed_by IS NOT NULL AND observed_at IS NOT NULL
      AND variance_milli=observed_milli-snapshot_milli)),
  CHECK(status<>'open' OR observed_milli IS NULL),
  CHECK(status NOT IN ('submitted','approved') OR observed_milli IS NOT NULL),
  CHECK((status IN ('open','submitted') AND reason IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('approved','discarded') AND reason IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK(basis_before_microcentavos IS NULL OR (status='approved' AND variance_milli>0))
) STRICT;
CREATE UNIQUE INDEX one_active_inventory_count ON inventory_counts(branch_id,ingredient_id) WHERE status IN ('open','submitted');
CREATE INDEX inventory_counts_history ON inventory_counts(branch_id,ingredient_id,created_at);

CREATE TABLE stock_movements_next (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),
  id TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli<>0),
  quantity_after_milli INTEGER NOT NULL CHECK(quantity_after_milli BETWEEN -9007199254740991 AND 9007199254740991),
  kind TEXT NOT NULL CHECK(kind IN ('receipt','consumption','waste','count_adjustment')),
  receipt_id TEXT REFERENCES stock_receipts(id),
  order_id TEXT,
  waste_id TEXT REFERENCES waste_entries(id),
  count_id TEXT,
  command_id TEXT NOT NULL REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  accepted_at INTEGER NOT NULL,
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  FOREIGN KEY(branch_id,count_id,ingredient_id) REFERENCES inventory_counts(branch_id,id,ingredient_id),
  CHECK((kind='receipt' AND receipt_id IS NOT NULL AND order_id IS NULL AND waste_id IS NULL AND count_id IS NULL AND quantity_milli>0)
    OR (kind='consumption' AND order_id IS NOT NULL AND receipt_id IS NULL AND waste_id IS NULL AND count_id IS NULL AND quantity_milli<0)
    OR (kind='waste' AND waste_id IS NOT NULL AND receipt_id IS NULL AND order_id IS NULL AND count_id IS NULL AND quantity_milli<0)
    OR (kind='count_adjustment' AND count_id IS NOT NULL AND receipt_id IS NULL AND order_id IS NULL AND waste_id IS NULL))
) STRICT;

-- Preserve insertion order across branches. Timestamps can be equal or move backwards.
INSERT INTO stock_movements_next(sequence,id,branch_id,ingredient_id,quantity_milli,quantity_after_milli,kind,receipt_id,order_id,waste_id,command_id,accepted_at)
SELECT rowid,id,branch_id,ingredient_id,quantity_milli,
  SUM(quantity_milli) OVER(PARTITION BY branch_id,ingredient_id ORDER BY rowid ROWS UNBOUNDED PRECEDING),
  kind,receipt_id,order_id,waste_id,command_id,accepted_at
FROM stock_movements ORDER BY rowid;
DROP TABLE stock_movements;
ALTER TABLE stock_movements_next RENAME TO stock_movements;

CREATE UNIQUE INDEX one_ready_consumption ON stock_movements(branch_id,order_id,ingredient_id) WHERE kind='consumption';
CREATE INDEX stock_history ON stock_movements(branch_id,ingredient_id,sequence);
CREATE INDEX stock_consumption_order ON stock_movements(branch_id,order_id) WHERE kind='consumption';
CREATE INDEX stock_waste_source ON stock_movements(waste_id) WHERE kind='waste';
CREATE UNIQUE INDEX one_count_adjustment ON stock_movements(count_id) WHERE kind='count_adjustment';
CREATE INDEX stock_zero_balance ON stock_movements(branch_id,ingredient_id,sequence) WHERE quantity_after_milli=0;

CREATE TRIGGER stock_movement_balance_guard AFTER INSERT ON stock_movements
WHEN NOT COALESCE((
  SELECT previous.sequence < NEW.sequence
    AND previous.quantity_after_milli + NEW.quantity_milli = NEW.quantity_after_milli
  FROM stock_movements previous
  WHERE previous.branch_id=NEW.branch_id AND previous.ingredient_id=NEW.ingredient_id
    AND previous.sequence<>NEW.sequence
  ORDER BY previous.sequence DESC LIMIT 1
), NEW.quantity_milli = NEW.quantity_after_milli)
BEGIN
  SELECT RAISE(ABORT, 'Invalid stock movement sequence or balance.');
END;

CREATE TABLE inventory_count_costs (
  count_id TEXT PRIMARY KEY REFERENCES inventory_counts(id),
  total_cost_centavos INTEGER NOT NULL CHECK(total_cost_centavos BETWEEN 0 AND 100000000000),
  reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 160),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  accepted_at INTEGER NOT NULL CHECK(accepted_at>=0),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_count_revaluations (
  count_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  stock_version INTEGER NOT NULL CHECK(stock_version BETWEEN 1 AND 9007199254740991),
  on_hand_milli INTEGER NOT NULL CHECK(on_hand_milli BETWEEN 1 AND 9007199254740991),
  total_cost_centavos INTEGER NOT NULL CHECK(total_cost_centavos BETWEEN 0 AND 100000000000),
  reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 160),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  accepted_at INTEGER NOT NULL CHECK(accepted_at>=0),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(branch_id,count_id,ingredient_id) REFERENCES inventory_counts(branch_id,id,ingredient_id)
) STRICT;
CREATE INDEX inventory_count_revaluations_latest ON inventory_count_revaluations(branch_id,ingredient_id,stock_version);
