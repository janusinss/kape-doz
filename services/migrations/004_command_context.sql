ALTER TABLE command_receipts ADD COLUMN device_id TEXT REFERENCES devices(id);
ALTER TABLE audit_events ADD COLUMN device_id TEXT REFERENCES devices(id);
ALTER TABLE outbox ADD COLUMN device_id TEXT REFERENCES devices(id);

-- Validate existing cash rows without deleting or silently repairing history.
CREATE TABLE migration_cash_integrity (invalid_rows INTEGER NOT NULL CHECK(invalid_rows=0)) STRICT;
INSERT INTO migration_cash_integrity(invalid_rows)
SELECT COUNT(*) FROM payments WHERE method='cash' AND (
  cash_received_centavos IS NULL OR change_centavos IS NULL OR reference IS NOT NULL
  OR status<>'confirmed' OR cash_received_centavos<amount_centavos
  OR change_centavos<>cash_received_centavos-amount_centavos
);
DROP TABLE migration_cash_integrity;

-- Triggers strengthen both fresh and previously applied schema-3 databases.
CREATE TRIGGER payment_cash_insert_guard BEFORE INSERT ON payments
WHEN NEW.method='cash' AND (
  NEW.cash_received_centavos IS NULL OR NEW.change_centavos IS NULL OR NEW.reference IS NOT NULL
  OR NEW.status<>'confirmed' OR NEW.cash_received_centavos<NEW.amount_centavos
  OR NEW.change_centavos<>NEW.cash_received_centavos-NEW.amount_centavos
)
BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: valid cash received and change required'); END;
CREATE TRIGGER payment_cash_update_guard BEFORE UPDATE ON payments
WHEN NEW.method='cash' AND (
  NEW.cash_received_centavos IS NULL OR NEW.change_centavos IS NULL OR NEW.reference IS NOT NULL
  OR NEW.status<>'confirmed' OR NEW.cash_received_centavos<NEW.amount_centavos
  OR NEW.change_centavos<>NEW.cash_received_centavos-NEW.amount_centavos
)
BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: valid cash received and change required'); END;
