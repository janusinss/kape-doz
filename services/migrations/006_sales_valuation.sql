CREATE TABLE order_settlements (
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  settled_at INTEGER NOT NULL CHECK(settled_at >= 0),
  business_date TEXT NOT NULL CHECK(business_date >= '0001-01-01' AND date(business_date, '+0 days') IS business_date),
  total_centavos INTEGER NOT NULL CHECK(total_centavos BETWEEN 1 AND 100000000000),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(branch_id,order_id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id)
) STRICT;

CREATE INDEX settlement_business_date ON order_settlements(branch_id,business_date);

CREATE TABLE ingredient_valuation_balances (
  branch_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  carrying_microcentavos INTEGER CHECK(carrying_microcentavos >= 0),
  PRIMARY KEY(branch_id,ingredient_id),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;

CREATE TABLE stock_movement_valuations (
  movement_id TEXT PRIMARY KEY REFERENCES stock_movements(id),
  value_microcentavos INTEGER CHECK(value_microcentavos >= 0)
) STRICT;

CREATE TABLE order_recipe_valuation_estimates (
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  cost_microcentavos INTEGER CHECK(cost_microcentavos >= 0),
  PRIMARY KEY(branch_id,order_id,ingredient_id),
  FOREIGN KEY(branch_id,order_id,ingredient_id) REFERENCES reservations(branch_id,order_id,ingredient_id)
) STRICT;

CREATE INDEX stock_consumption_order ON stock_movements(branch_id,order_id) WHERE kind='consumption';

CREATE TABLE expense_coverage_confirmations (
  command_id TEXT PRIMARY KEY REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  starts_on TEXT NOT NULL CHECK(starts_on >= '0001-01-01' AND date(starts_on, '+0 days') IS starts_on),
  ends_on TEXT NOT NULL CHECK(ends_on >= starts_on AND date(ends_on, '+0 days') IS ends_on),
  confirmed_at INTEGER NOT NULL CHECK(confirmed_at >= 0),
  invalidated_by TEXT REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX expense_coverage_active_period ON expense_coverage_confirmations(branch_id,starts_on,ends_on) WHERE invalidated_by IS NULL;
