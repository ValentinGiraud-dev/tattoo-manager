CREATE TABLE session_products (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, product_id)
);

CREATE INDEX idx_session_products_product_id
    ON session_products (product_id);