-- Journal d'audit : chaque création, modification ou suppression dans la base
-- ajoute une ligne, dans la même transaction que l'écriture (déclencheurs ci-dessous).
--
-- Règles :
-- - Le journal ne se modifie pas et ne s'efface pas, même depuis l'app
--   (déclencheurs audit_log_no_update / audit_log_no_delete). Conservation illimitée.
--   Restaurer une sauvegarde remet le journal de la sauvegarde.
-- - before_json / after_json : valeurs des colonnes suivies, avant et après.
--   created_at / updated_at ne sont pas suivies. Les réponses aux questionnaires
--   (session_forms.answers) ne sont jamais recopiées : seul le fait qu'elles
--   changent est noté.
-- - label : nom lisible de l'objet au moment de l'écriture (il reste lisible
--   si l'objet est renommé ou supprimé ensuite).
-- - client_id / session_id / lot_id : fiches auxquelles l'entrée se rattache,
--   pour l'historique affiché sur chaque fiche. Pas de clé étrangère : l'entrée
--   survit à la suppression de l'objet.
-- - Entrées écrites par l'app (entity = 'app') : sécurité, sauvegardes, exports.
--   Réception d'un usage multiple : une seule entrée pour toutes les pièces
--   (écrite par le service), pas une par pièce ni par mouvement d'achat.
--
-- Une future migration qui reconstruit une table suivie doit recréer ses
-- déclencheurs audit_<table>_* (le test audit_triggers_cover_every_column le vérifie).

CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL,
    action TEXT NOT NULL CHECK (length(action) > 0),
    entity TEXT NOT NULL CHECK (length(entity) > 0),
    entity_id TEXT,
    label TEXT,
    client_id TEXT,
    session_id TEXT,
    lot_id TEXT,
    before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json))
);

CREATE INDEX idx_audit_log_occurred_at ON audit_log (occurred_at);
CREATE INDEX idx_audit_log_entity ON audit_log (entity, entity_id);
CREATE INDEX idx_audit_log_client_id ON audit_log (client_id);
CREATE INDEX idx_audit_log_session_id ON audit_log (session_id);
CREATE INDEX idx_audit_log_lot_id ON audit_log (lot_id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'Le journal ne se modifie pas');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'Le journal ne s''efface pas');
END;

-- Point de départ : ce qui précède cette version n'est pas dans le journal.
INSERT INTO audit_log (occurred_at, action, entity)
VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'JOURNAL_STARTED', 'app');

-- clients
CREATE TRIGGER audit_clients_insert AFTER INSERT ON clients
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'client', NEW.id,
        NEW.first_name || ' ' || NEW.last_name,
        NEW.id,
        NULL,
        NULL,
        NULL,
        json_object('first_name', NEW.first_name, 'last_name', NEW.last_name, 'birth_date', NEW.birth_date, 'email', NEW.email, 'phone', NEW.phone, 'address', NEW.address, 'notes', NEW.notes));
END;
CREATE TRIGGER audit_clients_update AFTER UPDATE ON clients
WHEN NEW.first_name IS NOT OLD.first_name
    OR NEW.last_name IS NOT OLD.last_name
    OR NEW.birth_date IS NOT OLD.birth_date
    OR NEW.email IS NOT OLD.email
    OR NEW.phone IS NOT OLD.phone
    OR NEW.address IS NOT OLD.address
    OR NEW.notes IS NOT OLD.notes
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'client', NEW.id,
        NEW.first_name || ' ' || NEW.last_name,
        NEW.id,
        NULL,
        NULL,
        json_object('first_name', OLD.first_name, 'last_name', OLD.last_name, 'birth_date', OLD.birth_date, 'email', OLD.email, 'phone', OLD.phone, 'address', OLD.address, 'notes', OLD.notes),
        json_object('first_name', NEW.first_name, 'last_name', NEW.last_name, 'birth_date', NEW.birth_date, 'email', NEW.email, 'phone', NEW.phone, 'address', NEW.address, 'notes', NEW.notes));
