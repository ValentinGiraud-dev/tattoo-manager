import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { btnGhost, btnPrimary } from "../../components/styles";
import { formatDuration, SESSION_STATUS_LABELS } from "../../lib/labels";
import { useSessionsStore, type SessionListItem } from "../../stores/sessions-store";
import { useUIStore } from "../../stores/ui-store";

/** Hauteur d'une heure dans la grille, en pixels. */
const HOUR_PX = 56;
const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR = 21;
/** Durée affichée quand la séance n'en a pas. */
const FALLBACK_MINUTES = 60;

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const dayFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const rangeFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const BLOCK_TONE: Record<SessionListItem["status"], string> = {
  PLANNED: "border-info/50 bg-info/15 text-fg",
  COMPLETED: "border-success/50 bg-success/15 text-fg",
  RESCHEDULED: "border-warning/50 bg-warning/10 text-fg-muted",
  CANCELLED: "border-line-strong bg-surface-2 text-fg-muted line-through",
  NO_SHOW: "border-danger/50 bg-danger/10 text-fg-muted line-through",
};

type Placed = { session: SessionListItem; start: number; end: number; lane: number; lanes: number };

/** Répartit en colonnes les séances qui se chevauchent dans une journée. */
function placeDay(sessions: SessionListItem[]): Placed[] {
  const items = sessions
    .filter((session) => session.startTime)
    .map((session) => {
      const start = minutesOf(session.startTime as string);
      return { session, start, end: start + (session.durationMinutes ?? FALLBACK_MINUTES) };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((item) => item.lane + 1));
    for (const item of group) item.lanes = lanes;
    placed.push(...group);
    group = [];
  };
  for (const item of items) {
    if (group.length > 0 && item.start >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    const used = new Set(group.filter((other) => other.end > item.start).map((o) => o.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    group.push({ ...item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length > 0) flush();
  return placed;
}

export default function PlanningPage() {
  const between = useSessionsStore((state) => state.between);
  const { openSession, newSession } = useUIStore();
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(monday, index)),
    [monday],
  );
  const from = iso(days[0]);
  const to = iso(days[6]);
  const today = iso(new Date());

  useEffect(() => {
    let cancelled = false;
    between(from, to)
      .then((loaded) => {
        if (!cancelled) {
          setSessions(loaded);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [between, from, to]);

  const byDay = useMemo(() => {
    const map = new Map<string, SessionListItem[]>();
    for (const session of sessions ?? []) {
      map.set(session.date, [...(map.get(session.date) ?? []), session]);
    }
    return map;
  }, [sessions]);

  // La grille s'élargit si une séance déborde des horaires habituels.
  const [firstHour, lastHour] = useMemo(() => {
    let first = DEFAULT_FIRST_HOUR;
    let last = DEFAULT_LAST_HOUR;
    for (const session of sessions ?? []) {
      if (!session.startTime) continue;
      const start = minutesOf(session.startTime);
      const end = start + (session.durationMinutes ?? FALLBACK_MINUTES);
      first = Math.min(first, Math.floor(start / 60));
      last = Math.max(last, Math.min(24, Math.ceil(end / 60)));
    }
    return [first, last];
  }, [sessions]);
  const hours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index);
  const gridHeight = (lastHour - firstHour) * HOUR_PX;

  const active = (sessions ?? []).filter(
    (session) => session.status === "PLANNED" || session.status === "COMPLETED",
  );
  const plannedMinutes = active.reduce(
    (sum, session) => sum + (session.startTime ? (session.durationMinutes ?? 0) : 0),
    0,
  );

  function onSlotClick(event: MouseEvent<HTMLDivElement>, date: string) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = firstHour * 60 + ((event.clientY - rect.top) / HOUR_PX) * 60;
    const rounded = Math.min(23 * 60 + 30, Math.max(0, Math.floor(minutes / 30) * 30));
    newSession({ date, startTime: timeOf(rounded) });
  }

  const label = `Semaine du ${dayFormat.format(days[0])} au ${rangeFormat.format(days[6])}`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-medium tracking-tight">Planning</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {label}
            {sessions !== null &&
              ` · ${active.length} séance${active.length > 1 ? "s" : ""}${plannedMinutes > 0 ? ` · ${formatDuration(plannedMinutes)} prévues` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Semaine précédente"
            onClick={() => setMonday((current) => addDays(current, -7))}
            className={btnGhost}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setMonday(mondayOf(new Date()))}
            className={btnGhost}
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            aria-label="Semaine suivante"
            onClick={() => setMonday((current) => addDays(current, 7))}
            className={btnGhost}
          >
            ›
          </button>
          <button
            type="button"
            onClick={() =>
              newSession({ date: today >= from && today <= to ? today : from, startTime: null })
            }
            className={btnPrimary}
          >
            Nouvelle séance
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
        <div className="grid min-w-[760px] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          {/* En-têtes des jours */}
          <div className="sticky top-0 z-20 border-b border-line bg-surface" />
          {days.map((day, index) => {
            const date = iso(day);
            const isToday = date === today;
            return (
              <div
                key={date}
                className="sticky top-0 z-20 flex items-center justify-between gap-1 border-b border-l border-line bg-surface px-2 py-2"
              >
                <span className={isToday ? "text-fg" : "text-fg-muted"}>
                  <span className="text-[12px] font-medium uppercase">{WEEKDAYS[index]}</span>{" "}
                  <span
                    className={
                      isToday
                        ? "rounded-pill bg-accent px-1.5 py-0.5 text-[12px] font-medium text-accent-fg"
                        : "text-[12px]"
                    }
                  >
                    {dayFormat.format(day)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Nouvelle séance le ${rangeFormat.format(day)}`}
                  onClick={() => newSession({ date, startTime: null })}
                  className="grid size-6 place-items-center rounded-sm text-fg-faint hover:bg-surface-3 hover:text-fg"
                >
                  +
                </button>
              </div>
            );
          })}

          {/* Séances sans heure */}
          <div className="border-b border-line px-1 py-1.5 text-right text-[10.5px] leading-tight text-fg-faint">
            Sans heure
          </div>
          {days.map((day) => {
            const untimed = (byDay.get(iso(day)) ?? []).filter((session) => !session.startTime);
            return (
              <div
                key={`untimed-${iso(day)}`}
                className="flex min-h-9 flex-col gap-1 border-b border-l border-line p-1"
              >
                {untimed.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => openSession(session.id)}
                    title={SESSION_STATUS_LABELS[session.status]}
                    className={`truncate rounded-sm border px-1.5 py-0.5 text-left text-[11.5px] ${BLOCK_TONE[session.status]}`}
                  >
                    {session.clientFirstName} {session.clientLastName}
                  </button>
                ))}
              </div>
            );
          })}

          {/* Heures */}
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-fg-faint"
                style={{ top: (hour - firstHour) * HOUR_PX }}
              >
                {hour > firstHour ? `${String(hour).padStart(2, "0")}:00` : ""}
              </span>
            ))}
          </div>

          {days.map((day) => {
            const date = iso(day);
            const placed = placeDay(byDay.get(date) ?? []);
            return (
              <div
                key={`grid-${date}`}
                role="presentation"
                onClick={(event) => onSlotClick(event, date)}
                className={`relative cursor-copy border-l border-line ${date === today ? "bg-surface-2/60" : ""}`}
                style={{
                  height: gridHeight,
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, var(--line) 0, var(--line) 1px, transparent 1px, transparent " +
                    `${HOUR_PX}px)`,
                }}
              >
                {placed.map(({ session, start, end, lane, lanes }) => {
                  const top = ((start - firstHour * 60) / 60) * HOUR_PX;
                  const height = Math.max(22, ((end - start) / 60) * HOUR_PX - 2);
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => openSession(session.id)}
                      aria-label={`${session.startTime} ${session.clientFirstName} ${session.clientLastName}, ${SESSION_STATUS_LABELS[session.status]}`}
                      className={`absolute flex flex-col items-start justify-start overflow-hidden rounded-sm border px-1.5 py-1 text-left text-[11.5px] leading-snug transition-[filter] hover:brightness-110 ${BLOCK_TONE[session.status]}`}
                      style={{
                        top,
                        height,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                      }}
                    >
                      <span className="block font-medium">
                        {session.startTime}
                        {session.durationMinutes ? `–${timeOf(end)}` : ""}
                      </span>
                      <span className="block w-full truncate">
                        {session.clientFirstName} {session.clientLastName}
                      </span>
                      {height > 50 &&
                        (session.title || session.projectTitle || session.bodyArea) && (
                          <span className="block w-full truncate text-fg-muted">
                            {session.title ?? session.projectTitle ?? session.bodyArea}
                          </span>
                        )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[12px] text-fg-faint">
        Clique sur un créneau libre pour créer une séance à cette heure.
      </p>
    </div>
  );
}
