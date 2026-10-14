import { useEffect, useState, type FormEvent } from "react";
import { useConfirm } from "../../components/use-confirm";
import { DateSelector } from "../../components/date-selector";
import { formatIsoDate, formatTimestamp } from "../../lib/format";
import type { FormKind, Paperwork } from "../../stores/paperwork-store";
import { ConsentFormView } from "./consent-form";
import { HealthFormView } from "./health-form";
import { SessionPaperwork } from "./session-paperwork";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { useClientsStore } from "../../stores/clients-store";
import {
  useProductsStore,
  type LinkableItem,
  type SessionUsageItem,
} from "../../stores/products-store";
import {
  useSessionsStore,
  type SessionInput,
  type SessionListItem,
  type SessionStatus,
} from "../../stores/sessions-store";

type View =
  | { kind: "list" }
  | { kind: "form"; session?: SessionListItem }
  | { kind: "detail"; session: SessionListItem };

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

const fieldClass =
  "mt-1.5 w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[14px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-faint focus:border-accent";
const labelClass = "block text-[12.5px] font-medium text-fg-muted";
const btnPrimary =
  "inline-flex items-center rounded-pill bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-fg transition-[filter] hover:brightness-110 disabled:opacity-45";
const btnGhost =
  "inline-flex items-center rounded-pill border border-line-strong px-3.5 py-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-45";

const STATUS_LABELS: Record<SessionStatus, string> = {
  PLANNED: "Planifiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  RESCHEDULED: "Reportée",
};