END;
CREATE TRIGGER audit_clients_delete AFTER DELETE ON clients
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'client', OLD.id,
        OLD.first_name || ' ' || OLD.last_name,
        OLD.id,
        NULL,
        NULL,
        json_object('first_name', OLD.first_name, 'last_name', OLD.last_name, 'birth_date', OLD.birth_date, 'email', OLD.email, 'phone', OLD.phone, 'address', OLD.address, 'notes', OLD.notes),
        NULL);
END;

-- projects
CREATE TRIGGER audit_projects_insert AFTER INSERT ON projects
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'project', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || NEW.title,
        NEW.client_id,
        NULL,
        NULL,
        NULL,
        json_object('client_id', NEW.client_id, 'title', NEW.title, 'body_area', NEW.body_area, 'description', NEW.description, 'quoted_price_cents', NEW.quoted_price_cents, 'status', NEW.status));
END;
CREATE TRIGGER audit_projects_update AFTER UPDATE ON projects
WHEN NEW.client_id IS NOT OLD.client_id
    OR NEW.title IS NOT OLD.title
    OR NEW.body_area IS NOT OLD.body_area
    OR NEW.description IS NOT OLD.description
    OR NEW.quoted_price_cents IS NOT OLD.quoted_price_cents
    OR NEW.status IS NOT OLD.status
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'project', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || NEW.title,
        NEW.client_id,
        NULL,
        NULL,
        json_object('client_id', OLD.client_id, 'title', OLD.title, 'body_area', OLD.body_area, 'description', OLD.description, 'quoted_price_cents', OLD.quoted_price_cents, 'status', OLD.status),
        json_object('client_id', NEW.client_id, 'title', NEW.title, 'body_area', NEW.body_area, 'description', NEW.description, 'quoted_price_cents', NEW.quoted_price_cents, 'status', NEW.status));
END;
CREATE TRIGGER audit_projects_delete AFTER DELETE ON projects
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'project', OLD.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = OLD.client_id) || ' · ' || OLD.title,
        OLD.client_id,
        NULL,
        NULL,
        json_object('client_id', OLD.client_id, 'title', OLD.title, 'body_area', OLD.body_area, 'description', OLD.description, 'quoted_price_cents', OLD.quoted_price_cents, 'status', OLD.status),
        NULL);
END;

-- sessions
CREATE TRIGGER audit_sessions_insert AFTER INSERT ON sessions
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'session', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || strftime('%d/%m/%Y', NEW.date),
        NEW.client_id,
        NEW.id,
        NULL,
        NULL,
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'date', NEW.date, 'start_time', NEW.start_time, 'duration_minutes', NEW.duration_minutes, 'status', NEW.status, 'price_cents', NEW.price_cents, 'body_area', NEW.body_area, 'description', NEW.description, 'notes', NEW.notes));
END;
CREATE TRIGGER audit_sessions_update AFTER UPDATE ON sessions
WHEN NEW.client_id IS NOT OLD.client_id
    OR NEW.project_id IS NOT OLD.project_id
    OR NEW.date IS NOT OLD.date
    OR NEW.start_time IS NOT OLD.start_time
    OR NEW.duration_minutes IS NOT OLD.duration_minutes
    OR NEW.status IS NOT OLD.status
    OR NEW.price_cents IS NOT OLD.price_cents
    OR NEW.body_area IS NOT OLD.body_area
    OR NEW.description IS NOT OLD.description
    OR NEW.notes IS NOT OLD.notes
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'session', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || strftime('%d/%m/%Y', NEW.date),
        NEW.client_id,
        NEW.id,
        NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'date', OLD.date, 'start_time', OLD.start_time, 'duration_minutes', OLD.duration_minutes, 'status', OLD.status, 'price_cents', OLD.price_cents, 'body_area', OLD.body_area, 'description', OLD.description, 'notes', OLD.notes),
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'date', NEW.date, 'start_time', NEW.start_time, 'duration_minutes', NEW.duration_minutes, 'status', NEW.status, 'price_cents', NEW.price_cents, 'body_area', NEW.body_area, 'description', NEW.description, 'notes', NEW.notes));
END;
CREATE TRIGGER audit_sessions_delete AFTER DELETE ON sessions
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'session', OLD.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = OLD.client_id) || ' · ' || strftime('%d/%m/%Y', OLD.date),
        OLD.client_id,
        OLD.id,
        NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'date', OLD.date, 'start_time', OLD.start_time, 'duration_minutes', OLD.duration_minutes, 'status', OLD.status, 'price_cents', OLD.price_cents, 'body_area', OLD.body_area, 'description', OLD.description, 'notes', OLD.notes),
        NULL);
