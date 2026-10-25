import { SESSION_STATUS_LABELS } from "../../lib/labels";
import type { Readiness, SessionStatus } from "../../stores/sessions-store";

const STATUS_BADGE: Record<SessionStatus, string> = {
  PLANNED: "bg-info/15 text-info",
  COMPLETED: "bg-success/15 text-success",
  CANCELLED: "bg-fg-faint/15 text-fg-muted",
  RESCHEDULED: "bg-warning/15 text-warning",
  NO_SHOW: "bg-danger/15 text-danger",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-[12px] font-medium ${STATUS_BADGE[status]}`}
    >
      <i className="size-1.5 rounded-full bg-current" aria-hidden />
      {SESSION_STATUS_LABELS[status]}
    </span>
  );
}

const DOCUMENT_BADGE: Record<Readiness, { label: string; className: string }> = {
  FEASIBLE: { label: "Validé", className: "bg-success/15 text-success" },
  IMPOSSIBLE: { label: "Pas possible", className: "bg-danger/15 text-danger" },
  POSTPONED: { label: "Décaler", className: "bg-warning/15 text-warning" },
};

const DOCUMENT_TO_FILL = { label: "À remplir", className: "bg-fg-faint/15 text-fg-muted" };

/** Décision sur les documents : à remplir tant qu'elle n'est pas validée. */
export function DocumentStatus({
  readiness,
  validatedAt,
}: {
  readiness: Readiness | null;
  validatedAt: string | null;
}) {
  const badge = validatedAt && readiness ? DOCUMENT_BADGE[readiness] : DOCUMENT_TO_FILL;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-[12px] font-medium ${badge.className}`}
    >
      <i className="size-1.5 rounded-full bg-current" aria-hidden />
      {badge.label}
    </span>
  );
}
