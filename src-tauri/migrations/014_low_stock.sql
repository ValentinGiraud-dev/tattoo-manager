-- Stock bas : seuils d'alerte sur les fiches produit et les catégories.
--
-- Migration uniquement additive : colonnes vides, aucune alerte tant qu'aucun
-- seuil n'est réglé.
--
-- Règles (services/low_stock.rs) :
-- - Stock surveillé d'une fiche : somme de ses lots non périmés (pièces en stock
--   pour l'usage multiple). Les lots sans fiche ne sont pas surveillés.
-- - Alerte quand ce stock est inférieur ou égal au seuil.
-- - product_sheets.low_stock_threshold : vide = seuil de la catégorie ; 0 = pas
--   d'alerte pour ce produit ; N = alerte à N ou moins.
-- - product_categories.low_stock_mode :
--   EACH  : seuil par défaut de chaque fiche de la catégorie et de ses
--           sous-catégories (la catégorie la plus proche l'emporte) ;
--   TOTAL : alerte sur la somme du stock des fiches de la catégorie et de ses
--           sous-catégories (produits interchangeables).
--   Seuil et mode sont remplis ensemble, ou vides ensemble.

ALTER TABLE product_sheets ADD COLUMN low_stock_threshold INTEGER
    CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0);

ALTER TABLE product_categories ADD COLUMN low_stock_threshold INTEGER
    CHECK (low_stock_threshold IS NULL OR low_stock_threshold > 0);
ALTER TABLE product_categories ADD COLUMN low_stock_mode TEXT
    CHECK (low_stock_mode IS NULL OR low_stock_mode IN ('EACH', 'TOTAL'));

-- Seuil et mode vont ensemble (une contrainte de colonne ajoutée ne peut pas
-- les relier : déclencheurs).
CREATE TRIGGER product_categories_low_stock_pair_insert
BEFORE INSERT ON product_categories
WHEN (NEW.low_stock_threshold IS NULL) != (NEW.low_stock_mode IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'Seuil et mode d''alerte vont ensemble');
END;

CREATE TRIGGER product_categories_low_stock_pair_update
BEFORE UPDATE OF low_stock_threshold, low_stock_mode ON product_categories
WHEN (NEW.low_stock_threshold IS NULL) != (NEW.low_stock_mode IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'Seuil et mode d''alerte vont ensemble');
END;

-- Journal d'audit : déclencheurs recréés pour suivre les nouvelles colonnes.

-- product_categories
DROP TRIGGER IF EXISTS audit_product_categories_insert;
DROP TRIGGER IF EXISTS audit_product_categories_update;
DROP TRIGGER IF EXISTS audit_product_categories_delete;
CREATE TRIGGER audit_product_categories_insert AFTER INSERT ON product_categories
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'category', NEW.id,
        NEW.name,
        NULL,
        NULL,
        NULL,
        NULL,
        json_object('name', NEW.name, 'parent_id', NEW.parent_id, 'low_stock_threshold', NEW.low_stock_threshold, 'low_stock_mode', NEW.low_stock_mode));
END;
CREATE TRIGGER audit_product_categories_update AFTER UPDATE ON product_categories
WHEN NEW.name IS NOT OLD.name
    OR NEW.parent_id IS NOT OLD.parent_id
    OR NEW.low_stock_threshold IS NOT OLD.low_stock_threshold
    OR NEW.low_stock_mode IS NOT OLD.low_stock_mode
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'category', NEW.id,
        NEW.name,
        NULL,
        NULL,
        NULL,
        json_object('name', OLD.name, 'parent_id', OLD.parent_id, 'low_stock_threshold', OLD.low_stock_threshold, 'low_stock_mode', OLD.low_stock_mode),
        json_object('name', NEW.name, 'parent_id', NEW.parent_id, 'low_stock_threshold', NEW.low_stock_threshold, 'low_stock_mode', NEW.low_stock_mode));
END;
CREATE TRIGGER audit_product_categories_delete AFTER DELETE ON product_categories
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'category', OLD.id,
        OLD.name,
        NULL,
        NULL,
        NULL,
        json_object('name', OLD.name, 'parent_id', OLD.parent_id, 'low_stock_threshold', OLD.low_stock_threshold, 'low_stock_mode', OLD.low_stock_mode),
        NULL);
END;

-- product_sheets
DROP TRIGGER IF EXISTS audit_product_sheets_insert;
DROP TRIGGER IF EXISTS audit_product_sheets_update;
DROP TRIGGER IF EXISTS audit_product_sheets_delete;
CREATE TRIGGER audit_product_sheets_insert AFTER INSERT ON product_sheets
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'product', NEW.id,
        CASE WHEN NEW.brand IS NULL THEN NEW.name ELSE NEW.brand || ' · ' || NEW.name END,
        NULL,
        NULL,
        NULL,
        NULL,
        json_object('name', NEW.name, 'brand', NEW.brand, 'category_id', NEW.category_id, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'low_stock_threshold', NEW.low_stock_threshold));
END;
CREATE TRIGGER audit_product_sheets_update AFTER UPDATE ON product_sheets
WHEN NEW.name IS NOT OLD.name
    OR NEW.brand IS NOT OLD.brand
    OR NEW.category_id IS NOT OLD.category_id
    OR NEW.single_use IS NOT OLD.single_use
    OR NEW.after_opening_months IS NOT OLD.after_opening_months
    OR NEW.product_url IS NOT OLD.product_url
    OR NEW.low_stock_threshold IS NOT OLD.low_stock_threshold
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'product', NEW.id,
        CASE WHEN NEW.brand IS NULL THEN NEW.name ELSE NEW.brand || ' · ' || NEW.name END,
        NULL,
        NULL,
        NULL,
        json_object('name', OLD.name, 'brand', OLD.brand, 'category_id', OLD.category_id, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'low_stock_threshold', OLD.low_stock_threshold),
        json_object('name', NEW.name, 'brand', NEW.brand, 'category_id', NEW.category_id, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'low_stock_threshold', NEW.low_stock_threshold));
END;
CREATE TRIGGER audit_product_sheets_delete AFTER DELETE ON product_sheets
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'product', OLD.id,
        CASE WHEN OLD.brand IS NULL THEN OLD.name ELSE OLD.brand || ' · ' || OLD.name END,
        NULL,
        NULL,
        NULL,
        json_object('name', OLD.name, 'brand', OLD.brand, 'category_id', OLD.category_id, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'low_stock_threshold', OLD.low_stock_threshold),
        NULL);
END;