END;

-- session_forms
CREATE TRIGGER audit_session_forms_insert AFTER INSERT ON session_forms
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'session_form', NEW.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = NEW.session_id),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        NULL,
        NULL,
        json_object('session_id', NEW.session_id, 'kind', NEW.kind, 'form_version', NEW.form_version));
END;
CREATE TRIGGER audit_session_forms_update AFTER UPDATE ON session_forms
WHEN NEW.session_id IS NOT OLD.session_id
    OR NEW.kind IS NOT OLD.kind
    OR NEW.form_version IS NOT OLD.form_version
    OR NEW.answers IS NOT OLD.answers
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'session_form', NEW.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = NEW.session_id),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        NULL,
        json_object('session_id', OLD.session_id, 'kind', OLD.kind, 'form_version', OLD.form_version),
        json_object('session_id', NEW.session_id, 'kind', NEW.kind, 'form_version', NEW.form_version));
END;
CREATE TRIGGER audit_session_forms_delete AFTER DELETE ON session_forms
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'session_form', OLD.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = OLD.session_id),
        (SELECT client_id FROM sessions WHERE id = OLD.session_id),
        OLD.session_id,
        NULL,
        json_object('session_id', OLD.session_id, 'kind', OLD.kind, 'form_version', OLD.form_version),
        NULL);
END;

-- session_documents
CREATE TRIGGER audit_session_documents_insert AFTER INSERT ON session_documents
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'session_document', NEW.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = NEW.session_id),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        NULL,
        NULL,
        json_object('session_id', NEW.session_id, 'kind', NEW.kind, 'original_name', NEW.original_name, 'size_bytes', NEW.size_bytes, 'void_reason', NEW.void_reason, 'voided_at', NEW.voided_at));
END;
CREATE TRIGGER audit_session_documents_update AFTER UPDATE ON session_documents
WHEN NEW.session_id IS NOT OLD.session_id
    OR NEW.kind IS NOT OLD.kind
    OR NEW.original_name IS NOT OLD.original_name
    OR NEW.size_bytes IS NOT OLD.size_bytes
    OR NEW.void_reason IS NOT OLD.void_reason
    OR NEW.voided_at IS NOT OLD.voided_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'session_document', NEW.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = NEW.session_id),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        NULL,
        json_object('session_id', OLD.session_id, 'kind', OLD.kind, 'original_name', OLD.original_name, 'size_bytes', OLD.size_bytes, 'void_reason', OLD.void_reason, 'voided_at', OLD.voided_at),
        json_object('session_id', NEW.session_id, 'kind', NEW.kind, 'original_name', NEW.original_name, 'size_bytes', NEW.size_bytes, 'void_reason', NEW.void_reason, 'voided_at', NEW.voided_at));
END;
CREATE TRIGGER audit_session_documents_delete AFTER DELETE ON session_documents
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'session_document', OLD.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = OLD.session_id),
        (SELECT client_id FROM sessions WHERE id = OLD.session_id),
        OLD.session_id,
        NULL,
        json_object('session_id', OLD.session_id, 'kind', OLD.kind, 'original_name', OLD.original_name, 'size_bytes', OLD.size_bytes, 'void_reason', OLD.void_reason, 'voided_at', OLD.voided_at),
        NULL);
END;

-- session_usages
CREATE TRIGGER audit_session_usages_insert AFTER INSERT ON session_usages
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'session_usage', NEW.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = COALESCE(NEW.lot_id, (SELECT lot_id FROM units WHERE id = NEW.unit_id))),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        COALESCE(NEW.lot_id, (SELECT lot_id FROM units WHERE id = NEW.unit_id)),
        NULL,
        json_object('session_id', NEW.session_id, 'lot_id', NEW.lot_id, 'unit_id', NEW.unit_id));
