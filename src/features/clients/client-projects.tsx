import { useEffect, useState, type FormEvent } from "react";
import { MoneyForm } from "../../components/money-form";
import { btnGhost, btnPrimary, cardClass, fieldClass, labelClass } from "../../components/styles";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate } from "../../lib/format";
import { formatTimeRange, PAYMENT_METHOD_LABELS } from "../../lib/labels";
import { centsToInput, formatEuros, parseEuros } from "../../lib/money";
import { todayIso, useBillingStore, type Deposit } from "../../stores/billing-store";
import {
  PROJECT_STATUS_LABELS,
  useProjectsStore,
  type Project,
  type ProjectStatus,
} from "../../stores/projects-store";
import type { SessionListItem } from "../../stores/sessions-store";
import { useUIStore } from "../../stores/ui-store";
import { StatusBadge } from "../sessions/session-status";

const DEPOSIT_STATUS: Record<Deposit["status"], string> = {
  HELD: "En attente",
  APPLIED: "Déduit",
  FORFEITED: "Perdu",
  REFUNDED: "Remboursé",
  VOIDED: "Saisie annulée",
};

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

function ProjectForm({
  clientId,
  project,
  onDone,
}: {
  clientId: string;
  project?: Project;
  onDone: (saved?: Project) => void;
}) {
  const store = useProjectsStore();
  const guardedLeave = useGuardedLeave();
  const [title, setTitle] = useState(project?.title ?? "");
  const [bodyArea, setBodyArea] = useState(project?.bodyArea ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [price, setPrice] = useState(centsToInput(project?.quotedPriceCents));
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "ACTIVE");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedChanges(dirty);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quoted = price.trim() === "" ? null : parseEuros(price);
    if (price.trim() !== "" && quoted === null) {
      setError("Le prix annoncé doit être un montant en euros, par exemple 1200");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = {
        clientId,
        title: title.trim(),
        bodyArea: emptyToNull(bodyArea),
        description: emptyToNull(description),
        quotedPriceCents: quoted,
        status,
      };
      const saved = project ? await store.update(project.id, input) : await store.create(input);
      setDirty(false);
      onDone(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      onInput={() => setDirty(true)}
      className={`${cardClass} flex flex-col gap-3 p-4`}
    >
      <p className="text-[14px] font-medium">{project ? "Modifier le projet" : "Nouveau projet"}</p>
      <label className={labelClass}>
        Titre *
        <input
          autoFocus
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ex. Manchette japonaise"
          className={fieldClass}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Zone du corps
          <input
            value={bodyArea}
            onChange={(event) => setBodyArea(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Prix annoncé (€)
          <input
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="Devis pour la pièce entière"
            className={fieldClass}
          />
        </label>
      </div>
      <label className={labelClass}>
        Description
        <textarea
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={fieldClass}
        />
      </label>
      {project && (
        <label className={labelClass}>
          Statut
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ProjectStatus)}
            className={fieldClass}
          >
            {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((value) => (
              <option key={value} value={value}>
                {PROJECT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          type="button"
          onClick={() => void guardedLeave(() => onDone())}
          className={btnGhost}
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

function ProjectDetail({
  project,
  onEdit,
  onBack,
  onChanged,
}: {
  project: Project;
  onEdit: () => void;
  onBack: () => void;
  onChanged: (project: Project) => void;
}) {
  const projects = useProjectsStore();
  const billing = useBillingStore();
  const confirm = useConfirm();
  const { openSession, newSession } = useUIStore();
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([projects.sessions(project.id), billing.projectDeposits(project.id)])
      .then(([loadedSessions, loadedDeposits]) => {
        if (cancelled) return;
        setSessions(loadedSessions);
        setDeposits(loadedDeposits);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, projects, billing]);

  async function reload() {
    const [fresh, loadedDeposits] = await Promise.all([
      projects.get(project.id),
      billing.projectDeposits(project.id),
    ]);
    setDeposits(loadedDeposits);
    onChanged(fresh);
  }

  async function voidDeposit(deposit: Deposit) {
    const result = await confirm({
      title: "Annuler la saisie de cet acompte ?",
      details: [
        `${formatEuros(deposit.amountCents)} · ${PAYMENT_METHOD_LABELS[deposit.method]} · ${formatIsoDate(deposit.receivedOn)}`,
      ],
      body: "À utiliser pour une erreur de saisie. L'acompte reste visible, barré, avec le motif.",
      reason: { label: "Motif", required: true, placeholder: "Ex. montant erroné" },
      confirmLabel: "Annuler la saisie",
      cancelLabel: "Garder",
      tone: "danger",
    });
    if (!result?.reason) return;
    const reason = result.reason;
    try {
      await billing.voidDeposit(deposit.id, reason);
      await reload();
    } catch (voidError) {
      setError(String(voidError));
    }
  }

  const remaining =
    project.quotedPriceCents === null ? null : project.quotedPriceCents - project.receivedCents;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-[13px] text-fg-muted hover:text-fg"
      >
        ← Projets
      </button>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{project.title}</p>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            {PROJECT_STATUS_LABELS[project.status]}
            {project.bodyArea ? ` · ${project.bodyArea}` : ""}
          </p>
        </div>
        <button type="button" onClick={onEdit} className={btnGhost}>
          Modifier
        </button>
      </div>
      {project.description && (
        <p className="text-[13px] whitespace-pre-wrap text-fg-muted">{project.description}</p>
      )}

      <dl className={`${cardClass} grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-[13px]`}>
        <dt className="text-fg-faint">Prix annoncé</dt>
        <dd className="text-right">
          {project.quotedPriceCents === null ? "—" : formatEuros(project.quotedPriceCents)}
        </dd>
        <dt className="text-fg-faint">Prix des séances</dt>
        <dd className="text-right">{formatEuros(project.sessionsPriceCents)}</dd>
        <dt className="text-fg-faint">Encaissé (acomptes + paiements)</dt>
        <dd className="text-right">{formatEuros(project.receivedCents)}</dd>
        <dt className="text-fg-faint">Acomptes en attente</dt>
        <dd className="text-right">{formatEuros(project.heldDepositsCents)}</dd>
        {remaining !== null && (
          <>
            <dt className="font-medium text-fg">
              {remaining < 0 ? "Au-delà du prix annoncé" : "Reste sur le prix annoncé"}
            </dt>
            <dd className="text-right text-[14px] font-medium">
              {formatEuros(Math.abs(remaining))}
            </dd>
          </>
        )}
      </dl>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium text-fg-muted">
          Séances {sessions ? `(${sessions.length})` : ""}
        </h3>
        <button
          type="button"
          onClick={() =>
            newSession({
              date: todayIso(),
              startTime: null,
              clientId: project.clientId,
              projectId: project.id,
            })
          }
          className={btnGhost}
        >
          Planifier une séance
        </button>
      </div>
      {sessions === null ? (
        <p className="text-[13px] text-fg-muted">Chargement…</p>
      ) : sessions.length === 0 ? (
        <p className={`${cardClass} px-4 py-4 text-center text-[13px] text-fg-muted`}>
          Aucune séance pour ce projet.
        </p>
      ) : (
        <ul className={`${cardClass} divide-y divide-line`}>
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => openSession(session.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  {formatIsoDate(session.date)}
                  {session.startTime
                    ? ` · ${formatTimeRange(session.startTime, session.durationMinutes)}`
                    : ""}
                  {session.priceCents !== null ? ` · ${formatEuros(session.priceCents)}` : ""}
                </span>
                <StatusBadge status={session.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium text-fg-muted">Acomptes</h3>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={btnGhost}>
            Enregistrer un acompte
          </button>
        )}
      </div>
      {adding && (
        <MoneyForm
          title={`Acompte pour « ${project.title} »`}
          submitLabel="Enregistrer l'acompte"
          initialCents={null}
          onCancel={() => setAdding(false)}
          onSubmit={async (draft) => {
            await billing.recordDeposit({
              projectId: project.id,
              sessionId: null,
              amountCents: draft.amountCents,
              method: draft.method,
              receivedOn: draft.date,
              note: draft.note,
            });
            setAdding(false);
            await reload();
          }}
        />
      )}
      {deposits.length === 0 ? (
        !adding && (
          <p className={`${cardClass} px-4 py-4 text-center text-[13px] text-fg-muted`}>
            Aucun acompte.
          </p>
        )
      ) : (
        <ul className={`${cardClass} divide-y divide-line`}>
          {deposits.map((deposit) => (
            <li key={deposit.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <p className={deposit.status === "VOIDED" ? "text-fg-muted line-through" : ""}>
                  {formatEuros(deposit.amountCents)} · {PAYMENT_METHOD_LABELS[deposit.method]} ·{" "}
                  {formatIsoDate(deposit.receivedOn)}
                </p>
                <p className="text-[12.5px] text-fg-muted">
                  {DEPOSIT_STATUS[deposit.status]}
                  {deposit.status === "APPLIED" && deposit.outcomeSessionDate
                    ? ` sur la séance du ${formatIsoDate(deposit.outcomeSessionDate)}`
                    : ""}
                  {deposit.outcomeReason ? ` · ${deposit.outcomeReason}` : ""}
                  {deposit.voidReason ? ` : ${deposit.voidReason}` : ""}
                </p>
              </div>
              {deposit.status === "HELD" && (
                <button
                  type="button"
                  onClick={() => void voidDeposit(deposit)}
                  className={btnGhost}
                >
                  Annuler la saisie
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deposits.some((deposit) => deposit.status === "HELD") && (
        <p className="text-[12.5px] text-fg-muted">
          Un acompte en attente se déduit depuis la section « Paiement » d&apos;une séance du
          projet.
        </p>
      )}
    </div>
  );
}

type Mode =
  { kind: "list" } | { kind: "form"; project?: Project } | { kind: "detail"; project: Project };

/** Projets du client : liste, création, détail. Monté avec `key={clientId}`. */
export function ClientProjects({ clientId }: { clientId: string }) {
  const store = useProjectsStore();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .listForClient(clientId)
      .then((items) => {
        if (!cancelled) setProjects(items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, store]);

  async function refresh(next: Mode) {
    setProjects(await store.listForClient(clientId));
    setMode(next);
  }

  return (
    <section className="flex flex-col gap-3">
      {mode.kind !== "detail" && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-medium">Projets</h2>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">
              Une pièce en une ou plusieurs séances, avec son prix et ses acomptes.
            </p>
          </div>
          {mode.kind === "list" && (
            <button type="button" onClick={() => setMode({ kind: "form" })} className={btnGhost}>
              Nouveau projet
            </button>
          )}
        </div>
      )}

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {mode.kind === "form" ? (
        <ProjectForm
          clientId={clientId}
          project={mode.project}
          onDone={(saved) =>
            void refresh(
              saved
                ? { kind: "detail", project: saved }
                : mode.project
                  ? { kind: "detail", project: mode.project }
                  : { kind: "list" },
            )
          }
        />
      ) : mode.kind === "detail" ? (
        <ProjectDetail
          key={mode.project.id}
          project={mode.project}
          onEdit={() => setMode({ kind: "form", project: mode.project })}
          onBack={() => void refresh({ kind: "list" })}
          onChanged={(project) => setMode({ kind: "detail", project })}
        />
      ) : projects === null ? (
        <p className="text-[13px] text-fg-muted">Chargement…</p>
      ) : projects.length === 0 ? (
        <p className={`${cardClass} px-4 py-5 text-center text-[13px] text-fg-muted`}>
          Aucun projet pour ce client.
        </p>
      ) : (
        <ul className={`${cardClass} divide-y divide-line`}>
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => setMode({ kind: "detail", project })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{project.title}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">
                    {PROJECT_STATUS_LABELS[project.status]} · {project.sessionCount} séance
                    {project.sessionCount > 1 ? "s" : ""}
                    {project.nextSessionDate
                      ? ` · prochaine le ${formatIsoDate(project.nextSessionDate)}`
                      : ""}
                    {project.heldDepositsCents > 0
                      ? ` · ${formatEuros(project.heldDepositsCents)} d'acompte en attente`
                      : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
