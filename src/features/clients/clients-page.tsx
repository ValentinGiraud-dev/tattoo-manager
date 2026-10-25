import { useEffect, useState, type FormEvent } from "react";
import { DateSelector } from "../../components/date-selector";
import { DataTable } from "../../components/data-table";
import { formatTimestamp, formatWeekdayDate } from "../../lib/format";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import {
  useClientsStore,
  type Client,
  type ClientInput,
  type ClientListItem,
} from "../../stores/clients-store";
import { ClientHistory } from "./client-history";
import { AuditHistory } from "../journal/audit-history";
import { ClientProjects } from "./client-projects";
import { toast } from "../../stores/toast-store";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { BackButton } from "../../components/back-button";
import { ArchiveBanner, ArchiveFilter } from "../../components/archive-controls";
import { useConfirm } from "../../components/use-confirm";
import { useUIStore } from "../../stores/ui-store";

type View = { kind: "list" } | { kind: "editor"; client?: Client };

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

function blank(value: string | null): string {
  const text = value?.trim() ?? "";
  return text === "" ? "—" : text;
}

function sessionLabel(count: number): string {
  return `${count} séance${count === 1 ? "" : "s"}`;
}

function latestUpdatedAt(clients: ClientListItem[]): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const client of clients) {
    const utc = /[zZ]|[+-]\d{2}:\d{2}$/.test(client.updatedAt)
      ? client.updatedAt
      : `${client.updatedAt}Z`;
    const time = new Date(utc).getTime();
    if (!Number.isNaN(time) && time > latestTime) {
      latestTime = time;
      latest = client.updatedAt;
    }
  }
  return latest;
}

