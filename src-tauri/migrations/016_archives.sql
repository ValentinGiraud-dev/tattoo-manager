-- Archivage des séances, projets, lots et fiches produit.
--
-- Même règle que les clients (015) : une fiche sans aucune trace se supprime,
-- une fiche qui en a se archive. Rien de tracé n'est effacé. L'archivage ne
-- cascade pas : chaque fiche a son propre archived_at.
--
-- schema_flags sert uniquement à l'archivage d'un client, qui remet du stock
-- même sur un lot déjà archivé. La table reste vide en dehors de cette
-- transaction. Ce n'est pas une table métier : pas de journal d'audit.

ALTER TABLE sessions ADD COLUMN archived_at TEXT;
ALTER TABLE projects ADD COLUMN archived_at TEXT;
ALTER TABLE lots ADD COLUMN archived_at TEXT;
ALTER TABLE product_sheets ADD COLUMN archived_at TEXT;

CREATE INDEX idx_sessions_archived_at ON sessions (archived_at);
CREATE INDEX idx_projects_archived_at ON projects (archived_at);
CREATE INDEX idx_lots_archived_at ON lots (archived_at);
CREATE INDEX idx_product_sheets_archived_at ON product_sheets (archived_at);

CREATE TABLE schema_flags (
    name TEXT PRIMARY KEY
);

-- Le désarchivage est la seule mise à jour admise : archived_at redevient vide
-- et les autres colonnes métier ne changent pas (updated_at peut suivre).

CREATE TRIGGER archived_client_update BEFORE UPDATE ON clients
WHEN OLD.archived_at IS NOT NULL
 AND (
    NEW.archived_at IS NOT NULL
    OR NEW.first_name IS NOT OLD.first_name
    OR NEW.last_name IS NOT OLD.last_name
    OR NEW.birth_date IS NOT OLD.birth_date
    OR NEW.email IS NOT OLD.email
    OR NEW.phone IS NOT OLD.phone
    OR NEW.address IS NOT OLD.address
    OR NEW.notes IS NOT OLD.notes
    OR NEW.created_at IS NOT OLD.created_at
 )
BEGIN
    SELECT RAISE(ABORT, 'Client archivé : lecture seule');
END;

CREATE TRIGGER archived_session_update BEFORE UPDATE ON sessions
WHEN OLD.archived_at IS NOT NULL
 AND (
    NEW.archived_at IS NOT NULL
    OR NEW.client_id IS NOT OLD.client_id
    OR NEW.project_id IS NOT OLD.project_id
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

CREATE TRIGGER archived_project_update BEFORE UPDATE ON projects
WHEN OLD.archived_at IS NOT NULL
 AND (
    NEW.archived_at IS NOT NULL
    OR NEW.client_id IS NOT OLD.client_id
    OR NEW.title IS NOT OLD.title
    OR NEW.body_area IS NOT OLD.body_area
    OR NEW.description IS NOT OLD.description
    OR NEW.quoted_price_cents IS NOT OLD.quoted_price_cents
    OR NEW.status IS NOT OLD.status
    OR NEW.created_at IS NOT OLD.created_at
 )
BEGIN
    SELECT RAISE(ABORT, 'Projet archivé : lecture seule');
END;

CREATE TRIGGER archived_lot_update BEFORE UPDATE ON lots
WHEN OLD.archived_at IS NOT NULL
 AND (
    NEW.archived_at IS NOT NULL
    OR NEW.name IS NOT OLD.name
    OR NEW.lot_number IS NOT OLD.lot_number
    OR NEW.creation_date IS NOT OLD.creation_date
    OR NEW.expiration_date IS NOT OLD.expiration_date
    OR NEW.single_use IS NOT OLD.single_use
    OR NEW.after_opening_months IS NOT OLD.after_opening_months
    OR NEW.product_url IS NOT OLD.product_url
    OR NEW.category_id IS NOT OLD.category_id
    OR NEW.product_id IS NOT OLD.product_id
    OR NEW.created_at IS NOT OLD.created_at
 )
BEGIN
    SELECT RAISE(ABORT, 'Lot archivé : lecture seule');
END;

CREATE TRIGGER archived_sheet_update BEFORE UPDATE ON product_sheets
WHEN OLD.archived_at IS NOT NULL
 AND (
    NEW.archived_at IS NOT NULL
    OR NEW.name IS NOT OLD.name
    OR NEW.brand IS NOT OLD.brand
    OR NEW.category_id IS NOT OLD.category_id
    OR NEW.single_use IS NOT OLD.single_use
    OR NEW.after_opening_months IS NOT OLD.after_opening_months
    OR NEW.product_url IS NOT OLD.product_url
    OR NEW.low_stock_threshold IS NOT OLD.low_stock_threshold
    OR NEW.created_at IS NOT OLD.created_at
 )
BEGIN
    SELECT RAISE(ABORT, 'Fiche archivée : lecture seule');
END;

-- Enfants d'une séance archivée, ou d'une séance dont le client est archivé
-- (015 couvre déjà séances, projets, acomptes en insertion, paiements et liens).

CREATE TRIGGER archived_client_forms_insert BEFORE INSERT ON session_forms
WHEN EXISTS (
    SELECT 1 FROM sessions s JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id
      AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL))
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;
CREATE TRIGGER archived_client_forms_update BEFORE UPDATE ON session_forms
WHEN EXISTS (
    SELECT 1 FROM sessions s JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id
      AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL))
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;

