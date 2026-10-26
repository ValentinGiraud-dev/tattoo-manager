import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { InfoTip } from "../../components/info-tip";
import { btnGhost, btnPrimary, cardClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatBytes, formatRelative, formatTimestamp } from "../../lib/format";
import { useBackupStore, type BackupEntry } from "../../stores/backup-store";
import { errorMessage } from "../../stores/security-store";
import { RestorePanel } from "../security/restore-panel";

type Listing = { key: string; entries: BackupEntry[] | null; error: string | null };

function RecentBackups({ folder, refreshKey }: { folder: string; refreshKey: string }) {
  const list = useBackupStore((state) => state.list);
  const [listing, setListing] = useState<Listing | null>(null);
  const key = `${folder}|${refreshKey}`;

  useEffect(() => {
    let cancelled = false;
    list(folder)
      .then((entries) => {
        if (!cancelled) setListing({ key, entries, error: null });
      })
      .catch((listError: unknown) => {
        if (!cancelled) setListing({ key, entries: null, error: errorMessage(listError) });
      });
    return () => {
      cancelled = true;
    };
  }, [folder, key, list]);

  if (!listing || listing.key !== key) {
    return <p className="text-[12.5px] text-fg-muted">Chargement des sauvegardes…</p>;
  }
  if (listing.error) return <p className="text-[12.5px] text-danger">{listing.error}</p>;
  const entries = listing.entries ?? [];
  if (entries.length === 0) {
    return <p className="text-[12.5px] text-fg-muted">Aucune sauvegarde dans ce dossier.</p>;
  }
  return (
    <div>
      <p className="mb-1.5 text-[12.5px] text-fg-muted">
        {entries.length} sauvegarde{entries.length > 1 ? "s" : ""} dans le dossier
      </p>
      <ul className="flex max-h-40 flex-col overflow-auto rounded-md border border-line text-[12.5px]">
        {entries.slice(0, 10).map((entry, index) => (
          <li
            key={entry.name}
            className={`flex justify-between gap-3 px-3 py-1.5 ${index > 0 ? "border-t border-line" : ""}`}
          >
            <span className={entry.readable ? "text-fg" : "text-fg-faint"}>
              {entry.createdAt ? formatTimestamp(entry.createdAt) : entry.name}
            </span>
            <span className="text-fg-muted">
              {entry.readable ? formatBytes(entry.sizeBytes) : "incomplète"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BackupSection() {
  const { settings, running, error: loadError, load, setFolder, runNow } = useBackupStore();
  const confirm = useConfirm();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  async function chooseFolder() {
    setError(null);
    setMessage(null);
    const chosen = await open({
      directory: true,
      multiple: false,
      title: "Dossier des sauvegardes de Tracink",
    });
    if (typeof chosen !== "string") return;
    try {
      await setFolder(chosen);
      const outcome = await runNow();
      setMessage(
        outcome.result === "CREATED" ? "Première sauvegarde faite dans ce dossier." : null,
      );
    } catch (chooseError) {
      setError(errorMessage(chooseError));
    }
  }

  async function stop() {
    const ok = await confirm({
      title: "Arrêter les sauvegardes externes ?",
      body: "Tracink ne copiera plus ses données dans ce dossier. Les sauvegardes déjà faites y restent.",
      warning:
        "Sans sauvegarde externe, une panne ou la perte du Mac fait perdre toutes les données.",
      confirmLabel: "Arrêter les sauvegardes",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await setFolder(null);
      setMessage(null);
    } catch (stopError) {
      setError(errorMessage(stopError));
    }
  }

  async function backupNow() {
    setError(null);
    setMessage(null);
    try {
      await runNow();
      setMessage("Sauvegarde faite.");
    } catch (runError) {
      setError(errorMessage(runError));
    }
  }

  if (!settings) {
    return (
      <section className={`${cardClass} p-4`}>
        <h2 className="text-[14px] font-medium">Sauvegardes</h2>
        <p className={`mt-2 text-[13px] ${loadError ? "text-danger" : "text-fg-muted"}`}>
          {loadError ?? "Chargement…"}
        </p>
      </section>
    );
  }

  return (
    <section className={`${cardClass} flex flex-col gap-4 p-4`}>
      <div className="flex items-center gap-1">
        <h2 className="text-[14px] font-medium">Sauvegardes</h2>
        <InfoTip label="Sauvegardes">
          Une copie chiffrée complète (base, documents, clés) est faite chaque jour et à la
          fermeture de l’app quand quelque chose a changé. Les 30 plus récentes sont gardées.
          Choisissez un dossier hors de ce Mac : iCloud Drive, disque externe…
        </InfoTip>
      </div>

      {settings.folder ? (
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] text-fg-faint">Dossier</span>
          <span className="font-mono text-[12.5px] break-all text-fg">{settings.folder}</span>
        </div>
      ) : (
        <p
          role="note"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg"
        >
          <span aria-hidden="true">⚠︎ </span>
          Aucun dossier de sauvegarde. Si ce Mac tombe en panne, les données sont perdues.
        </p>
      )}

      {settings.folder && (
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-fg-faint">Dernière sauvegarde</dt>
          <dd className="text-fg">
            {settings.lastBackupAt
              ? `${formatTimestamp(settings.lastBackupAt)} (${formatRelative(settings.lastBackupAt)})`
              : "Pas encore"}
          </dd>
          {settings.lastCheckAt && settings.lastCheckAt !== settings.lastBackupAt && (
            <>
              <dt className="text-fg-faint">Vérifiée à jour</dt>
              <dd className="text-fg">{formatRelative(settings.lastCheckAt)}</dd>
            </>
          )}
        </dl>
      )}

      {settings.lastError && (
        <p role="alert" className="text-[13px] text-danger">
          Dernier essai échoué : {settings.lastError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-[13px] text-success">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {settings.folder && (
          <button
            type="button"
            onClick={() => void backupNow()}
            disabled={running}
            className={btnPrimary}
          >
            {running ? "Sauvegarde…" : "Sauvegarder maintenant"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void chooseFolder()}
          disabled={running}
          className={settings.folder ? btnGhost : btnPrimary}
        >
          {settings.folder ? "Changer de dossier…" : "Choisir un dossier…"}
        </button>
        {settings.folder && (
          <button type="button" onClick={() => void stop()} disabled={running} className={btnGhost}>
            Arrêter
          </button>
        )}
      </div>

      {settings.folder && (
        <RecentBackups folder={settings.folder} refreshKey={settings.lastBackupAt ?? ""} />
      )}

      <hr className="border-line" />
      {restoring ? (
        <RestorePanel
          initialFolder={settings.folder}
          replacesData
          onRestored={() => window.location.reload()}
          onCancel={() => setRestoring(false)}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-fg-muted">
            Restaurer remplace toutes les données par celles d’une sauvegarde. Les données actuelles
            sont mises de côté, pas effacées.
          </p>
          <div>
            <button type="button" onClick={() => setRestoring(true)} className={btnGhost}>
              Restaurer une sauvegarde…
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