END;
CREATE TRIGGER audit_session_usages_update AFTER UPDATE ON session_usages
WHEN NEW.session_id IS NOT OLD.session_id
    OR NEW.lot_id IS NOT OLD.lot_id
    OR NEW.unit_id IS NOT OLD.unit_id
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'session_usage', NEW.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = COALESCE(NEW.lot_id, (SELECT lot_id FROM units WHERE id = NEW.unit_id))),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        COALESCE(NEW.lot_id, (SELECT lot_id FROM units WHERE id = NEW.unit_id)),
        json_object('session_id', OLD.session_id, 'lot_id', OLD.lot_id, 'unit_id', OLD.unit_id),
        json_object('session_id', NEW.session_id, 'lot_id', NEW.lot_id, 'unit_id', NEW.unit_id));
END;
CREATE TRIGGER audit_session_usages_delete AFTER DELETE ON session_usages
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'session_usage', OLD.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = COALESCE(OLD.lot_id, (SELECT lot_id FROM units WHERE id = OLD.unit_id))),
        (SELECT client_id FROM sessions WHERE id = OLD.session_id),
        OLD.session_id,
        COALESCE(OLD.lot_id, (SELECT lot_id FROM units WHERE id = OLD.unit_id)),
        json_object('session_id', OLD.session_id, 'lot_id', OLD.lot_id, 'unit_id', OLD.unit_id),
        NULL);
END;

-- session_usage_voids
CREATE TRIGGER audit_session_usage_voids_insert AFTER INSERT ON session_usage_voids
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'session_usage_void', NEW.id,
        (SELECT (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = COALESCE(su.lot_id, (SELECT lot_id FROM units WHERE id = su.unit_id))) FROM session_usages su WHERE su.id = NEW.session_usage_id),
        (SELECT (SELECT client_id FROM sessions WHERE id = su.session_id) FROM session_usages su WHERE su.id = NEW.session_usage_id),
        (SELECT session_id FROM session_usages WHERE id = NEW.session_usage_id),
        (SELECT COALESCE(su.lot_id, (SELECT lot_id FROM units WHERE id = su.unit_id)) FROM session_usages su WHERE su.id = NEW.session_usage_id),
        NULL,
        json_object('session_usage_id', NEW.session_usage_id, 'reason', NEW.reason));
END;
CREATE TRIGGER audit_session_usage_voids_update AFTER UPDATE ON session_usage_voids
WHEN NEW.session_usage_id IS NOT OLD.session_usage_id
    OR NEW.reason IS NOT OLD.reason
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'session_usage_void', NEW.id,
        (SELECT (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = COALESCE(su.lot_id, (SELECT lot_id FROM units WHERE id = su.unit_id))) FROM session_usages su WHERE su.id = NEW.session_usage_id),
        (SELECT (SELECT client_id FROM sessions WHERE id = su.session_id) FROM session_usages su WHERE su.id = NEW.session_usage_id),
        (SELECT session_id FROM session_usages WHERE id = NEW.session_usage_id),
        (SELECT COALESCE(su.lot_id, (SELECT lot_id FROM units WHERE id = su.unit_id)) FROM session_usages su WHERE su.id = NEW.session_usage_id),
        json_object('session_usage_id', OLD.session_usage_id, 'reason', OLD.reason),
        json_object('session_usage_id', NEW.session_usage_id, 'reason', NEW.reason));
END;
CREATE TRIGGER audit_session_usage_voids_delete AFTER DELETE ON session_usage_voids
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'session_usage_void', OLD.id,
        (SELECT (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = COALESCE(su.lot_id, (SELECT lot_id FROM units WHERE id = su.unit_id))) FROM session_usages su WHERE su.id = OLD.session_usage_id),
        (SELECT (SELECT client_id FROM sessions WHERE id = su.session_id) FROM session_usages su WHERE su.id = OLD.session_usage_id),
        (SELECT session_id FROM session_usages WHERE id = OLD.session_usage_id),
        (SELECT COALESCE(su.lot_id, (SELECT lot_id FROM units WHERE id = su.unit_id)) FROM session_usages su WHERE su.id = OLD.session_usage_id),
        json_object('session_usage_id', OLD.session_usage_id, 'reason', OLD.reason),
        NULL);
END;

