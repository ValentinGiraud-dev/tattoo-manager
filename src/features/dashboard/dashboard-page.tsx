import { useEffect } from "react";
import { btnGhost, cardClass } from "../../components/styles";
import { formatEuros } from "../../lib/money";
import { useDashboardStore, type PeriodSummary } from "../../stores/dashboard-store";
import { AlertsPanel } from "./dashboard-alerts";
import { TodaySessionList, UpcomingSessionList } from "./dashboard-sessions";

const longDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long" });

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${cardClass} flex flex-col gap-1.5 px-5 py-4`}>
      <span className="text-[13px] text-fg-muted">{label}</span>
      <span className="text-[28px] font-medium tracking-tight text-fg tabular-nums">{value}</span>
      {hint && <span className="text-[13px] text-fg-muted">{hint}</span>}
    </div>
  );
}

function MonthStats({ month, previous }: { month: PeriodSummary; previous: PeriodSummary }) {
  const name = monthName.format(localDate(month.from));
  const previousName = monthName.format(localDate(previous.from));
  const sessionsHint =
    month.completedPriceCents > 0
      ? `${formatEuros(month.completedPriceCents)} de prestations`
      : undefined;
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={`Chiffres de ${name}`}>
      <Stat
        label={`Encaissé en ${name}`}
        value={formatEuros(month.collectedCents)}
        hint={`En ${previousName} : ${formatEuros(previous.collectedCents)}`}
      />
      <Stat
        label="Séances terminées ce mois"
        value={String(month.sessionsCompleted)}
        hint={
          month.sessionsNoShow > 0
            ? [
                sessionsHint,
                `${month.sessionsNoShow} absence${month.sessionsNoShow > 1 ? "s" : ""}`,
              ]
                .filter(Boolean)
                .join(" · ")
            : sessionsHint
        }
      />
      <Stat
        label="Nouveaux clients ce mois"
        value={String(month.newClients)}
        hint={`En ${previousName} : ${previous.newClients}`}
      />
    </section>
  );
}

export default function DashboardPage() {
  const { dashboard, error, load } = useDashboardStore();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="text-[28px] font-medium tracking-tight text-fg">Dashboard</h1>
        {dashboard && (
          <p className="mt-0.5 text-[14px] text-fg-muted first-letter:uppercase">
            {longDay.format(localDate(dashboard.today))}
          </p>
        )}
      </header>

      {error && !dashboard ? (
        <div className={`${cardClass} flex flex-col items-start gap-3 p-4`}>
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
          <button type="button" onClick={() => void load()} className={btnGhost}>
            Réessayer
          </button>
        </div>
      ) : !dashboard ? (
        <p className="text-[13px] text-fg-muted">Chargement…</p>
      ) : (
        <>
          <MonthStats month={dashboard.month} previous={dashboard.previousMonth} />
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-2">
                <h2 className="text-[14px] font-medium">
                  Séances du jour
                  <span className="ml-2 text-[12.5px] font-normal text-fg-muted">
                    {dashboard.todaySessions.length}
                  </span>
                </h2>
                <TodaySessionList sessions={dashboard.todaySessions} />
              </section>
              <section className="flex flex-col gap-2">
                <h2 className="text-[14px] font-medium">7 prochains jours</h2>
                <UpcomingSessionList sessions={dashboard.upcoming} />
              </section>
            </div>
            <AlertsPanel />
          </div>
        </>
      )}
    </div>
  );
}
