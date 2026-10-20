import { useEffect, useState } from "react";
import { DateSelector } from "../../components/date-selector";
import { btnGhost, cardClass, fieldClass, labelClass } from "../../components/styles";
import { localDay } from "../../lib/audit";
import { formatIsoDate } from "../../lib/format";
import {
  useAuditStore,
  type AuditEntry,
  type AuditFilter,
  type AuditGroup,
  type AuditPeriod,
} from "../../stores/audit-store";
import { AuditEntryRow } from "./audit-entry-row";

const GROUPS: { id: AuditGroup | ""; label: string }[] = [
  { id: "", label: "Tout" },
  { id: "clients", label: "Clients et projets" },
  { id: "sessions", label: "Séances, questionnaires et produits liés" },
  { id: "billing", label: "Paiements et acomptes" },
  { id: "stock", label: "Fiches produit, lots, stock et catégories" },
  { id: "app", label: "Sécurité, sauvegardes et exports" },
];

const PERIODS: { id: AuditPeriod; label: string }[] = [
  { id: "all", label: "Depuis le début" },
  { id: "today", label: "Aujourd'hui" },
  { id: "week", label: "7 derniers jours" },
  { id: "month", label: "30 derniers jours" },
  { id: "custom", label: "Autre période" },
];

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Dates d'un préréglage ; `null` pour « Autre période » (dates choisies à la main). */
function presetRange(period: AuditPeriod, now: Date): [string | null, string | null] | null {
  const daysAgo = (days: number) =>
    iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  switch (period) {
    case "all":
      return [null, null];
    case "today":
      return [iso(now), iso(now)];
    case "week":
      return [daysAgo(6), iso(now)];
    case "month":
      return [daysAgo(29), iso(now)];
    case "custom":
      return null;
  }
}

/** Entrées regroupées par jour local, dans l'ordre reçu (plus récentes d'abord). */
function byDay(entries: AuditEntry[]): [string, AuditEntry[]][] {
  const days: [string, AuditEntry[]][] = [];
  for (const entry of entries) {
    const day = localDay(entry.occurredAt);
    const last = days[days.length - 1];
    if (last && last[0] === day) last[1].push(entry);
    else days.push([day, [entry]]);
  }
  return days;
}

export default function JournalPage() {
  const { filter, page, loading, loadingMore, error, load, loadMore } = useAuditStore();
  // Période personnalisée en cours de saisie (chargée quand les deux dates sont là).
  const [custom, setCustom] = useState<{ from: string | null; to: string | null }>({
    from: filter.period === "custom" ? filter.from : null,
    to: filter.period === "custom" ? filter.to : null,
  });

  useEffect(() => {
    const { filter: initial, load: initialLoad } = useAuditStore.getState();
    void initialLoad(initial);
  }, []);

  function apply(next: AuditFilter) {
    void load(next);
  }

  function choosePeriod(period: AuditPeriod) {
    const range = presetRange(period, new Date());
    if (range) {
      apply({ ...filter, period, from: range[0], to: range[1] });
      return;
    }
    // « Autre période » : on garde la liste jusqu'à ce que les deux dates soient choisies.
    const from = custom.from ?? filter.from ?? iso(new Date());
    const to = custom.to ?? filter.to ?? iso(new Date());
    setCustom({ from, to });
    apply({ ...filter, period, from, to });
  }

  function chooseDate(key: "from" | "to", value: string | null) {
    const next = { ...custom, [key]: value };
    setCustom(next);
    if (next.from && next.to && next.from <= next.to) {
      apply({ ...filter, period: "custom", from: next.from, to: next.to });
    }
  }

  const filtered = filter.period !== "all" || filter.group !== null;
  const invalidRange =
    filter.period === "custom" &&
    custom.from !== null &&
    custom.to !== null &&
    custom.from > custom.to;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-10">
      <div>
        <h1 className="text-[24px] font-medium tracking-tight">Journal</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Tout ce qui a été créé, modifié, annulé ou supprimé dans Tracink, avec la date et le
          détail. Le journal ne peut être ni modifié ni effacé.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className={`${labelClass} w-[300px]`}>
          Type
          <select
            value={filter.group ?? ""}
            onChange={(event) =>
              apply({ ...filter, group: (event.target.value || null) as AuditGroup | null })
            }
            className={fieldClass}
          >
            {GROUPS.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelClass} w-[200px]`}>
          Période
          <select
            value={filter.period}
            onChange={(event) => choosePeriod(event.target.value as AuditPeriod)}
            className={fieldClass}
          >
            {PERIODS.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label}
              </option>
            ))}
          </select>
        </label>
        {filter.period === "custom" && (
          <>
            <label className={`${labelClass} w-56`}>
              Du
              <DateSelector
                value={custom.from}
                onChange={(value) => chooseDate("from", value)}
                minYear={2024}
                maxYear={new Date().getFullYear()}
              />
            </label>
            <label className={`${labelClass} w-56`}>
              Au
              <DateSelector
                value={custom.to}
                onChange={(value) => chooseDate("to", value)}
                minYear={2024}
                maxYear={new Date().getFullYear()}
              />
            </label>
          </>
        )}
      </div>
      {invalidRange && (
        <p role="alert" className="-mt-2 text-[12.5px] text-danger">
          La date de début doit précéder la date de fin.
        </p>
      )}

      {error && (
        <div className="flex items-center gap-3">
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
          <button type="button" onClick={() => apply(filter)} className={btnGhost}>
            Réessayer
          </button>
        </div>
      )}

      {!page && loading && <p className="text-[13px] text-fg-faint">Chargement du journal…</p>}

      {page && page.entries.length === 0 && !loading && (
        <div className={`${cardClass} px-5 py-10 text-center`}>
          <p className="text-[14px] text-fg-muted">
            {filtered ? "Rien dans le journal pour ces filtres." : "Le journal est vide."}
          </p>
          {filtered && (
            <button
              type="button"
              onClick={() => apply({ period: "all", from: null, to: null, group: null })}
              className={`${btnGhost} mt-4`}
            >
              Retirer les filtres
            </button>
          )}
        </div>
      )}

      {page && page.entries.length > 0 && (
        <div
          className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}
          aria-busy={loading}
        >
          {byDay(page.entries).map(([day, entries]) => (
            <section key={day}>
              <h2 className="mb-1.5 text-[12.5px] font-medium text-fg-muted">
                {formatIsoDate(day)}
              </h2>
              <ul className={`${cardClass} divide-y divide-line`}>
                {entries.map((entry) => (
                  <AuditEntryRow key={entry.seq} entry={entry} names={page.names} />
                ))}
              </ul>
            </section>
          ))}
          {page.hasMore && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className={`${btnGhost} self-center`}
            >
              {loadingMore ? "Chargement…" : "Afficher plus"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
