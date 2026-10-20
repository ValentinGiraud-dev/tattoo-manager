import { useEffect, useState, type FormEvent } from "react";
import { DateSelector } from "../../components/date-selector";
import { formatIsoDate, formatTimestamp } from "../../lib/format";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { useClientsStore, type Client, type ClientInput } from "../../stores/clients-store";
import { ClientHistory } from "./client-history";
import { AuditHistory } from "../journal/audit-history";
import { ClientProjects } from "./client-projects";
import { toast } from "../../stores/toast-store";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { BackButton } from "../../components/back-button";
import { useUIStore } from "../../stores/ui-store";

type View =
  { kind: "list" } | { kind: "form"; client?: Client } | { kind: "detail"; client: Client };

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

function initials(client: Client) {
  return `${client.firstName.charAt(0)}${client.lastName.charAt(0)}`.toUpperCase();
}

function ClientForm({ client, onDone }: { client?: Client; onDone: (saved?: Client) => void }) {
  const { create, update } = useClientsStore();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const guardedLeave = useGuardedLeave();
  useUnsavedChanges(dirty);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    const input: ClientInput = {
      firstName: text("firstName").trim(),
      lastName: text("lastName").trim(),
      birthDate: emptyToNull(text("birthDate")),
      address: emptyToNull(text("address")),
      email: emptyToNull(text("email")),
      phone: emptyToNull(text("phone")),
      notes: emptyToNull(text("notes")),
    };
    setSaving(true);
    setError(null);
    try {
      const saved = client ? await update(client.id, input) : await create(input);
      setDirty(false);
      toast.success(client ? "Fiche client enregistrée" : "Client créé");
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
          {client ? "Modifier le client" : "Nouveau client"}
        </h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Prénom *
          <input
            name="firstName"
            required
            defaultValue={client?.firstName}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Nom *
          <input name="lastName" required defaultValue={client?.lastName} className={fieldClass} />
        </label>
      </div>

      <div>
        <label htmlFor="client-birth-date" className={labelClass}>
          Date de naissance
        </label>
        <DateSelector
          id="client-birth-date"
          name="birthDate"
          defaultValue={client?.birthDate ?? null}
          onChange={() => setDirty(true)}
          placeholder="Choisir une date de naissance"
        />
      </div>
      <label className={labelClass}>
        Adresse
        <textarea
          name="address"
          rows={2}
          defaultValue={client?.address ?? ""}
          placeholder="Demandée par le consentement"
          className={fieldClass}
        />
      </label>
      <label className={labelClass}>
        Email
        <input
          name="email"
          type="email"
          defaultValue={client?.email ?? ""}
          className={fieldClass}
        />
      </label>
      <label className={labelClass}>
        Téléphone
        <input name="phone" type="tel" defaultValue={client?.phone ?? ""} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Notes
        <textarea name="notes" rows={4} defaultValue={client?.notes ?? ""} className={fieldClass} />
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

function ClientDetail({
  client,
  onEdit,
  onBack,
}: {
  client: Client;
  onEdit: () => void;
  onBack: () => void;
}) {
  const rows: [string, string | null][] = [
    ["Date de naissance", client.birthDate ? formatIsoDate(client.birthDate) : null],
    ["Adresse", client.address],
    ["Email", client.email],
    ["Téléphone", client.phone],
    ["Notes", client.notes],
    ["Créé le", formatTimestamp(client.createdAt)],
    ["Modifié le", formatTimestamp(client.updatedAt)],
  ];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-8 py-10">
      <BackButton listLabel="Clients" onList={onBack} />
      <div className="flex items-start gap-4">
        <span className="grid size-12 place-items-center rounded-md border border-line bg-surface-2 text-[14px] font-medium text-fg-muted">
          {initials(client)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-medium tracking-tight">
            {client.firstName} {client.lastName}
          </h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {[client.email, client.phone].filter(Boolean).join(" · ") || "Aucun contact"}
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
      <ClientProjects key={`projects-${client.id}`} clientId={client.id} />
      <ClientHistory key={client.id} clientId={client.id} />
      <AuditHistory key={`audit-${client.id}`} target={{ kind: "client", id: client.id }} />
    </div>
  );
}

export default function ClientsPage() {
  const { clients, search, loading, error, load, get: getClient } = useClientsStore();
  const [view, setView] = useState<View>({ kind: "list" });
  const clientIntent = useUIStore((state) => state.clientIntent);
  const takeClientIntent = useUIStore((state) => state.takeClientIntent);
  const setDetail = useUIStore((state) => state.setDetail);
  const detailId = view.kind === "detail" ? view.client.id : null;

  // Client demandé depuis un autre écran (séance, accueil…).
  useEffect(() => {
    if (!clientIntent) return;
    const clientId = takeClientIntent();
    if (!clientId) return;
    void getClient(clientId)
      .then((client) => setView({ kind: "detail", client }))
      .catch(() => setView({ kind: "list" }));
  }, [clientIntent, takeClientIntent, getClient]);

  useEffect(() => {
    setDetail(detailId ? { kind: "client", id: detailId } : null);
  }, [detailId, setDetail]);

  useEffect(() => {
    void load("");
  }, [load]);

  if (view.kind === "form") {
    return (
      <ClientForm
        client={view.client}
        onDone={(saved) =>
          setView(
            saved
              ? { kind: "detail", client: saved }
              : view.client
                ? { kind: "detail", client: view.client }
                : { kind: "list" },
          )
        }
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <ClientDetail
        client={view.client}
        onEdit={() => setView({ kind: "form", client: view.client })}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-medium tracking-tight">Clients</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {loading ? "Chargement…" : `${clients.length} client${clients.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button type="button" onClick={() => setView({ kind: "form" })} className={btnPrimary}>
          Nouveau client
        </button>
      </div>

      <input
        type="search"
        placeholder="Rechercher (nom, email, téléphone)…"
        value={search}
        onChange={(event) => void load(event.target.value)}
        className={fieldClass}
      />

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {!loading && clients.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-5 py-10 text-center">
          <p className="text-[14px] text-fg-muted">
            {search ? "Aucun résultat." : "Aucun client pour le moment."}
          </p>
          {!search && (
            <button
              type="button"
              onClick={() => setView({ kind: "form" })}
              className={`${btnGhost} mt-4`}
            >
              Créer le premier client
            </button>
          )}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {clients.map((client, index) => (
            <li key={client.id} className={index > 0 ? "border-t border-line" : undefined}>
              <button
                type="button"
                onClick={() => setView({ kind: "detail", client })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-[12px] font-medium text-fg-muted">
                  {initials(client)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    {client.lastName} {client.firstName}
                  </span>
                  <span className="block truncate text-[12.5px] text-fg-muted">
                    {client.email ?? client.phone ?? "—"}
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
