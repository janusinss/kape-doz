CREATE TABLE operating_expenses (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 240),
  amount_centavos INTEGER NOT NULL CHECK(amount_centavos BETWEEN 1 AND 1000000000),
  starts_on TEXT NOT NULL CHECK(starts_on >= '0001-01-01' AND date(starts_on, '+0 days') IS starts_on),
  ends_on TEXT NOT NULL CHECK(ends_on >= starts_on AND date(ends_on, '+0 days') IS ends_on),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  recorded_at INTEGER NOT NULL,
  command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX operating_expense_branch_order ON operating_expenses(branch_id, recorded_at DESC, id ASC);
