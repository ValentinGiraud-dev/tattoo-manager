-- Questionnaires de santé, consentements et documents signés d'une séance.

-- Adresse du client : demandée par le formulaire de consentement.
ALTER TABLE clients ADD COLUMN address TEXT;

-- Réponses saisies dans l'app. Une ligne par séance et par type.
-- `answers` est du JSON validé par Rust (structs HealthAnswers / ConsentAnswers),
-- `form_version` dit quelle version du formulaire papier il suit.
CREATE TABLE session_forms (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    kind TEXT NOT NULL CHECK (kind IN ('HEALTH', 'CONSENT')),
    form_version INTEGER NOT NULL CHECK (form_version > 0),
    answers TEXT NOT NULL CHECK (json_valid(answers)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (session_id, kind)
);

-- Fichiers joints à une séance (scan ou photo du document signé).
-- Le fichier est copié dans documents/<session_id>/ ; la base garde les métadonnées.
-- Un document ne se supprime pas : il s'annule une seule fois, avec un motif.
CREATE TABLE session_documents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    kind TEXT NOT NULL CHECK (kind IN ('HEALTH_SIGNED', 'CONSENT_SIGNED', 'OTHER')),
    stored_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    created_at TEXT NOT NULL,
    void_reason TEXT,
    voided_at TEXT,
    CHECK ((void_reason IS NULL) = (voided_at IS NULL)),
    CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)
);

CREATE INDEX idx_session_documents_session_id ON session_documents (session_id);

-- Une annulation ne se défait pas et ne se réécrit pas.
CREATE TRIGGER session_documents_void_once
BEFORE UPDATE ON session_documents
WHEN OLD.voided_at IS NOT NULL
    OR NEW.stored_name != OLD.stored_name
    OR NEW.original_name != OLD.original_name
    OR NEW.size_bytes != OLD.size_bytes
    OR NEW.session_id != OLD.session_id
    OR NEW.kind != OLD.kind
BEGIN
    SELECT RAISE(ABORT, 'Un document joint ne se modifie pas');
END;
