import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, fieldClass } from "../../components/styles";
import { useGuardedLeave } from "../../components/unsaved-changes";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate, formatTimestamp, formatWeekdayDate } from "../../lib/format";
import type { FormKind, Paperwork } from "../../stores/paperwork-store";
import {
  useProductsStore,
  type LinkableItem,
  type SessionUsageItem,
} from "../../stores/products-store";
import {
  useSessionsStore,
  type SessionListItem,
  type SessionStatus,
} from "../../stores/sessions-store";
import { useUIStore, type SessionFocus, type SessionIntent } from "../../stores/ui-store";
import { ConsentFormView } from "./consent-form";
import { HealthFormView } from "./health-form";
import { SessionBilling } from "./session-billing";
import { settleHeldDeposits } from "./session-status-flow";
import { lowStockAfterLink } from "../../lib/low-stock";
import { AuditHistory } from "../journal/audit-history";
import { SessionForm, type SessionDraft } from "./session-form";
import { SessionPaperwork } from "./session-paperwork";
import { DocumentStatus, StatusBadge } from "./session-status";
import { toast } from "../../stores/toast-store";
import { BackButton } from "../../components/back-button";
import { DataTable } from "../../components/data-table";
import { ArchiveBanner, ArchiveFilter, ArchiveMention } from "../../components/archive-controls";

type View =
  | { kind: "list" }
  | { kind: "editor"; session?: SessionListItem; draft?: SessionDraft; focus?: SessionFocus };

function clientName(session: SessionListItem) {
  return `${session.clientFirstName} ${session.clientLastName}`;
}

function blank(value: string | null): string {
  const text = value?.trim() ?? "";
  return text === "" ? "—" : text;
}

function sessionWhen(session: SessionListItem): string {
  const date = formatIsoDate(session.date);
  return session.startTime ? `${date} à ${session.startTime}` : date;
}

function latestUpdatedAt(sessions: SessionListItem[]): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const session of sessions) {
    const utc = /[zZ]|[+-]\d{2}:\d{2}$/.test(session.updatedAt)
      ? session.updatedAt
      : `${session.updatedAt}Z`;
    const time = new Date(utc).getTime();
    if (!Number.isNaN(time) && time > latestTime) {
      latestTime = time;
      latest = session.updatedAt;
    }
  }
  return latest;
}

/** Filtres de la liste, dans l'ordre de la capture. Les autres statuts restent dans la liste complète. */
const STATUS_FILTERS: { status: SessionStatus; label: string }[] = [
  { status: "PLANNED", label: "Planifier" },
  { status: "COMPLETED", label: "Terminer" },
  { status: "CANCELLED", label: "Annuler" },
];