CREATE TRIGGER archived_client_documents_insert BEFORE INSERT ON session_documents
WHEN EXISTS (
    SELECT 1 FROM sessions s JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id
      AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL))
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;
CREATE TRIGGER archived_client_documents_update BEFORE UPDATE ON session_documents
WHEN EXISTS (
    SELECT 1 FROM sessions s JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id
      AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL))
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;

CREATE TRIGGER archived_client_deposits_update BEFORE UPDATE ON deposits
WHEN EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND archived_at IS NOT NULL)
  OR (NEW.session_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM sessions WHERE id = NEW.session_id AND archived_at IS NOT NULL))
  OR (NEW.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects WHERE id = NEW.project_id AND archived_at IS NOT NULL))
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;

CREATE TRIGGER archived_session_deposits_insert BEFORE INSERT ON deposits
WHEN NEW.session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM sessions WHERE id = NEW.session_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Séance archivée : lecture seule');
END;
CREATE TRIGGER archived_project_deposits_insert BEFORE INSERT ON deposits
WHEN NEW.project_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM projects WHERE id = NEW.project_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Projet archivé : lecture seule');
END;

CREATE TRIGGER archived_client_outcomes_insert BEFORE INSERT ON deposit_outcomes
WHEN EXISTS (
    SELECT 1 FROM deposits d
    JOIN clients c ON c.id = d.client_id
    WHERE d.id = NEW.deposit_id AND c.archived_at IS NOT NULL
) OR EXISTS (
    SELECT 1 FROM sessions s
    JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id
      AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL)
) OR EXISTS (
    SELECT 1 FROM deposits d
    JOIN projects p ON p.id = d.project_id
    WHERE d.id = NEW.deposit_id AND p.archived_at IS NOT NULL
)
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;
CREATE TRIGGER archived_client_outcomes_update BEFORE UPDATE ON deposit_outcomes
WHEN EXISTS (
    SELECT 1 FROM deposits d
    JOIN clients c ON c.id = d.client_id
    WHERE d.id = NEW.deposit_id AND c.archived_at IS NOT NULL
) OR EXISTS (
    SELECT 1 FROM sessions s
    JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id
      AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;

CREATE TRIGGER archived_client_payments_update BEFORE UPDATE ON payments
WHEN EXISTS (
    SELECT 1 FROM sessions s JOIN clients c ON c.id = s.client_id
    WHERE s.id = NEW.session_id
      AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL))
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;
CREATE TRIGGER archived_session_payments_insert BEFORE INSERT ON payments
WHEN EXISTS (SELECT 1 FROM sessions WHERE id = NEW.session_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Séance archivée : lecture seule');
END;

CREATE TRIGGER archived_session_usages_insert BEFORE INSERT ON session_usages
WHEN EXISTS (SELECT 1 FROM sessions WHERE id = NEW.session_id AND archived_at IS NOT NULL)
  OR (NEW.lot_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM lots WHERE id = NEW.lot_id AND archived_at IS NOT NULL))
  OR (NEW.unit_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM units u JOIN lots l ON l.id = u.lot_id
        WHERE u.id = NEW.unit_id AND l.archived_at IS NOT NULL))
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;

