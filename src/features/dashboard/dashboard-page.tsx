import { useEffect, type ReactNode } from "react";
import { btnGhost, btnPrimary, cardClass } from "../../components/styles";
import { formatIsoDate } from "../../lib/format";
import { formatTimeRange, SESSION_STATUS_LABELS } from "../../lib/labels";
import { formatEuros } from "../../lib/money";
import {
  alertCount,
  useDashboardStore,
  type DaySession,
  type ExpiringItem,
  type PeriodSummary,
} from "../../stores/dashboard-store";
import { useUIStore } from "../../stores/ui-store";

const longDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long" });

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function clientName(session: { clientFirstName: string; clientLastName: string }) {
  return `${session.clientFirstName} ${session.clientLastName}`;
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted"; children: ReactNode }) {
  const tones = {
    ok: "border-success/40 text-success",
    warn: "border-warning/40 text-warning",
    muted: "border-line-strong text-fg-muted",
  };
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-[11.5px] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function paperworkChip(label: string, saved: boolean, signed: boolean) {
  if (signed) return <Chip tone="ok">{label} signé</Chip>;
  if (saved) return <Chip tone="warn">{label} à signer</Chip>;
  return <Chip tone="warn">{label} à remplir</Chip>;
}

function SessionRow({ session, showDate = false }: { session: DaySession; showDate?: boolean }) {
  const openSession = useUIStore((state) => state.openSession);
  const time = formatTimeRange(session.startTime, session.durationMinutes);
  const active = session.status === "PLANNED" || session.status === "COMPLETED";
  const when = [showDate ? shortDay.format(localDate(session.date)) : null, time]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <button
        type="button"
        onClick={() => openSession(session.id)}
        className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] font-medium text-fg">{clientName(session)}</span>
          <span className="shrink-0 text-[12.5px] text-fg-muted tabular-nums">
            {when || "Sans heure"}
          </span>
        </span>
        <span className="text-[12.5px] text-fg-muted">
          {[session.title, session.projectTitle, session.bodyArea].filter(Boolean).join(" · ") ||
            "Pas de titre ni de zone"}
          {session.status !== "PLANNED" && ` · ${SESSION_STATUS_LABELS[session.status]}`}
        </span>
        {active && (
          <span className="flex flex-wrap gap-1.5">
            {paperworkChip("Questionnaire", session.healthSaved, session.healthSigned)}
            {paperworkChip("Consentement", session.consentSaved, session.consentSigned)}
            {session.balanceCents !== null && session.balanceCents > 0 && (
              <Chip tone="muted">Reste {formatEuros(session.balanceCents)}</Chip>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

function SessionList({
  sessions,
  empty,
  showDate,
}: {
  sessions: DaySession[];
  empty: string;
  showDate?: boolean;
}) {
  if (sessions.length === 0) {
    return (
      <p className={`${cardClass} px-4 py-6 text-center text-[13px] text-fg-muted`}>{empty}</p>
    );
  }
  return (
    <ul className={`${cardClass} divide-y divide-line overflow-hidden`}>
      {sessions.map((session) => (
        <SessionRow key={session.id} session={session} showDate={showDate} />
      ))}
    </ul>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${cardClass} flex flex-col gap-1 px-4 py-3`}>
      <span className="text-[12px] text-fg-faint">{label}</span>
      <span className="text-[22px] font-medium tracking-tight text-fg tabular-nums">{value}</span>
      {hint && <span className="text-[12px] text-fg-muted">{hint}</span>}
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

function AlertGroup({
  title,
  tone,
  hint,
  children,
}: {
  title: string;
  tone: "danger" | "warning" | "info";
  hint: string;
  children: ReactNode;
}) {
  const dot = { danger: "bg-danger", warning: "bg-warning", info: "bg-info" }[tone];
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
        {title}
      </h3>
      <p className="text-[12px] text-fg-muted">{hint}</p>
      <ul className="-mx-2 flex flex-col">{children}</ul>
    </section>
  );
}

function AlertItem({ onClick, main, side }: { onClick: () => void; main: string; side: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-baseline justify-between gap-3 rounded-sm px-2 py-1 text-left text-[13px] transition-colors hover:bg-surface-2"
      >
        <span className="min-w-0 text-fg">{main}</span>
        <span className="shrink-0 text-[12px] text-fg-muted tabular-nums">{side}</span>
      </button>
    </li>
  );
}

function productLabel(item: ExpiringItem): string {
  const piece =
    item.kind === "LOT"
      ? `${item.count} en stock`
      : item.kind === "OPENED"
        ? item.count > 1
          ? `${item.count} pièces ouvertes`
          : "pièce ouverte"
        : `${item.count} scellée${item.count > 1 ? "s" : ""}`;
  return `${item.name} · lot ${item.lotNumber} · ${piece}`;
}

function itemKey(item: ExpiringItem) {
  return `${item.lotId}-${item.kind}-${item.openedAt ?? ""}`;
}

function AlertsPanel() {
  const dashboard = useDashboardStore((state) => state.dashboard);
  const openSession = useUIStore((state) => state.openSession);
  const openLot = useUIStore((state) => state.openLot);
  const openSheet = useUIStore((state) => state.openSheet);
  const setPage = useUIStore((state) => state.setPage);
  if (!dashboard) return null;
  const { alerts } = dashboard;
  const total = alertCount(alerts);

  return (
    <aside className={`${cardClass} flex flex-col gap-5 p-4`} aria-label="À traiter">
      <h2 className="flex items-baseline justify-between text-[14px] font-medium">
        À traiter
        {total > 0 && <span className="text-[12.5px] font-normal text-fg-muted">{total}</span>}
      </h2>
      {total === 0 && (
        <p className="text-[13px] text-fg-muted">
          Tout est à jour : aucun produit périmé ou en stock bas, aucune séance à clôturer, aucun
          reste à payer.
        </p>
      )}
      {alerts.expired.length > 0 && (
        <AlertGroup
          title="Produits périmés en stock"
          tone="danger"
          hint="À sortir du stock : ils ne doivent plus servir."
        >
          {alerts.expired.map((item) => (
            <AlertItem
              key={itemKey(item)}
              onClick={() => openLot(item.lotId)}
              main={productLabel(item)}
              side={`depuis le ${formatIsoDate(item.usefulUntil)}`}
            />
          ))}
        </AlertGroup>
      )}
      {alerts.lowStock.sheets.length + alerts.lowStock.categories.length > 0 && (
        <AlertGroup
          title="Stock bas"
          tone="warning"
          hint="À racheter : stock égal ou sous le seuil d’alerte (lots non périmés)."
        >
          {alerts.lowStock.sheets.map((alert) => (
            <AlertItem
              key={alert.sheetId}
              onClick={() => openSheet(alert.sheetId)}
              main={alert.displayName}
              side={`${alert.stock} / seuil ${alert.threshold}`}
            />
          ))}
          {alerts.lowStock.categories.map((alert) => (
            <AlertItem
              key={alert.categoryId}
              onClick={() => setPage("products")}
              main={`${alert.path} (au total)`}
              side={`${alert.stock} / seuil ${alert.threshold}`}
            />
          ))}
        </AlertGroup>
      )}
      {alerts.sessionsToClose.length > 0 && (
        <AlertGroup
          title="Séances passées à clôturer"
          tone="warning"
          hint="Encore « planifiées » : indiquez si elles ont eu lieu."
        >
          {alerts.sessionsToClose.map((session) => (
            <AlertItem
              key={session.id}
              onClick={() => openSession(session.id)}
              main={clientName(session)}
              side={formatIsoDate(session.date)}
            />
          ))}
        </AlertGroup>
      )}
      {alerts.depositsToSettle.length > 0 && (
        <AlertGroup
          title="Acomptes en attente"
          tone="warning"
          hint="Séance passée, annulée ou manquée : déduire, garder ou rembourser."
        >
          {alerts.depositsToSettle.map((deposit) => (
            <AlertItem
              key={deposit.depositId}
              onClick={() => openSession(deposit.sessionId)}
              main={`${clientName(deposit)} · ${SESSION_STATUS_LABELS[deposit.sessionStatus].toLowerCase()}`}
              side={formatEuros(deposit.amountCents)}
            />
          ))}
        </AlertGroup>
      )}
      {alerts.unpaid.length > 0 && (
        <AlertGroup
          title="Restes à payer"
          tone="warning"
          hint="Séances terminées pas entièrement réglées."
        >
          {alerts.unpaid.map((session) => (
            <AlertItem
              key={session.id}
              onClick={() => openSession(session.id)}
              main={`${clientName(session)} · ${formatIsoDate(session.date)}`}
              side={formatEuros(session.balanceCents ?? 0)}
            />
          ))}
        </AlertGroup>
      )}
      {alerts.unsigned.length > 0 && (
        <AlertGroup
          title="Documents non signés"
          tone="info"
          hint="Séances terminées ces 30 derniers jours sans scan signé joint."
        >
          {alerts.unsigned.map((session) => (
            <AlertItem
              key={session.id}
              onClick={() => openSession(session.id)}
              main={clientName(session)}
              side={[
                !session.healthSigned && "questionnaire",
                !session.consentSigned && "consentement",
              ]
                .filter(Boolean)
                .join(", ")}
            />
          ))}
        </AlertGroup>
      )}
      {alerts.expiringSoon.length > 0 && (
        <AlertGroup
          title="Bientôt périmés"
          tone="info"
          hint="Limite d’utilisation dans les 30 prochains jours."
        >
          {alerts.expiringSoon.map((item) => (
            <AlertItem
              key={itemKey(item)}
              onClick={() => openLot(item.lotId)}
              main={productLabel(item)}
              side={`jusqu’au ${formatIsoDate(item.usefulUntil)}`}
            />
          ))}
        </AlertGroup>
      )}
    </aside>
  );
}

export default function DashboardPage() {
  const { dashboard, error, load } = useDashboardStore();
  const newSession = useUIStore((state) => state.newSession);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-medium tracking-tight text-fg">Aujourd’hui</h1>
          {dashboard && (
            <p className="mt-0.5 text-[14px] text-fg-muted first-letter:uppercase">
              {longDay.format(localDate(dashboard.today))}
            </p>
          )}
        </div>
        {dashboard && (
          <button
            type="button"
            onClick={() => newSession({ date: dashboard.today, startTime: null })}
            className={btnPrimary}
          >
            Nouvelle séance
          </button>
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
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-2">
                <h2 className="text-[14px] font-medium">
                  Séances du jour
                  {dashboard.todaySessions.length > 0 && (
                    <span className="ml-2 text-[12.5px] font-normal text-fg-muted">
                      {dashboard.todaySessions.length}
                    </span>
                  )}
                </h2>
                <SessionList
                  sessions={dashboard.todaySessions}
                  empty="Aucune séance aujourd’hui."
                />
              </section>
              <section className="flex flex-col gap-2">
                <h2 className="text-[14px] font-medium">7 prochains jours</h2>
                <SessionList
                  sessions={dashboard.upcoming}
                  empty="Aucune séance planifiée dans les 7 prochains jours."
                  showDate
                />
              </section>
            </div>
            <AlertsPanel />
          </div>
        </>
      )}
    </div>
  );
}
