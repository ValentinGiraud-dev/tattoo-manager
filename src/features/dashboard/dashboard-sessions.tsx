import { cardClass } from "../../components/styles";
import { SESSION_STATUS_LABELS } from "../../lib/labels";
import { type DaySession } from "../../stores/dashboard-store";
import { useUIStore } from "../../stores/ui-store";
import {
  formatClock,
  sessionActionClass,
  sessionDetail,
  sessionHeading,
  statusChipClass,
  upcomingDetail,
} from "./dashboard-format";

function TodayCard({ session }: { session: DaySession }) {
  const openSession = useUIStore((state) => state.openSession);
  const detail = sessionDetail(session);
  return (
    <article className={`${cardClass} flex flex-wrap items-center gap-3 px-4 py-3`}>
      <button
        type="button"
        onClick={() => openSession(session.id)}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <span className="w-14 shrink-0 pt-0.5 text-[13px] font-medium text-fg tabular-nums">
          {formatClock(session.startTime)}
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-medium text-fg">{sessionHeading(session)}</span>
          {detail && <span className="mt-0.5 block text-[12.5px] text-fg-muted">{detail}</span>}
        </span>
      </button>
      <span className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openSession(session.id, "documents")}
          className={sessionActionClass}
        >
          Ajouter les documents
        </button>
        <button
          type="button"
          onClick={() => openSession(session.id, "usages")}
          className={sessionActionClass}
        >
          Compléter la traçabilité
        </button>
      </span>
    </article>
  );
}

function UpcomingCard({ session }: { session: DaySession }) {
  const openSession = useUIStore((state) => state.openSession);
  const detail = upcomingDetail(session);
  return (
    <button
      type="button"
      onClick={() => openSession(session.id)}
      className={`${cardClass} flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2`}
    >
      <span className="w-14 shrink-0 text-[13px] font-medium text-fg tabular-nums">
        {formatClock(session.startTime)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-fg">{sessionHeading(session)}</span>
        {detail && <span className="mt-0.5 block text-[12.5px] text-fg-muted">{detail}</span>}
      </span>
      <span className={statusChipClass}>{SESSION_STATUS_LABELS[session.status]}</span>
    </button>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <p className={`${cardClass} px-4 py-6 text-center text-[13px] text-fg-muted`}>{children}</p>
  );
}

export function TodaySessionList({ sessions }: { sessions: DaySession[] }) {
  if (sessions.length === 0) return <Empty>Aucune séance aujourd’hui.</Empty>;
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => (
        <TodayCard key={session.id} session={session} />
      ))}
    </div>
  );
}

export function UpcomingSessionList({ sessions }: { sessions: DaySession[] }) {
  if (sessions.length === 0) {
    return <Empty>Aucune séance planifiée dans les 7 prochains jours.</Empty>;
  }
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => (
        <UpcomingCard key={session.id} session={session} />
      ))}
    </div>
  );
}