CREATE TRIGGER archived_client_voids_insert BEFORE INSERT ON session_usage_voids
WHEN EXISTS (
    SELECT 1 FROM session_usages su
    JOIN sessions s ON s.id = su.session_id
    JOIN clients c ON c.id = s.client_id
    WHERE su.id = NEW.session_usage_id
      AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;

CREATE TRIGGER archived_context_movements_insert BEFORE INSERT ON stock_movements
WHEN (
    NEW.session_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM sessions s
        JOIN clients c ON c.id = s.client_id
        WHERE s.id = NEW.session_id
          AND (s.archived_at IS NOT NULL OR c.archived_at IS NOT NULL)
    )
) OR (
    EXISTS (SELECT 1 FROM lots WHERE id = NEW.lot_id AND archived_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM schema_flags WHERE name = 'lot_movement')
)
BEGIN
    SELECT RAISE(ABORT, 'Archivé : lecture seule');
END;

-- Un projet archivé n'accepte plus de séance ni de changement de rattachement.

CREATE TRIGGER archived_project_sessions_insert BEFORE INSERT ON sessions
WHEN NEW.project_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM projects WHERE id = NEW.project_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Projet archivé : lecture seule');
END;
CREATE TRIGGER archived_project_sessions_update BEFORE UPDATE OF project_id ON sessions
WHEN NEW.project_id IS NOT OLD.project_id
 AND NEW.project_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Projet archivé : lecture seule');
END;

-- Un lot archivé n'accepte plus de pièce. Une fiche archivée n'accepte plus de lot.

CREATE TRIGGER archived_lot_units_insert BEFORE INSERT ON units
WHEN EXISTS (SELECT 1 FROM lots WHERE id = NEW.lot_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Lot archivé : lecture seule');
END;
CREATE TRIGGER archived_lot_units_update BEFORE UPDATE ON units
WHEN EXISTS (SELECT 1 FROM lots WHERE id = NEW.lot_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Lot archivé : lecture seule');
END;

CREATE TRIGGER archived_sheet_lots_insert BEFORE INSERT ON lots
WHEN NEW.product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM product_sheets WHERE id = NEW.product_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Fiche archivée : lecture seule');
END;
CREATE TRIGGER archived_sheet_lots_update BEFORE UPDATE OF product_id ON lots
WHEN NEW.product_id IS NOT OLD.product_id
 AND NEW.product_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM product_sheets WHERE id = NEW.product_id AND archived_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Fiche archivée : lecture seule');
END;

-- Journal d'audit : archived_at suivi.

DROP TRIGGER IF EXISTS audit_sessions_insert;
DROP TRIGGER IF EXISTS audit_sessions_update;
DROP TRIGGER IF EXISTS audit_sessions_delete;
CREATE TRIGGER audit_sessions_insert AFTER INSERT ON sessions
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'session', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || strftime('%d/%m/%Y', NEW.date),
        NEW.client_id, NEW.id, NULL, NULL,
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'date', NEW.date, 'start_time', NEW.start_time, 'duration_minutes', NEW.duration_minutes, 'status', NEW.status, 'price_cents', NEW.price_cents, 'body_area', NEW.body_area, 'description', NEW.description, 'notes', NEW.notes, 'archived_at', NEW.archived_at));
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
    OR NEW.archived_at IS NOT OLD.archived_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'session', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || strftime('%d/%m/%Y', NEW.date),
        NEW.client_id, NEW.id, NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'date', OLD.date, 'start_time', OLD.start_time, 'duration_minutes', OLD.duration_minutes, 'status', OLD.status, 'price_cents', OLD.price_cents, 'body_area', OLD.body_area, 'description', OLD.description, 'notes', OLD.notes, 'archived_at', OLD.archived_at),
        json_object('client_id', NEW.client_id, 'project_id', NEW.project_id, 'date', NEW.date, 'start_time', NEW.start_time, 'duration_minutes', NEW.duration_minutes, 'status', NEW.status, 'price_cents', NEW.price_cents, 'body_area', NEW.body_area, 'description', NEW.description, 'notes', NEW.notes, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_sessions_delete AFTER DELETE ON sessions
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'session', OLD.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = OLD.client_id) || ' · ' || strftime('%d/%m/%Y', OLD.date),
        OLD.client_id, OLD.id, NULL,
        json_object('client_id', OLD.client_id, 'project_id', OLD.project_id, 'date', OLD.date, 'start_time', OLD.start_time, 'duration_minutes', OLD.duration_minutes, 'status', OLD.status, 'price_cents', OLD.price_cents, 'body_area', OLD.body_area, 'description', OLD.description, 'notes', OLD.notes, 'archived_at', OLD.archived_at),
        NULL);
