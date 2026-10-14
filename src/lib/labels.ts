import type { SessionStatus } from "../stores/sessions-store";

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  PLANNED: "Planifiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  RESCHEDULED: "Reportée",
};
