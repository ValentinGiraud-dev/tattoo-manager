-- Phase 3 : la séance devient un rendez-vous (heure, durée, prix, projet, statut
-- « Absent »), avec acomptes et paiements.
--
-- SQLite ne sait pas modifier la contrainte CHECK du statut : la table sessions est
-- reconstruite (copie temporaire, suppression, recréation, recopie). sqlx exécute la
-- migration dans une transaction : on y diffère la vérification des clés étrangères
-- jusqu'au COMMIT (PRAGMA defer_foreign_keys). Les séances gardent leurs identifiants,
-- donc les liens (produits, documents, formulaires) retrouvent la nouvelle table.
-- Une vérification explicite fait échouer la migration si une référence est cassée.

PRAGMA defer_foreign_keys = ON;

-- Une pièce réalisée en une ou plusieurs séances.
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    body_area TEXT,
    description TEXT,
    -- Prix annoncé pour la pièce entière (devis), en centimes.
    quoted_price_cents INTEGER CHECK (quoted_price_cents IS NULL OR quoted_price_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'ABANDONED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_projects_client_id ON projects (client_id);

-- Copie de travail des séances, le temps de recréer la table.
CREATE TEMP TABLE migration_009_sessions AS SELECT * FROM main.sessions;

-- Avec les clés étrangères différées, supprimer la table compte une violation par
-- ligne qui pointe vers une séance ; chaque séance réinsérée dans la nouvelle table
-- (même identifiant) annule les siennes. À la fin, le compte doit être nul.
DROP TABLE main.sessions;

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    project_id TEXT REFERENCES projects(id),
    date TEXT NOT NULL,
    -- Heure locale de début « HH:MM ». NULL pour les séances saisies avant la Phase 3.
    start_time TEXT CHECK (
        start_time IS NULL
        OR (length(start_time) = 5 AND start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time < '24:00')
    ),
    duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 15 AND 720),
    status TEXT NOT NULL CHECK (status IN ('PLANNED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW')),
    -- Prix convenu de la séance, en centimes.
    price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
    body_area TEXT,
    description TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO main.sessions
    (id, client_id, project_id, date, start_time, duration_minutes, status, price_cents,
     body_area, description, notes, created_at, updated_at)
SELECT
    id, client_id, NULL, date, NULL, NULL, status, NULL,
    body_area, description, notes, created_at, updated_at
FROM temp.migration_009_sessions;

DROP TABLE temp.migration_009_sessions;

CREATE INDEX idx_sessions_client_id ON sessions (client_id);
CREATE INDEX idx_sessions_date ON sessions (date);
CREATE INDEX idx_sessions_project_id ON sessions (project_id);

-- Acompte versé par le client, pour un projet ou pour une séance.
CREATE TABLE deposits (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    project_id TEXT REFERENCES projects(id),
    session_id TEXT REFERENCES sessions(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD', 'TRANSFER', 'CHECK', 'OTHER')),
    received_on TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    void_reason TEXT,
    voided_at TEXT,
    CHECK (project_id IS NOT NULL OR session_id IS NOT NULL),
    CHECK ((void_reason IS NULL) = (voided_at IS NULL)),
    CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)
);

CREATE INDEX idx_deposits_client_id ON deposits (client_id);
CREATE INDEX idx_deposits_project_id ON deposits (project_id);
CREATE INDEX idx_deposits_session_id ON deposits (session_id);

-- Ce que devient un acompte : déduit d'une séance, perdu ou remboursé.
-- Une seule issue active par acompte ; une issue saisie par erreur s'annule (motif),
-- l'acompte redevient alors « en attente ».
CREATE TABLE deposit_outcomes (
    id TEXT PRIMARY KEY,
    deposit_id TEXT NOT NULL REFERENCES deposits(id),
    outcome TEXT NOT NULL CHECK (outcome IN ('APPLIED', 'FORFEITED', 'REFUNDED')),
    -- APPLIED : séance dont il est déduit. FORFEITED : séance manquée, si connue.
    session_id TEXT REFERENCES sessions(id),
    reason TEXT,
    created_at TEXT NOT NULL,
    void_reason TEXT,
    voided_at TEXT,
    CHECK (outcome != 'APPLIED' OR session_id IS NOT NULL),
    CHECK ((void_reason IS NULL) = (voided_at IS NULL)),
    CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)
);

CREATE UNIQUE INDEX idx_deposit_outcomes_active
    ON deposit_outcomes (deposit_id)
    WHERE voided_at IS NULL;
CREATE INDEX idx_deposit_outcomes_session_id ON deposit_outcomes (session_id);

-- Encaissement pour une séance.
CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD', 'TRANSFER', 'CHECK', 'OTHER')),
    paid_on TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    void_reason TEXT,
    voided_at TEXT,
    CHECK ((void_reason IS NULL) = (voided_at IS NULL)),
    CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)
);

CREATE INDEX idx_payments_session_id ON payments (session_id);

-- L'argent ne se réécrit pas : seule l'annulation (une fois) est permise.
CREATE TRIGGER deposits_void_once
BEFORE UPDATE ON deposits
WHEN OLD.voided_at IS NOT NULL
    OR NEW.client_id != OLD.client_id
    OR NEW.project_id IS NOT OLD.project_id
    OR NEW.session_id IS NOT OLD.session_id
    OR NEW.amount_cents != OLD.amount_cents
    OR NEW.method != OLD.method
    OR NEW.received_on != OLD.received_on
    OR NEW.note IS NOT OLD.note
BEGIN
    SELECT RAISE(ABORT, 'Un acompte ne se modifie pas : annule-le avec un motif');
END;

CREATE TRIGGER deposit_outcomes_void_once
BEFORE UPDATE ON deposit_outcomes
WHEN OLD.voided_at IS NOT NULL
    OR NEW.deposit_id != OLD.deposit_id
    OR NEW.outcome != OLD.outcome
    OR NEW.session_id IS NOT OLD.session_id
    OR NEW.reason IS NOT OLD.reason
BEGIN
    SELECT RAISE(ABORT, 'Le sort d''un acompte ne se modifie pas : annule-le avec un motif');
END;

CREATE TRIGGER payments_void_once
BEFORE UPDATE ON payments
WHEN OLD.voided_at IS NOT NULL
    OR NEW.session_id != OLD.session_id
    OR NEW.amount_cents != OLD.amount_cents
    OR NEW.method != OLD.method
    OR NEW.paid_on != OLD.paid_on
    OR NEW.note IS NOT OLD.note
BEGIN
    SELECT RAISE(ABORT, 'Un paiement ne se modifie pas : annule-le avec un motif');
END;

CREATE TRIGGER deposits_no_delete BEFORE DELETE ON deposits
BEGIN
    SELECT RAISE(ABORT, 'Un acompte ne se supprime pas');
END;

CREATE TRIGGER deposit_outcomes_no_delete BEFORE DELETE ON deposit_outcomes
BEGIN
    SELECT RAISE(ABORT, 'Le sort d''un acompte ne se supprime pas');
END;

CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
BEGIN
    SELECT RAISE(ABORT, 'Un paiement ne se supprime pas');
END;

-- Refuse de valider si la recopie a cassé une référence : la contrainte CHECK
-- échoue, la transaction est annulée et la base reste intacte.
CREATE TEMP TABLE migration_009_fk_check (violations INTEGER NOT NULL CHECK (violations = 0));
INSERT INTO migration_009_fk_check SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE migration_009_fk_check;

