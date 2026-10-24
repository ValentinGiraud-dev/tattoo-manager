/**
 * Publie une nouvelle version de Tracink, depuis un Mac :
 *
 *   pnpm run release            0.4.0 → 0.4.1
 *   pnpm run release minor      0.4.0 → 0.5.0
 *   pnpm run release major      0.4.0 → 1.0.0
 *   pnpm run release 1.2.0
 *   options : --skip-check (sans pnpm check ni les vérifications Rust),
 *             --allow-dirty, --draft (release brouillon),
 *             --publish-only (republie les fichiers déjà construits de la version
 *             actuelle, sans rebuild : après une publication qui a échoué)
 *
 * Étapes : vérifications → même numéro dans package.json, tauri.conf.json et
 * Cargo.toml → build universel signé (pnpm dist:mac) → latest.json →
 * release GitHub. Rien n'est commité ni poussé.
 *
 * Clé privée : TAURI_SIGNING_PRIVATE_KEY (contenu ou chemin), sinon
 * ~/.tauri/tracink.key. Mot de passe : TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
 * sinon ~/.tauri/tracink-password.txt pour cette clé, sinon le Trousseau
 * (security add-generic-password -s com.tracink.updater -a tracink -w),
 * sinon une saisie masquée.
 */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CONF = join(ROOT, "src-tauri/tauri.conf.json");
const CARGO = join(ROOT, "src-tauri/Cargo.toml");
const CARGO_LOCK = join(ROOT, "src-tauri/Cargo.lock");
const PKG = join(ROOT, "package.json");
const BUNDLE = join(ROOT, "src-tauri/target/universal-apple-darwin/release/bundle");
const OUT = join(BUNDLE, "release");
const KEYCHAIN_SERVICE = "com.tracink.updater";
const DEFAULT_KEY = join(homedir(), ".tauri/tracink.key");
const DEFAULT_PASSWORD = join(homedir(), ".tauri/tracink-password.txt");
const SEMVER = /^\d+\.\d+\.\d+$/;

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const flag = (name) => args.includes(`--${name}`);
const wanted = args.find((arg) => !arg.startsWith("--")) ?? "patch";

const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};
const step = (message) => console.log(`\n→ ${message}`);

const baseEnv = {
  ...process.env,
  PATH: `${homedir()}/.cargo/bin:${process.env.PATH ?? ""}`,
};

function run(command, commandArgs, { cwd = ROOT, env = baseEnv, quiet = false } = {}) {
  return spawnSync(command, commandArgs, {
    cwd,
    env,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
  });
}

function succeed(command, commandArgs, options) {
  const result = run(command, commandArgs, { ...options, quiet: true });
  return result.status === 0 ? result.stdout : null;
}

if (flag("help")) {
  console.log(
    `pnpm run release [patch|minor|major|x.y.z] [--skip-check] [--allow-dirty] [--draft] [--publish-only]`,
  );
  process.exit(0);
}

if (process.platform !== "darwin") fail("La release se construit sur macOS.");

const conf = JSON.parse(readFileSync(CONF, "utf8"));
const endpoint = conf.plugins?.updater?.endpoints?.[0] ?? "";
const repoMatch = endpoint.match(/github\.com\/([^/]+\/[^/]+)\//);
if (!conf.plugins?.updater?.pubkey) fail("Pas de clé publique dans tauri.conf.json.");
if (!repoMatch) fail(`Endpoint updater illisible : ${endpoint || "absent"}`);
const repo = repoMatch[1];

if (succeed("gh", ["auth", "status"]) === null) fail("gh n'est pas connecté : gh auth login.");
if (succeed("gh", ["repo", "view", repo, "--json", "name"]) === null) {
  fail(`Le dépôt ${repo} est inaccessible.`);
}

const publishOnly = flag("publish-only");

function signingKey() {
  const raw = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
  if (!raw) {
    if (existsSync(DEFAULT_KEY)) return DEFAULT_KEY;
    fail(
      'TAURI_SIGNING_PRIVATE_KEY est absente. Le Trousseau ne garde que le mot de passe de la clé. Indique le fichier : export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/tracink.key"',
    );
  }
  const path = raw.startsWith("~") ? join(homedir(), raw.slice(1)) : raw;
  const looksLikePath =
    !raw.includes("\n") &&
    (raw.startsWith("/") || raw.startsWith("~") || raw.startsWith(".") || existsSync(path));
  if (looksLikePath && !existsSync(path)) fail(`Clé de signature introuvable (${path}).`);
  return looksLikePath ? path : raw;
}

function signingPassword(key) {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD !== undefined) {
    return process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  }
  if (key === DEFAULT_KEY && existsSync(DEFAULT_PASSWORD)) {
    return readFileSync(DEFAULT_PASSWORD, "utf8").replace(/\n$/, "");
  }
  const found = succeed("security", [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    "tracink",
    "-w",
  ]);
  if (found !== null) return found.replace(/\n$/, "");
  return readHidden("Mot de passe de la clé de signature : ");
}

