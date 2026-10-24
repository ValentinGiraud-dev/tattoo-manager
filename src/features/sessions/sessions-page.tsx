import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, fieldClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate, formatTimestamp } from "../../lib/format";
import { formatTimeRange, SESSION_STATUS_LABELS } from "../../lib/labels";
import { formatEuros } from "../../lib/money";
import type { FormKind, Paperwork } from "../../stores/paperwork-store";
import {
  useProductsStore,
  type LinkableItem,
  type SessionUsageItem,
} from "../../stores/products-store";
import {
  sessionToInput,
  useSessionsStore,
  type SessionListItem,
  type SessionStatus,
} from "../../stores/sessions-store";
import { useUIStore, type SessionIntent } from "../../stores/ui-store";
import { ConsentFormView } from "./consent-form";
import { HealthFormView } from "./health-form";
import { SessionBilling } from "./session-billing";
import { lowStockAfterLink } from "../../lib/low-stock";
import { AuditHistory } from "../journal/audit-history";
import { SessionForm, type SessionDraft } from "./session-form";
import { SessionPaperwork } from "./session-paperwork";
import { confirmClosingStatus, settleHeldDeposits } from "./session-status-flow";
import { StatusBadge } from "./session-status";
import { toast } from "../../stores/toast-store";
import { BackButton } from "../../components/back-button";
import { ArchiveBanner, ArchiveFilter, ArchiveMention } from "../../components/archive-controls";

type View =
  | { kind: "list" }
  | { kind: "form"; session?: SessionListItem; draft?: SessionDraft }
  | { kind: "detail"; session: SessionListItem };

