import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { btnGhost, btnPrimary } from "../../components/styles";
import { PROJECT_STATUS_LABELS, type Project } from "../../stores/projects-store";

/**
 * Choix d'un projet pour une séance. Le titre déjà saisi n'est pas modifié ici :
 * le formulaire décide s'il propose « {projet} séance N ».
 */
export function SessionProjectDialog({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onClose,
}: {
  projects: Project[];
  selectedId: string;
  onSelect: (project: Project) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const visible = projects.filter((project) => !project.archivedAt || project.id === selectedId);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>("button:not([disabled])");
    first?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 motion-safe:animate-[confirm-fade_var(--t-fast)_var(--ease-out)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        className="flex max-h-[min(32rem,calc(100vh-3rem))] w-full max-w-lg flex-col rounded-lg border border-line-strong bg-surface p-5 shadow-2xl motion-safe:animate-[confirm-pop_var(--t-base)_var(--ease-out)]"
      >
        <h2 id={titleId} className="text-[16px] font-medium tracking-tight text-fg">
          Lier à un projet
        </h2>
        <p id={descriptionId} className="mt-2 text-[13.5px] text-fg-muted">
          Le projet regroupe les séances d'une même pièce. S'il n'y a pas encore de titre, il est
          proposé à partir du projet.
        </p>

        {visible.length === 0 ? (
          <p className="mt-4 text-[13.5px] text-fg-muted">Aucun projet pour ce client.</p>
        ) : (
          <ul className="mt-4 flex min-h-0 flex-col gap-1 overflow-y-auto">
            {visible.map((project) => {
              const chosen = project.id === selectedId;
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    aria-label={project.title}
                    aria-pressed={chosen}
                    onClick={() => onSelect(project)}
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-3 py-2 text-left text-[14px] hover:bg-surface-2"
                  >
                    <span className="min-w-0 truncate">
                      {project.title}
                      {project.archivedAt ? " (archivé)" : ""}
                    </span>
                    <span className="shrink-0 text-[12.5px] text-fg-muted">
                      {chosen
                        ? "Choisi"
                        : project.status !== "ACTIVE"
                          ? PROJECT_STATUS_LABELS[project.status]
                          : project.sessionCount === 0
                            ? "Aucune séance"
                            : `${project.sessionCount} séance${project.sessionCount > 1 ? "s" : ""}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>
            Annuler
          </button>
          <button type="button" onClick={onCreate} className={btnPrimary}>
            Nouveau projet
          </button>
        </div>
      </div>
    </div>
  );
}