END;

DROP TRIGGER IF EXISTS audit_projects_insert;
DROP TRIGGER IF EXISTS audit_projects_update;
DROP TRIGGER IF EXISTS audit_projects_delete;
CREATE TRIGGER audit_projects_insert AFTER INSERT ON projects
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'project', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || NEW.title,
        NEW.client_id, NULL, NULL, NULL,
        json_object('client_id', NEW.client_id, 'title', NEW.title, 'body_area', NEW.body_area, 'description', NEW.description, 'quoted_price_cents', NEW.quoted_price_cents, 'status', NEW.status, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_projects_update AFTER UPDATE ON projects
WHEN NEW.client_id IS NOT OLD.client_id
    OR NEW.title IS NOT OLD.title
    OR NEW.body_area IS NOT OLD.body_area
    OR NEW.description IS NOT OLD.description
    OR NEW.quoted_price_cents IS NOT OLD.quoted_price_cents
    OR NEW.status IS NOT OLD.status
    OR NEW.archived_at IS NOT OLD.archived_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'project', NEW.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = NEW.client_id) || ' · ' || NEW.title,
        NEW.client_id, NULL, NULL,
        json_object('client_id', OLD.client_id, 'title', OLD.title, 'body_area', OLD.body_area, 'description', OLD.description, 'quoted_price_cents', OLD.quoted_price_cents, 'status', OLD.status, 'archived_at', OLD.archived_at),
        json_object('client_id', NEW.client_id, 'title', NEW.title, 'body_area', NEW.body_area, 'description', NEW.description, 'quoted_price_cents', NEW.quoted_price_cents, 'status', NEW.status, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_projects_delete AFTER DELETE ON projects
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'project', OLD.id,
        (SELECT first_name || ' ' || last_name FROM clients WHERE id = OLD.client_id) || ' · ' || OLD.title,
        OLD.client_id, NULL, NULL,
        json_object('client_id', OLD.client_id, 'title', OLD.title, 'body_area', OLD.body_area, 'description', OLD.description, 'quoted_price_cents', OLD.quoted_price_cents, 'status', OLD.status, 'archived_at', OLD.archived_at),
        NULL);
END;

