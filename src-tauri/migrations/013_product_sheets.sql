-- Fiches produit : ce que l'atelier achète et réachète (« Dynamic Triple Black »).
-- Un lot (numéro, péremption, pièces) peut être rattaché à une fiche.
--
-- Migration uniquement additive : aucune donnée existante n'est transformée.
-- Les lots déjà créés restent sans fiche (product_id vide) ; l'écran Produits les
-- signale (« Lot sans fiche produit ») et propose de créer ou de choisir la fiche.
--
-- Règles (vérifiées en Rust, services/product_sheets.rs) :
-- - Identité d'une fiche : nom + marque, sans tenir compte de la casse.
-- - Un lot rattaché a le même type (usage unique ou multiple) que sa fiche.
-- - Rattacher un lot ne change ni son nom, ni son numéro, ni sa péremption :
--   l'identité tracée du lot reste celle enregistrée.
-- - La catégorie d'un lot rattaché suit celle de sa fiche (copiée dans lots.category_id).
-- - Type, durée après ouverture et lien de la fiche servent de modèle aux nouveaux lots ;
--   les lots déjà reçus gardent leurs propres valeurs.
--
-- Nom de table distinct de l'ancienne table « products » (supprimée en 010).

CREATE TABLE product_sheets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    brand TEXT CHECK (brand IS NULL OR length(trim(brand)) > 0),
    category_id TEXT REFERENCES product_categories(id),
    single_use INTEGER NOT NULL CHECK (single_use IN (0, 1)),
    after_opening_months INTEGER CHECK (after_opening_months IS NULL OR after_opening_months > 0),
    product_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (single_use = 0 OR after_opening_months IS NULL)
);

CREATE UNIQUE INDEX idx_product_sheets_identity
    ON product_sheets (name COLLATE NOCASE, COALESCE(brand, '') COLLATE NOCASE);
CREATE INDEX idx_product_sheets_category_id ON product_sheets (category_id);

ALTER TABLE lots ADD COLUMN product_id TEXT REFERENCES product_sheets(id);
CREATE INDEX idx_lots_product_id ON lots (product_id);

-- Journal d'audit : la nouvelle table, et les déclencheurs des lots recréés
-- pour suivre la colonne product_id.

-- lots
DROP TRIGGER IF EXISTS audit_lots_insert;
DROP TRIGGER IF EXISTS audit_lots_update;
DROP TRIGGER IF EXISTS audit_lots_delete;
CREATE TRIGGER audit_lots_insert AFTER INSERT ON lots
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'lot', NEW.id,
        NEW.name || ' · lot ' || NEW.lot_number,
        NULL,
        NULL,
        NEW.id,
        NULL,
        json_object('name', NEW.name, 'lot_number', NEW.lot_number, 'creation_date', NEW.creation_date, 'expiration_date', NEW.expiration_date, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'category_id', NEW.category_id, 'product_id', NEW.product_id));
END;
CREATE TRIGGER audit_lots_update AFTER UPDATE ON lots
WHEN NEW.name IS NOT OLD.name
    OR NEW.lot_number IS NOT OLD.lot_number
    OR NEW.creation_date IS NOT OLD.creation_date
    OR NEW.expiration_date IS NOT OLD.expiration_date
    OR NEW.single_use IS NOT OLD.single_use
    OR NEW.after_opening_months IS NOT OLD.after_opening_months
    OR NEW.product_url IS NOT OLD.product_url
    OR NEW.category_id IS NOT OLD.category_id
    OR NEW.product_id IS NOT OLD.product_id
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'lot', NEW.id,
        NEW.name || ' · lot ' || NEW.lot_number,
        NULL,
        NULL,
        NEW.id,
        json_object('name', OLD.name, 'lot_number', OLD.lot_number, 'creation_date', OLD.creation_date, 'expiration_date', OLD.expiration_date, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'category_id', OLD.category_id, 'product_id', OLD.product_id),
        json_object('name', NEW.name, 'lot_number', NEW.lot_number, 'creation_date', NEW.creation_date, 'expiration_date', NEW.expiration_date, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'category_id', NEW.category_id, 'product_id', NEW.product_id));
END;
CREATE TRIGGER audit_lots_delete AFTER DELETE ON lots
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'lot', OLD.id,
        OLD.name || ' · lot ' || OLD.lot_number,
        NULL,
        NULL,
        OLD.id,
        json_object('name', OLD.name, 'lot_number', OLD.lot_number, 'creation_date', OLD.creation_date, 'expiration_date', OLD.expiration_date, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'category_id', OLD.category_id, 'product_id', OLD.product_id),
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
        json_object('name', NEW.name, 'brand', NEW.brand, 'category_id', NEW.category_id, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url));
END;
CREATE TRIGGER audit_product_sheets_update AFTER UPDATE ON product_sheets
WHEN NEW.name IS NOT OLD.name
    OR NEW.brand IS NOT OLD.brand
    OR NEW.category_id IS NOT OLD.category_id
    OR NEW.single_use IS NOT OLD.single_use
    OR NEW.after_opening_months IS NOT OLD.after_opening_months
    OR NEW.product_url IS NOT OLD.product_url
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'product', NEW.id,
        CASE WHEN NEW.brand IS NULL THEN NEW.name ELSE NEW.brand || ' · ' || NEW.name END,
        NULL,
        NULL,
        NULL,
        json_object('name', OLD.name, 'brand', OLD.brand, 'category_id', OLD.category_id, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url),
        json_object('name', NEW.name, 'brand', NEW.brand, 'category_id', NEW.category_id, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url));
END;
CREATE TRIGGER audit_product_sheets_delete AFTER DELETE ON product_sheets
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'product', OLD.id,
        CASE WHEN OLD.brand IS NULL THEN OLD.name ELSE OLD.brand || ' · ' || OLD.name END,
        NULL,
        NULL,
        NULL,
        json_object('name', OLD.name, 'brand', OLD.brand, 'category_id', OLD.category_id, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url),
        NULL);
END;
