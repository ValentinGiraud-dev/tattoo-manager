import type { ReactNode } from "react";
import type { LotSummary } from "../../stores/products-store";
import { stockLabel } from "./lot-labels";

const rowClass =
  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2";

function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warning" }) {
  return (
    <span
      className={[
        "rounded-pill px-2 py-0.5 text-[11px]",
        tone === "warning" ? "bg-warning/15 text-warning" : "bg-surface-3 text-fg-muted",
      ].join(" ")}
    >
      {tone === "warning" && <span aria-hidden="true">⚠︎ </span>}
      {children}
    </span>
  );
}

export function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9.2 2.6 13.4 6.8 5.2 15H1v-4.2L9.2 2.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 3.8 12.2 8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 4.2h9.6M6.2 4.1V2.8h3.6v1.3M4.4 4.2l.6 9h6l.6-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LotSummaryText({
  lot,
  title,
  children,
  footer,
}: {
  lot: LotSummary;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="truncate text-[14px] font-medium">{title}</span>
        {lot.expired && <Badge>Périmé</Badge>}
      </span>
      <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">
        {children} · {stockLabel(lot)}
      </span>
      {footer}
    </span>
  );
}

/** Ligne d'un lot : titre, péremption, stock. */
export function LotRow({
  lot,
  title,
  onOpen,
  onRemove,
  removeLabel = "Supprimer ou archiver",
  removeDisabled = false,
  children,
  footer,
}: {
  lot: LotSummary;
  title: string;
  onOpen: () => void;
  /** Corbeille à droite de la ligne. Le crayon, dans la ligne, ouvre aussi le lot. */
  onRemove?: () => void;
  removeLabel?: string;
  removeDisabled?: boolean;
  /** Début de la ligne de détail (avant le stock). */
  children: ReactNode;
  footer?: ReactNode;
}) {
  const summary = (
    <LotSummaryText lot={lot} title={title} footer={footer}>
      {children}
    </LotSummaryText>
  );

  if (!onRemove) {
    return (
      <button type="button" onClick={onOpen} className={rowClass}>
        {summary}
      </button>
    );
  }

  return (
    <div className={rowClass}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        {summary}
        <span className="grid size-8 shrink-0 place-items-center text-fg-muted">
          <PencilIcon />
        </span>
      </button>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        disabled={removeDisabled}
        className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-45"
      >
        <TrashIcon />
      </button>
    </div>
  );
}
