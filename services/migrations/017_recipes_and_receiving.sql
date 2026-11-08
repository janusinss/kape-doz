ALTER TABLE stock_receipts ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
ALTER TABLE stock_receipts ADD COLUMN pack_count INTEGER NOT NULL DEFAULT 1 CHECK(pack_count>0);
ALTER TABLE stock_receipts ADD COLUMN pack_size_milli INTEGER CHECK(pack_size_milli IS NULL OR pack_size_milli>0);
UPDATE stock_receipts SET pack_size_milli=quantity_milli WHERE pack_size_milli IS NULL;

ALTER TABLE product_versions ADD COLUMN price_centavos INTEGER CHECK(price_centavos IS NULL OR (price_centavos>0 AND price_centavos<=100000000000));
ALTER TABLE product_versions ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(options_json));
UPDATE product_versions SET price_centavos=(
  SELECT p.price_centavos FROM products p WHERE p.branch_id=product_versions.branch_id AND p.id=product_versions.product_id
) WHERE price_centavos IS NULL;