function clientName(session: SessionListItem) {
  return `${session.clientFirstName} ${session.clientLastName}`;
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
    <section>
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

function SessionDetail({
  session,
  onEdit,
  onBack,
  onRestored,
}: {
  session: SessionListItem;
  onEdit: () => void;
  onBack: () => void;
  onRestored: (session: SessionListItem) => void;
}) {
  const [form, setForm] = useState<{ kind: FormKind; paperwork: Paperwork } | null>(null);
  const [paperworkVersion, setPaperworkVersion] = useState(0);
  const openClient = useUIStore((state) => state.openClient);
  const { previewRemoval, remove, archive, restore, get, update, setAftercareExplained } =
    useSessionsStore();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [aftercareBusy, setAftercareBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{
    id: string;
    status: SessionStatus;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"delete" | "archive" | null>(null);
  const locked = session.archivedAt !== null || session.clientArchived;
  const statusValue = pendingStatus?.id === session.id ? pendingStatus.status : session.status;

  useEffect(() => {
    if (locked) return;
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
  }, [locked, previewRemoval, session.id]);

  async function removeOrArchive() {
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

  async function changeStatus(next: SessionStatus) {
    if (locked || next === session.status) return;
    setPendingStatus({ id: session.id, status: next });
    if (next === "CANCELLED" || next === "NO_SHOW") {
      const ok = await confirmClosingStatus(
        confirm,
        next,
        `${session.clientFirstName} ${session.clientLastName}`,
        session.date,
        session.startTime,
      );
      if (!ok) {
        setPendingStatus(null);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await update(session.id, sessionToInput(session, next));
      if (saved.status === "CANCELLED" || saved.status === "NO_SHOW") {
        await settleHeldDeposits(confirm, saved);
      }
      toast.success("Statut mis à jour");
      setPendingStatus(null);
      onRestored(saved);
    } catch (statusError) {
      setPendingStatus(null);
      setError(String(statusError));
    } finally {
      setBusy(false);
    }
  }

  async function setAftercare(explained: boolean) {
    const previous = session;
    setAftercareBusy(true);
    onRestored({ ...session, aftercareExplained: explained });
    setError(null);
    try {
      const saved = await setAftercareExplained(session.id, explained);
      toast.success(explained ? "Conseils d’hygiène notés" : "Case d’hygiène retirée");
      onRestored(saved);
    } catch (aftercareError) {
      onRestored(previous);
      setError(String(aftercareError));
    } finally {
      setAftercareBusy(false);
    }
  }

  async function unarchive() {
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
      onRestored(fresh);
    } catch (restoreError) {
      setError(String(restoreError));
    } finally {
      setBusy(false);
    }
  }

  if (form) {
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

  const rows: [string, string | null][] = [
    ["Client", clientName(session)],
    ["Date", formatIsoDate(session.date)],
    ["Horaire", formatTimeRange(session.startTime, session.durationMinutes)],
    ["Statut", SESSION_STATUS_LABELS[session.status]],
    ["Titre", session.title],
    ["Projet", session.projectTitle],
    ["Prix", session.priceCents === null ? null : formatEuros(session.priceCents)],
    ["Zone", session.bodyArea],
    ["Description", session.description],
    ["Notes", session.notes],
    ["Créé le", formatTimestamp(session.createdAt)],
    ["Modifié le", formatTimestamp(session.updatedAt)],
  ];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-8 py-10">
      <BackButton listLabel="Séances" onList={onBack} />
      {session.archivedAt && (
        <ArchiveBanner>
          Séance archivée. Elle est en lecture seule et absente du planning. Désarchive-la pour la
          modifier.
        </ArchiveBanner>
      )}
      {!session.archivedAt && session.clientArchived && (
        <ArchiveBanner>
          Client archivé. Cette séance est en lecture seule. Désarchive le client pour la modifier.
        </ArchiveBanner>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <label className="mb-2 block w-fit text-[12px] text-fg-faint">
            Statut
            <select
              aria-label="Statut de la séance"
              value={statusValue}
              disabled={locked || busy}
              onChange={(event) => void changeStatus(event.target.value as SessionStatus)}
              className="mt-1 block rounded-md border border-line-strong bg-bg px-2.5 py-1 text-[13px] text-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted"
            >
              {(Object.keys(SESSION_STATUS_LABELS) as SessionStatus[]).map((value) => (
                <option key={value} value={value}>
                  {SESSION_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <h1 className="text-[24px] font-medium tracking-tight">
            {session.title ?? session.projectTitle ?? session.bodyArea ?? "Séance"}
          </h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            <button
              type="button"
              onClick={() => openClient(session.clientId)}
              className="underline-offset-2 hover:text-fg hover:underline"
            >
              {clientName(session)}
              {session.clientArchived && <ArchiveMention>client archivé</ArchiveMention>}
            </button>{" "}
            · {formatIsoDate(session.date)}
            {session.startTime ? ` · ${session.startTime}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
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
              <>
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
                <button type="button" onClick={onEdit} className={btnPrimary}>
                  Modifier
                </button>
              </>
            )
          )}
        </div>
      </div>
      <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-[13.5px]">
            <dt className="text-fg-faint">{label}</dt>
            <dd className="whitespace-pre-wrap text-fg">
              {value ?? "—"}
              {label === "Projet" && session.projectArchived && (
                <ArchiveMention>projet archivé</ArchiveMention>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {session.clientNoShowCount > 0 && (
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
      <SessionBilling session={session} readOnly={locked} />
      <SessionPaperwork
        key={`${paperworkVersion}-${session.status}`}
        sessionId={session.id}
        readOnly={locked}
        aftercareExplained={session.aftercareExplained}
        aftercareBusy={aftercareBusy}
        onAftercareExplained={(explained) => void setAftercare(explained)}
        onOpenForm={(kind, paperwork) => setForm({ kind, paperwork })}
      />
      <SessionProducts session={session} readOnly={locked} />
      <AuditHistory key={session.id} target={{ kind: "session", id: session.id }} />
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
  const sessionIntent = useUIStore((state) => state.sessionIntent);
  const takeSessionIntent = useUIStore((state) => state.takeSessionIntent);
  const setDetail = useUIStore((state) => state.setDetail);
  const detailId = view.kind === "detail" ? view.session.id : null;

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
      setView({ kind: "form", draft: { date, startTime, clientId, projectId } });
    }
  }

  // Ouverture d'une séance existante : il faut la charger.
  useEffect(() => {
    if (!sessionIntent) return;
    const intent = takeSessionIntent();
    if (!intent || intent.kind === "new") return;
    void getSession(intent.sessionId)
      .then((session) => setView({ kind: "detail", session }))
      .catch(() => setView({ kind: "list" }));
  }, [sessionIntent, takeSessionIntent, getSession]);

  if (view.kind === "form") {
    return (
      <SessionForm
        session={view.session}
        draft={view.draft}
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
        onRestored={(session) => setView({ kind: "detail", session })}
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
        <div className="flex items-center gap-3">
          <ArchiveFilter
            archived={showArchived}
            onChange={(archived) => void load(search, archived)}
          />
          {!showArchived && (
            <button type="button" onClick={() => setView({ kind: "form" })} className={btnPrimary}>
              Nouvelle séance
            </button>
          )}
        </div>
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
            {search
              ? "Aucun résultat."
              : showArchived
                ? "Aucune séance archivée."
                : "Aucune séance pour le moment."}
          </p>
          {!search && !showArchived && (
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
                    {session.startTime ? ` · ${session.startTime}` : ""}
                    {session.title ? ` · ${session.title}` : ""}
                    {session.projectTitle ? ` · ${session.projectTitle}` : ""}
                    {session.projectArchived ? " · projet archivé" : ""}
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
