import { useEffect, useState, type FormEvent } from "react";
import { DateSelector } from "../../components/date-selector";
import { useClientsStore } from "../../stores/clients-store";
import {
  useProductsStore,
  type Product,
  type SessionProductItem,
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
  "inline-flex items-center rounded-pill border border-line-strong px-3.5 py-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg";

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

function formatIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTimestamp(value: string) {
  return value.replace("T", " ").slice(0, 16);
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
  const currentYear = new Date().getFullYear();

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
      clientId: text("clientId").trim(),
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
    setSaving(true);
    setError(null);
    try {
      const saved = session ? await update(session.id, input) : await create(input);
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
      className="mx-auto flex max-w-xl flex-col gap-4 px-8 py-10"
    >
      <div>
        <button
          type="button"
          onClick={() => onDone()}
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
      </label>

      <div>
        <label htmlFor="session-date" className={labelClass}>
          Date *
        </label>
        <DateSelector
          id="session-date"
          value={date}
          onChange={setDate}
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
        <textarea name="notes" rows={3} defaultValue={session?.notes ?? ""} className={fieldClass} />
      </label>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={() => onDone()} className={btnGhost}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function SessionProducts({ sessionId }: { sessionId: string }) {
  const { listSessionProducts, listLinkable, linkToSession } = useProductsStore();
  const [linked, setLinked] = useState<SessionProductItem[]>([]);
  const [linkable, setLinkable] = useState<Product[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  async function refreshLinked() {
    const items = await listSessionProducts(sessionId);
    setLinked(items);
  }

  async function refreshLinkable(search = pickerSearch) {
    const items = await listLinkable(sessionId, search);
    setLinkable(items);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listSessionProducts(sessionId)
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
  }, [listSessionProducts, sessionId]);

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

  async function link(productId: string) {
    setLinking(true);
    setError(null);
    try {
      await linkToSession(sessionId, productId);
      await refreshLinked();
      await refreshLinkable();
    } catch (linkError) {
      setError(String(linkError));
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
            Traçabilité : les liens ne se suppriment pas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className={btnGhost}
        >
          {pickerOpen ? "Fermer" : "Lier un produit"}
        </button>
      </div>

      {error && <p className="mb-2 text-[13px] text-danger">{error}</p>}

      {pickerOpen && (
        <div className="mb-3 rounded-lg border border-line bg-surface p-3">
          <input
            type="search"
            placeholder="Rechercher un produit…"
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            className={fieldClass}
          />
          {linkable.length === 0 ? (
            <p className="mt-3 text-center text-[13px] text-fg-muted">
              Aucun produit disponible à lier.
            </p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-y-auto">
              {linkable.map((product) => (
                <li
                  key={product.id}
                  className="flex items-center gap-2 border-t border-line py-2 first:border-t-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">
                      {product.name}
                    </span>
                    <span className="block truncate text-[12px] text-fg-muted">
                      Lot {product.lotNumber}
                      {" · "}
                      {product.singleUse ? "Unique" : "Encre"}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={linking}
                    onClick={() => void link(product.id)}
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
              key={`${item.productId}-${item.createdAt}`}
              className={index > 0 ? "border-t border-line px-4 py-3" : "px-4 py-3"}
            >
              <p className="text-[14px] font-medium">{item.name}</p>
              <p className="mt-0.5 text-[12.5px] text-fg-muted">
                Lot {item.lotNumber}
                {" · "}
                {item.singleUse ? "Unique" : "Encre"}
                {" · exp. "}
                {formatIsoDate(item.expirationDate)}
              </p>
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
          <h1 className="text-[24px] font-medium tracking-tight">
            {session.bodyArea ?? "Séance"}
          </h1>
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
      <SessionProducts sessionId={session.id} />
    </div>
  );
}

export default function SessionsPage() {
  const { sessions, search, loading, error, load } = useSessionsStore();
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
        onEdit={() => setView({ kind: "form", session: view.session })}
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
