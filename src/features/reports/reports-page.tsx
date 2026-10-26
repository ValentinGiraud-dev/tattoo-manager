import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { DateSelector } from "../../components/date-selector";
import { InfoTip } from "../../components/info-tip";
import { btnGhost, cardClass, labelClass } from "../../components/styles";
import { formatIsoDate } from "../../lib/format";
import { PAYMENT_METHOD_LABELS } from "../../lib/labels";
import { formatEuros } from "../../lib/money";
import {
  useDashboardStore,
  type ExportKind,
  type PeriodSummary,
} from "../../stores/dashboard-store";
import { errorMessage } from "../../stores/security-store";

type Preset = "month" | "previousMonth" | "year" | "previousYear" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "month", label: "Ce mois" },
  { id: "previousMonth", label: "Mois dernier" },
  { id: "year", label: "Cette année" },
  { id: "previousYear", label: "Année dernière" },
  { id: "custom", label: "Autre période" },
];

const EXPORTS: { kind: ExportKind; title: string; description: string; stem: string }[] = [
  {
    kind: "PAYMENTS",
    title: "Journal des encaissements",
    description: "Paiements, acomptes reçus et remboursements, avec le mode et le total.",
    stem: "encaissements",
  },
  {
    kind: "SESSIONS",
    title: "Séances",
    description: "Date, client, statut, prix, montant réglé et reste à payer.",
    stem: "seances",
  },
  {
    kind: "TRACEABILITY",
    title: "Registre de traçabilité",
    description:
      "Produits utilisés à chaque séance (lot, pièce, péremption), liens annulés compris.",
    stem: "tracabilite",
  },
];

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function presetRange(preset: Exclude<Preset, "custom">, now: Date): [string, string] {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "month":
      return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    case "previousMonth":
      return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case "year":
      return [`${y}-01-01`, `${y}-12-31`];
    case "previousYear":
      return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  }
}