function nextVersion(current, bump) {
  if (!SEMVER.test(current)) fail(`Version actuelle illisible : ${current}`);
  if (SEMVER.test(bump)) return bump;
  const [major, minor, patch] = current.split(".").map(Number);
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "major") return `${major + 1}.0.0`;
  fail(`Version inconnue « ${bump} ». Attendu : patch, minor, major, ou 1.2.3.`);
}

function setJsonVersion(text, version) {
  const next = text.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`);
  if (next === text) fail("Champ version introuvable.");
  return next;
}

function setCargoVersion(text, version) {
  const next = text.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
  if (next === text) fail("Version Cargo.toml introuvable.");
  return next;
}

function releaseNotes(subjects) {
  const lines = subjects
    .map((subject) => subject.trim())
    .filter((subject) => subject !== "" && !subject.startsWith("Merge "));
  if (lines.length === 0) return "Mise à jour de Tracink.";
  return lines.map((subject) => `- ${subject}`).join("\n");
}

function latestJson({ version, notes, signature, url }) {
  const platform = { signature: signature.trim(), url };
  return {
    version,
    notes,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: {
      "darwin-aarch64": platform,
      "darwin-x86_64": platform,
    },
  };
}

function ejectMountedDisks() {
  if (!existsSync("/Volumes")) return;
  for (const volume of readdirSync("/Volumes").filter((name) => /^Tracink( \d+)?$/.test(name))) {
    console.log(`  éjection de /Volumes/${volume}`);
    run("hdiutil", ["detach", `/Volumes/${volume}`, "-force"], { quiet: true });
  }
  const macosDir = join(BUNDLE, "macos");
  if (!existsSync(macosDir)) return;
  for (const file of readdirSync(macosDir).filter((name) => /^rw\..*\.dmg$/.test(name))) {
    rmSync(join(macosDir, file), { force: true });
  }
}

const pkgText = readFileSync(PKG, "utf8");
const current = JSON.parse(pkgText).version;
const version = publishOnly ? current : nextVersion(current, wanted);
const tag = `v${version}`;

const existing = succeed("gh", [
  "release",
  "view",
  tag,
  "--repo",
  repo,
  "--json",
  "isDraft",
  "-q",
  ".isDraft",
]);
if (existing !== null && existing.trim() !== "true") {
  fail(`La release ${tag} existe déjà sur ${repo}.`);
}

console.log(
  publishOnly
    ? `Tracink ${version} : republication (${repo})`
    : `Tracink ${current} → ${version} (${repo})`,
);

const archiveName = "Tracink.app.tar.gz";

if (publishOnly) {
  const latestPath = join(OUT, "latest.json");
  const built = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) : undefined;
  if (
    built?.version !== version ||
    !existsSync(join(OUT, archiveName)) ||
    !existsSync(join(OUT, "notes.md"))
  ) {
    fail(`Pas de fichiers construits pour ${version} dans ${OUT} : lance une release normale.`);
  }
} else {
  if (!flag("allow-dirty")) {
    const dirty = (succeed("git", ["status", "--porcelain"]) ?? "").trim();
    if (dirty) fail(`Des changements ne sont pas commités (ou --allow-dirty) :\n${dirty}`);
  }

  if (!flag("skip-check")) {
    step("pnpm check");
    if (run("pnpm", ["check"]).status !== 0) {
      fail("pnpm check échoue : corrige d'abord (ou --skip-check).");
    }
    step("cargo fmt, clippy, test");
    const rust = join(ROOT, "src-tauri");
    if (run("cargo", ["fmt", "--check"], { cwd: rust }).status !== 0) {
      fail("cargo fmt --check échoue.");
    }
    if (
      run("cargo", ["clippy", "--all-targets", "--", "-D", "warnings"], { cwd: rust }).status !== 0
    ) {
      fail("cargo clippy échoue.");
    }
    if (run("cargo", ["test"], { cwd: rust }).status !== 0) fail("cargo test échoue.");
  }

  const lastTag = (
    succeed("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"]) ?? ""
  ).trim();
  const logArgs = ["log", "--format=%s"];
  if (lastTag) logArgs.push(`${lastTag}..HEAD`);
  else logArgs.push("-20");
  const subjects = (succeed("git", logArgs) ?? "").split("\n");
  const notes = releaseNotes(subjects);

  const key = signingKey();
  const password = signingPassword(key);
  const cargoText = readFileSync(CARGO, "utf8");
  const confText = readFileSync(CONF, "utf8");
  const lockText = readFileSync(CARGO_LOCK, "utf8");
  const restore = () => {
    writeFileSync(PKG, pkgText);
    writeFileSync(CONF, confText);
    writeFileSync(CARGO, cargoText);
    writeFileSync(CARGO_LOCK, lockText);
  };

  const nextPkg = setJsonVersion(pkgText, version);
  const nextConf = setJsonVersion(confText, version);
  const nextCargo = setCargoVersion(cargoText, version);
  writeFileSync(PKG, nextPkg);
  writeFileSync(CONF, nextConf);
  writeFileSync(CARGO, nextCargo);
  step("cargo check (Cargo.lock)");
  if (run("cargo", ["check"], { cwd: join(ROOT, "src-tauri") }).status !== 0) {
    restore();
    fail("cargo check a échoué (version remise à l'ancienne).");
  }

  ejectMountedDisks();
  step("pnpm dist:mac");
  const build = run("pnpm", ["dist:mac"], {
    env: {
      ...baseEnv,
      TAURI_SIGNING_PRIVATE_KEY: key,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    },
  });
  if (build.status !== 0) {
    restore();
    fail(
      "pnpm dist:mac a échoué (version remise à l'ancienne). Un DMG Tracink encore ouvert dans le Finder peut en être la cause.",
    );
  }

  const archive = join(BUNDLE, "macos", archiveName);
  const signaturePath = `${archive}.sig`;
  if (!existsSync(archive) || !existsSync(signaturePath)) {
    restore();
    fail(`Archive de mise à jour ou signature introuvable (${archive}[.sig]).`);
  }
  const dmgDir = join(BUNDLE, "dmg");
  const builtDmg = existsSync(dmgDir)
    ? readdirSync(dmgDir).find((name) => name.endsWith(".dmg") && name.includes(version))
    : undefined;
  if (!builtDmg) {
    restore();
    fail(`DMG ${version} introuvable dans ${dmgDir}.`);
  }

  mkdirSync(OUT, { recursive: true });
  copyFileSync(archive, join(OUT, archiveName));
  copyFileSync(signaturePath, join(OUT, `${archiveName}.sig`));
  copyFileSync(join(dmgDir, builtDmg), join(OUT, builtDmg));
  const url = `https://github.com/${repo}/releases/download/${tag}/${archiveName}`;
  writeFileSync(
    join(OUT, "latest.json"),
    `${JSON.stringify(latestJson({ version, notes, signature: readFileSync(signaturePath, "utf8"), url }), null, 2)}\n`,
  );
  writeFileSync(join(OUT, "notes.md"), `${notes}\n`);
}