function ClientEditor({
  client,
  onBack,
  onSaved,
}: {
  client?: Client;
  onBack: () => void;
  onSaved: (client: Client) => void;
}) {
  const { create, update, remove, archive, restore, previewRemoval, get } = useClientsStore();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [action, setAction] = useState<"delete" | "archive" | null>(null);
  const guardedLeave = useGuardedLeave();
  useUnsavedChanges(dirty);
  const archived = client?.archivedAt != null;

  useEffect(() => {
    if (!client || archived) return;
    let cancelled = false;
    previewRemoval(client.id)
      .then((preview) => {
        if (!cancelled) setAction(preview.canDelete ? "delete" : "archive");
      })
      .catch(() => {
        if (!cancelled) setAction(null);
      });
    return () => {
      cancelled = true;
    };
  }, [archived, client, previewRemoval]);

  function leave() {
    void guardedLeave(onBack);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (archived) return;
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
      onSaved(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function removeOrArchive() {
    if (!client) return;
    setActionError(null);
    const name = `${client.firstName} ${client.lastName}`;
    let preview;
    try {
      preview = await previewRemoval(client.id);
    } catch (previewError) {
      setActionError(String(previewError));
      return;
    }
    if (preview.canDelete) {
      const ok = await confirm({
        title: "Supprimer ce client ?",
        details: [name],
        body: "La fiche sera supprimée définitivement. Cette action est irréversible.",
        confirmLabel: "Supprimer le client",
        tone: "danger",
        typeToConfirm: "SUPPRIMER",
      });
      if (!ok) return;
      setBusy(true);
      try {
        await remove(client.id);
        toast.success("Client supprimé");
        onBack();
      } catch (deleteError) {
        setActionError(String(deleteError));
        setBusy(false);
      }
      return;
    }
    const stock =
      preview.stock.length === 0
        ? "Aucun stock à usage unique n'est remis."
        : preview.stock
            .map((line) => `${line.name} · lot ${line.lotNumber} · ${line.quantity} remis`)
            .join(", ");
    const ok = await confirm({
      title: "Archiver ce client ?",
      details: [
        name,
        `${preview.sessions.length} séance${preview.sessions.length > 1 ? "s" : ""}`,
        `${preview.projects.length} projet${preview.projects.length > 1 ? "s" : ""}`,
        stock,
      ],
      body: "Il quitte les listes, le planning et les sélecteurs. Ses séances restent dans son historique, avec la mention « client archivé ». Le stock à usage unique consommé est remis.",
      confirmLabel: "Archiver le client",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await archive(client.id);
      toast.success("Client archivé");
      onBack();
    } catch (archiveError) {
      setActionError(String(archiveError));
      setBusy(false);
    }
  }

  async function unarchive() {
    if (!client) return;
    const ok = await confirm({
      title: "Désarchiver ce client ?",
      body: "Il revient dans les listes. Le stock remis à l'archivage est de nouveau décompté, si le stock suffit.",
      confirmLabel: "Désarchiver",
    });
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    try {
      await restore(client.id);
      const fresh = await get(client.id);
      toast.success("Client désarchivé");
      onSaved(fresh);
    } catch (restoreError) {
      setActionError(String(restoreError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-10">
      <div>
        <h1 className="text-[16px] font-medium tracking-tight">
          {client ? `${client.firstName} ${client.lastName}` : "Nouveau client"}
        </h1>
        <div className="mt-1">
          <BackButton listLabel="Clients" onList={leave} />
        </div>
      </div>

      {archived && (
        <ArchiveBanner>
          Archivé. Cette fiche est en lecture seule. Désarchive-la pour la modifier.
        </ArchiveBanner>
      )}

      <div className="grid items-start gap-10 lg:grid-cols-2">
        <form
          onSubmit={(event) => void submit(event)}
          onInput={(event) => {
            if ((event.target as HTMLElement).getAttribute("name")) setDirty(true);
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Nom *
              <input
                name="lastName"
                required
                disabled={archived}
                defaultValue={client?.lastName}
                className={fieldClass}
              />
            </label>
            <label className={labelClass}>
              Prénom *
              <input
                name="firstName"
                required
                disabled={archived}
                defaultValue={client?.firstName}
                className={fieldClass}
              />
            </label>
          </div>

          <div>
            <label htmlFor="client-birth-date" className={labelClass}>
              Date de naissance
            </label>
            <DateSelector
              id="client-birth-date"
              name="birthDate"
              disabled={archived}
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
              disabled={archived}
              defaultValue={client?.address ?? ""}
              placeholder="Demandée par le consentement"
              className={fieldClass}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Email
              <input
                name="email"
                type="email"
                disabled={archived}
                defaultValue={client?.email ?? ""}
                className={fieldClass}
              />
            </label>
            <label className={labelClass}>
              Téléphone
              <input
                name="phone"
                type="tel"
                disabled={archived}
                defaultValue={client?.phone ?? ""}
                className={fieldClass}
              />
            </label>
          </div>
          <label className={labelClass}>
            Notes
            <textarea
              name="notes"
              rows={4}
              disabled={archived}
              defaultValue={client?.notes ?? ""}
              className={fieldClass}
            />
          </label>

          {error && <p className="text-[13px] text-danger">{error}</p>}

          {!archived && (
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

        <ClientHistory
          key={client?.id ?? "new"}
          clientId={client?.id}
          canAdd={client !== undefined && !archived}
        />
      </div>

      {client && (
        <div className="flex flex-col gap-8 border-t border-line pt-8">
          <AuditHistory key={`audit-${client.id}`} target={{ kind: "client", id: client.id }} />
          <ClientProjects
            key={`projects-${client.id}`}
            clientId={client.id}
            clientArchived={archived}
          />
          {actionError && <p className="text-[13px] text-danger">{actionError}</p>}
          <div>
            {archived ? (
              <button
                type="button"
                onClick={() => void unarchive()}
                disabled={busy}
                className={btnPrimary}
              >
                {busy ? "Désarchivage…" : "Désarchiver"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void removeOrArchive()}
                disabled={busy}
                className={btnGhost}
              >
                <span className="text-danger">
                  {busy ? "En cours…" : action === "delete" ? "Supprimer" : "Archiver"}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ClientTable({
  clients,
  pageResetKey,
  onOpen,
  onEdit,
}: {
  clients: ClientListItem[];
  pageResetKey: string;
  onOpen: (client: ClientListItem) => void;
  onEdit: (client: ClientListItem) => void;
}) {
  return (
    <DataTable
      label="Clients"
      rows={clients}
      rowKey={(client) => client.id}
      rowLabel={(client) => `${client.firstName} ${client.lastName}`}
      pageResetKey={pageResetKey}
      onRowClick={onOpen}
      rowActions={(client) => [
        { id: "open", label: "Ouvrir", onSelect: () => onOpen(client) },
        { id: "edit", label: "Modifier", onSelect: () => onEdit(client) },
      ]}
      columns={[
        {
          id: "name",
          header: "Nom du client",
          className: "w-[20%]",
          cell: (client) => (
            <span className="text-fg">{`${client.firstName} ${client.lastName}`}</span>
          ),
        },
        {
          id: "email",
          header: "Adresse mail",
          className: "w-[22%]",
          cell: (client) => blank(client.email),
        },
        {
          id: "phone",
          header: "Numéro de téléphone",
          className: "w-[22%]",
          cell: (client) => blank(client.phone),
        },
        {
          id: "created",
          header: "Créé le",
          className: "w-[16%]",
          cell: (client) => formatTimestamp(client.createdAt),
        },
        {
          id: "sessions",
          header: "Séances",
          className: "w-[12%]",
          cell: (client) => sessionLabel(client.sessionCount),
        },
      ]}
    />
  );
}

export default function ClientsPage() {
  const { clients, search, showArchived, loading, error, load, get: getClient } = useClientsStore();
  const [view, setView] = useState<View>({ kind: "list" });
  const clientIntent = useUIStore((state) => state.clientIntent);
  const takeClientIntent = useUIStore((state) => state.takeClientIntent);
  const setDetail = useUIStore((state) => state.setDetail);
  const detailId = view.kind === "editor" ? (view.client?.id ?? null) : null;

  // Client demandé depuis un autre écran (séance, accueil…).
  useEffect(() => {
    if (!clientIntent) return;
    const clientId = takeClientIntent();
    if (!clientId) return;
    void getClient(clientId)
      .then((client) => setView({ kind: "editor", client }))
      .catch(() => setView({ kind: "list" }));
  }, [clientIntent, takeClientIntent, getClient]);

  useEffect(() => {
    setDetail(detailId ? { kind: "client", id: detailId } : null);
  }, [detailId, setDetail]);

  useEffect(() => {
    void load("");
  }, [load]);

  if (view.kind === "editor") {
    return (
      <ClientEditor
        key={view.client?.id ?? "new"}
        client={view.client}
        onBack={() => setView({ kind: "list" })}
        onSaved={(saved) => setView({ kind: "editor", client: saved })}
      />
    );
  }

  const updatedAt = latestUpdatedAt(clients);
  const subtitle =
    loading && clients.length === 0
      ? "Chargement…"
      : updatedAt
        ? `Dernière mise à jour - ${formatWeekdayDate(updatedAt)}`
        : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <div>
        <h1 className="text-[16px] font-medium tracking-tight">Mes clients</h1>
        {subtitle ? <p className="mt-0.5 text-[12.5px] text-fg-faint">{subtitle}</p> : null}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <input
            type="search"
            aria-label="Rechercher un client"
            placeholder="Recherche"
            value={search}
            onChange={(event) => void load(event.target.value)}
            className="w-64 rounded-md border border-line-strong bg-bg px-3 py-2 text-[14px] text-fg transition-[border-color,box-shadow] outline-none placeholder:text-fg-faint focus:border-accent"
          />
          <ArchiveFilter
            archived={showArchived}
            onChange={(archived) => void load(search, archived)}
          />
        </div>
        {!showArchived && (
          <button type="button" onClick={() => setView({ kind: "editor" })} className={btnPrimary}>
            Ajouter un client
          </button>
        )}
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {!loading && clients.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-5 py-10 text-center">
          <p className="text-[14px] text-fg-muted">
            {search
              ? "Aucun résultat."
              : showArchived
                ? "Aucun client archivé."
                : "Aucun client pour le moment."}
          </p>
          {!search && !showArchived && (
            <button
              type="button"
              onClick={() => setView({ kind: "editor" })}
              className={`${btnGhost} mt-4`}
            >
              Créer le premier client
            </button>
          )}
        </div>
      ) : clients.length > 0 ? (
        <ClientTable
          clients={clients}
          pageResetKey={`${search}\0${String(showArchived)}`}
          onOpen={(client) => setView({ kind: "editor", client })}
          onEdit={(client) => setView({ kind: "editor", client })}
        />
      ) : null}
    </div>
  );
}
