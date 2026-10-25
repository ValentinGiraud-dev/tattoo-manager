import { btnGhost, cardClass } from "../../components/styles";
import { formatIsoDate } from "../../lib/format";
import { SESSION_STATUS_LABELS } from "../../lib/labels";
import { formatEuros } from "../../lib/money";
import {
  alertCount,
  useDashboardStore,
  type DaySession,
  type ExpiringItem,
} from "../../stores/dashboard-store";
import { useUIStore } from "../../stores/ui-store";
import {
  clientName,
  sessionActionClass,
  sessionHeading,
  statusChipClass,
} from "./dashboard-format";

function AlertHeading({ title, tone }: { title: string; tone: "danger" | "warning" | "info" }) {
  const dot = { danger: "bg-danger", warning: "bg-warning", info: "bg-info" }[tone];
  return (
    <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
      {title}
    </h3>
  );
}

function AlertRow({ onClick, main, side }: { onClick: () => void; main: string; side: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-baseline justify-between gap-3 rounded-md px-1 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2"
      >
        <span className="min-w-0 text-fg">{main}</span>
        <span className="shrink-0 text-[12px] text-fg-muted tabular-nums">{side}</span>
      </button>
    </li>
  );
}

function closeDetail(session: DaySession): string {
  const description = session.description?.trim();
  if (description) return description;
  const client = session.title?.trim() ? clientName(session) : null;
  return [client, formatIsoDate(session.date)].filter(Boolean).join(" · ");
}

function stockPhrase(item: ExpiringItem): string {
  if (item.kind === "LOT") return `${item.count} en stock`;
  if (item.kind === "OPENED") {
    return item.count > 1 ? `${item.count} pièces ouvertes` : "1 pièce ouverte";
  }
  return item.count > 1 ? `${item.count} scellées` : "1 scellée";
}

function ExpiryBadge({ expired }: { expired: boolean }) {
  const tone = expired ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill px-2 py-0.5 text-[11.5px] font-medium ${tone}`}
    >
      {expired ? "Exp." : "Bientôt exp."}
    </span>
  );
}

function SessionsToClose({ sessions }: { sessions: DaySession[] }) {
  const openSession = useUIStore((state) => state.openSession);
  if (sessions.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <AlertHeading title="Séances passées à clôturer" tone="warning" />
      <ul className="flex flex-col gap-3">
        {sessions.map((session) => {
          const detail = closeDetail(session);
          return (
            <li key={session.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-[14px] font-medium text-fg">
                  {sessionHeading(session)}
                </span>
                <span className={statusChipClass}>{SESSION_STATUS_LABELS[session.status]}</span>
                <button
                  type="button"
                  onClick={() => openSession(session.id, "usages")}
                  className={sessionActionClass}
                >
                  Compléter la traçabilité
                </button>
              </div>
              {detail && <p className="text-[12.5px] text-fg-muted">{detail}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ExpiringLots({ items }: { items: ExpiringItem[] }) {
  const openLot = useUIStore((state) => state.openLot);
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <AlertHeading title="Bientôt périmés à racheter" tone="warning" />
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={`${item.lotId}-${item.kind}-${item.openedAt ?? ""}`}
            className="flex flex-col gap-1"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-[14px] font-medium text-fg">
                {item.name} · lot {item.lotNumber}
              </span>
              <ExpiryBadge expired={item.expired} />
              <button type="button" onClick={() => openLot(item.lotId)} className={btnGhost}>
                Voir le lot
              </button>
            </div>
            <p className="text-[12.5px] text-fg-muted">
              exp. {formatIsoDate(item.usefulUntil)} · {stockPhrase(item)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AlertsPanel() {
  const dashboard = useDashboardStore((state) => state.dashboard);
  const openSession = useUIStore((state) => state.openSession);
  const openSheet = useUIStore((state) => state.openSheet);
  const setPage = useUIStore((state) => state.setPage);
  if (!dashboard) return null;
  const { alerts } = dashboard;
  const total = alertCount(alerts);
  const expiring = [...alerts.expired, ...alerts.expiringSoon];

  return (
    <aside className={`${cardClass} flex flex-col gap-5 p-4`} aria-label="À traiter">
      <h2 className="flex items-baseline justify-between text-[14px] font-medium">
        À traiter
        <span className="text-[12.5px] font-normal text-fg-muted">{total}</span>
      </h2>
      {total === 0 && (
        <p className="text-[13px] text-fg-muted">
          Tout est à jour : aucun produit périmé ou en stock bas, aucune séance à clôturer, aucun
          reste à payer.
        </p>
      )}
      <SessionsToClose sessions={alerts.sessionsToClose} />
      <ExpiringLots items={expiring} />
      {alerts.lowStock.sheets.length + alerts.lowStock.categories.length > 0 && (
        <section className="flex flex-col gap-1">
          <AlertHeading title="Stock bas" tone="warning" />
          <ul className="flex flex-col">
            {alerts.lowStock.sheets.map((alert) => (
              <AlertRow
                key={alert.sheetId}
                onClick={() => openSheet(alert.sheetId)}
                main={alert.displayName}
                side={`${alert.stock} / seuil ${alert.threshold}`}
              />
            ))}
            {alerts.lowStock.categories.map((alert) => (
              <AlertRow
                key={alert.categoryId}
                onClick={() => setPage("products")}
                main={`${alert.path} (au total)`}
                side={`${alert.stock} / seuil ${alert.threshold}`}
              />
            ))}
          </ul>
        </section>
      )}
      {alerts.depositsToSettle.length > 0 && (
        <section className="flex flex-col gap-1">
          <AlertHeading title="Acomptes en attente" tone="warning" />
          <ul className="flex flex-col">
            {alerts.depositsToSettle.map((deposit) => (
              <AlertRow
                key={deposit.depositId}
                onClick={() => openSession(deposit.sessionId)}
                main={`${clientName(deposit)} · ${SESSION_STATUS_LABELS[deposit.sessionStatus].toLowerCase()}`}
                side={formatEuros(deposit.amountCents)}
              />
            ))}
          </ul>
        </section>
      )}
      {alerts.unpaid.length > 0 && (
        <section className="flex flex-col gap-1">
          <AlertHeading title="Restes à payer" tone="warning" />
          <ul className="flex flex-col">
            {alerts.unpaid.map((session) => (
              <AlertRow
                key={session.id}
                onClick={() => openSession(session.id)}
                main={`${clientName(session)} · ${formatIsoDate(session.date)}`}
                side={formatEuros(session.balanceCents ?? 0)}
              />
            ))}
          </ul>
        </section>
      )}
      {alerts.unsigned.length > 0 && (
        <section className="flex flex-col gap-1">
          <AlertHeading title="Documents non signés" tone="info" />
          <ul className="flex flex-col">
            {alerts.unsigned.map((session) => (
              <AlertRow
                key={session.id}
                onClick={() => openSession(session.id, "documents")}
                main={clientName(session)}
                side={
                  [
                    !session.healthSigned && "questionnaire",
                    !session.consentSigned && "consentement",
                  ]
                    .filter(Boolean)
                    .join(", ") || "à signer"
                }
              />
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
