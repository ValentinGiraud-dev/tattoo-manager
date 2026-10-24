-- Titre libre d'une séance.
--
-- Les séances déjà liées à un projet et sans titre en reçoivent un, une fois :
-- « {titre du projet} séance N », N dans l'ordre de la date, puis de created_at.
-- Les séances sans projet restent sans titre.
--
-- Le déclencheur « client archivé » refuse toute mise à jour de séance. On le
-- retire le temps du remplissage, puis on le remet tel quel. Une séance archivée
-- ne pourra plus changer de titre ensuite.

ALTER TABLE sessions ADD COLUMN title TEXT;

DROP TRIGGER IF EXISTS archived_client_sessions_update;

UPDATE sessions
SET title = (
    SELECT p.title || ' séance ' || (
        SELECT COUNT(*)
        FROM sessions earlier
        WHERE earlier.project_id = sessions.project_id
          AND (
            earlier.date < sessions.date
            OR (
                earlier.date = sessions.date
                AND earlier.created_at < sessions.created_at
            )
            OR (
                earlier.date = sessions.date
                AND earlier.created_at = sessions.created_at
                AND earlier.rowid <= sessions.rowid
            )
          )
    )
    FROM projects p
    WHERE p.id = sessions.project_id
)
WHERE project_id IS NOT NULL
  AND (title IS NULL OR trim(title) = '');

CREATE TRIGGER archived_client_sessions_update BEFORE UPDATE ON sessions
WHEN EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;

DROP TRIGGER IF EXISTS archived_session_update;
CREATE TRIGGER archived_session_update BEFORE UPDATE ON sessions
WHEN OLD.archived_at IS NOT NULL
 AND (
    NEW.archived_at IS NOT NULL
    OR NEW.client_id IS NOT OLD.client_id
    OR NEW.project_id IS NOT OLD.project_id
    OR NEW.title IS NOT OLD.title
    OR NEW.date IS NOT OLD.date
    OR NEW.start_time IS NOT OLD.start_time
    OR NEW.duration_minutes IS NOT OLD.duration_minutes
    OR NEW.status IS NOT OLD.status
    OR NEW.price_cents IS NOT OLD.price_cents
    OR NEW.body_area IS NOT OLD.body_area
    OR NEW.description IS NOT OLD.description
    OR NEW.notes IS NOT OLD.notes
    OR NEW.created_at IS NOT OLD.created_at
 )
BEGIN
    SELECT RAISE(ABORT, 'Séance archivée : lecture seule');
END;

DROP TRIGGER IF EXISTS audit_sessions_insert;
DROP TRIGGER IF EXISTS audit_sessions_update;
DROP TRIGGER IF EXISTS audit_sessions_delete;
CREATE TRIGGER audit_sessions_insert AFTER INSERT ON sessions
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'session', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || strftime('%d/%m/%Y', NEW.date),
        NEW.client_id, NEW.id, NULL, NULL,
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'title', NEW.title, 'date', NEW.date, 'start_time', NEW.start_time, 'duration_minutes', NEW.duration_minutes, 'status', NEW.status, 'price_cents', NEW.price_cents, 'body_area', NEW.body_area, 'description', NEW.description, 'notes', NEW.notes, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_sessions_update AFTER UPDATE ON sessions
WHEN NEW.client_id IS NOT OLD.client_id
    OR NEW.project_id IS NOT OLD.project_id
    OR NEW.title IS NOT OLD.title
    OR NEW.date IS NOT OLD.date
    OR NEW.start_time IS NOT OLD.start_time
    OR NEW.duration_minutes IS NOT OLD.duration_minutes
    OR NEW.status IS NOT OLD.status
    OR NEW.price_cents IS NOT OLD.price_cents
    OR NEW.body_area IS NOT OLD.body_area
    OR NEW.description IS NOT OLD.description
    OR NEW.notes IS NOT OLD.notes
    OR NEW.archived_at IS NOT OLD.archived_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'session', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || strftime('%d/%m/%Y', NEW.date),
        NEW.client_id, NEW.id, NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'title', OLD.title, 'date', OLD.date, 'start_time', OLD.start_time, 'duration_minutes', OLD.duration_minutes, 'status', OLD.status, 'price_cents', OLD.price_cents, 'body_area', OLD.body_area, 'description', OLD.description, 'notes', OLD.notes, 'archived_at', OLD.archived_at),
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'title', NEW.title, 'date', NEW.date, 'start_time', NEW.start_time, 'duration_minutes', NEW.duration_minutes, 'status', NEW.status, 'price_cents', NEW.price_cents, 'body_area', NEW.body_area, 'description', NEW.description, 'notes', NEW.notes, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_sessions_delete AFTER DELETE ON sessions
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'session', OLD.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = OLD.client_id) || ' · ' || strftime('%d/%m/%Y', OLD.date),
        OLD.client_id, OLD.id, NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'title', OLD.title, 'date', OLD.date, 'start_time', OLD.start_time, 'duration_minutes', OLD.duration_minutes, 'status', OLD.status, 'price_cents', OLD.price_cents, 'body_area', OLD.body_area, 'description', OLD.description, 'notes', OLD.notes, 'archived_at', OLD.archived_at),
        NULL);
END;
