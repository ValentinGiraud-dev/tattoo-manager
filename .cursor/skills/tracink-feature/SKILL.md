---
name: tracink-feature
description: Ajouter ou modifier une fonctionnalité Tracink de bout en bout (migration, service Rust, commande Tauri, store Zustand, écran React). À utiliser pour toute demande « ajoute », « implémente », « crée l'écran » dans ce projet.
---

# Ajouter une fonctionnalité Tracink

Suis les étapes dans l'ordre. Ne passe pas à l'UI tant que le backend et ses tests ne passent pas.

## 0. Cadrer

1. Lis `AGENTS.md`, `data-model-v1.mdc` et la section concernée de `project.md`.
2. Écris en 3 à 5 lignes : ce que fait la fonctionnalité, les données touchées, les règles métier, les actions sensibles.
3. Si une règle sanitaire, légale ou une durée de conservation est en jeu et n'est pas écrite dans le projet : **demande**, n'invente pas.
4. Repère la dette connue (`AGENTS.md`) dans la zone : corrige-la si c'est petit, sinon signale-la.

## 1. Données

- Schéma modifié → skill `tracink-migration`.
- Mettre à jour `database-start.md` et `.cursor/rules/data-model-v1.mdc` dans le même changement.

## 2. Service Rust (`src-tauri/src/services/<domaine>.rs`)

- Struct d'entrée `…Input` (`Deserialize`, camelCase) et struct de sortie (`Serialize`, `FromRow`, camelCase).
- Fonction `normalize` : `trim`, obligatoires, formats, bornes. Helpers de `services/sql.rs`.
- Écritures multiples dans une transaction, invariants vérifiés dedans.
- Erreurs : enum du domaine, messages métier en français, erreurs SQL masquées.

## 3. Tests Rust

- Dans le même module ou un fichier `*_tests.rs` sur le modèle de `stock_rules_tests.rs`.
- Au minimum : le cas nominal, chaque refus métier, un cas limite (vide, zéro, date passée).
- `cargo test`, `cargo fmt`, `cargo clippy --all-targets -- -D warnings`.

## 4. Commande Tauri

- Fonction mince dans `commands/mod.rs`, ajoutée à `generate_handler!` dans `lib.rs`.
- Nouvelle permission ou plugin → `capabilities/default.json`, permission minimale.

## 5. Store et types

- Types TS alignés sur les structs Rust.
- Action dans le store du domaine : `try/catch`, `loading`, `error`, rechargement après écriture.

## 6. Écran

Applique `ux-ui.mdc` :

- quatre états (chargement, vide, erreur, succès) ;
- dialogue de confirmation pour toute action listée dans la section 1 de `ux-ui.mdc` ;
- formulaire qui garde la saisie en cas d'erreur, bouton désactivé pendant l'envoi ;
- alertes métier visibles au moment de la décision ;
- tokens de `index.css`, textes en français.

## 7. Clore

1. `pnpm build` passe.
2. Lance `pnpm tauri dev` et fais le parcours à la main, y compris un cas d'erreur, si l'environnement le permet. Sinon, dis-le.
3. Coche la roadmap dans `project.md` si une case avance.
4. Passe le skill `tracink-review` sur le diff.
