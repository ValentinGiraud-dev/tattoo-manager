-- Annulation motivée d'un lien séance–produit.
-- Le lien reste dans session_usages : une ligne ici le marque comme annulé, avec le motif.
-- Pour un usage unique, le stock est rétabli par un mouvement ADJUSTMENT lié à la séance.
CREATE TABLE session_usage_voids (
    id TEXT PRIMARY KEY,
    session_usage_id TEXT NOT NULL UNIQUE REFERENCES session_usages(id),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    created_at TEXT NOT NULL
);
