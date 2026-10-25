import { useEffect, useState, type FormEvent } from "react";
import { DateSelector } from "../../components/date-selector";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { useConfirm } from "../../components/use-confirm";
import { formatDuration, formatTimeRange, SESSION_STATUS_LABELS } from "../../lib/labels";
import { centsToInput, parseEuros } from "../../lib/money";
import { ClientCreateDialog } from "../clients/client-create-dialog";
import { SessionProjectDialog } from "./session-project-dialog";
import { confirmClosingStatus, settleHeldDeposits } from "./session-status-flow";
import { useClientsStore, type Client } from "../../stores/clients-store";
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
  locked = false,
  onDone,
}: {
  session?: SessionListItem;
  draft?: SessionDraft;
  locked?: boolean;
  onDone: (saved?: SessionListItem) => void;
}) {
  const { create, update, overlaps } = useSessionsStore();
  const listActive = useClientsStore((state) => state.listActive);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsReady, setClientsReady] = useState(false);
  const projectsStore = useProjectsStore();
  const confirm = useConfirm();
  const guardedLeave = useGuardedLeave();

  const [clientId, setClientId] = useState(session?.clientId ?? draft?.clientId ?? "");
  const [projectId, setProjectId] = useState(session?.projectId ?? draft?.projectId ?? "");
  const [title, setTitle] = useState(session?.title ?? "");
  const [projects, setProjects] = useState<Project[]>([]);
  const [date, setDate] = useState<string | null>(session?.date ?? draft?.date ?? null);
  const [startTime, setStartTime] = useState(session?.startTime ?? draft?.startTime ?? "");
  const [duration, setDuration] = useState<number>(
    session?.durationMinutes ?? (session ? 0 : DEFAULT_DURATION),
  );
  const [price, setPrice] = useState(centsToInput(session?.priceCents));
  const [bodyArea, setBodyArea] = useState(session?.bodyArea ?? "");
  const [status, setStatus] = useState<SessionStatus>(session?.status ?? "PLANNED");
  const incomingStatus = session?.status;
  const [seenStatus, setSeenStatus] = useState(incomingStatus);
  if (incomingStatus !== seenStatus) {
    setSeenStatus(incomingStatus);
    if (incomingStatus) setStatus(incomingStatus);
  }
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [pickingProject, setPickingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedChanges(dirty);

  /** Produits, acomptes ou paiements rattachés : le client est figé (règle vérifiée en Rust). */
  const clientLocked = (session?.usageCount ?? 0) > 0 || (session?.moneyCount ?? 0) > 0;
  const currentYear = new Date().getFullYear();
  const durationOptions =
    duration > 0 && !DURATIONS.includes(duration)
      ? [...DURATIONS, duration].sort((a, b) => a - b)
      : DURATIONS;
  const linkedProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    let cancelled = false;
    void listActive()
      .then((items) => {
        if (!cancelled) setClients(items);
      })
      .finally(() => {
        if (!cancelled) setClientsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [listActive]);

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

  /** Numéro proposé : les séances déjà sur ce projet, plus celle-ci si elle n'y est pas encore. */
  function projectSessionNumber(project: Project) {
    const already = session?.projectId === project.id;
    return project.sessionCount + (already ? 0 : 1);
  }

  function chooseProject(project: Project) {
    setProjectId(project.id);
    if (title.trim() === "") {
      setTitle(`${project.title} séance ${projectSessionNumber(project)}`);
    }
    if (project.bodyArea && bodyArea.trim() === "") setBodyArea(project.bodyArea);
    setError(null);
    touch();
    setPickingProject(false);
  }

  function chooseCreatedClient(client: Client) {
    setClients((current) =>
      current.some((item) => item.id === client.id) ? current : [...current, client],
    );
    setClientId(client.id);
    setProjectId("");
    setProjects([]);
    setError(null);
    touch();
    setCreatingClient(false);
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
      chooseProject(created);
    } catch (createError) {
      setError(String(createError));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
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
      title: emptyToNull(title),
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
        const ok = await confirmClosingStatus(
          confirm,
          status,
          client ? `${client.firstName} ${client.lastName}` : "Client",
          date,
          input.startTime,
        );
        if (!ok) return;
      }

      const saved = session ? await update(session.id, input) : await create(input);
      setDirty(false);
      if (
        (saved.status === "CANCELLED" || saved.status === "NO_SHOW") &&
        saved.status !== session?.status
      ) {
        await settleHeldDeposits(confirm, saved);
      }
      toast.success(session ? "Séance enregistrée" : "Séance créée");
      onDone(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  function leave() {
    void guardedLeave(() => onDone());
  }

  return (
    <>
      <form
        onSubmit={(event) => void submit(event)}
        onInput={(event) => {
          if ((event.target as HTMLElement).getAttribute("name")) touch();
        }}
        className="flex flex-col gap-4"
      >
        <div>
          <label htmlFor="session-client" className={labelClass}>
            Client *
          </label>
          <div className="mt-1.5 flex gap-2">
            <select
              id="session-client"
              required
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                setProjectId("");
                setProjects([]);
                touch();
              }}
              disabled={locked || clientLocked}
              className={fieldClass.replace("mt-1.5", "")}
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
            {!locked && !clientLocked && (
              <button
                type="button"
                onClick={() => setCreatingClient(true)}
                className={`${btnGhost} shrink-0`}
              >
                Nouveau client
              </button>
            )}
          </div>
          {clientLocked && (
            <p className="mt-1.5 text-[12.5px] text-fg-muted">
              Des produits, acomptes ou paiements sont rattachés à cette séance : elle reste
              attachée à ce client.
            </p>
          )}
          {!locked && !clientLocked && clientsReady && clients.length === 0 && (
            <p className="mt-1.5 text-[12.5px] text-fg-muted">
              Aucun client pour l'instant. Crée-le ici, la séance reste ouverte.
            </p>
          )}
        </div>

        <div>
          <span className={labelClass}>Projet</span>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickingProject(true)}
              disabled={locked || !clientId}
              aria-label={
                linkedProject ? `Changer le projet, ${linkedProject.title}` : "Lier à un projet"
              }
              className={`${btnGhost} max-w-56 shrink-0 truncate`}
            >
              {linkedProject ? linkedProject.title : "Lier à un projet"}
            </button>
            {linkedProject && !locked && (
              <button
                type="button"
                onClick={() => {
                  setProjectId("");
                  touch();
                }}
                className={`${btnGhost} shrink-0`}
              >
                Retirer
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="session-date" className={labelClass}>
              Date *
            </label>
            <DateSelector
              id="session-date"
              value={date}
              disabled={locked}
              onChange={(value) => {
                setDate(value);
                touch();
              }}
              placeholder="Choisir la date de séance"
              minYear={currentYear - 10}
              maxYear={currentYear + 2}
            />
          </div>
          <label className={labelClass}>
            Heure
            <input
              type="time"
              step={900}
              value={startTime}
              disabled={locked}
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
              disabled={locked || startTime === ""}
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

        <label className={labelClass}>
          Zone
          <input
            value={bodyArea}
            disabled={locked}
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
            disabled={locked}
            defaultValue={session?.description ?? ""}
            className={fieldClass}
          />
        </label>

        <label htmlFor="session-title" className={labelClass}>
          Titre de la séance
          <input
            id="session-title"
            value={title}
            disabled={locked}
            onChange={(event) => {
              setTitle(event.target.value);
              touch();
            }}
            placeholder="Ex. Retouche ombrage"
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Notes
          <textarea
            name="notes"
            rows={3}
            disabled={locked}
            defaultValue={session?.notes ?? ""}
            className={fieldClass}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Prix de la séance (€)
            <input
              inputMode="decimal"
              value={price}
              disabled={locked}
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
              aria-label="Statut de la séance"
              value={status}
              disabled={locked}
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

        {error && <p className="text-[13px] text-danger">{error}</p>}

        {!locked && (
          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={leave} className={btnGhost}>
              Annuler
            </button>
          </div>
        )}
      </form>
      {creatingClient && (
        <ClientCreateDialog
          onCreated={chooseCreatedClient}
          onClose={() => setCreatingClient(false)}
        />
      )}
      {pickingProject && (
        <SessionProjectDialog
          projects={projects}
          selectedId={projectId}
          onSelect={chooseProject}
          onCreate={() => void createProject()}
          onClose={() => setPickingProject(false)}
        />
      )}
    </>
  );
}
