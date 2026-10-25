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

/** Ligne d'un lot : titre, péremption, stock. */
export function LotRow({
  lot,
  title,
  onOpen,
  children,
  footer,
}: {
  lot: LotSummary;
  title: string;
  onOpen: () => void;
  /** Début de la ligne de détail (avant le stock). */
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <button type="button" onClick={onOpen} className={rowClass}>
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
    </button>
  );
}