if (existing !== null) {
  step(`remplacement du brouillon ${tag}`);
  if (
    run("gh", ["release", "delete", tag, "--repo", repo, "--yes", "--cleanup-tag"]).status !== 0
  ) {
    fail(`Impossible de remplacer le brouillon ${tag}.`);
  }
}

const dmgName = readdirSync(OUT).find((name) => name.endsWith(".dmg") && name.includes(version));
if (!dmgName) fail(`DMG ${version} introuvable dans ${OUT}.`);

step(`gh release create ${tag} --repo ${repo}`);
const createArgs = [
  "release",
  "create",
  tag,
  "--repo",
  repo,
  "--title",
  `Tracink ${version}`,
  "--notes-file",
  join(OUT, "notes.md"),
];
if (flag("draft")) createArgs.push("--draft");
createArgs.push(
  join(OUT, archiveName),
  join(OUT, `${archiveName}.sig`),
  join(OUT, dmgName),
  join(OUT, "latest.json"),
);
if (run("gh", createArgs).status !== 0) {
  fail(
    `Release impossible. Les fichiers sont dans ${OUT} : corrige puis pnpm run release --publish-only (sans rebuild).`,
  );
}

console.log(`
✓ Tracink ${version} publiée${flag("draft") ? " (brouillon : publie-la sur GitHub pour qu'elle soit proposée)" : ""}.
  Les Tracink installées la proposeront au prochain lancement (ou Paramètres → Vérifier les mises à jour).

Il reste à commiter la version et la marquer :
  git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
  git commit -m "Release v${version}" && git tag ${tag} && git push --follow-tags

Le tag ${tag} est déjà sur GitHub, au commit depuis lequel cette commande a tourné. S'il existe déjà, le push du tag sera refusé : les fichiers de la release, eux, sont en ligne.
`);

/** Lit une ligne sans l'afficher (mot de passe). */
function readHidden(question) {
  process.stdout.write(question);
  run("stty", ["-echo"]);
  const fd = openSync("/dev/tty", "r");
  try {
    let line = "";
    const byte = Buffer.alloc(1);
    while (true) {
      const read = readSync(fd, byte, 0, 1, null);
      if (read === 0 || byte[0] === 10) break;
      if (byte[0] !== 13) line += byte.toString();
    }
    return line;
  } finally {
    closeSync(fd);
    run("stty", ["echo"]);
    process.stdout.write("\n");
  }
}