DROP TRIGGER IF EXISTS audit_lots_insert;
DROP TRIGGER IF EXISTS audit_lots_update;
DROP TRIGGER IF EXISTS audit_lots_delete;
CREATE TRIGGER audit_lots_insert AFTER INSERT ON lots
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'lot', NEW.id,
        NEW.name || ' · lot ' || NEW.lot_number,
        NULL, NULL, NEW.id, NULL,
        json_object('name', NEW.name, 'lot_number', NEW.lot_number, 'creation_date', NEW.creation_date, 'expiration_date', NEW.expiration_date, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'category_id', NEW.category_id, 'product_id', NEW.product_id, 'archived_at', NEW.archived_at));
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
    OR NEW.product_id IS NOT OLD.product_id
    OR NEW.archived_at IS NOT OLD.archived_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'lot', NEW.id,
        NEW.name || ' · lot ' || NEW.lot_number,
        NULL, NULL, NEW.id,
        json_object('name', OLD.name, 'lot_number', OLD.lot_number, 'creation_date', OLD.creation_date, 'expiration_date', OLD.expiration_date, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'category_id', OLD.category_id, 'product_id', OLD.product_id, 'archived_at', OLD.archived_at),
        json_object('name', NEW.name, 'lot_number', NEW.lot_number, 'creation_date', NEW.creation_date, 'expiration_date', NEW.expiration_date, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'category_id', NEW.category_id, 'product_id', NEW.product_id, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_lots_delete AFTER DELETE ON lots
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'lot', OLD.id,
        OLD.name || ' · lot ' || OLD.lot_number,
        NULL, NULL, OLD.id,
        json_object('name', OLD.name, 'lot_number', OLD.lot_number, 'creation_date', OLD.creation_date, 'expiration_date', OLD.expiration_date, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'category_id', OLD.category_id, 'product_id', OLD.product_id, 'archived_at', OLD.archived_at),
        NULL);
END;

DROP TRIGGER IF EXISTS audit_product_sheets_insert;
DROP TRIGGER IF EXISTS audit_product_sheets_update;
DROP TRIGGER IF EXISTS audit_product_sheets_delete;
CREATE TRIGGER audit_product_sheets_insert AFTER INSERT ON product_sheets
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'CREATE', 'product', NEW.id,
        CASE WHEN NEW.brand IS NULL THEN NEW.name ELSE NEW.brand || ' · ' || NEW.name END,
        NULL, NULL, NULL, NULL,
        json_object('name', NEW.name, 'brand', NEW.brand, 'category_id', NEW.category_id, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'low_stock_threshold', NEW.low_stock_threshold, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_product_sheets_update AFTER UPDATE ON product_sheets
WHEN NEW.name IS NOT OLD.name
    OR NEW.brand IS NOT OLD.brand
    OR NEW.category_id IS NOT OLD.category_id
    OR NEW.single_use IS NOT OLD.single_use
    OR NEW.after_opening_months IS NOT OLD.after_opening_months
    OR NEW.product_url IS NOT OLD.product_url
    OR NEW.low_stock_threshold IS NOT OLD.low_stock_threshold
    OR NEW.archived_at IS NOT OLD.archived_at
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'UPDATE', 'product', NEW.id,
        CASE WHEN NEW.brand IS NULL THEN NEW.name ELSE NEW.brand || ' · ' || NEW.name END,
        NULL, NULL, NULL,
        json_object('name', OLD.name, 'brand', OLD.brand, 'category_id', OLD.category_id, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'low_stock_threshold', OLD.low_stock_threshold, 'archived_at', OLD.archived_at),
        json_object('name', NEW.name, 'brand', NEW.brand, 'category_id', NEW.category_id, 'single_use', NEW.single_use, 'after_opening_months', NEW.after_opening_months, 'product_url', NEW.product_url, 'low_stock_threshold', NEW.low_stock_threshold, 'archived_at', NEW.archived_at));
END;
CREATE TRIGGER audit_product_sheets_delete AFTER DELETE ON product_sheets
BEGIN
    INSERT INTO audit_log (occurred_at, action, entity, entity_id, label, client_id, session_id, lot_id, before_json, after_json)
    VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now'), 'DELETE', 'product', OLD.id,
        CASE WHEN OLD.brand IS NULL THEN OLD.name ELSE OLD.brand || ' · ' || OLD.name END,
        NULL, NULL, NULL,
        json_object('name', OLD.name, 'brand', OLD.brand, 'category_id', OLD.category_id, 'single_use', OLD.single_use, 'after_opening_months', OLD.after_opening_months, 'product_url', OLD.product_url, 'low_stock_threshold', OLD.low_stock_threshold, 'archived_at', OLD.archived_at),
        NULL);
END;
