import { useEffect, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatBytes, formatTimestamp } from "../../lib/format";
import { useBackupStore, type BackupEntry, type RestoreOutcome } from "../../stores/backup-store";
import { errorMessage } from "../../stores/security-store";
import { NewPasswordFields } from "./password-fields";
import { EMPTY_PASSWORD, newPasswordProblem } from "./password-rules";

const BACKUP_DIR = "Tracink-sauvegardes";

type Listing = { folder: string; entries: BackupEntry[] | null; error: string | null };

function entryLabel(entry: BackupEntry): string {
  return entry.createdAt ? formatTimestamp(entry.createdAt) : entry.name;
}

/** Le dossier choisi peut être `Tracink-sauvegardes` lui-même ou son dossier parent. */
function parentFolder(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed.endsWith(`/${BACKUP_DIR}`) ? trimmed.slice(0, -BACKUP_DIR.length - 1) : trimmed;
}

/**
 * Choix d'une sauvegarde et restauration. Utilisé sur un nouveau Mac (écran de
 * création) et dans Paramètres. Confirmation renforcée : toutes les données sont remplacées.
 */
export function RestorePanel({
  initialFolder,
  replacesData,
  onRestored,
  onCancel,
}: {
  initialFolder: string | null;
  /** Vrai si des données existent déjà sur ce Mac (elles seront mises de côté). */
  replacesData: boolean;
  onRestored: (outcome: RestoreOutcome) => void;
  onCancel?: () => void;
}) {
  const { list, restore } = useBackupStore();
  const confirm = useConfirm();
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState(EMPTY_PASSWORD);
  const [showErrors, setShowErrors] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    list(folder)
      .then((entries) => {
        if (cancelled) return;
        setListing({ folder, entries, error: null });
        setSelected(entries.find((entry) => entry.readable)?.name ?? null);
      })
      .catch((listError: unknown) => {
        if (!cancelled) setListing({ folder, entries: null, error: errorMessage(listError) });
      });
    return () => {
      cancelled = true;
    };
  }, [folder, list]);

  const loading = folder !== null && listing?.folder !== folder;
  const entries = listing?.folder === folder ? listing.entries : null;
  const selectedEntry = entries?.find((entry) => entry.name === selected) ?? null;

  async function chooseFolder() {
    const chosen = await open({
      directory: true,
      multiple: false,
      title: "Dossier qui contient « Tracink-sauvegardes »",
    });
    if (typeof chosen === "string") {
      setFolder(parentFolder(chosen));
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (!folder || !selectedEntry) return;
    if (mode === "password" && password === "") {
      setError("Saisissez le mot de passe de la sauvegarde.");
      return;
    }
    if (mode === "recovery") {
      const problem =
        recoveryKey.trim() === ""
          ? "Saisissez la clé de secours."
          : newPasswordProblem(newPassword);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError(null);

    const ok = await confirm({
      title: replacesData
        ? "Remplacer toutes les données par cette sauvegarde ?"
        : "Restaurer cette sauvegarde ?",
      details: [
        `Sauvegarde du ${entryLabel(selectedEntry)}`,
        `${selectedEntry.documents} document${selectedEntry.documents > 1 ? "s" : ""} · ${formatBytes(selectedEntry.sizeBytes)}`,
      ],
      body: replacesData
        ? "Clients, séances, stock, documents et mot de passe reviennent à leur état de cette date. Ce qui a été saisi depuis n’apparaîtra plus."
        : "Les données de la sauvegarde sont copiées sur ce Mac.",
      warning: replacesData
        ? "Les données actuelles ne sont pas effacées : elles sont mises de côté dans un dossier « avant-restauration » des données de Tracink."
        : undefined,
      confirmLabel: "Restaurer la sauvegarde",
      tone: "danger",
      typeToConfirm: replacesData ? "RESTAURER" : undefined,
    });
    if (!ok) return;

    setRestoring(true);
    try {
      const outcome = await restore({
        folder,
        name: selectedEntry.name,
        ...(mode === "password"
          ? { password }
          : { recoveryKey, newPassword: newPassword.password }),
      });
      onRestored(outcome);
    } catch (restoreError) {
      setError(errorMessage(restoreError));
      setRestoring(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div>
        <h2 className="text-[16px] font-medium tracking-tight">Restaurer une sauvegarde</h2>
        <p className="mt-1 text-[13px] text-fg-muted">
          Choisissez le dossier où Tracink enregistre ses sauvegardes (iCloud Drive, disque
          externe…). Il contient un dossier « {BACKUP_DIR} ».
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void chooseFolder()} className={btnGhost}>
          {folder ? "Changer de dossier…" : "Choisir le dossier…"}
        </button>
        {folder && <span className="font-mono text-[12px] break-all text-fg-muted">{folder}</span>}
      </div>

      {folder &&
        (loading ? (
          <p className="text-[13px] text-fg-muted">Recherche des sauvegardes…</p>
        ) : listing?.error ? (
          <p className="text-[13px] text-danger">{listing.error}</p>
        ) : !entries || entries.length === 0 ? (
          <p className="rounded-md border border-line bg-surface-2 px-3 py-3 text-[13px] text-fg-muted">
            Aucune sauvegarde Tracink dans ce dossier.
          </p>
        ) : (
          <fieldset className="flex max-h-56 flex-col gap-1.5 overflow-auto">
            <legend className={`${labelClass} mb-1.5`}>Sauvegarde</legend>
            {entries.map((entry) => (
              <label
                key={entry.name}
                className={[
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-[13px]",
                  !entry.readable
                    ? "cursor-not-allowed border-line text-fg-faint"
                    : selected === entry.name
                      ? "cursor-pointer border-accent bg-surface-2 text-fg"
                      : "cursor-pointer border-line text-fg hover:bg-surface-2",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="backup"
                  value={entry.name}
                  disabled={!entry.readable}
                  checked={selected === entry.name}
                  onChange={() => setSelected(entry.name)}
                  className="accent-[var(--accent)]"
                />
                <span className="flex-1">{entryLabel(entry)}</span>
                <span className="text-[12px] text-fg-muted">
                  {entry.readable
                    ? `${entry.documents} doc. · ${formatBytes(entry.sizeBytes)}${entry.appVersion ? ` · v${entry.appVersion}` : ""}`
                    : "incomplète"}
                </span>
              </label>
            ))}
          </fieldset>
        ))}

      {selectedEntry && (
        <>
          {mode === "password" ? (
            <label className={labelClass}>
              Mot de passe de la sauvegarde
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={fieldClass}
              />
              <span className="mt-1 block text-[12px] font-normal text-fg-faint">
                Celui qui était en vigueur à la date de la sauvegarde.
              </span>
            </label>
          ) : (
            <>
              <label className={labelClass}>
                Clé de secours
                <input
                  value={recoveryKey}
                  onChange={(event) => setRecoveryKey(event.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${fieldClass} font-mono uppercase`}
                />
              </label>
              <NewPasswordFields
                value={newPassword}
                onChange={setNewPassword}
                showErrors={showErrors}
              />
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "password" ? "recovery" : "password");
              setError(null);
            }}
            className="self-start text-[12.5px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            {mode === "password"
              ? "Utiliser la clé de secours à la place"
              : "Utiliser le mot de passe à la place"}
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={!selectedEntry || restoring} className={btnPrimary}>
          {restoring ? "Restauration… (ne fermez pas l’app)" : "Restaurer…"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={restoring} className={btnGhost}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}
