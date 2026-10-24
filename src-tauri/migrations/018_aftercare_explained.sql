-- La tatoueuse note qu'elle a expliqué les règles d'hygiène après le tatouage.
-- Le contenu de ces règles n'est pas stocké. Les séances déjà là partent décochées.
--
-- Une séance archivée refuse toujours toute modification, y compris cette case.
-- Le journal d'audit reprend la colonne.

ALTER TABLE sessions ADD COLUMN aftercare_explained INTEGER NOT NULL DEFAULT 0;

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
    OR NEW.aftercare_explained IS NOT OLD.aftercare_explained
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
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'title', NEW.title, 'date', NEW.date, 'start_time', NEW.start_time, 'duration_minutes', NEW.duration_minutes, 'status', NEW.status, 'price_cents', NEW.price_cents, 'body_area', NEW.body_area, 'description', NEW.description, 'notes', NEW.notes, 'aftercare_explained', NEW.aftercare_explained, 'archived_at', NEW.archived_at));
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
    OR NEW.aftercare_explained IS NOT OLD.aftercare_explained
    OR NEW.archived_at IS NOT OLD.archived_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'session', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || strftime('%d/%m/%Y', NEW.date),
        NEW.client_id, NEW.id, NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'title', OLD.title, 'date', OLD.date, 'start_time', OLD.start_time, 'duration_minutes', OLD.duration_minutes, 'status', OLD.status, 'price_cents', OLD.price_cents, 'body_area', OLD.body_area, 'description', OLD.description, 'notes', OLD.notes, 'aftercare_explained', OLD.aftercare_explained, 'archived_at', OLD.archived_at),
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'title', NEW.title, 'date', NEW.date, 'start_time', NEW.start_time, 'duration_minutes', NEW.duration_minutes, 'status', NEW.status, 'price_cents', NEW.price_cents, 'body_area', NEW.body_area, 'description', NEW.description, 'notes', NEW.notes, 'aftercare_explained', NEW.aftercare_explained, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_sessions_delete AFTER DELETE ON sessions
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'session', OLD.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = OLD.client_id) || ' · ' || strftime('%d/%m/%Y', OLD.date),
        OLD.client_id, OLD.id, NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'title', OLD.title, 'date', OLD.date, 'start_time', OLD.start_time, 'duration_minutes', OLD.duration_minutes, 'status', OLD.status, 'price_cents', OLD.price_cents, 'body_area', OLD.body_area, 'description', OLD.description, 'notes', OLD.notes, 'aftercare_explained', OLD.aftercare_explained, 'archived_at', OLD.archived_at),
        NULL);
END;
