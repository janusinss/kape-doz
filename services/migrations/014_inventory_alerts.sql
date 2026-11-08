CREATE TABLE ingredient_stock_thresholds (
  branch_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  threshold_milli INTEGER CHECK(threshold_milli BETWEEN 0 AND 1000000000000),
  PRIMARY KEY(branch_id,ingredient_id),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id)
) STRICT;

CREATE TABLE inventory_alerts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('low_stock','shortage')),
  status TEXT NOT NULL CHECK(status IN ('open','acknowledged','resolved')),
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  on_hand_milli INTEGER NOT NULL CHECK(on_hand_milli BETWEEN -9007199254740991 AND 9007199254740991),
  reserved_milli INTEGER NOT NULL CHECK(reserved_milli BETWEEN 0 AND 9007199254740991),
  available_milli INTEGER NOT NULL CHECK(available_milli BETWEEN -9007199254740991 AND 9007199254740991),
  threshold_milli INTEGER,
  opened_at INTEGER NOT NULL CHECK(opened_at>=0),
  last_evaluated_at INTEGER NOT NULL CHECK(last_evaluated_at>=opened_at),
  acknowledged_by TEXT REFERENCES accounts(id),
  acknowledged_at INTEGER CHECK(acknowledged_at>=opened_at),
  acknowledgment_note TEXT CHECK(length(trim(acknowledgment_note)) BETWEEN 1 AND 160),
  resolved_at INTEGER CHECK(resolved_at>=opened_at),
  resolution TEXT CHECK(resolution IN ('stock_recovered','threshold_changed')),
  UNIQUE(branch_id,id,ingredient_id),
  FOREIGN KEY(branch_id,ingredient_id) REFERENCES ingredients(branch_id,id),
  CHECK(available_milli=on_hand_milli-reserved_milli),
  CHECK((kind='shortage' AND threshold_milli IS NULL)
    OR (kind='low_stock' AND ((threshold_milli IS NOT NULL AND threshold_milli BETWEEN 0 AND 1000000000000)
      OR (status='resolved' AND threshold_milli IS NULL)))),
  CHECK((acknowledged_by IS NULL AND acknowledged_at IS NULL AND acknowledgment_note IS NULL)
    OR (acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND acknowledgment_note IS NOT NULL)),
  CHECK(status<>'open' OR acknowledged_by IS NULL),
  CHECK(status<>'acknowledged' OR acknowledged_by IS NOT NULL),
  CHECK((status='resolved' AND resolved_at IS NOT NULL AND resolution IS NOT NULL)
    OR (status<>'resolved' AND resolved_at IS NULL AND resolution IS NULL))
) STRICT;
CREATE UNIQUE INDEX inventory_alerts_active ON inventory_alerts(branch_id,ingredient_id,kind) WHERE status<>'resolved';
CREATE INDEX inventory_alerts_page ON inventory_alerts(branch_id,status,opened_at,id);

CREATE TABLE inventory_alert_events (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES inventory_alerts(id),
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  type TEXT NOT NULL CHECK(type IN ('opened','updated','acknowledged','resolved')),
  command_id TEXT REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  actor_id TEXT REFERENCES accounts(id),
  at INTEGER NOT NULL CHECK(at>=0),
  note TEXT CHECK(length(trim(note)) BETWEEN 1 AND 160),
  on_hand_milli INTEGER NOT NULL CHECK(on_hand_milli BETWEEN -9007199254740991 AND 9007199254740991),
  reserved_milli INTEGER NOT NULL CHECK(reserved_milli BETWEEN 0 AND 9007199254740991),
  available_milli INTEGER NOT NULL CHECK(available_milli BETWEEN -9007199254740991 AND 9007199254740991),
  threshold_milli INTEGER CHECK(threshold_milli BETWEEN 0 AND 1000000000000),
  UNIQUE(alert_id,version),
  CHECK(available_milli=on_hand_milli-reserved_milli)
) STRICT;

CREATE TABLE inventory_order_shortages (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(length(trim(phase)) BETWEEN 1 AND 100),
  required_milli INTEGER NOT NULL CHECK(required_milli BETWEEN 1 AND 9007199254740991),
  available_milli INTEGER NOT NULL CHECK(available_milli BETWEEN -9007199254740991 AND 9007199254740991),
  shortfall_milli INTEGER NOT NULL CHECK(shortfall_milli BETWEEN 1 AND 9007199254740991),
  command_id TEXT NOT NULL REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  at INTEGER NOT NULL CHECK(at>=0),
  UNIQUE(command_id,ingredient_id),
  FOREIGN KEY(branch_id,alert_id,ingredient_id) REFERENCES inventory_alerts(branch_id,id,ingredient_id),
  FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id)
) STRICT;
CREATE INDEX inventory_order_shortages_history ON inventory_order_shortages(alert_id,at,id);

-- Existing shortages remain visible without creating audit commands or altering stock.
WITH reserved AS (
  SELECT branch_id,ingredient_id,SUM(quantity_milli) AS quantity
  FROM reservations WHERE consumed=0 AND released=0 GROUP BY branch_id,ingredient_id
), positions AS (
  SELECT i.branch_id,i.id AS ingredient_id,
    COALESCE((SELECT m.quantity_after_milli FROM stock_movements m
      WHERE m.branch_id=i.branch_id AND m.ingredient_id=i.id ORDER BY m.sequence DESC LIMIT 1),0) AS on_hand,
    COALESCE(r.quantity,0) AS reserved
  FROM ingredients i LEFT JOIN reserved r ON r.branch_id=i.branch_id AND r.ingredient_id=i.id
)
INSERT INTO inventory_alerts(id,branch_id,ingredient_id,kind,status,version,on_hand_milli,reserved_milli,available_milli,threshold_milli,opened_at,last_evaluated_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2)
    || '-' || substr('89ab',(random() & 3)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
  branch_id,ingredient_id,'shortage','open',1,on_hand,reserved,on_hand-reserved,NULL,0,0
FROM positions WHERE on_hand-reserved<0;

INSERT INTO inventory_alert_events(id,alert_id,version,type,command_id,actor_id,at,note,on_hand_milli,reserved_milli,available_milli,threshold_milli)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2)
    || '-' || substr('89ab',(random() & 3)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
  id,1,'opened',NULL,NULL,0,NULL,on_hand_milli,reserved_milli,available_milli,NULL
FROM inventory_alerts;
