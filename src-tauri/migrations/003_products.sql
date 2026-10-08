CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lot_number TEXT NOT NULL,
    creation_date TEXT,
    opened_at TEXT,
    expiration_date TEXT NOT NULL,
    after_opening_months INTEGER CHECK (after_opening_months IS NULL OR after_opening_months > 0),
    single_use INTEGER NOT NULL CHECK (single_use IN (0, 1)),
    product_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);