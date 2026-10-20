---
name: tracink-migration
description: Écrire une migration SQLite sûre pour Tracink (src-tauri/migrations). À utiliser dès qu'une table, une colonne, un index ou une donnée existante doit changer.
---

# Migration SQLite Tracink

Les migrations s'exécutent au démarrage chez la tatoueuse, sur ses vraies données. Une erreur bloque l'app. Une migration ratée qui modifie des données peut casser la traçabilité.

## Règles absolues

- **Ne jamais modifier un fichier de migration déjà livré** (présent dans un tag ou une release). SQLx stocke sa somme de contrôle : l'app refuserait de démarrer.
- Une migration non livrée (encore locale, jamais publiée) peut être corrigée. Vérifie avec `git log --oneline -- src-tauri/migrations/<fichier>` et `git tag --contains`.
- Pas de `DROP TABLE`, `DROP COLUMN` ou `DELETE` sur une table tracée (`clients`, `sessions`, `lots`, `units`, `stock_movements`, `session_usages`).

## Étapes

1. **Nom** : numéro suivant sur 3 chiffres + description : `007_session_time.sql`.
2. **Structure** :
   - `CREATE TABLE` avec `id TEXT PRIMARY KEY`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL` si l'objet est modifiable.
   - Clés étrangères `REFERENCES table(id)`.
   - Contraintes `CHECK` pour les énumérations et les règles simples, en plus des vérifications Rust.
   - Index sur chaque clé étrangère et chaque colonne filtrée ou triée.
   - Journal d'audit : déclencheurs `audit_<table>_insert`, `_update`, `_delete` pour toute nouvelle table métier (modèle : `012_audit_log.sql`). Nouvelle colonne : recréer les trois déclencheurs avec la colonne. Le test `audit_triggers_cover_every_column` échoue sinon.
3. **Ajout de colonne** : `ALTER TABLE … ADD COLUMN` nullable ou avec `DEFAULT`. SQLite ne sait pas ajouter une contrainte à une colonne existante : si c'est nécessaire, créer la nouvelle table, copier, puis renommer, dans la même migration, avec `PRAGMA foreign_key_check` à l'esprit.
4. **Transformation de données** :
   - Écrire la règle de correspondance noir sur blanc dans un commentaire en tête du fichier.
   - Si des données peuvent être ambiguës, ajouter une garde qui fait échouer la migration avec un message français clair (modèle : trigger `migration_006_guard` dans `006_lots_and_stock.sql`). Mieux vaut bloquer que deviner.
   - Garder les anciennes tables tant qu'une version de transition est en circulation.
   - Table reconstruite (`DROP` + `CREATE`) : ses déclencheurs disparaissent avec elle (validation `void_once`, journal `audit_*`). Les recréer dans la même migration.
5. **Rust** : mettre à jour `models/`, les `SELECT` explicites et les structs d'entrée/sortie.
6. **Tests** :
   - Les tests qui ouvrent une base temporaire appliquent toutes les migrations : `cargo test` doit passer.
   - Pour une transformation de données, ajouter un test qui crée l'état « avant », applique la migration et vérifie l'état « après ».
7. **Essai sur une vraie base** : copier `~/Library/Application Support/com.tracink.app/database.sqlite` dans un dossier temporaire et lancer l'app de dev dessus, ou appliquer le SQL avec `sqlite3` sur la copie. Ne jamais tester sur l'original.
8. **Docs** : `database-start.md`, `.cursor/rules/data-model-v1.mdc`, et la liste des migrations dans `project.md`.

## Vérification finale

- [ ] Fichier nouveau, aucune migration livrée modifiée
- [ ] Aucune suppression de données tracées
- [ ] Index sur les clés étrangères
- [ ] Garde sur les transformations ambiguës
- [ ] `cargo test` passe
- [ ] Essayée sur une copie d'une vraie base
- [ ] Docs du modèle à jour