type Loaded = { key: string; summary: PeriodSummary | null; error: string | null };

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={strong ? "text-[13.5px] font-medium text-fg" : "text-[13px] text-fg-muted"}>
        {label}
      </dt>
      <dd
        className={`tabular-nums ${strong ? "text-[15px] font-medium text-fg" : "text-[13px] text-fg"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Summary({ summary }: { summary: PeriodSummary }) {
  const received = summary.paymentsCents + summary.depositsCents;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <section className={`${cardClass} p-4`}>
        <h2 className="mb-2 text-[14px] font-medium">Encaissements</h2>
        <dl className="divide-y divide-line">
          <Row label="Paiements de séances" value={formatEuros(summary.paymentsCents)} />
          <Row label="Acomptes reçus" value={formatEuros(summary.depositsCents)} />
          <Row
            label="Acomptes remboursés"
            value={summary.refundsCents > 0 ? `− ${formatEuros(summary.refundsCents)}` : "—"}
          />
          <Row label="Encaissé net" value={formatEuros(summary.collectedCents)} strong />
        </dl>
        {summary.byMethod.length > 0 && (
          <>
            <h3 className="mt-4 mb-1 text-[12.5px] font-medium text-fg-muted">
              Par mode (avant remboursements)
            </h3>
            <dl className="divide-y divide-line">
              {summary.byMethod.map((total) => (
                <Row
                  key={total.method}
                  label={`${PAYMENT_METHOD_LABELS[total.method]} · ${Math.round((total.cents / received) * 100)} %`}
                  value={formatEuros(total.cents)}
                />
              ))}
            </dl>
          </>
        )}
      </section>
      <section className={`${cardClass} p-4`}>
        <h2 className="mb-2 flex items-center gap-1 text-[14px] font-medium">
          Activité
          <InfoTip label="Activité">
            Une séance compte à sa date ; un encaissement à sa date de paiement.
          </InfoTip>
        </h2>
        <dl className="divide-y divide-line">
          <Row label="Séances terminées" value={String(summary.sessionsCompleted)} strong />
          <Row
            label="Prix des séances terminées"
            value={formatEuros(summary.completedPriceCents)}
          />
          <Row label="Séances encore planifiées" value={String(summary.sessionsPlanned)} />
          <Row label="Annulées ou reportées" value={String(summary.sessionsCancelled)} />
          <Row label="Absences" value={String(summary.sessionsNoShow)} />
          <Row label="Nouveaux clients" value={String(summary.newClients)} />
        </dl>
      </section>
    </div>
  );
}

function Exports({ from, to }: { from: string; to: string }) {
  const exportCsv = useDashboardStore((state) => state.exportCsv);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: ExportKind, stem: string) {
    setMessage(null);
    setError(null);
    const path = await save({
      title: "Enregistrer l’export",
      defaultPath: `tracink-${stem}-${from}-au-${to}.csv`,
      filters: [{ name: "Tableur (CSV)", extensions: ["csv"] }],
    });
    if (!path) return;
    setBusy(kind);
    try {
      const result = await exportCsv(kind, from, to, path);
      setMessage(
        `${result.rows} ligne${result.rows > 1 ? "s" : ""} enregistrée${result.rows > 1 ? "s" : ""} dans ${result.path}`,
      );
    } catch (exportError) {
      setError(errorMessage(exportError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`${cardClass} flex flex-col gap-4 p-4`}>
      <div className="flex items-center gap-1">
        <h2 className="text-[14px] font-medium">Exports CSV</h2>
        <InfoTip label="Exports CSV">
          Pour la comptabilité ou un contrôle, sur la période choisie. Le fichier s’ouvre dans
          Numbers ou Excel.
        </InfoTip>
      </div>
      <p
        role="note"
        className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg"
      >
        <span aria-hidden="true">⚠︎ </span>
        Le fichier exporté n’est pas chiffré et contient des noms de clients. Rangez-le en lieu sûr
        et supprimez-le quand il ne sert plus.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {EXPORTS.map((item) => (
          <li key={item.kind} className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[13.5px] text-fg">
                {item.title}
                <InfoTip label={item.title}>{item.description}</InfoTip>
              </p>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run(item.kind, item.stem)}
              className={`${btnGhost} shrink-0`}
            >
              {busy === item.kind ? "Export…" : "Exporter…"}
            </button>
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className="text-[13px] break-all text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

export default function ReportsPage() {
  const periodSummary = useDashboardStore((state) => state.periodSummary);
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState<[string | null, string | null]>(() =>
    presetRange("month", new Date()),
  );
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const [from, to] = preset === "custom" ? custom : presetRange(preset, new Date());
  const valid = from !== null && to !== null && from <= to;
  const key = `${from}|${to}`;

  useEffect(() => {
    if (!valid || from === null || to === null) return;
    let cancelled = false;
    periodSummary(from, to)
      .then((summary) => {
        if (!cancelled) setLoaded({ key, summary, error: null });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setLoaded({ key, summary: null, error: errorMessage(loadError) });
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, key, valid, periodSummary]);

  const current = loaded?.key === key ? loaded : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="text-[28px] font-medium tracking-tight text-fg">Rapports</h1>
        <p className="mt-0.5 text-[14px] text-fg-muted">
          Chiffres d’une période et exports pour la comptabilité.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Période">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={preset === item.id}
              onClick={() => {
                if (item.id === "custom" && preset !== "custom") setCustom([from, to]);
                setPreset(item.id);
              }}
              className={[
                "rounded-pill border px-3 py-1 text-[13px] transition-colors",
                preset === item.id
                  ? "border-accent bg-surface-3 text-fg"
                  : "border-line-strong text-fg-muted hover:bg-surface-2 hover:text-fg",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className={`${labelClass} w-72`}>
              Du
              <DateSelector
                value={custom[0]}
                onChange={(value) => setCustom([value, custom[1]])}
                minYear={2015}
                maxYear={new Date().getFullYear() + 1}
              />
            </label>
            <label className={`${labelClass} w-72`}>
              Au
              <DateSelector
                value={custom[1]}
                onChange={(value) => setCustom([custom[0], value])}
                minYear={2015}
                maxYear={new Date().getFullYear() + 1}
              />
            </label>
            {!valid && (
              <p className="pb-2 text-[13px] text-danger">
                Choisissez une date de début antérieure à la date de fin.
              </p>
            )}
          </div>
        ) : (
          from &&
          to && (
            <p className="text-[13px] text-fg-muted">
              Du {formatIsoDate(from)} au {formatIsoDate(to)}
            </p>
          )
        )}
      </section>

      {valid &&
        (current?.error ? (
          <p role="alert" className="text-[13px] text-danger">
            {current.error}
          </p>
        ) : current?.summary ? (
          <Summary summary={current.summary} />
        ) : (
          <p className="text-[13px] text-fg-muted">Calcul…</p>
        ))}

      {valid && from && to && <Exports from={from} to={to} />}
    </div>
  );
}
