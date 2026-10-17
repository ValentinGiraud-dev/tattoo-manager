# Tracink — instructions pour les agents

Tracink (nom de code `tattoo-manager`) est une application desktop macOS, locale et hors ligne, qui gère l'activité d'une tatoueuse : clients, séances, lots, stock et traçabilité. Ce fichier est le point d'entrée pour tout agent (Cursor, Claude Code, Codex…). Lis-le en entier avant de modifier le code.

## Où est quoi

| Sujet | Fichier |
| --- | --- |
| Vision produit, roadmap | `project.md` |
| Modèle de données détaillé | `database-start.md` |
| Direction artistique | `Charte.html` (tokens repris dans `src/index.css`) |
| Règles transverses | `.cursor/rules/project-foundation.mdc`, `.cursor/rules/data-model-v1.mdc`, `.cursor/rules/security-privacy.mdc` |
| Règles UX / UI (confirmations, états, formulaires) | `.cursor/rules/ux-ui.mdc` |
| Règles frontend React | `.cursor/rules/frontend-react.mdc` |
| Règles backend Rust et migrations | `.cursor/rules/rust-backend.mdc` |
| Procédures pas à pas | skills `tracink-*` dans `.agents/skills/` |

Les règles `.mdc` sont du Markdown avec un en-tête YAML. Tout agent peut les lire, pas seulement Cursor. **Avant de toucher `src/`, lis `ux-ui.mdc` et `frontend-react.mdc`. Avant de toucher `src-tauri/`, lis `rust-backend.mdc`.**

## Commandes

```bash
pnpm install                     # dépendances frontend
pnpm tauri dev                   # lancer l'app en développement
pnpm build                       # tsc + build Vite (vérifie les types)
pnpm lint                        # ESLint
pnpm format                      # Prettier (pnpm format:check pour vérifier)
pnpm check                       # lint + format:check + tests unitaires + build
pnpm test                        # Vitest : logique frontend (src/**/*.test.ts)
pnpm test:e2e                    # Playwright : parcours d'écran avec faux backend (e2e/)
cd src-tauri && cargo test       # tests Rust (règles métier, sauvegardes)
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --all-targets -- -D warnings
pnpm dist:mac                    # build universel macOS (voir skill tracink-release)
```

Données de l'app en local : `~/Library/Application Support/com.tracink.app/` (`database.sqlite` chiffrée SQLCipher, `vault.json`, `backups/`, `photos/`, `documents/` chiffrés, `settings.json`). Ne jamais travailler sur la base réelle de la tatoueuse : copie-la d'abord. Pour l'ouvrir hors de l'app, il faut la clé maître (voir `security-privacy.mdc`).

## Architecture en une ligne

```text
React (écran) → store Zustand → invoke("commande") → commands/ (mince) → services/ (métier + SQL) → SQLite
```

Toute règle métier vit dans `src-tauri/src/services/`. React affiche, collecte et confirme ; il ne décide pas.

La base est fermée tant que l'app est verrouillée : les commandes la demandent à l'état `Db` (`db.pool()?`). Côté React, `SecurityGate` (`src/features/security/`) ne monte l'app qu'après le premier déverrouillage. Chiffrement, Touch ID et sauvegardes : `security-privacy.mdc`.

## Définition de « terminé »

Une tâche n'est finie que si :

1. `pnpm check`, `cargo test`, `cargo fmt --check` et `cargo clippy --all-targets -- -D warnings` passent. La CI (`.github/workflows/ci.yml`) lance les mêmes commandes.
2. Chaque nouvelle règle métier a un test Rust (cas nominal + cas refusé).
3. L'écran gère les états chargement, vide, erreur et succès (voir `ux-ui.mdc`) ; une écriture réussie affiche un toast (`toast.success`, `src/stores/toast-store.ts`).
   Un parcours d'écran nouveau ou modifié a son test Playwright dans `e2e/` (faux backend : `e2e/fake-backend.ts`).
4. Toute action sensible a sa confirmation (liste dans `ux-ui.mdc`).
5. Les messages visibles sont en français, sans erreur SQL brute.
6. Si le schéma change : nouvelle migration (jamais d'édition d'une ancienne), `database-start.md` et `data-model-v1.mdc` mis à jour.
7. Si une fonctionnalité de la roadmap avance : case cochée dans `project.md`.

## Git

- Un commit = un changement cohérent. Message court à l'impératif, en français ou en anglais, mais pas de liste de fichiers.
- Ne jamais commiter `.env`, clés de signature (`*.key`), base SQLite, sauvegardes ou données client.
- Ne pas réécrire l'historique publié. Ne pas pousser sans demande explicite.

## Skills

Skills du projet (procédures à suivre). Source : `.agents/skills/`. `.claude/skills/` contient des liens ; `.cursor/skills/` contient des copies, à recopier après toute modification d'un skill `tracink-*` :

- `tracink-feature` : ajouter une fonctionnalité de bout en bout (migration → service → commande → store → écran).
- `tracink-migration` : écrire une migration SQLite sûre.
- `tracink-review` : relire un changement avant commit (traçabilité, UX, sécurité).
- `tracink-release` : publier une version (numéros, build, mise à jour automatique).

Skills tiers installés (`skills-lock.json`, ne pas les modifier : ils sont écrasés à la mise à jour) :

- Design et animation : `apple-design`, `emil-design-eng`, `animate`, `animation-vocabulary`, `improve-animations`, `review-animations`, `find-animation-opportunities`, `web-design-guidelines`, `break-ui`, `prototype`.
- React : `vercel-react-best-practices`, `vercel-composition-patterns`, `vercel-react-view-transitions`. **Ignorer les règles `server-*`, `async-api-routes`, `rendering-hydration-*` et les références Next.js** : il n'y a ni serveur ni SSR ici.
- Rédaction : `writing-guidelines`.
- `ask-sonner`, `pick-ui-library` : le projet n'utilise pas de bibliothèque de composants. Ne pas ajouter `sonner` ou une lib UI sans accord explicite.

## Formulaires papier

Les PDF de l'atelier (`src-tauri/assets/forms/`) sont pré-remplis par superposition (`services/form_pdf.rs`), aux coordonnées des formulaires v1. Si la tatoueuse change un formulaire : ajouter le nouveau PDF (`…-v2.pdf`), relever les coordonnées (`pdftotext -bbox`), adapter les structs si des questions changent, incrémenter `FORM_VERSION`, et vérifier le rendu avec `TRACINK_PDF_SAMPLES=/tmp cargo test write_samples -- --ignored`. Les réponses déjà enregistrées gardent leur `form_version`.

## Dette connue (à ne pas aggraver)

Ces écarts existent dans le code actuel. Ne pas les copier ; les corriger quand on travaille dans la zone.

- Code Touch ID et Trousseau (`security/biometry.rs`, `macos/touch_id.m`) compilé seulement sur macOS : seul le job CI `macos` le vérifie.
- Pas de rotation de la clé maître : changer le mot de passe ne rechiffre pas les données (voir `security-privacy.mdc`).
- Pas de seuil de stock bas : l'accueil ne signale que la péremption.
- Retour d'une fiche limité à un niveau (`origin` dans `ui-store`) : pas d'historique complet.
- Pas encore de journal d'audit générique (`audit_log`) : seules les annulations de liens et les mouvements de stock gardent une trace motivée.
- Les tests d'écran (Playwright) utilisent un faux backend : ils ne vérifient pas les appels Rust réels. Ceux-ci sont couverts par `cargo test`.
