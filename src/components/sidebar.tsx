import { useEffect } from "react";
import { formatRelative, isOlderThan } from "../lib/format";
import { useBackupStore } from "../stores/backup-store";
import { useSecurityStore } from "../stores/security-store";
import { useUIStore, type AppPage } from "../stores/ui-store";
import { useGuardedLeave } from "./unsaved-changes";

const STALE_BACKUP_MS = 3 * 24 * 3600 * 1000;

/** État des sauvegardes externes, en bas de la barre latérale. Ouvre les Paramètres. */
function BackupStatus({ onOpen }: { onOpen: () => void }) {
  const { settings, running, load } = useBackupStore();
  useEffect(() => {
    void load();
  }, [load]);
  if (!settings) return null;

  const last = settings.lastBackupAt ?? settings.lastCheckAt;
  const stale = isOlderThan(settings.lastCheckAt, STALE_BACKUP_MS);
  let text: string;
  let tone: "muted" | "warning" | "danger" = "muted";
  if (running) {
    text = "Sauvegarde en cours…";
  } else if (!settings.folder) {
    text = "Aucune sauvegarde externe";
    tone = "warning";
  } else if (settings.lastError) {
    text = "Dernière sauvegarde échouée";
    tone = "danger";
  } else if (last) {
    text = `Sauvegardé ${formatRelative(last)}`;
    tone = stale ? "warning" : "muted";
  } else {
    text = "Pas encore de sauvegarde";
    tone = "warning";
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-2",
        tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-fg-faint",
      ].join(" ")}
    >
      {tone !== "muted" && <span aria-hidden="true">⚠︎ </span>}
      {text}
    </button>
  );
}

const NAV: { id: AppPage; label: string }[] = [
  { id: "dashboard", label: "Accueil" },
  // Planning masqué pour l'instant. L'écran reste dans `features/planning` et `App.tsx`.
  { id: "clients", label: "Clients" },
  { id: "sessions", label: "Séances" },
  { id: "products", label: "Produits" },
  { id: "reports", label: "Rapports" },
  // Le journal s'ouvre depuis Paramètres.
  { id: "settings", label: "Paramètres" },
];

export function Sidebar() {
  const { page, setPage } = useUIStore();
  const guardedLeave = useGuardedLeave();
  const lock = useSecurityStore((state) => state.lock);

  return (
    <aside className="flex w-[210px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-4 py-4">
        <p className="text-[13px] font-medium tracking-tight text-fg">Tracink</p>
        <p className="mt-0.5 text-[11px] text-fg-faint">Atelier</p>
      </div>
      <nav className="flex flex-col gap-0.5 p-3" aria-label="Navigation principale">
        <span className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-fg-faint uppercase">
          Menu
        </span>
        {NAV.map((item) => {
          const active = page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                // Même écran : retour à sa liste (utile depuis une fiche).
                void guardedLeave(() => setPage(item.id));
              }}
              aria-current={active ? "page" : undefined}
              className={[
                "rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors",
                active
                  ? "bg-surface-3 font-medium text-fg"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              ].join(" ")}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-1 border-t border-line p-3">
        <BackupStatus
          onOpen={() => {
            if (page !== "settings") void guardedLeave(() => setPage("settings"));
          }}
        />
        <button
          type="button"
          onClick={() => void lock()}
          title="Verrouiller (⌘L)"
          className="flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          Verrouiller
          <kbd className="font-sans text-[11px] text-fg-faint">⌘L</kbd>
        </button>
      </div>
    </aside>
  );
}
