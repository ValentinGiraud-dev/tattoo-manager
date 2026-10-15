---
name: tracink-review
description: Relire un changement Tracink avant commit — traçabilité, intégrité des données, UX (confirmations, états), sécurité, tests. À utiliser quand on demande une revue, avant un commit, ou à la fin d'une fonctionnalité.
---

# Revue d'un changement Tracink

Lis le diff (`git diff` et `git diff --staged`, plus les fichiers non suivis). Pour chaque point, réponds OK, KO (avec fichier:ligne) ou N/A. Termine par la liste des KO classés du plus grave au moins grave.

## 1. Traçabilité et données (bloquant)

- [ ] Aucun `UPDATE`/`DELETE` qui écrase l'historique (`stock_movements`, `session_usages`, identité d'un lot utilisé, client d'une séance liée).
- [ ] Le stock reste une somme de mouvements.
- [ ] Les invariants de `data-model-v1.mdc` sont vérifiés dans une transaction.
- [ ] Aucune migration livrée modifiée. Nouvelle migration conforme au skill `tracink-migration`.
- [ ] « Périmé » et autres statuts calculés en Rust, avec la date locale.

## 2. Backend

- [ ] Logique dans `services/`, commande mince, commande enregistrée dans `lib.rs`.
- [ ] Entrées validées en Rust. Requêtes paramétrées.
- [ ] Pas de `unwrap`/`expect` hors tests sans justification.
- [ ] Erreurs SQL non exposées telles quelles.
- [ ] Tests : cas nominal + refus pour chaque nouvelle règle.

## 3. UX (`ux-ui.mdc`)

- [ ] Confirmation sur chaque action sensible, avec récapitulatif et verbe exact. Pas de `window.confirm`.
- [ ] États chargement, vide, erreur, succès.
- [ ] Double soumission impossible. Saisie conservée en cas d'erreur.
- [ ] Alertes (périmé, stock faible, mineur) visibles au moment de la décision.
- [ ] Textes en français, vocabulaire stable, dates `fr-FR`.
- [ ] Clavier : focus visible, `Échap`, `Entrée`. Libellés accessibles.
- [ ] Tokens de `index.css`, pas de couleur en dur.

## 4. Frontend

- [ ] `invoke` seulement dans les stores, avec `try/catch`.
- [ ] Types TS alignés sur les structs Rust.
- [ ] Pas de règle métier recalculée dans React.

## 5. Sécurité (`security-privacy.mdc`)

- [ ] Pas de donnée personnelle ou de santé dans un log ou un message technique.
- [ ] Pas de nouvelle requête réseau. Permissions Tauri minimales.
- [ ] Pas de secret, base, sauvegarde ou donnée client dans le commit.
- [ ] Commandes : base via `db.pool()?` (état `Db`), jamais `State<'_, SqlitePool>`.
- [ ] Aucun fichier client écrit en clair hors de `AppPaths.opened` ; documents et photos via `security::files`.
- [ ] Ni clé, ni mot de passe, ni clé de secours, ni chemin de fichier client dans un log.

## 6. Hygiène du dépôt

- [ ] `pnpm build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` passent (les lancer si possible).
- [ ] Docs à jour (`database-start.md`, règles, roadmap de `project.md`).
- [ ] Nouvelle dépendance justifiée.
- [ ] La dette connue de `AGENTS.md` n'a pas été recopiée ; si elle a été corrigée, retirer la ligne.
