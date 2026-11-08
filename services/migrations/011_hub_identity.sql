-- Seeded with a CSPRNG UUID by the migration transaction before its marker.
-- Backups preserve this logical authority; fresh databases receive a new ID.
CREATE TABLE hub_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  authority_id TEXT NOT NULL UNIQUE CHECK (length(authority_id)=36)
) STRICT;
