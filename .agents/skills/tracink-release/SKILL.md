---
name: tracink-release
description: Publier une nouvelle version de Tracink pour macOS (numéro de version, build universel signé, release GitHub et latest.json pour la mise à jour automatique). À utiliser quand on demande de sortir, publier ou packager une version.
---

# Publier une version de Tracink

L'app se met à jour seule via `tauri-plugin-updater`, qui lit
`https://github.com/ValentinGiraud-dev/tattoo-manager/releases/latest/download/latest.json`.
Une release mal formée bloque les mises à jour chez la tatoueuse.

La commande fait le travail. Elle ne commit ni ne pousse rien.

```bash
pnpm run release            # 0.4.0 → 0.4.1
pnpm run release minor      # 0.4.0 → 0.5.0
pnpm run release major      # 0.4.0 → 1.0.0
pnpm run release 1.2.0
```

Options : `--skip-check`, `--allow-dirty`, `--draft`, `--publish-only` (republie les fichiers déjà construits de la version actuelle, sans rebuild). macOS seulement. Script : `scripts/release.mjs`.

## Déroulement

1. Clé publique déjà dans `src-tauri/tauri.conf.json`. Clé privée : `TAURI_SIGNING_PRIVATE_KEY` (contenu ou chemin), sinon `~/.tauri/tracink.key`. Mot de passe : `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, sinon `~/.tauri/tracink-password.txt` pour cette clé, sinon le Trousseau (`com.tracink.updater`, compte `tracink`), sinon une saisie masquée. `gh` connecté. Le dépôt est celui de l'endpoint updater.
2. Arbre git propre, sauf `--allow-dirty`. `--publish-only` saute aussi cette vérification.
3. Sauf `--skip-check` (et jamais pour `--publish-only`) : `pnpm check`, puis dans `src-tauri` `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` et `cargo test`. Pas de Playwright : la CI le fait, et le build universel est long.
4. Même numéro dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`, puis `cargo check` pour `Cargo.lock`. Si le build échoue, ces quatre fichiers reviennent à l'ancienne version.
5. Éjection d'un DMG Tracink encore monté, puis `pnpm dist:mac`. Cibles Rust : `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.
6. `latest.json` : `darwin-aarch64` et `darwin-x86_64` pointent vers la même archive. Les notes sont les sujets des commits depuis le dernier tag `v*`.
7. `gh release create v<version>` avec le `.dmg`, `Tracink.app.tar.gz`, son `.sig` et `latest.json`. Un brouillon du même tag est remplacé. Une release déjà publiée arrête la commande.

Fichiers produits dans `src-tauri/target/universal-apple-darwin/release/bundle/` :

- `dmg/Tracink_<version>_universal.dmg` : installation initiale
- `macos/Tracink.app.tar.gz` et `macos/Tracink.app.tar.gz.sig` : mise à jour automatique
- `release/` : copies prêtes à republier avec `--publish-only`

Sans `.sig`, la clé de signature n'a pas été trouvée : la commande ne publie pas.

## latest.json

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

Le build est universel : les deux plateformes pointent sur la même archive. Le nom du fichier sur GitHub reste `Tracink.app.tar.gz`.

## Après la commande

Elle affiche la commande à lancer, seulement si l'utilisateur l'a demandé :

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "Release v<version>" && git tag v<version> && git push --follow-tags
```

Le tag GitHub existe déjà : il pointe le commit depuis lequel la commande a tourné. Si `git push --follow-tags` refuse le tag, les fichiers de la release sont déjà en ligne. Ne pas forcer le tag sans demande explicite.

Si la version contient une migration : vérifier qu'elle a été essayée sur une copie d'une vraie base (skill `tracink-migration`). L'app copie la base avant migration, mais ce n'est pas une excuse.

## Vérifier

- Ouvrir l'URL `…/releases/latest/download/latest.json` : elle renvoie la nouvelle version. Un brouillon (`--draft`) n'est pas proposé tant qu'il n'est pas publié.
- Sur une installation de la version précédente, la bannière de mise à jour apparaît, l'installation et le redémarrage fonctionnent, les données sont intactes.

## Limite connue

`signingIdentity` vaut `"-"` (signature ad hoc). macOS affiche un avertissement Gatekeeper à la première installation. Une signature Developer ID et une notarisation demandent un compte Apple Developer.
