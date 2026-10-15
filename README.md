# Tracink

Application macOS locale pour gérer l'activité d'une tatoueuse : clients, séances, lots, stock et traçabilité des produits utilisés.

Stack : Tauri 2, React 19, TypeScript, Tailwind 4, Rust, SQLite (SQLx).

## Démarrer

Prérequis : Node.js, pnpm, Rust (rustup), Xcode Command Line Tools.

```bash
pnpm install
pnpm tauri dev
```

## Vérifier

```bash
pnpm build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## Documentation

- `project.md` : vision et roadmap
- `database-start.md` : modèle de données
- `AGENTS.md` : conventions du projet, à lire avant de contribuer (humain ou agent)
- `.cursor/rules/` : règles détaillées (données, UX, React, Rust, sécurité)
- `.agents/skills/tracink-*` : procédures (fonctionnalité, migration, revue, release)

## Données

Base et sauvegardes : `~/Library/Application Support/com.tracink.app/`. Base et documents sont chiffrés (mot de passe de l'app, clé de secours ou Touch ID). L'app copie la base avant chaque migration (dans `backups/`, 10 copies au plus) et fait des sauvegardes complètes chiffrées dans le dossier choisi dans Paramètres.