const STATUS_BADGE: Record<SessionStatus, string> = {
  PLANNED: "bg-info/15 text-info",
  COMPLETED: "bg-success/15 text-success",
  CANCELLED: "bg-fg-faint/15 text-fg-muted",
  RESCHEDULED: "bg-warning/15 text-warning",
};

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-[12px] font-medium ${STATUS_BADGE[status]}`}
    >
      <i className="size-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

function clientName(session: SessionListItem) {
  return `${session.clientFirstName} ${session.clientLastName}`;
}

function SessionForm({
  session,
  onDone,
}: {
  session?: SessionListItem;
  onDone: (saved?: SessionListItem) => void;
}) {
  const { create, update } = useSessionsStore();
  const { clients, load: loadClients } = useClientsStore();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState<string | null>(session?.date ?? null);
  const [dirty, setDirty] = useState(false);
  /** Séance avec produits liés : le client est figé (règle vérifiée en Rust). */
  const clientLocked = (session?.usageCount ?? 0) > 0;
  const confirm = useConfirm();
  const guardedLeave = useGuardedLeave();
  const currentYear = new Date().getFullYear();
  useUnsavedChanges(dirty);

  useEffect(() => {
    void loadClients("");
  }, [loadClients]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    const status = text("status") as SessionStatus;
    if (!date) {
      setError("La date est obligatoire");
      return;
    }
    const input: SessionInput = {
      clientId: clientLocked && session ? session.clientId : text("clientId").trim(),
      date,
      status,
      bodyArea: emptyToNull(text("bodyArea")),
      description: emptyToNull(text("description")),
      notes: emptyToNull(text("notes")),
    };
    if (!input.clientId) {
      setError("Le client est obligatoire");
      return;
    }
    if ((status === "CANCELLED" || status === "RESCHEDULED") && status !== session?.status) {
      const client = clients.find((item) => item.id === input.clientId);
      const ok = await confirm({
        title:
          status === "CANCELLED"
            ? "Marquer cette séance comme annulée ?"
            : "Marquer cette séance comme reportée ?",
        details: [
          client ? `${client.firstName} ${client.lastName}` : "Client",
          formatIsoDate(date),
          ...(input.bodyArea ? [input.bodyArea] : []),
        ],
        body:
          status === "CANCELLED"
            ? "La séance reste dans l'historique avec le statut « Annulée »."
            : "La séance reste dans l'historique avec le statut « Reportée ». Crée une nouvelle séance pour la nouvelle date.",
        confirmLabel: status === "CANCELLED" ? "Annuler la séance" : "Reporter la séance",
        cancelLabel: "Retour",
        tone: status === "CANCELLED" ? "danger" : "default",
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = session ? await update(session.id, input) : await create(input);
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
      onInput={(event) => {
        if ((event.target as HTMLElement).getAttribute("name")) setDirty(true);
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
          name="clientId"
          required
          defaultValue={session?.clientId ?? ""}
          disabled={clientLocked}
          className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted`}
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
            Des produits sont liés à cette séance : elle reste attachée à ce client pour la
            traçabilité.
          </span>
        )}
      </label>

      <div>
        <label htmlFor="session-date" className={labelClass}>
          Date *
        </label>
        <DateSelector
          id="session-date"
          value={date}
          onChange={(value) => {
            setDate(value);
            setDirty(true);
          }}
          placeholder="Choisir la date de séance"
          minYear={currentYear - 10}
          maxYear={currentYear + 2}
        />
      </div>

      <label className={labelClass}>
        Statut *
        <select
          name="status"
          required
          defaultValue={session?.status ?? "PLANNED"}
          className={fieldClass}
        >
          {(Object.keys(STATUS_LABELS) as SessionStatus[]).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Zone du corps
        <input
          name="bodyArea"
          defaultValue={session?.bodyArea ?? ""}
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

function SessionProducts({ session }: { session: SessionListItem }) {
  const sessionId = session.id;
  const { listSessionUsages, listLinkable, linkToSession, voidUsage } = useProductsStore();
  const confirm = useConfirm();
  const [linked, setLinked] = useState<SessionUsageItem[]>([]);
  const [linkable, setLinkable] = useState<LinkableItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  async function refreshLinked() {
    const items = await listSessionUsages(sessionId);
    setLinked(items);
  }

  async function refreshLinkable(search = pickerSearch) {
    const items = await listLinkable(sessionId, search);
    setLinkable(items);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listSessionUsages(sessionId)
      .then((items) => {
        if (!cancelled) {
          setLinked(items);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listSessionUsages, sessionId]);

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    void listLinkable(sessionId, pickerSearch)
      .then((items) => {
        if (!cancelled) setLinkable(items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [listLinkable, pickerOpen, pickerSearch, sessionId]);

  async function link(item: LinkableItem) {
    let quantity: number | null = null;
    if (item.singleUse) {
      quantity = Number(quantities[item.lotId] ?? "1");
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setError("La quantité consommée doit être un nombre positif");
        return;
      }
      if (quantity > item.stock) {
        setError(`Stock insuffisant : ${item.stock} restant${item.stock > 1 ? "s" : ""}`);
        return;
      }
    }
    const ok = await confirm({
      title: "Lier ce produit à la séance ?",
      details: [
        `${item.name} · lot ${item.lotNumber}`,
        item.singleUse
          ? `Usage unique · ${quantity} retiré${quantity && quantity > 1 ? "s" : ""} du stock (${item.stock} → ${item.stock - (quantity ?? 0)})`
          : `Usage multiple · pièce ${item.openedAt ? `ouverte le ${formatIsoDate(item.openedAt)}` : "scellée"}`,
        `Séance : ${clientName(session)} · ${formatIsoDate(session.date)}`,
      ],
      body: "Le lien restera dans l'historique de traçabilité : il ne pourra pas être supprimé.",
      warning: item.expired
        ? item.openedAt
          ? `Limite d'utilisation dépassée : à utiliser jusqu'au ${formatIsoDate(item.usefulUntil)} (ouverture + durée après ouverture, ou péremption).`
          : `Lot périmé : date de péremption ${formatIsoDate(item.expirationDate)}.`
        : undefined,
      confirmLabel: item.expired ? "Lier quand même" : "Lier à la séance",
      cancelLabel: "Retour",
      tone: item.expired ? "danger" : "default",
    });
    if (!ok) return;
    setLinking(true);
    setError(null);
    try {
      await linkToSession({
        sessionId,
        lotId: item.singleUse ? item.lotId : null,
        unitId: item.unitId,
        quantity,
      });
      await refreshLinked();
      await refreshLinkable();
    } catch (linkError) {
      setError(String(linkError));
    } finally {
      setLinking(false);
    }
  }

  async function cancelLink(item: SessionUsageItem) {
    const result = await confirm({
      title: "Annuler ce lien ?",
      details: [
        `${item.name} · lot ${item.lotNumber}`,
        item.singleUse
          ? `Usage unique · ${item.quantity} remis en stock`
          : "Usage multiple · le stock ne change pas",
        `Séance : ${clientName(session)} · ${formatIsoDate(session.date)}`,
      ],
      body: "Le lien reste visible dans l'historique, barré, avec le motif. Il ne pourra pas être rétabli : il faudra lier un autre lot ou une autre pièce.",
      reason: {
        label: "Motif",
        required: true,
        placeholder: "Ex. mauvais lot sélectionné",
      },
      confirmLabel: "Annuler le lien",
      cancelLabel: "Garder le lien",
      tone: "danger",
    });
    if (!result?.reason) return;
    setLinking(true);
    setError(null);
    try {
      await voidUsage(item.id, result.reason);
      await refreshLinked();
      if (pickerOpen) await refreshLinkable();
    } catch (voidError) {
      setError(String(voidError));
    } finally {
      setLinking(false);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium">Produits utilisés</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            Traçabilité : un lien ne se supprime pas, il s&apos;annule avec un motif.
          </p>
        </div>
        <button type="button" onClick={() => setPickerOpen((open) => !open)} className={btnGhost}>
          {pickerOpen ? "Fermer" : "Lier un produit"}
        </button>
      </div>

      {error && <p className="mb-2 text-[13px] text-danger">{error}</p>}

      {pickerOpen && (
        <div className="mb-3 rounded-lg border border-line bg-surface p-3">
          <input
            type="search"
            placeholder="Rechercher un lot…"
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            className={fieldClass}
          />
          {linkable.length === 0 ? (
            <p className="mt-3 text-center text-[13px] text-fg-muted">
              Aucun produit disponible à lier.
            </p>
          ) : (
            <ul className="mt-2 max-h-64 overflow-y-auto">
              {linkable.map((item) => (
                <li
                  key={item.unitId ?? item.lotId}
                  className="flex items-center gap-2 border-t border-line py-2 first:border-t-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{item.name}</span>
                    <span className="block truncate text-[12px] text-fg-muted">
                      Lot {item.lotNumber}
                      {" · "}
                      {item.singleUse
                        ? `${item.stock} restant${item.stock > 1 ? "s" : ""}`
                        : item.openedAt
                          ? "Ouvert"
                          : "Scellé"}
                      {item.expired ? " · Périmé" : ""}
                    </span>
                  </span>
                  {item.singleUse && (
                    <input
                      type="number"
                      min={1}
                      step={1}
                      aria-label={`Quantité pour ${item.name}`}
                      value={quantities[item.lotId] ?? "1"}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [item.lotId]: event.target.value,
                        }))
                      }
                      className="w-16 rounded-md border border-line-strong bg-bg px-2 py-1 text-[13px] text-fg"
                    />
                  )}
                  <button
                    type="button"
                    disabled={linking}
                    onClick={() => void link(item)}
                    className={btnPrimary}
                  >
                    Lier
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-fg-muted">Chargement…</p>
      ) : linked.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[13px] text-fg-muted">
          Aucun produit lié à cette séance.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {linked.map((item, index) => (
            <li
              key={item.id}
              className={index > 0 ? "border-t border-line px-4 py-3" : "px-4 py-3"}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[14px] font-medium ${item.voidReason ? "text-fg-muted line-through" : ""}`}
                  >
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-fg-muted">
                    Lot {item.lotNumber}
                    {" · "}
                    {item.singleUse
                      ? item.voidReason
                        ? "Usage unique"
                        : `Usage unique · ${item.quantity}`
                      : item.openedAt
                        ? "Usage multiple · ouvert"
                        : "Usage multiple · scellé"}
                    {" · à utiliser jusqu'au "}
                    {formatIsoDate(item.usefulUntil)}
                  </p>
                  {item.voidReason ? (
                    <p className="mt-1 text-[12.5px] text-fg-muted">
                      Lien annulé
                      {item.voidedAt ? ` le ${formatTimestamp(item.voidedAt)}` : ""} :{" "}
                      {item.voidReason}
                    </p>
                  ) : (
                    item.expired && (
                      <p className="mt-1 text-[12.5px] text-warning">
                        <span aria-hidden="true">⚠︎ </span>
                        Périmé à la date de la séance.
                      </p>
                    )
                  )}
                </div>
                {!item.voidReason && (
                  <button
                    type="button"
                    disabled={linking}
                    onClick={() => void cancelLink(item)}
                    className={btnGhost}
                  >
                    Annuler le lien
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionDetail({
  session,
  onEdit,
  onBack,
}: {
  session: SessionListItem;
  onEdit: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState<{ kind: FormKind; paperwork: Paperwork } | null>(null);
  const [paperworkVersion, setPaperworkVersion] = useState(0);

  if (form) {
    const close = () => {
      setForm(null);
      setPaperworkVersion((version) => version + 1);
    };
    return form.kind === "HEALTH" ? (
      <HealthFormView paperwork={form.paperwork} onDone={close} />
    ) : (
      <ConsentFormView paperwork={form.paperwork} onDone={close} />
    );
  }

  const rows: [string, string | null][] = [
    ["Client", clientName(session)],
    ["Date", formatIsoDate(session.date)],
    ["Statut", STATUS_LABELS[session.status]],
    ["Zone", session.bodyArea],
    ["Description", session.description],
    ["Notes", session.notes],
    ["Créé le", formatTimestamp(session.createdAt)],
    ["Modifié le", formatTimestamp(session.updatedAt)],
  ];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-8 py-10">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-[13px] text-fg-muted hover:text-fg"
      >
        ← Séances
      </button>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2">
            <StatusBadge status={session.status} />
          </div>
          <h1 className="text-[24px] font-medium tracking-tight">{session.bodyArea ?? "Séance"}</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {clientName(session)} · {formatIsoDate(session.date)}
          </p>
        </div>
        <button type="button" onClick={onEdit} className={btnPrimary}>
          Modifier
        </button>
      </div>
      <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-[13.5px]">
            <dt className="text-fg-faint">{label}</dt>
            <dd className="whitespace-pre-wrap text-fg">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <SessionPaperwork
        key={paperworkVersion}
        sessionId={session.id}
        onOpenForm={(kind, paperwork) => setForm({ kind, paperwork })}
      />
      <SessionProducts session={session} />
    </div>
  );
}

export default function SessionsPage() {
  const { sessions, search, loading, error, load, get: getSession } = useSessionsStore();
  const [view, setView] = useState<View>({ kind: "list" });

  useEffect(() => {
    void load("");
  }, [load]);

  if (view.kind === "form") {
    return (
      <SessionForm
        session={view.session}
        onDone={(saved) =>
          setView(
            saved
              ? { kind: "detail", session: saved }
              : view.session
                ? { kind: "detail", session: view.session }
                : { kind: "list" },
          )
        }
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <SessionDetail
        session={view.session}
        onEdit={() => {
          // Recharger : des produits ont pu être liés depuis l'ouverture de la fiche.
          const current = view.session;
          void getSession(current.id)
            .then((fresh) => setView({ kind: "form", session: fresh }))
            .catch(() => setView({ kind: "form", session: current }));
        }}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-medium tracking-tight">Séances</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {loading
              ? "Chargement…"
              : `${sessions.length} séance${sessions.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button type="button" onClick={() => setView({ kind: "form" })} className={btnPrimary}>
          Nouvelle séance
        </button>
      </div>

      <input
        type="search"
        placeholder="Rechercher (client, zone, notes)…"
        value={search}
        onChange={(event) => void load(event.target.value)}
        className={fieldClass}
      />

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {!loading && sessions.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-5 py-10 text-center">
          <p className="text-[14px] text-fg-muted">
            {search ? "Aucun résultat." : "Aucune séance pour le moment."}
          </p>
          {!search && (
            <button
              type="button"
              onClick={() => setView({ kind: "form" })}
              className={`${btnGhost} mt-4`}
            >
              Créer la première séance
            </button>
          )}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {sessions.map((session, index) => (
            <li key={session.id} className={index > 0 ? "border-t border-line" : undefined}>
              <button
                type="button"
                onClick={() => setView({ kind: "detail", session })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] font-medium">{clientName(session)}</span>
                    <StatusBadge status={session.status} />
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">
                    {formatIsoDate(session.date)}
                    {session.bodyArea ? ` · ${session.bodyArea}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
