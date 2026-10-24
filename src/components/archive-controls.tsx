/** Bascule Actifs / Archivés et mentions « archivé » partagées par les listes. */

export function ArchiveFilter({
  archived,
  onChange,
}: {
  archived: boolean;
  onChange: (archived: boolean) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Afficher les fiches actives ou archivées">
      <FilterButton pressed={!archived} onClick={() => onChange(false)}>
        Actifs
      </FilterButton>
      <FilterButton pressed={archived} onClick={() => onChange(true)}>
        Archivés
      </FilterButton>
    </div>
  );
}

function FilterButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        pressed
          ? "rounded-md bg-surface-3 px-3 py-1.5 text-[13px] font-medium text-fg"
          : "rounded-md px-3 py-1.5 text-[13px] text-fg-muted hover:text-fg"
      }
    >
      {children}
    </button>
  );
}

export function ArchiveBanner({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-[13.5px] text-fg"
    >
      {children}
    </p>
  );
}

/** Mention courte à côté d'un nom : « client archivé », « fiche archivée ». */
export function ArchiveMention({ children }: { children: string }) {
  return (
    <span className="ml-1.5 inline-block rounded border border-line px-1.5 py-0.5 align-middle text-[11px] font-normal text-fg-muted">
      {children}
    </span>
  );
}
