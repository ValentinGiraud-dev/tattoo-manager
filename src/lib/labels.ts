import type { PaymentMethod } from "../stores/billing-store";
import type { SessionStatus } from "../stores/sessions-store";

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  PLANNED: "Planifiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  RESCHEDULED: "Reportée",
  NO_SHOW: "Absent",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  CARD: "Carte",
  TRANSFER: "Virement",
  CHECK: "Chèque",
  OTHER: "Autre",
};

/** « 14:00 – 17:00 (3 h) », « 14:00 », ou `null` sans heure. */
export function formatTimeRange(
  startTime: string | null,
  durationMinutes: number | null,
): string | null {
  if (!startTime) return null;
  if (!durationMinutes) return startTime;
  const [h, m] = startTime.split(":").map(Number);
  const end = h * 60 + m + durationMinutes;
  const endText = `${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  return `${startTime} – ${endText} (${formatDuration(durationMinutes)})`;
}

/** 90 → « 1 h 30 », 120 → « 2 h », 45 → « 45 min ». */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
