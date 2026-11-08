-- Preserve accepted receipts and fence terminal business rejections under their
-- original command identity. Rejected business effects are rolled back first.
ALTER TABLE command_receipts ADD COLUMN outcome TEXT NOT NULL DEFAULT 'accepted'
  CHECK (outcome IN ('accepted','rejected'));
ALTER TABLE command_receipts ADD COLUMN rejection_status INTEGER
  CHECK ((outcome='accepted' AND rejection_status IS NULL)
    OR (outcome='rejected' AND rejection_status IS NOT NULL AND rejection_status IN (400,404,409,413)));
