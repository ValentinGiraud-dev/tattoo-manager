-- Catégories de produits, libres et sur autant de niveaux que voulu
-- (ex. « Aiguilles › RL »). Un lot peut être rangé dans n'importe quelle catégorie,
-- ou dans aucune. Les lots existants restent « sans catégorie ».
--
-- La catégorie sert à ranger, pas à tracer : elle peut changer à tout moment, même
-- pour un lot déjà utilisé en séance.

CREATE TABLE product_categories (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES product_categories(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (parent_id IS NULL OR parent_id != id)
);

-- Deux catégories sœurs ne portent pas le même nom (sans tenir compte de la casse).
CREATE UNIQUE INDEX idx_product_categories_sibling_name
    ON product_categories (COALESCE(parent_id, ''), name COLLATE NOCASE);

CREATE INDEX idx_product_categories_parent_id ON product_categories (parent_id);

ALTER TABLE lots ADD COLUMN category_id TEXT REFERENCES product_categories(id);

CREATE INDEX idx_lots_category_id ON lots (category_id);
