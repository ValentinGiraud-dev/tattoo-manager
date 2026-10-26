-- Alerte d'expiration : délai en jours sur la fiche produit.
--
-- Migration uniquement additive : colonne vide, donc 30 jours (le délai
-- déjà utilisé à l'accueil). Rien n'est recalculé ici.
--
-- product_sheets.expiry_warning_days :
--   vide = 30 jours ;
--   0    = pas d'alerte anticipée (un lot déjà périmé reste signalé) ;
--   N    = alerte si la limite utile tombe dans les N jours.
-- Un lot sans fiche garde 30 jours. Règles : services/dashboard.rs.

ALTER TABLE product_sheets ADD COLUMN expiry_warning_days INTEGER
    CHECK (expiry_warning_days IS NULL OR expiry_warning_days >= 0);

-- Journal d'audit : déclencheurs recréés pour suivre la nouvelle colonne.

DROP TRIGGER IF EXISTS audit_product_sheets_insert;
DROP TRIGGER IF EXISTS audit_product_sheets_update;
DROP TRIGGER IF EXISTS audit_product_sheets_delete;
CREATE TRIGGER audit_product_sheets_insert AFTER INSERT ON product_sheets
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'product', NEW.id,
        CASE WHEN NEW.brand IS NULL THEN NEW.name ELSE NEW.brand || ' · ' || NEW.name END,
        NULL, NULL, NULL, NULL,
        json_object('name', NEW.name, 'brand', NEW.brand, 'category_id', NEW.category_id, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'low_stock_threshold', NEW.low_stock_threshold, 'expiry_warning_days', NEW.expiry_warning_days, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_product_sheets_update AFTER UPDATE ON product_sheets
WHEN NEW.name IS NOT OLD.name
    OR NEW.brand IS NOT OLD.brand
    OR NEW.category_id IS NOT OLD.category_id
    OR NEW.single_use IS NOT OLD.single_use
    OR NEW.after_opening_months IS NOT OLD.after_opening_months
    OR NEW.product_url IS NOT OLD.product_url
    OR NEW.low_stock_threshold IS NOT OLD.low_stock_threshold
    OR NEW.expiry_warning_days IS NOT OLD.expiry_warning_days
    OR NEW.archived_at IS NOT OLD.archived_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'product', NEW.id,
        CASE WHEN NEW.brand IS NULL THEN NEW.name ELSE NEW.brand || ' · ' || NEW.name END,
        NULL, NULL, NULL,
        json_object('name', OLD.name, 'brand', OLD.brand, 'category_id', OLD.category_id, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'low_stock_threshold', OLD.low_stock_threshold, 'expiry_warning_days', OLD.expiry_warning_days, 'archived_at', OLD.archived_at),
        json_object('name', NEW.name, 'brand', NEW.brand, 'category_id', NEW.category_id, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'low_stock_threshold', NEW.low_stock_threshold, 'expiry_warning_days', NEW.expiry_warning_days, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_product_sheets_delete AFTER DELETE ON product_sheets
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'product', OLD.id,
        CASE WHEN OLD.brand IS NULL THEN OLD.name ELSE OLD.brand || ' · ' || OLD.name END,
        NULL, NULL, NULL,
        json_object('name', OLD.name, 'brand', OLD.brand, 'category_id', OLD.category_id, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'low_stock_threshold', OLD.low_stock_threshold, 'expiry_warning_days', OLD.expiry_warning_days, 'archived_at', OLD.archived_at),
        NULL);
END;
