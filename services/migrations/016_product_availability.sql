ALTER TABLE products ADD COLUMN available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1));
ALTER TABLE products ADD COLUMN availability_version INTEGER NOT NULL DEFAULT 1 CHECK(availability_version BETWEEN 1 AND 1000000000);

CREATE TABLE product_availability_events (
  command_id TEXT PRIMARY KEY REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version BETWEEN 2 AND 1000000000),
  old_available INTEGER NOT NULL CHECK(old_available IN (0,1)),
  new_available INTEGER NOT NULL CHECK(new_available IN (0,1)),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 160),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  at INTEGER NOT NULL CHECK(at>=0),
  UNIQUE(branch_id,product_id,version),
  FOREIGN KEY(branch_id,product_id) REFERENCES products(branch_id,id)
) STRICT;

CREATE TABLE unreleased_order_replacements (
  command_id TEXT PRIMARY KEY REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  old_line_no INTEGER NOT NULL,
  new_line_no INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 160),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  at INTEGER NOT NULL CHECK(at>=0),
  CHECK(old_line_no<>new_line_no),
  FOREIGN KEY(branch_id,order_id,old_line_no) REFERENCES order_lines(branch_id,order_id,line_no),
  FOREIGN KEY(branch_id,order_id,new_line_no) REFERENCES order_lines(branch_id,order_id,line_no)
) STRICT;
