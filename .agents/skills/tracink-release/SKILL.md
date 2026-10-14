---
name: tracink-release
description: Publier une nouvelle version de Tracink pour macOS (numéro de version, build universel signé, release GitHub et latest.json pour la mise à jour automatique). À utiliser quand on demande de sortir, publier ou packager une version.
---

# Publier une version de Tracink

L'app se met à jour seule via `tauri-plugin-updater`, qui lit
`https://github.com/ValentinGiraud-dev/tattoo-manager/releases/latest/download/latest.json`.
Une release mal formée bloque les mises à jour chez la tatoueuse : suis chaque étape.

## 1. Prérequis

- Arbre propre (`git status` vide), sur la branche principale à jour.
- `cargo test`, `cargo clippy --all-targets -- -D warnings` et `pnpm build` passent.
- Variables d'environnement présentes (jamais dans le dépôt) :
  - `TAURI_SIGNING_PRIVATE_KEY` (chemin ou contenu de la clé privée de l'updater)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` si la clé a un mot de passe
- Cibles Rust : `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

## 2. Numéro de version

SemVer : correctif `0.1.1 → 0.1.2`, fonctionnalité `0.1.x → 0.2.0`. Le même numéro dans les trois fichiers :

- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `"version"`

Puis `cd src-tauri && cargo check` pour mettre à jour `Cargo.lock`.

Si la version contient une migration : vérifier qu'elle a été essayée sur une copie d'une vraie base (skill `tracink-migration`). L'app copie la base avant migration, mais ce n'est pas une excuse.

## 3. Build

```bash
pnpm dist:mac
```

Fichiers produits dans `src-tauri/target/universal-apple-darwin/release/bundle/` :

- `dmg/Tracink_<version>_universal.dmg` : installation initiale
- `macos/Tracink.app.tar.gz` et `macos/Tracink.app.tar.gz.sig` : mise à jour automatique

Sans `.sig`, la clé de signature n'a pas été trouvée : ne pas publier.

## 4. latest.json

```json
{
  "version": "<version>",
  "notes": "<résumé en français pour la tatoueuse>",
  "pub_date": "<date ISO 8601 UTC, ex. 2026-10-14T13:00:00Z>",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contenu exact du fichier .sig>",
      "url": "https://github.com/ValentinGiraud-dev/tattoo-manager/releases/download/v<version>/Tracink.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "<même contenu>",
      "url": "<même URL>"
    }
  }
}
```

Le build est universel : les deux plateformes pointent sur la même archive.

## 5. Publier

1. Commit `Release v<version>`, tag `v<version>`, push du commit et du tag (seulement si l'utilisateur l'a demandé).
2. Release GitHub `v<version>` avec : le `.dmg`, `Tracink.app.tar.gz`, `Tracink.app.tar.gz.sig`, `latest.json`.
3. Notes de version en français, orientées usage : ce qui change pour la tatoueuse.

## 6. Vérifier

- Ouvrir l'URL `…/releases/latest/download/latest.json` : elle renvoie la nouvelle version.
- Sur une installation de la version précédente, la bannière de mise à jour apparaît, l'installation et le redémarrage fonctionnent, les données sont intactes.

## Limite connue

`signingIdentity` vaut `"-"` (signature ad hoc). macOS affiche un avertissement Gatekeeper à la première installation. Une signature Developer ID et une notarisation demandent un compte Apple Developer.