-- deposits
CREATE TRIGGER audit_deposits_insert AFTER INSERT ON deposits
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'deposit', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id),
        NEW.client_id,
        NEW.session_id,
        NULL,
        NULL,
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'session_id', NEW.session_id, 'amount_cents', NEW.amount_cents, 'method', NEW.method, 'received_on', NEW.received_on, 'note', NEW.note, 'void_reason', NEW.void_reason, 'voided_at', NEW.voided_at));
END;
CREATE TRIGGER audit_deposits_update AFTER UPDATE ON deposits
WHEN NEW.client_id IS NOT OLD.client_id
    OR NEW.project_id IS NOT OLD.project_id
    OR NEW.session_id IS NOT OLD.session_id
    OR NEW.amount_cents IS NOT OLD.amount_cents
    OR NEW.method IS NOT OLD.method
    OR NEW.received_on IS NOT OLD.received_on
    OR NEW.note IS NOT OLD.note
    OR NEW.void_reason IS NOT OLD.void_reason
    OR NEW.voided_at IS NOT OLD.voided_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'deposit', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id),
        NEW.client_id,
        NEW.session_id,
        NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'session_id', OLD.session_id, 'amount_cents', OLD.amount_cents, 'method', OLD.method, 'received_on', OLD.received_on, 'note', OLD.note, 'void_reason', OLD.void_reason, 'voided_at', OLD.voided_at),
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'session_id', NEW.session_id, 'amount_cents', NEW.amount_cents, 'method', NEW.method, 'received_on', NEW.received_on, 'note', NEW.note, 'void_reason', NEW.void_reason, 'voided_at', NEW.voided_at));
END;
CREATE TRIGGER audit_deposits_delete AFTER DELETE ON deposits
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'deposit', OLD.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = OLD.client_id),
        OLD.client_id,
        OLD.session_id,
        NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'session_id', OLD.session_id, 'amount_cents', OLD.amount_cents, 'method', OLD.method, 'received_on', OLD.received_on, 'note', OLD.note, 'void_reason', OLD.void_reason, 'voided_at', OLD.voided_at),
        NULL);
END;

-- deposit_outcomes
CREATE TRIGGER audit_deposit_outcomes_insert AFTER INSERT ON deposit_outcomes
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'deposit_outcome', NEW.id,
        (SELECT (SELECT first_name || ' ' || last_name FROM clients WHERE id = d.client_id) FROM deposits d WHERE d.id = NEW.deposit_id),
        (SELECT client_id FROM deposits WHERE id = NEW.deposit_id),
        COALESCE(NEW.session_id, (SELECT session_id FROM deposits WHERE id = NEW.deposit_id)),
        NULL,
        NULL,
        json_object('deposit_id', NEW.deposit_id, 'outcome', NEW.outcome, 'session_id', NEW.session_id, 'reason', NEW.reason, 'void_reason', NEW.void_reason, 'voided_at', NEW.voided_at));
END;
CREATE TRIGGER audit_deposit_outcomes_update AFTER UPDATE ON deposit_outcomes
WHEN NEW.deposit_id IS NOT OLD.deposit_id
    OR NEW.outcome IS NOT OLD.outcome
    OR NEW.session_id IS NOT OLD.session_id
    OR NEW.reason IS NOT OLD.reason
    OR NEW.void_reason IS NOT OLD.void_reason
    OR NEW.voided_at IS NOT OLD.voided_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'deposit_outcome', NEW.id,
        (SELECT (SELECT first_name || ' ' || last_name FROM clients WHERE id = d.client_id) FROM deposits d WHERE d.id = NEW.deposit_id),
        (SELECT client_id FROM deposits WHERE id = NEW.deposit_id),
        COALESCE(NEW.session_id, (SELECT session_id FROM deposits WHERE id = NEW.deposit_id)),
        NULL,
        json_object('deposit_id', OLD.deposit_id, 'outcome', OLD.outcome, 'session_id', OLD.session_id, 'reason', OLD.reason, 'void_reason', OLD.void_reason, 'voided_at', OLD.voided_at),
        json_object('deposit_id', NEW.deposit_id, 'outcome', NEW.outcome, 'session_id', NEW.session_id, 'reason', NEW.reason, 'void_reason', NEW.void_reason, 'voided_at', NEW.voided_at));
