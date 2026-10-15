import { SESSION_STATUS_LABELS } from "../../lib/labels";
import type { SessionStatus } from "../../stores/sessions-store";

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
