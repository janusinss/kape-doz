ALTER TABLE auth_attempts ADD COLUMN in_flight INTEGER NOT NULL DEFAULT 0 CHECK (in_flight >= 0);