END;
CREATE TRIGGER audit_deposit_outcomes_delete AFTER DELETE ON deposit_outcomes
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'deposit_outcome', OLD.id,
        (SELECT (SELECT first_name || ' ' || last_name FROM clients WHERE id = d.client_id) FROM deposits d WHERE d.id = OLD.deposit_id),
        (SELECT client_id FROM deposits WHERE id = OLD.deposit_id),
        COALESCE(OLD.session_id, (SELECT session_id FROM deposits WHERE id = OLD.deposit_id)),
        NULL,
        json_object('deposit_id', OLD.deposit_id, 'outcome', OLD.outcome, 'session_id', OLD.session_id, 'reason', OLD.reason, 'void_reason', OLD.void_reason, 'voided_at', OLD.voided_at),
        NULL);
END;

-- payments
CREATE TRIGGER audit_payments_insert AFTER INSERT ON payments
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'payment', NEW.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = NEW.session_id),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        NULL,
        NULL,
        json_object('session_id', NEW.session_id, 'amount_cents', NEW.amount_cents, 'method', NEW.method, 'paid_on', NEW.paid_on, 'note', NEW.note, 'void_reason', NEW.void_reason, 'voided_at', NEW.voided_at));
END;
CREATE TRIGGER audit_payments_update AFTER UPDATE ON payments
WHEN NEW.session_id IS NOT OLD.session_id
    OR NEW.amount_cents IS NOT OLD.amount_cents
    OR NEW.method IS NOT OLD.method
    OR NEW.paid_on IS NOT OLD.paid_on
    OR NEW.note IS NOT OLD.note
    OR NEW.void_reason IS NOT OLD.void_reason
    OR NEW.voided_at IS NOT OLD.voided_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'payment', NEW.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = NEW.session_id),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        NULL,
        json_object('session_id', OLD.session_id, 'amount_cents', OLD.amount_cents, 'method', OLD.method, 'paid_on', OLD.paid_on, 'note', OLD.note, 'void_reason', OLD.void_reason, 'voided_at', OLD.voided_at),
        json_object('session_id', NEW.session_id, 'amount_cents', NEW.amount_cents, 'method', NEW.method, 'paid_on', NEW.paid_on, 'note', NEW.note, 'void_reason', NEW.void_reason, 'voided_at', NEW.voided_at));
END;
CREATE TRIGGER audit_payments_delete AFTER DELETE ON payments
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'payment', OLD.id,
        (SELECT c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date) FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = OLD.session_id),
        (SELECT client_id FROM sessions WHERE id = OLD.session_id),
        OLD.session_id,
        NULL,
        json_object('session_id', OLD.session_id, 'amount_cents', OLD.amount_cents, 'method', OLD.method, 'paid_on', OLD.paid_on, 'note', OLD.note, 'void_reason', OLD.void_reason, 'voided_at', OLD.voided_at),
        NULL);
END;

-- lots
CREATE TRIGGER audit_lots_insert AFTER INSERT ON lots
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'lot', NEW.id,
        NEW.name || ' · lot ' || NEW.lot_number,
        NULL,
        NULL,
        NEW.id,
        NULL,
        json_object('name', NEW.name, 'lot_number', NEW.lot_number, 'creation_date', NEW.creation_date, 'expiration_date', NEW.expiration_date, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'category_id', NEW.category_id));
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
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'lot', NEW.id,
        NEW.name || ' · lot ' || NEW.lot_number,
        NULL,
        NULL,
        NEW.id,
        json_object('name', OLD.name, 'lot_number', OLD.lot_number, 'creation_date', OLD.creation_date, 'expiration_date', OLD.expiration_date, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'category_id', OLD.category_id),
        json_object('name', NEW.name, 'lot_number', NEW.lot_number, 'creation_date', NEW.creation_date, 'expiration_date', NEW.expiration_date, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'category_id', NEW.category_id));
