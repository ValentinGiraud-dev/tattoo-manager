import { useEffect, useState, type FormEvent } from "react";
import { DateSelector } from "../../components/date-selector";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate } from "../../lib/format";
import { formatDuration, formatTimeRange, SESSION_STATUS_LABELS } from "../../lib/labels";
import { centsToInput, formatEuros, parseEuros } from "../../lib/money";
import { useBillingStore } from "../../stores/billing-store";
import { useClientsStore } from "../../stores/clients-store";
import { useProjectsStore, type Project } from "../../stores/projects-store";
import {
  useSessionsStore,
  type SessionInput,
  type SessionListItem,
  type SessionStatus,
} from "../../stores/sessions-store";
import { toast } from "../../stores/toast-store";

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480];
const DEFAULT_DURATION = 120;

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

/** Brouillon de séance (créneau choisi dans le planning, projet de la fiche client…). */
export type SessionDraft = {
  date?: string;
  startTime?: string | null;
  clientId?: string;
  projectId?: string;
};

export function SessionForm({
  session,
  draft,
  onDone,
}: {
  session?: SessionListItem;
  draft?: SessionDraft;
  onDone: (saved?: SessionListItem) => void;
}) {
  const { create, update, overlaps } = useSessionsStore();
  const { clients, load: loadClients } = useClientsStore();
  const projectsStore = useProjectsStore();
  const billing = useBillingStore();
  const confirm = useConfirm();
  const guardedLeave = useGuardedLeave();

  const [clientId, setClientId] = useState(session?.clientId ?? draft?.clientId ?? "");
  const [projectId, setProjectId] = useState(session?.projectId ?? draft?.projectId ?? "");
  const [projects, setProjects] = useState<Project[]>([]);
  const [date, setDate] = useState<string | null>(session?.date ?? draft?.date ?? null);
  const [startTime, setStartTime] = useState(session?.startTime ?? draft?.startTime ?? "");
  const [duration, setDuration] = useState<number>(
    session?.durationMinutes ?? (session ? 0 : DEFAULT_DURATION),
  );
  const [price, setPrice] = useState(centsToInput(session?.priceCents));
  const [bodyArea, setBodyArea] = useState(session?.bodyArea ?? "");
  const [status, setStatus] = useState<SessionStatus>(session?.status ?? "PLANNED");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedChanges(dirty);

  /** Produits, acomptes ou paiements rattachés : le client est figé (règle vérifiée en Rust). */
  const clientLocked = (session?.usageCount ?? 0) > 0 || (session?.moneyCount ?? 0) > 0;
  const currentYear = new Date().getFullYear();
  const durationOptions =
    duration > 0 && !DURATIONS.includes(duration)
      ? [...DURATIONS, duration].sort((a, b) => a - b)
      : DURATIONS;

  useEffect(() => {
    void loadClients("");
  }, [loadClients]);

  useEffect(() => {
    let cancelled = false;
    if (!clientId) return;
    projectsStore
      .listForClient(clientId)
      .then((items) => {
        if (!cancelled) setProjects(items);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, projectsStore]);

  function touch() {
    setDirty(true);
  }

  async function createProject() {
    if (!clientId) {
      setError("Choisis d'abord le client");
      return;
    }
    const result = await confirm({
      title: "Nouveau projet",
      body: "Un projet regroupe les séances d'une même pièce, avec son prix annoncé et ses acomptes. Les détails se complètent dans la fiche client.",
      reason: { label: "Titre du projet", required: true, placeholder: "Ex. Manchette japonaise" },
      confirmLabel: "Créer le projet",
    });
    if (!result?.reason) return;
    try {
      const created = await projectsStore.create({
        clientId,
        title: result.reason,
        bodyArea: emptyToNull(bodyArea),
        description: null,
        quotedPriceCents: null,
        status: "ACTIVE",
      });
      setProjects((current) => [created, ...current]);
      setProjectId(created.id);
      touch();
    } catch (createError) {
      setError(String(createError));
    }
  }

  /** Après une absence ou une annulation : que devient l'acompte en attente ? */
  async function settleHeldDeposits(saved: SessionListItem) {
    const bill = await billing.sessionBilling(saved.id);
    const held = bill.deposits.filter((deposit) => deposit.status === "HELD");
    if (held.length === 0) return;
    const total = held.reduce((sum, deposit) => sum + deposit.amountCents, 0);
    const event =
      saved.status === "NO_SHOW"
        ? `Absence du ${formatIsoDate(saved.date)}`
        : `Annulation de la séance du ${formatIsoDate(saved.date)}`;
    const result = await confirm({
      title: "Que devient l'acompte ?",
      details: held.map(
        (deposit) =>
          `${formatEuros(deposit.amountCents)} versé le ${formatIsoDate(deposit.receivedOn)}${deposit.projectTitle ? ` · ${deposit.projectTitle}` : ""}`,
      ),
      body: `${event}. ${held.length > 1 ? `Ces acomptes (${formatEuros(total)}) sont` : "Cet acompte est"} encore en attente.`,
      choices: [
        {
          value: "KEEP",
          label: "Le garder en attente",
          description: "Il pourra être déduit d'une prochaine séance.",
        },
        {
          value: "FORFEITED",
          label: "Acompte perdu",
          description: "Conservé par l'atelier ; il ne sera plus déduit.",
        },
        { value: "REFUNDED", label: "Le rembourser", description: "Rendu au client." },
      ],
      confirmLabel: "Valider",
      cancelLabel: "Décider plus tard",
    });
    if (!result || result.choice === "KEEP" || result.choice === null) return;
    const outcome = result.choice as "FORFEITED" | "REFUNDED";
    for (const deposit of held) {
      await billing.settleDeposit({
        depositId: deposit.id,
        outcome,
        sessionId: saved.id,
        reason: event,
      });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    if (!clientId) {
      setError("Le client est obligatoire");
      return;
    }
    if (!date) {
      setError("La date est obligatoire");
      return;
    }
    const priceCents = price.trim() === "" ? null : parseEuros(price);
    if (price.trim() !== "" && priceCents === null) {
      setError("Le prix doit être un montant en euros, par exemple 150 ou 150,50");
      return;
    }
    const time = startTime.trim() === "" ? null : startTime;
    const input: SessionInput = {
      clientId,
      projectId: projectId || null,
      date,
      startTime: time,
      durationMinutes: time && duration > 0 ? duration : null,
      status,
      priceCents,
      bodyArea: emptyToNull(bodyArea),
      description: emptyToNull(text("description")),
      notes: emptyToNull(text("notes")),
    };

    setSaving(true);
    setError(null);
    try {
      // Chevauchement : un avertissement, pas un blocage.
      if (input.startTime && (status === "PLANNED" || status === "COMPLETED")) {
        const clashes = await overlaps(
          input.date,
          input.startTime,
          input.durationMinutes ?? 60,
          session?.id ?? null,
        );
        if (clashes.length > 0) {
          const ok = await confirm({
            title: "Ce créneau chevauche une autre séance",
            details: clashes.map(
              (other) =>
                `${formatTimeRange(other.startTime, other.durationMinutes) ?? ""} · ${other.clientFirstName} ${other.clientLastName}`,
            ),
            body: "Enregistrer quand même ?",
            confirmLabel: "Enregistrer quand même",
            cancelLabel: "Changer l'horaire",
          });
          if (!ok) return;
        }
      }

      if ((status === "CANCELLED" || status === "NO_SHOW") && status !== session?.status) {
        const client = clients.find((item) => item.id === clientId);
        const ok = await confirm({
          title:
            status === "NO_SHOW"
              ? "Marquer le client comme absent ?"
              : "Marquer cette séance comme annulée ?",
          details: [
            client ? `${client.firstName} ${client.lastName}` : "Client",
            formatIsoDate(date),
            ...(input.startTime ? [input.startTime] : []),
          ],
          body: `La séance reste dans l'historique avec le statut « ${SESSION_STATUS_LABELS[status]} ».`,
          confirmLabel: status === "NO_SHOW" ? "Marquer absent" : "Annuler la séance",
          cancelLabel: "Retour",
          tone: "danger",
        });
        if (!ok) return;
      }

      const saved = session ? await update(session.id, input) : await create(input);
      setDirty(false);
      if (
        (saved.status === "CANCELLED" || saved.status === "NO_SHOW") &&
        saved.status !== session?.status
      ) {
        await settleHeldDeposits(saved);
      }
      toast.success(session ? "Séance enregistrée" : "Séance créée");
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
      onInput={(event) => {
        if ((event.target as HTMLElement).getAttribute("name")) touch();
      }}
      className="mx-auto flex max-w-xl flex-col gap-4 px-8 py-10"
    >
      <div>
        <button
          type="button"
          onClick={() => void guardedLeave(() => onDone())}
          className="mb-4 text-[13px] text-fg-muted hover:text-fg"
        >
          ← Retour
        </button>
        <h1 className="text-[24px] font-medium tracking-tight">
          {session ? "Modifier la séance" : "Nouvelle séance"}
        </h1>
      </div>

      <label className={labelClass}>
        Client *
        <select
          required
          value={clientId}
          onChange={(event) => {
            setClientId(event.target.value);
            setProjectId("");
            setProjects([]);
            touch();
          }}
          disabled={clientLocked}
          className={fieldClass}
        >
          <option value="" disabled>
            Choisir un client
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.lastName} {client.firstName}
            </option>
          ))}
        </select>
        {clientLocked && (
          <span className="mt-1.5 block text-[12.5px] font-normal text-fg-muted">
            Des produits, acomptes ou paiements sont rattachés à cette séance : elle reste attachée
            à ce client.
          </span>
        )}
      </label>

      <div>
        <label htmlFor="session-project" className={labelClass}>
          Projet
        </label>
        <div className="mt-1.5 flex gap-2">
          <select
            id="session-project"
            value={projectId}
            onChange={(event) => {
              const next = event.target.value;
              setProjectId(next);
              const project = projects.find((item) => item.id === next);
              if (project?.bodyArea && bodyArea.trim() === "") setBodyArea(project.bodyArea);
              touch();
            }}
            disabled={!clientId}
            className={fieldClass.replace("mt-1.5", "")}
          >
            <option value="">Séance isolée (sans projet)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
                {project.status !== "ACTIVE" ? " (terminé ou abandonné)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void createProject()}
            disabled={!clientId}
            className={`${btnGhost} shrink-0`}
          >
            Nouveau projet
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="session-date" className={labelClass}>
          Date *
        </label>
        <DateSelector
          id="session-date"
          value={date}
          onChange={(value) => {
            setDate(value);
            touch();
          }}
          placeholder="Choisir la date de séance"
          minYear={currentYear - 10}
          maxYear={currentYear + 2}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Heure de début
          <input
            type="time"
            step={900}
            value={startTime}
            onChange={(event) => {
              setStartTime(event.target.value);
              touch();
            }}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Durée
          <select
            value={duration}
            onChange={(event) => {
              setDuration(Number(event.target.value));
              touch();
            }}
            disabled={startTime === ""}
            className={fieldClass}
          >
            <option value={0}>Non précisée</option>
            {durationOptions.map((minutes) => (
              <option key={minutes} value={minutes}>
                {formatDuration(minutes)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Prix de la séance (€)
          <input
            inputMode="decimal"
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
              touch();
            }}
            placeholder="Ex. 250"
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Statut *
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as SessionStatus);
              touch();
            }}
            className={fieldClass}
          >
            {(Object.keys(SESSION_STATUS_LABELS) as SessionStatus[]).map((value) => (
              <option key={value} value={value}>
                {SESSION_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={labelClass}>
        Zone du corps
        <input
          value={bodyArea}
          onChange={(event) => {
            setBodyArea(event.target.value);
            touch();
          }}
          placeholder="Ex. avant-bras gauche"
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        Description
        <textarea
          name="description"
          rows={3}
          defaultValue={session?.description ?? ""}
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        Notes
        <textarea
          name="notes"
          rows={3}
          defaultValue={session?.notes ?? ""}
          className={fieldClass}
        />
      </label>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
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
