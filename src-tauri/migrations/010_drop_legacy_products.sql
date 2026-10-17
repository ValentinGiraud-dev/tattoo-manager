-- Supprime les tables products et session_products, remplacées par lots, units et
-- session_usages depuis la migration 006 (qui en a recopié tout le contenu).
--
-- Garde : avant de supprimer, chaque ancienne fiche produit doit avoir son lot
-- (même nom et même numéro, sans tenir compte de la casse), et chaque ancien lien
-- séance–produit son lien dans session_usages. Sinon la migration s'arrête et rien
-- n'est supprimé : mieux vaut bloquer que perdre une trace.

CREATE TEMP TABLE migration_010_check (step TEXT NOT NULL);

CREATE TEMP TRIGGER migration_010_guard
BEFORE INSERT ON migration_010_check
WHEN EXISTS (
    SELECT 1
    FROM products p
    WHERE NOT EXISTS (
        SELECT 1 FROM lots l
        WHERE l.name = p.name COLLATE NOCASE
          AND l.lot_number = p.lot_number COLLATE NOCASE
    )
)
OR EXISTS (
    SELECT 1
    FROM session_products sp
    INNER JOIN products p ON p.id = sp.product_id
    WHERE NOT EXISTS (
        SELECT 1
        FROM session_usages su
        LEFT JOIN units u ON u.id = su.unit_id
        INNER JOIN lots l ON l.id = COALESCE(su.lot_id, u.lot_id)
        WHERE su.session_id = sp.session_id
          AND l.name = p.name COLLATE NOCASE
          AND l.lot_number = p.lot_number COLLATE NOCASE
    )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Migration 010 : d''anciennes fiches produits ou d''anciens liens séance–produit n''ont pas leur équivalent dans les lots. Rien n''a été supprimé.'
    );
END;

INSERT INTO migration_010_check (step) VALUES ('anciennes tables recopiées');

DROP TRIGGER migration_010_guard;
DROP TABLE migration_010_check;

DROP INDEX IF EXISTS idx_session_products_product_id;
DROP TABLE session_products;
DROP TABLE products;
