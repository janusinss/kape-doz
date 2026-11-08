CREATE TABLE request_limits (
  scope TEXT NOT NULL, subject TEXT NOT NULL, window_start INTEGER NOT NULL, used INTEGER NOT NULL,
  PRIMARY KEY(scope,subject)
) STRICT;
CREATE TABLE ingredients (
  branch_id TEXT NOT NULL REFERENCES branches(id), id TEXT NOT NULL, name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK(unit IN ('g','ml','piece')), PRIMARY KEY(branch_id,id)
) STRICT;
CREATE TABLE products (
  branch_id TEXT NOT NULL REFERENCES branches(id), id TEXT NOT NULL, name TEXT NOT NULL,
  price_centavos INTEGER NOT NULL CHECK(price_centavos>0 AND price_centavos<=100000000000),
  version INTEGER NOT NULL CHECK(version>0), PRIMARY KEY(branch_id,id)
) STRICT;
CREATE TABLE product_versions (
  branch_id TEXT NOT NULL, product_id TEXT NOT NULL, version INTEGER NOT NULL,
  PRIMARY KEY(branch_id,product_id,version),
  FOREIGN KEY(branch_id,product_id) REFERENCES products(branch_id,id)
) STRICT;
CREATE TABLE product_recipe (
  branch_id TEXT NOT NULL, product_id TEXT NOT NULL, version INTEGER NOT NULL, ingredient_id TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), PRIMARY KEY(branch_id,product_id,version,ingredient_id),
  FOREIGN KEY(branch_id,product_id,version) REFERENCES product_versions(branch_id,product_id,version),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;
CREATE TABLE drawers (
  branch_id TEXT NOT NULL REFERENCES branches(id), id TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY(branch_id,id)
) STRICT;
CREATE TABLE drawer_devices (
  device_id TEXT PRIMARY KEY REFERENCES devices(id), branch_id TEXT NOT NULL, drawer_id TEXT NOT NULL,
  FOREIGN KEY(branch_id,drawer_id) REFERENCES drawers(branch_id,id)
) STRICT;
CREATE TABLE shifts (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, drawer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','awaiting_review','recount_required','closed')),
  version INTEGER NOT NULL CHECK(version>0), opening_cash_centavos INTEGER NOT NULL CHECK(opening_cash_centavos>=0),
  counted_cash_centavos INTEGER CHECK(counted_cash_centavos>=0), opened_by TEXT NOT NULL REFERENCES accounts(id),
  opened_at INTEGER NOT NULL, current_count_id TEXT REFERENCES shift_counts(id),
  UNIQUE(branch_id,id), FOREIGN KEY(branch_id,drawer_id) REFERENCES drawers(branch_id,id)
) STRICT;
CREATE UNIQUE INDEX one_active_drawer_shift ON shifts(branch_id,drawer_id) WHERE status<>'closed';
CREATE TABLE shift_counts (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, shift_id TEXT NOT NULL,
  counted_cash_centavos INTEGER NOT NULL CHECK(counted_cash_centavos>=0), note TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES accounts(id), submitted_at INTEGER NOT NULL, version INTEGER NOT NULL,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(shift_id,version), FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)
) STRICT;
CREATE TABLE shift_reviews (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, shift_id TEXT NOT NULL, count_id TEXT NOT NULL REFERENCES shift_counts(id),
  actor_id TEXT NOT NULL REFERENCES accounts(id), decision TEXT NOT NULL CHECK(decision IN ('approve','recount')),
  reviewed_at INTEGER NOT NULL, expected_cash_centavos INTEGER NOT NULL, variance_centavos INTEGER NOT NULL,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)
) STRICT;
CREATE TABLE orders (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id), order_no INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK(version>0), dine_in INTEGER NOT NULL CHECK(dine_in IN (0,1)), table_ref TEXT NOT NULL,
  release_policy TEXT NOT NULL CHECK(release_policy IN ('explicit_send','after_payment')),
  accepted_at INTEGER NOT NULL, released_at INTEGER, ready_at INTEGER,
  total_centavos INTEGER NOT NULL CHECK(total_centavos>0 AND total_centavos<=100000000000),
  UNIQUE(branch_id,id), UNIQUE(branch_id,order_no)
) STRICT;
CREATE TABLE order_lines (
  branch_id TEXT NOT NULL, order_id TEXT NOT NULL, line_no INTEGER NOT NULL, product_id TEXT NOT NULL,
  name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price_centavos INTEGER NOT NULL CHECK(unit_price_centavos>0),
  note TEXT NOT NULL, recipe_version INTEGER,
  PRIMARY KEY(branch_id,order_id,line_no),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  FOREIGN KEY(branch_id,product_id) REFERENCES products(branch_id,id),
  FOREIGN KEY(branch_id,product_id,recipe_version) REFERENCES product_versions(branch_id,product_id,version)
) STRICT;
CREATE TABLE order_line_recipe (
  branch_id TEXT NOT NULL, order_id TEXT NOT NULL, line_no INTEGER NOT NULL, ingredient_id TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), PRIMARY KEY(branch_id,order_id,line_no,ingredient_id),
  FOREIGN KEY(branch_id,order_id,line_no) REFERENCES order_lines(branch_id,order_id,line_no),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;
