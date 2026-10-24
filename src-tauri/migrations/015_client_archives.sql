-- Archivage des clients.
--
-- Un client archivé reste en base, en lecture seule, et disparaît des listes de
-- séances, du planning et du tableau de bord. Son historique n'est jamais effacé.
-- Pour chaque lot à usage unique, la consommation nette de ses séances est remise
-- en stock par un mouvement ADJUSTMENT sans séance (services/client_archive.rs).
-- Le désarchivage ajoute les mouvements inverses.
--
-- Migration additive : une colonne vide et deux tables nouvelles.

ALTER TABLE clients ADD COLUMN archived_at TEXT;

CREATE TABLE client_archives (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    archived_at TEXT NOT NULL,
    restored_at TEXT
);

CREATE INDEX idx_client_archives_client_id ON client_archives (client_id);
-- Une seule archive active par client.
CREATE UNIQUE INDEX idx_client_archives_active
    ON client_archives (client_id) WHERE restored_at IS NULL;

CREATE TABLE client_archive_movements (
    id TEXT PRIMARY KEY,
    archive_id TEXT NOT NULL REFERENCES client_archives(id),
    lot_id TEXT NOT NULL REFERENCES lots(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(id),
    restore_movement_id TEXT UNIQUE REFERENCES stock_movements(id)
);

CREATE INDEX idx_client_archive_movements_archive_id
    ON client_archive_movements (archive_id);

-- Journal d'audit : archived_at suivi sur les clients.
DROP TRIGGER IF EXISTS audit_clients_insert;
DROP TRIGGER IF EXISTS audit_clients_update;
DROP TRIGGER IF EXISTS audit_clients_delete;
CREATE TRIGGER audit_clients_insert AFTER INSERT ON clients
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'client', NEW.id,
        NEW.first_name || ' ' || NEW.last_name,
        NEW.id,
        NULL,
        NULL,
        NULL,
        json_object('first_name', NEW.first_name, 'last_name', NEW.last_name, 'birth_date', NEW.birth_date, 'email', NEW.email, 'phone', NEW.phone, 'address', NEW.address, 'notes', NEW.notes, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_clients_update AFTER UPDATE ON clients
WHEN NEW.first_name IS NOT OLD.first_name
    OR NEW.last_name IS NOT OLD.last_name
    OR NEW.birth_date IS NOT OLD.birth_date
    OR NEW.email IS NOT OLD.email
    OR NEW.phone IS NOT OLD.phone
    OR NEW.address IS NOT OLD.address
    OR NEW.notes IS NOT OLD.notes
    OR NEW.archived_at IS NOT OLD.archived_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'client', NEW.id,
        NEW.first_name || ' ' || NEW.last_name,
        NEW.id,
        NULL,
        NULL,
        json_object('first_name', OLD.first_name, 'last_name', OLD.last_name, 'birth_date', OLD.birth_date, 'email', OLD.email, 'phone', OLD.phone, 'address', OLD.address, 'notes', OLD.notes, 'archived_at', OLD.archived_at),
        json_object('first_name', NEW.first_name, 'last_name', NEW.last_name, 'birth_date', NEW.birth_date, 'email', NEW.email, 'phone', NEW.phone, 'address', NEW.address, 'notes', NEW.notes, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_clients_delete AFTER DELETE ON clients
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'client', OLD.id,
        OLD.first_name || ' ' || OLD.last_name,
        OLD.id,
        NULL,
        NULL,
        json_object('first_name', OLD.first_name, 'last_name', OLD.last_name, 'birth_date', OLD.birth_date, 'email', OLD.email, 'phone', OLD.phone, 'address', OLD.address, 'notes', OLD.notes, 'archived_at', OLD.archived_at),
        NULL);
END;

-- Filet de sécurité : un client archivé est en lecture seule, même si un service
-- oublie de le vérifier (les services renvoient un message clair avant d'arriver ici).
CREATE TRIGGER archived_client_sessions_insert BEFORE INSERT ON sessions
WHEN EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;
CREATE TRIGGER archived_client_sessions_update BEFORE UPDATE ON sessions
WHEN EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;
CREATE TRIGGER archived_client_projects_insert BEFORE INSERT ON projects
WHEN EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;
CREATE TRIGGER archived_client_projects_update BEFORE UPDATE ON projects
WHEN EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;
CREATE TRIGGER archived_client_deposits_insert BEFORE INSERT ON deposits
WHEN EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;
CREATE TRIGGER archived_client_payments_insert BEFORE INSERT ON payments
WHEN EXISTS (
    SELECT 1 FROM sessions s JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id AND c.archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;
CREATE TRIGGER archived_client_usages_insert BEFORE INSERT ON session_usages
WHEN EXISTS (
    SELECT 1 FROM sessions s JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id AND c.archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;

-- Journal d'audit des nouvelles tables.
CREATE TRIGGER audit_client_archives_insert AFTER INSERT ON client_archives
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'client_archive', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id),
        NEW.client_id, NULL, NULL, NULL,
        json_object('client_id', NEW.client_id, 'archived_at', NEW.archived_at, 'restored_at', NEW.restored_at));
END;
CREATE TRIGGER audit_client_archives_update AFTER UPDATE ON client_archives
WHEN NEW.client_id IS NOT OLD.client_id
    OR NEW.archived_at IS NOT OLD.archived_at
    OR NEW.restored_at IS NOT OLD.restored_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'client_archive', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id),
        NEW.client_id, NULL, NULL,
        json_object('client_id', OLD.client_id, 'archived_at', OLD.archived_at, 'restored_at', OLD.restored_at),
        json_object('client_id', NEW.client_id, 'archived_at', NEW.archived_at, 'restored_at', NEW.restored_at));
END;
CREATE TRIGGER audit_client_archives_delete AFTER DELETE ON client_archives
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'client_archive', OLD.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = OLD.client_id),
        OLD.client_id, NULL, NULL,
        json_object('client_id', OLD.client_id, 'archived_at', OLD.archived_at, 'restored_at', OLD.restored_at),
        NULL);