function StatusFilters({
  selected,
  onToggle,
}: {
  selected: readonly SessionStatus[];
  onToggle: (status: SessionStatus) => void;
}) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Filtrer par statut">
      {STATUS_FILTERS.map((filter) => {
        const pressed = selected.includes(filter.status);
        return (
          <button
            key={filter.status}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(filter.status)}
            className={
              pressed
                ? "rounded-pill border border-fg bg-surface-3 px-3 py-1 text-[13px] font-medium text-fg"
                : "rounded-pill border border-line-strong px-3 py-1 text-[13px] text-fg-muted hover:text-fg"
            }
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}

function SessionTable({
  sessions,
  pageResetKey,
  onOpen,
  onEdit,
}: {
  sessions: SessionListItem[];
  pageResetKey: string;
  onOpen: (session: SessionListItem) => void;
  onEdit: (session: SessionListItem) => void;
}) {
  return (
    <DataTable
      label="Séances"
      rows={sessions}
      rowKey={(session) => session.id}
      rowLabel={(session) => clientName(session)}
      pageResetKey={pageResetKey}
      onRowClick={onOpen}
      rowActions={(session) => [
        { id: "open", label: "Ouvrir", onSelect: () => onOpen(session) },
        { id: "edit", label: "Modifier", onSelect: () => onEdit(session) },
      ]}
      columns={[
        {
          id: "client",
          header: "Nom du client",
          className: "w-[22%]",
          cell: (session) => <span className="text-fg">{clientName(session)}</span>,
        },
        {
          id: "when",
          header: "Date de la séance",
          className: "w-[22%]",
          cell: (session) => sessionWhen(session),
        },
        {
          id: "area",
          header: "Zone",
          className: "w-[20%]",
          cell: (session) => blank(session.bodyArea),
        },
        {
          id: "documents",
          header: "Documents",
          className: "w-[18%]",
          cell: (session) => (
            <DocumentStatus
              readiness={session.readiness}
              validatedAt={session.readinessValidatedAt}
            />
          ),
        },
        {
          id: "status",
          header: "Statut",
          className: "w-[14%]",
          cell: (session) => <StatusBadge status={session.status} />,
        },
      ]}
    />
  );
}

function SessionProducts({ session, readOnly }: { session: SessionListItem; readOnly?: boolean }) {
  const sessionId = session.id;
  const { listSessionUsages, listLinkable, linkToSession, voidUsage } = useProductsStore();
  const openLot = useUIStore((state) => state.openLot);
  const confirm = useConfirm();
  const [linked, setLinked] = useState<SessionUsageItem[]>([]);
  const [linkable, setLinkable] = useState<LinkableItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Chargé pour cette séance : pas d'état « chargement » à remettre à la main.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== sessionId;
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
        if (!cancelled) setLoadedFor(sessionId);
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
      warning:
        [
          item.expired
            ? item.openedAt
              ? `Limite d'utilisation dépassée : à utiliser jusqu'au ${formatIsoDate(item.usefulUntil)} (ouverture + durée après ouverture, ou péremption).`
              : `Lot périmé : date de péremption ${formatIsoDate(item.expirationDate)}.`
            : null,
          lowStockAfterLink(item, quantity),
        ]
          .filter(Boolean)
          .join(" ") || undefined,
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
      toast.success(`${item.name} lié à la séance`);
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
      toast.success("Lien annulé");
      await refreshLinked();
      if (pickerOpen) await refreshLinkable();
    } catch (voidError) {
      setError(String(voidError));
    } finally {
      setLinking(false);
    }
  }

  return (
    <section id="session-usages" className="scroll-mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium">Produits utilisés</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            Traçabilité : un lien ne se supprime pas, il s&apos;annule avec un motif.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className={btnGhost}
          hidden={readOnly}
        >
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
                    {item.lowStock && (
                      <span className="block text-[12px] text-warning">
                        <span aria-hidden="true">⚠︎ </span>
                        Stock bas : {item.productStock} restant
                        {(item.productStock ?? 0) > 1 ? "s" : ""} pour ce produit
                      </span>
                    )}
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
                  <button
                    type="button"
                    onClick={() => openLot(item.lotRef)}
                    className={`text-left text-[14px] font-medium underline-offset-2 hover:underline ${item.voidReason ? "text-fg-muted line-through" : ""}`}
                  >
                    {item.name}
                  </button>
                  {item.lotArchived && <ArchiveMention>lot archivé</ArchiveMention>}
                  {item.productArchived && <ArchiveMention>fiche archivée</ArchiveMention>}
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
                {!item.voidReason && !readOnly && (
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

function sessionTitle(session: SessionListItem): string {
  return session.title ?? session.projectTitle ?? session.bodyArea ?? "Séance";
}

function SessionEditor({
  session,
  draft,
  focus,
  onBack,
  onSaved,
}: {
  session?: SessionListItem;
  draft?: SessionDraft;
  focus?: SessionFocus;
  onBack: () => void;
  onSaved: (session: SessionListItem) => void;
}) {
  const [form, setForm] = useState<{ kind: FormKind; paperwork: Paperwork } | null>(null);
  const [paperworkVersion, setPaperworkVersion] = useState(0);
  const openClient = useUIStore((state) => state.openClient);
  const { previewRemoval, remove, archive, restore, get } = useSessionsStore();
  const confirm = useConfirm();
  const guardedLeave = useGuardedLeave();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"delete" | "archive" | null>(null);
  const locked = session != null && (session.archivedAt !== null || session.clientArchived);

  useEffect(() => {
    if (!focus || !session) return;
    const id = focus === "documents" ? "session-documents" : "session-usages";
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [focus, session]);

  useEffect(() => {
    if (!session || locked) return;
    let cancelled = false;
    previewRemoval(session.id)
      .then((preview) => {
        if (!cancelled) setAction(preview.canDelete ? "delete" : "archive");
      })
      .catch(() => {
        if (!cancelled) setAction(null);
      });
    return () => {
      cancelled = true;
    };
  }, [locked, previewRemoval, session]);

  async function removeOrArchive() {
    if (!session) return;
    setError(null);
    let preview;
    try {
      preview = await previewRemoval(session.id);
    } catch (previewError) {
      setError(String(previewError));
      return;
    }
    if (preview.canDelete) {
      const ok = await confirm({
        title: "Supprimer cette séance ?",
        body: "La séance sera supprimée définitivement. Cette action est irréversible.",
        confirmLabel: "Supprimer la séance",
        tone: "danger",
      });
      if (!ok) return;
      setBusy(true);
      try {
        await remove(session.id);
        toast.success("Séance supprimée");
        onBack();
      } catch (deleteError) {
        setError(String(deleteError));
        setBusy(false);
      }
      return;
    }
    const ok = await confirm({
      title: "Archiver cette séance ?",
      details: [
        `${preview.usageCount} produit${preview.usageCount > 1 ? "s" : ""} lié${preview.usageCount > 1 ? "s" : ""}`,
        `${preview.paymentCount} paiement${preview.paymentCount > 1 ? "s" : ""}`,
      ],
      body: "Elle quitte le planning et les listes. Les produits liés restent dans l'historique. Le stock n'est pas remis : pour défaire un lien, désarchive la séance puis annule le lien.",
      confirmLabel: "Archiver la séance",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await archive(session.id);
      toast.success("Séance archivée");
      onBack();
    } catch (archiveError) {
      setError(String(archiveError));
      setBusy(false);
    }
  }

  async function onDocumentsValidated(saved: SessionListItem) {
    onSaved(saved);
    setPaperworkVersion((version) => version + 1);
    if (saved.status !== "CANCELLED") return;
    try {
      await settleHeldDeposits(confirm, saved);
    } catch (settleError) {
      setError(String(settleError));
    }
  }

  async function unarchive() {
    if (!session) return;
    const ok = await confirm({
      title: "Désarchiver cette séance ?",
      body: "Elle revient dans le planning et les listes.",
      confirmLabel: "Désarchiver",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await restore(session.id);
      toast.success("Séance désarchivée");
      const fresh = await get(session.id);
      onSaved(fresh);
    } catch (restoreError) {
      setError(String(restoreError));
    } finally {
      setBusy(false);
    }
  }

  if (form && session) {
    const close = () => {
      setForm(null);
      setPaperworkVersion((version) => version + 1);
    };
    return form.kind === "HEALTH" ? (
      <HealthFormView paperwork={form.paperwork} onDone={close} readOnly={locked} />
    ) : (
      <ConsentFormView paperwork={form.paperwork} onDone={close} readOnly={locked} />
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-10">
      <div>
        <h1 className="text-[16px] font-medium tracking-tight">
          {session ? sessionTitle(session) : "Nouvelle séance"}
        </h1>
        {session && (
          <button
            type="button"
            onClick={() => openClient(session.clientId)}
            className="mt-1 text-[13px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            {clientName(session)}
            {session.clientArchived && <ArchiveMention>client archivé</ArchiveMention>}
          </button>
        )}
        <div className="mt-1">
          <BackButton listLabel="Séances" onList={() => void guardedLeave(onBack)} />
        </div>
      </div>

      {session?.archivedAt && (
        <ArchiveBanner>
          Séance archivée. Elle est en lecture seule et absente du planning. Désarchive-la pour la
          modifier.
        </ArchiveBanner>
      )}
      {session && !session.archivedAt && session.clientArchived && (
        <ArchiveBanner>
          Client archivé. Cette séance est en lecture seule. Désarchive le client pour la modifier.
        </ArchiveBanner>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {session && session.clientNoShowCount > 0 && (
        <p
          role="note"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg"
        >
          <span aria-hidden="true">⚠︎ </span>
          {session.clientFirstName} a déjà {session.clientNoShowCount} absence
          {session.clientNoShowCount > 1 ? "s" : ""} enregistrée
          {session.clientNoShowCount > 1 ? "s" : ""}.
        </p>
      )}

      <div className="grid items-start gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <SessionForm
            key={session?.id ?? "new"}
            session={session}
            draft={draft}
            locked={locked}
            onDone={(saved) => (saved ? onSaved(saved) : onBack())}
          />
          {session && (
            <SessionPaperwork
              key={`${paperworkVersion}-${session.status}`}
              sessionId={session.id}
              readOnly={locked}
              onValidated={(saved) => onDocumentsValidated(saved)}
              onOpenForm={(kind, paperwork) => setForm({ kind, paperwork })}
            />
          )}
        </div>
        <div className="flex flex-col gap-8">
          {session ? (
            <>
              <SessionBilling session={session} readOnly={locked} />
              <SessionProducts session={session} readOnly={locked} />
            </>
          ) : (
            <p className="text-[13px] text-fg-muted">
              Enregistre la séance pour encaisser, lier des produits et remplir les documents.
            </p>
          )}
        </div>
      </div>

      {session && (
        <div className="flex flex-col gap-8 border-t border-line pt-8">
          <AuditHistory key={session.id} target={{ kind: "session", id: session.id }} />
          <div>
            {session.archivedAt && !session.clientArchived ? (
              <button
                type="button"
                onClick={() => void unarchive()}
                disabled={busy}
                className={btnPrimary}
              >
                {busy ? "Désarchivage…" : "Désarchiver"}
              </button>
            ) : (
              !locked && (
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
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SessionsPage() {
  const {
    sessions,
    search,
    showArchived,
    loading,
    error,
    load,
    get: getSession,
  } = useSessionsStore();
  const [view, setView] = useState<View>({ kind: "list" });
  const [statuses, setStatuses] = useState<SessionStatus[]>([]);
  const sessionIntent = useUIStore((state) => state.sessionIntent);
  const takeSessionIntent = useUIStore((state) => state.takeSessionIntent);
  const setDetail = useUIStore((state) => state.setDetail);
  const detailId = view.kind === "editor" ? (view.session?.id ?? null) : null;

  // Fiche ouverte : retenue pour pouvoir y revenir depuis un autre écran.
  useEffect(() => {
    setDetail(detailId ? { kind: "session", id: detailId } : null);
  }, [detailId, setDetail]);

  useEffect(() => {
    void load("");
  }, [load]);

  // Nouvelle séance demandée depuis un autre écran : l'état suit la demande
  // pendant le rendu (pas d'effet), la demande est ensuite effacée.
  const [seenIntent, setSeenIntent] = useState<SessionIntent | null>(null);
  if (sessionIntent !== seenIntent) {
    setSeenIntent(sessionIntent);
    if (sessionIntent?.kind === "new") {
      const { date, startTime, clientId, projectId } = sessionIntent;
      setView({ kind: "editor", draft: { date, startTime, clientId, projectId } });
    }
  }

  // Ouverture d'une séance existante : il faut la charger.
  useEffect(() => {
    if (!sessionIntent) return;
    const intent = takeSessionIntent();
    if (!intent || intent.kind === "new") return;
    void getSession(intent.sessionId)
      .then((session) => setView({ kind: "editor", session, focus: intent.focus }))
      .catch(() => setView({ kind: "list" }));
  }, [sessionIntent, takeSessionIntent, getSession]);

  if (view.kind === "editor") {
    return (
      <SessionEditor
        key={view.session?.id ?? "new"}
        session={view.session}
        draft={view.draft}
        focus={view.focus}
        onBack={() => setView({ kind: "list" })}
        onSaved={(session) => setView({ kind: "editor", session })}
      />
    );
  }

  const visible =
    statuses.length === 0
      ? sessions
      : sessions.filter((session) => statuses.includes(session.status));
  const updatedAt = latestUpdatedAt(sessions);
  const subtitle =
    loading && sessions.length === 0
      ? "Chargement…"
      : updatedAt
        ? `Dernière mise à jour - ${formatWeekdayDate(updatedAt)}`
        : null;
  const filtered = search !== "" || statuses.length > 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <div>
        <h1 className="text-[16px] font-medium tracking-tight">Mes séances</h1>
        {subtitle ? <p className="mt-0.5 text-[12.5px] text-fg-faint">{subtitle}</p> : null}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <input
            type="search"
            aria-label="Rechercher une séance"
            placeholder="Recherche"
            value={search}
            onChange={(event) => void load(event.target.value)}
            className="w-64 rounded-md border border-line-strong bg-bg px-3 py-2 text-[14px] text-fg transition-[border-color,box-shadow] outline-none placeholder:text-fg-faint focus:border-accent"
          />
          <StatusFilters
            selected={statuses}
            onToggle={(status) =>
              setStatuses((current) =>
                current.includes(status)
                  ? current.filter((item) => item !== status)
                  : [...current, status],
              )
            }
          />
          <ArchiveFilter
            archived={showArchived}
            onChange={(archived) => void load(search, archived)}
          />
        </div>
        {!showArchived && (
          <button
            type="button"
            onClick={() => setView({ kind: "editor" })}
            className={`${btnPrimary} shrink-0`}
          >
            Ajouter une séance
          </button>
        )}
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {!loading && visible.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-5 py-10 text-center">
          <p className="text-[14px] text-fg-muted">
            {filtered
              ? "Aucun résultat."
              : showArchived
                ? "Aucune séance archivée."
                : "Aucune séance pour le moment."}
          </p>
          {!filtered && !showArchived && (
            <button
              type="button"
              onClick={() => setView({ kind: "editor" })}
              className={`${btnGhost} mt-4`}
            >
              Créer la première séance
            </button>
          )}
        </div>
      ) : visible.length > 0 ? (
        <SessionTable
          sessions={visible}
          pageResetKey={`${search}\0${String(showArchived)}\0${statuses.join(",")}`}
          onOpen={(session) => setView({ kind: "editor", session })}
          onEdit={(session) => setView({ kind: "editor", session })}
        />
      ) : null}
    </div>
  );
}