CREATE TABLE reservations (
  branch_id TEXT NOT NULL, order_id TEXT NOT NULL, ingredient_id TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),
  PRIMARY KEY(branch_id,order_id,ingredient_id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;
CREATE TABLE payments (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, order_id TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('cash','gcash','card')),
  amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected')),
  reference TEXT, cash_received_centavos INTEGER, change_centavos INTEGER, rejection_reason TEXT,
  accepted_at INTEGER NOT NULL, command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  CHECK((method='cash' AND status='confirmed' AND cash_received_centavos>=amount_centavos AND change_centavos=cash_received_centavos-amount_centavos)
    OR (method<>'cash' AND reference IS NOT NULL AND length(reference)>0 AND cash_received_centavos IS NULL AND change_centavos IS NULL))
) STRICT;
CREATE UNIQUE INDEX active_external_reference ON payments(branch_id,method,reference) WHERE method<>'cash' AND status<>'rejected';
CREATE INDEX payment_order ON payments(branch_id,order_id);
CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, shift_id TEXT NOT NULL, payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  actor_id TEXT NOT NULL REFERENCES accounts(id), device_id TEXT NOT NULL REFERENCES devices(id), amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)
) STRICT;
CREATE TABLE stock_receipts (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, ingredient_id TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0), total_cost_centavos INTEGER NOT NULL CHECK(total_cost_centavos>=0), reference TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES accounts(id), accepted_at INTEGER NOT NULL,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;
CREATE TABLE waste_entries (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, ingredient_id TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
  reason TEXT NOT NULL, note TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES accounts(id), accepted_at INTEGER NOT NULL,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, ingredient_id TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli<>0),
  kind TEXT NOT NULL CHECK(kind IN ('receipt','consumption','waste')), receipt_id TEXT REFERENCES stock_receipts(id),
  order_id TEXT, waste_id TEXT REFERENCES waste_entries(id),
  command_id TEXT NOT NULL REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED, accepted_at INTEGER NOT NULL,
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
  CHECK((kind='receipt' AND receipt_id IS NOT NULL AND order_id IS NULL AND waste_id IS NULL AND quantity_milli>0)
    OR (kind='consumption' AND order_id IS NOT NULL AND receipt_id IS NULL AND waste_id IS NULL AND quantity_milli<0)
    OR (kind='waste' AND waste_id IS NOT NULL AND receipt_id IS NULL AND order_id IS NULL AND quantity_milli<0))
) STRICT;
CREATE UNIQUE INDEX one_ready_consumption ON stock_movements(branch_id,order_id,ingredient_id) WHERE kind='consumption';
CREATE INDEX stock_history ON stock_movements(branch_id,ingredient_id);
CREATE TABLE print_jobs (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, order_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('label','receipt')), status TEXT NOT NULL DEFAULT 'unconfigured' CHECK(status='unconfigured'),
  command_id TEXT NOT NULL REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(branch_id,order_id,type), FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id)
) STRICT;