END;
CREATE TRIGGER audit_lots_delete AFTER DELETE ON lots
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'lot', OLD.id,
        OLD.name || ' · lot ' || OLD.lot_number,
        NULL,
        NULL,
        OLD.id,
        json_object('name', OLD.name, 'lot_number', OLD.lot_number, 'creation_date', OLD.creation_date, 'expiration_date', OLD.expiration_date, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'category_id', OLD.category_id),
        NULL);
END;

-- units
CREATE TRIGGER audit_units_update AFTER UPDATE ON units
WHEN NEW.lot_id IS NOT OLD.lot_id
    OR NEW.opened_at IS NOT OLD.opened_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'unit', NEW.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = NEW.lot_id),
        NULL,
        NULL,
        NEW.lot_id,
        json_object('lot_id', OLD.lot_id, 'opened_at', OLD.opened_at),
        json_object('lot_id', NEW.lot_id, 'opened_at', NEW.opened_at));
END;
CREATE TRIGGER audit_units_delete AFTER DELETE ON units
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'unit', OLD.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = OLD.lot_id),
        NULL,
        NULL,
        OLD.lot_id,
        json_object('lot_id', OLD.lot_id, 'opened_at', OLD.opened_at),
        NULL);
END;

-- stock_movements
CREATE TRIGGER audit_stock_movements_insert AFTER INSERT ON stock_movements
WHEN NEW.type != 'PURCHASE' OR NEW.unit_id IS NULL
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'stock_movement', NEW.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = NEW.lot_id),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        NEW.lot_id,
        NULL,
        json_object('lot_id', NEW.lot_id, 'type', NEW.type, 'quantity', NEW.quantity, 'unit_id', NEW.unit_id, 'session_id', NEW.session_id, 'reason', NEW.reason));
END;
CREATE TRIGGER audit_stock_movements_update AFTER UPDATE ON stock_movements
WHEN NEW.lot_id IS NOT OLD.lot_id
    OR NEW.type IS NOT OLD.type
    OR NEW.quantity IS NOT OLD.quantity
    OR NEW.unit_id IS NOT OLD.unit_id
    OR NEW.session_id IS NOT OLD.session_id
    OR NEW.reason IS NOT OLD.reason
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'stock_movement', NEW.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = NEW.lot_id),
        (SELECT client_id FROM sessions WHERE id = NEW.session_id),
        NEW.session_id,
        NEW.lot_id,
        json_object('lot_id', OLD.lot_id, 'type', OLD.type, 'quantity', OLD.quantity, 'unit_id', OLD.unit_id, 'session_id', OLD.session_id, 'reason', OLD.reason),
        json_object('lot_id', NEW.lot_id, 'type', NEW.type, 'quantity', NEW.quantity, 'unit_id', NEW.unit_id, 'session_id', NEW.session_id, 'reason', NEW.reason));
END;
CREATE TRIGGER audit_stock_movements_delete AFTER DELETE ON stock_movements
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'stock_movement', OLD.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = OLD.lot_id),
        (SELECT client_id FROM sessions WHERE id = OLD.session_id),
        OLD.session_id,
        OLD.lot_id,
        json_object('lot_id', OLD.lot_id, 'type', OLD.type, 'quantity', OLD.quantity, 'unit_id', OLD.unit_id, 'session_id', OLD.session_id, 'reason', OLD.reason),
        NULL);
END;

-- product_categories
CREATE TRIGGER audit_product_categories_insert AFTER INSERT ON product_categories
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'category', NEW.id,
        NEW.name,
        NULL,
        NULL,
        NULL,
        NULL,
        json_object('name', NEW.name, 'parent_id', NEW.parent_id));
END;
CREATE TRIGGER audit_product_categories_update AFTER UPDATE ON product_categories
WHEN NEW.name IS NOT OLD.name
    OR NEW.parent_id IS NOT OLD.parent_id
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'category', NEW.id,
        NEW.name,
        NULL,
        NULL,
        NULL,
        json_object('name', OLD.name, 'parent_id', OLD.parent_id),
        json_object('name', NEW.name, 'parent_id', NEW.parent_id));
END;
CREATE TRIGGER audit_product_categories_delete AFTER DELETE ON product_categories
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'category', OLD.id,
        OLD.name,
        NULL,
        NULL,
        NULL,
        json_object('name', OLD.name, 'parent_id', OLD.parent_id),
        NULL);
END;