END;

CREATE TRIGGER audit_client_archive_movements_insert AFTER INSERT ON client_archive_movements
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'client_archive_movement', NEW.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = NEW.lot_id),
        (SELECT client_id FROM client_archives WHERE id = NEW.archive_id),
        NULL, NEW.lot_id, NULL,
        json_object('archive_id', NEW.archive_id, 'lot_id', NEW.lot_id, 'quantity', NEW.quantity, 'movement_id', NEW.movement_id, 'restore_movement_id', NEW.restore_movement_id));
END;
CREATE TRIGGER audit_client_archive_movements_update AFTER UPDATE ON client_archive_movements
WHEN NEW.archive_id IS NOT OLD.archive_id
    OR NEW.lot_id IS NOT OLD.lot_id
    OR NEW.quantity IS NOT OLD.quantity
    OR NEW.movement_id IS NOT OLD.movement_id
    OR NEW.restore_movement_id IS NOT OLD.restore_movement_id
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'client_archive_movement', NEW.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = NEW.lot_id),
        (SELECT client_id FROM client_archives WHERE id = NEW.archive_id),
        NULL, NEW.lot_id,
        json_object('archive_id', OLD.archive_id, 'lot_id', OLD.lot_id, 'quantity', OLD.quantity, 'movement_id', OLD.movement_id, 'restore_movement_id', OLD.restore_movement_id),
        json_object('archive_id', NEW.archive_id, 'lot_id', NEW.lot_id, 'quantity', NEW.quantity, 'movement_id', NEW.movement_id, 'restore_movement_id', NEW.restore_movement_id));
END;
CREATE TRIGGER audit_client_archive_movements_delete AFTER DELETE ON client_archive_movements
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'client_archive_movement', OLD.id,
        (SELECT name || ' · lot ' || lot_number FROM lots WHERE id = OLD.lot_id),
        (SELECT client_id FROM client_archives WHERE id = OLD.archive_id),
        NULL, OLD.lot_id,
        json_object('archive_id', OLD.archive_id, 'lot_id', OLD.lot_id, 'quantity', OLD.quantity, 'movement_id', OLD.movement_id, 'restore_movement_id', OLD.restore_movement_id),
        NULL);
END;
