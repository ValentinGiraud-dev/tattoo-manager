-- Lots, flacons et mouvements. Les tables products et session_products
-- restent en place : l'application ne les lit plus.

CREATE TABLE lots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lot_number TEXT NOT NULL,
    creation_date TEXT,
    expiration_date TEXT NOT NULL,
    single_use INTEGER NOT NULL CHECK (single_use IN (0, 1)),
    after_opening_months INTEGER,
    product_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (after_opening_months IS NULL OR after_opening_months > 0),
    CHECK (single_use = 0 OR after_opening_months IS NULL)
);

CREATE UNIQUE INDEX idx_lots_name_lot_number
    ON lots (name COLLATE NOCASE, lot_number COLLATE NOCASE);

CREATE TABLE units (
    id TEXT PRIMARY KEY,
    lot_id TEXT NOT NULL REFERENCES lots(id),
    opened_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_units_lot_id ON units (lot_id);

CREATE TABLE stock_movements (
    id TEXT PRIMARY KEY,
    lot_id TEXT NOT NULL REFERENCES lots(id),
    unit_id TEXT REFERENCES units(id),
    session_id TEXT REFERENCES sessions(id),
    type TEXT NOT NULL CHECK (type IN (
        'PURCHASE', 'CONSUMPTION', 'LOSS', 'EXPIRATION', 'RETURN', 'ADJUSTMENT'
    )),
    quantity INTEGER NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    CHECK (quantity != 0),
    CHECK (unit_id IS NULL OR quantity IN (-1, 1)),
    CHECK (
        (type = 'PURCHASE' AND quantity > 0)
        OR (type IN ('CONSUMPTION', 'LOSS', 'EXPIRATION', 'RETURN') AND quantity < 0)
        OR type = 'ADJUSTMENT'
    )
);

CREATE INDEX idx_stock_movements_lot_id ON stock_movements (lot_id);
CREATE INDEX idx_stock_movements_unit_id ON stock_movements (unit_id);
CREATE INDEX idx_stock_movements_session_id ON stock_movements (session_id);

CREATE TABLE session_usages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    lot_id TEXT REFERENCES lots(id),
    unit_id TEXT REFERENCES units(id),
    created_at TEXT NOT NULL,
    CHECK ((lot_id IS NULL) != (unit_id IS NULL))
);

CREATE UNIQUE INDEX idx_session_usages_session_lot
    ON session_usages (session_id, lot_id)
    WHERE lot_id IS NOT NULL;

CREATE UNIQUE INDEX idx_session_usages_session_unit
    ON session_usages (session_id, unit_id)
    WHERE unit_id IS NOT NULL;

CREATE INDEX idx_session_usages_lot_id ON session_usages (lot_id);
CREATE INDEX idx_session_usages_unit_id ON session_usages (unit_id);

-- Refuse de fusionner deux fiches incompatibles sous le même nom + numéro.
CREATE TRIGGER migration_006_guard
BEFORE INSERT ON lots
WHEN EXISTS (
    SELECT 1
    FROM products
    GROUP BY name COLLATE NOCASE, lot_number COLLATE NOCASE
    HAVING COUNT(DISTINCT expiration_date) > 1
        OR COUNT(DISTINCT single_use) > 1
        OR COUNT(DISTINCT COALESCE(after_opening_months, -1)) > 1
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Migration 006 : même nom et numéro de lot, mais péremption, type ou durée après ouverture différents'
    );
END;

INSERT INTO lots (
    id, name, lot_number, creation_date, expiration_date, single_use,
    after_opening_months, product_url, created_at, updated_at
)
SELECT
    p.id,
    p.name,
    p.lot_number,
    p.creation_date,
    p.expiration_date,
    p.single_use,
    CASE WHEN p.single_use = 1 THEN NULL ELSE p.after_opening_months END,
    p.product_url,
    p.created_at,
    p.updated_at
FROM products p
WHERE p.id = (
    SELECT p2.id
    FROM products p2
    WHERE p2.name COLLATE NOCASE = p.name COLLATE NOCASE
      AND p2.lot_number COLLATE NOCASE = p.lot_number COLLATE NOCASE
    ORDER BY p2.created_at ASC, p2.id ASC
    LIMIT 1
);

INSERT INTO units (id, lot_id, opened_at, created_at, updated_at)
SELECT
    p.id,
    (
        SELECT p2.id
        FROM products p2
        WHERE p2.name COLLATE NOCASE = p.name COLLATE NOCASE
          AND p2.lot_number COLLATE NOCASE = p.lot_number COLLATE NOCASE
        ORDER BY p2.created_at ASC, p2.id ASC
        LIMIT 1
    ),
    p.opened_at,
    p.created_at,
    p.updated_at
FROM products p
WHERE p.single_use = 0;

INSERT INTO stock_movements (
    id, lot_id, unit_id, session_id, type, quantity, reason, created_at
)
SELECT
    lower(hex(randomblob(16))),
    u.lot_id,
    u.id,
    NULL,
    'PURCHASE',
    1,
    NULL,
    u.created_at
FROM units u;

INSERT INTO session_usages (id, session_id, lot_id, unit_id, created_at)
SELECT
    lower(hex(randomblob(16))),
    sp.session_id,
    NULL,
    sp.product_id,
    sp.created_at
FROM session_products sp
INNER JOIN products p ON p.id = sp.product_id
WHERE p.single_use = 0;

INSERT INTO session_usages (id, session_id, lot_id, unit_id, created_at)
SELECT
    lower(hex(randomblob(16))),
    sp.session_id,
    rep.lot_id,
    NULL,
    MIN(sp.created_at)
FROM session_products sp
INNER JOIN products p ON p.id = sp.product_id
INNER JOIN (
    SELECT
        p3.id AS product_id,
        (
            SELECT p2.id
            FROM products p2
            WHERE p2.name COLLATE NOCASE = p3.name COLLATE NOCASE
              AND p2.lot_number COLLATE NOCASE = p3.lot_number COLLATE NOCASE
            ORDER BY p2.created_at ASC, p2.id ASC
            LIMIT 1
        ) AS lot_id
    FROM products p3
    WHERE p3.single_use = 1
) rep ON rep.product_id = p.id
WHERE p.single_use = 1
GROUP BY sp.session_id, rep.lot_id;

DROP TRIGGER migration_006_guard;
