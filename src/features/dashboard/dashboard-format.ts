import type { DaySession } from "../../stores/dashboard-store";

const shortDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export const sessionActionClass =
  "inline-flex shrink-0 items-center rounded-pill bg-warning/15 px-3 py-1 text-[12.5px] font-medium text-warning transition-colors hover:bg-warning/25";

export const statusChipClass =
  "inline-flex shrink-0 items-center rounded-pill bg-surface-2 px-2.5 py-0.5 text-[12px] text-fg-muted";

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function clientName(session: { clientFirstName: string; clientLastName: string }) {
  return `${session.clientFirstName} ${session.clientLastName}`;
}

/** « 14:30 » → « 14H30 ». « Sans heure » s'il n'y en a pas. */
export function formatClock(startTime: string | null): string {
  if (!startTime) return "Sans heure";
  return startTime.replace(":", "H");
}

export function sessionHeading(session: DaySession): string {
  const title = session.title?.trim();
  return title ? title : clientName(session);
}

/** Description, sinon client (s'il n'est pas déjà le titre), projet et zone. */
export function sessionDetail(session: DaySession): string {
  const description = session.description?.trim();
  if (description) return description;
  const client = session.title?.trim() ? clientName(session) : null;
  return [client, session.projectTitle, session.bodyArea].filter(Boolean).join(" · ");
}

/** Date courte devant le détail, pour les séances des 7 prochains jours. */
export function upcomingDetail(session: DaySession): string {
  return [shortDay.format(localDate(session.date)), sessionDetail(session)]
    .filter(Boolean)
    .join(" · ");
}
