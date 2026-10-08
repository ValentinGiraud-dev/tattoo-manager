CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PLANNED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED')),
    body_area TEXT,
    description TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);