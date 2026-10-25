import { useEffect, useState } from "react";
import { ArchiveBanner, ArchiveMention } from "../../components/archive-controls";
import { BackButton } from "../../components/back-button";
import { btnPrimary, cardClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { useGuardedLeave } from "../../components/unsaved-changes";
import { formatIsoDate } from "../../lib/format";
import { SESSION_STATUS_LABELS } from "../../lib/labels";
import type { SessionStatus } from "../../stores/sessions-store";
import {
  useProductsStore,
  type LotSessionItem,
  type LotSummary,
  type ProductSheet,
} from "../../stores/products-store";
import { toast } from "../../stores/toast-store";
import { useUIStore } from "../../stores/ui-store";
import { AuditHistory } from "../journal/audit-history";
import { LotForm } from "./lot-form";
import { LotRow } from "./lot-row";
import { SheetFacts } from "./sheet-facts";
import { SheetForm } from "./sheet-form";

type LinkedSession = LotSessionItem & { lotNumber: string };

type Loaded = {
  key: string;
  lots: LotSummary[];
  sessions: LinkedSession[];
  error: string | null;
};

/**
 * Création et fiche d'un produit. Une fiche déjà enregistrée s'ouvre en lecture :
 * le crayon passe au formulaire. Les lots sont une liste ; « Ajouter un lot »
 * déplie la réception dans la carte.
 */
export function SheetEditor({
  sheet,
  fromLot,
  defaultCategoryId = null,
  backLabel,
  onBack,
  onSaved,
  onOpenLot,
}: {
  sheet?: ProductSheet;
  fromLot?: LotSummary;
  defaultCategoryId?: string | null;
  /** Retour vers un lot ou une réception. Sinon, « ← Produits ». */
  backLabel?: string;
  onBack: () => void;
  onSaved: (sheet: ProductSheet) => void;
  onOpenLot: (lot: LotSummary) => void;
}) {
  const {
    listAllLots,
    listSessions,
    getSheet,
    deleteSheet,
    previewSheetRemoval,
    archiveSheet,
    restoreSheet,
    previewLotRemoval,
    deleteLot,
    archiveLot,
  } = useProductsStore();
  const openSession = useUIStore((state) => state.openSession);
  const confirm = useConfirm();
  const guardedLeave = useGuardedLeave();
  const archived = sheet?.archivedAt != null;
  const [editing, setEditing] = useState(sheet === undefined);
  const [addingLot, setAddingLot] = useState(false);
  const [lotsReload, setLotsReload] = useState(0);
  const key = sheet
    ? `${sheet.id}:${sheet.updatedAt}:${sheet.lotCount}:${sheet.stock}:${lotsReload}`
    : "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fresh = loaded?.key === key ? loaded : null;

  useEffect(() => {
    if (!sheet) return;
    let cancelled = false;
    listAllLots()
      .then(async (all) => {
        const mine = all.filter((lot) => lot.productId === sheet.id);
        const groups = await Promise.all(
          mine.map(async (lot) => {
            const rows = await listSessions(lot.id);
            return rows.map((row) => ({ ...row, lotNumber: lot.lotNumber }));
          }),
        );
        return { mine, sessions: groups.flat() };
      })
      .then((result) => {
        if (!cancelled) {
          setLoaded({ key, lots: result.mine, sessions: result.sessions, error: null });
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setLoaded({ key, lots: [], sessions: [], error: String(loadError) });
      });
    return () => {
      cancelled = true;
    };
  }, [key, listAllLots, listSessions, sheet]);

  async function removeOrArchive() {
    if (!sheet) return;
    let preview;
    try {
      preview = await previewSheetRemoval(sheet.id);
    } catch (previewError) {
      setError(String(previewError));
      return;
    }
    if (preview.canDelete) {
      const ok = await confirm({
        title: `Supprimer la fiche « ${sheet.displayName} » ?`,
        body: "Elle n'a aucun lot : rien d'autre ne change. Cette action est irréversible.",
        confirmLabel: "Supprimer la fiche",
        tone: "danger",
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        await deleteSheet(sheet.id);
        toast.success("Fiche produit supprimée");
        onBack();
      } catch (deleteError) {
        setError(String(deleteError));
        setBusy(false);
      }
      return;
    }
    const ok = await confirm({
      title: `Archiver la fiche « ${sheet.displayName} » ?`,
      details: [`${preview.lotCount} lot${preview.lotCount > 1 ? "s" : ""}`],
      body: "Elle quitte le sélecteur. Ses lots restent utilisables et affichent « fiche archivée ».",
      confirmLabel: "Archiver la fiche",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await archiveSheet(sheet.id);
      toast.success("Fiche produit archivée");
      onBack();
    } catch (archiveError) {
      setError(String(archiveError));
      setBusy(false);
    }
  }

  async function unarchive() {
    if (!sheet) return;
    const ok = await confirm({
      title: "Désarchiver cette fiche ?",
      body: "Elle revient dans le sélecteur des nouveaux lots.",
      confirmLabel: "Désarchiver",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await restoreSheet(sheet.id);
      toast.success("Fiche produit désarchivée");
      onSaved(await getSheet(sheet.id));
    } catch (restoreError) {
      setError(String(restoreError));
    } finally {
      setBusy(false);
    }
  }

  async function received() {
    if (!sheet) return;
    try {
      onSaved(await getSheet(sheet.id));
      setLotsReload((current) => current + 1);
    } catch (receiveError) {
      setError(String(receiveError));
    }
  }

  function finishSheet(saved?: ProductSheet) {
    if (saved) {
      setEditing(false);
      onSaved(saved);
      return;
    }
    if (sheet) {
      setEditing(false);
      return;
    }
    onBack();
  }

  async function removeLot(lot: LotSummary) {
    let preview;
    try {
      preview = await previewLotRemoval(lot.id);
    } catch (previewError) {
      setError(String(previewError));
      return;
    }
    if (preview.canDelete) {
      const ok = await confirm({
        title: "Supprimer ce lot ?",
        details: [`${lot.name} · lot ${lot.lotNumber}`],
        body: "Le lot, ses pièces et les entrées de stock d'ouverture seront supprimés. Cette action est irréversible.",
        confirmLabel: "Supprimer le lot",
        tone: "danger",
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        await deleteLot(lot.id);
        toast.success("Lot supprimé");
        await received();
      } catch (deleteError) {
        setError(String(deleteError));
      } finally {
        setBusy(false);
      }
      return;
    }
    const ok = await confirm({
      title: "Archiver ce lot ?",
      details: [`${lot.name} · lot ${lot.lotNumber}`, `${lot.stock} en stock`],
      body: "Il quitte le stock, les alertes et le sélecteur des séances. La quantité reste inscrite sur le lot. Ses séances restent dans l'historique, avec la mention « lot archivé ».",
      confirmLabel: "Archiver le lot",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await archiveLot(lot.id);
      toast.success("Lot archivé");
      await received();
    } catch (archiveError) {
      setError(String(archiveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <div>
        <h1 className="text-[16px] font-medium tracking-tight">
          {sheet ? sheet.displayName : "Nouveau produit"}
        </h1>
        {backLabel ? (
          <button
            type="button"
            onClick={() => void guardedLeave(onBack)}
            className="mt-3 text-[13px] text-fg-muted hover:text-fg"
          >
            ← {backLabel}
          </button>
        ) : (
          <div className="mt-3">
            <BackButton listLabel="Produits" onList={() => void guardedLeave(onBack)} />
          </div>
        )}
      </div>

      {archived && (
        <ArchiveBanner>
          Fiche archivée. Elle est en lecture seule et absente du sélecteur. Désarchive-la pour la
          modifier. Ses lots restent utilisables.
        </ArchiveBanner>
      )}

      {sheet?.lowStock && sheet.alertThreshold !== null && (
        <p
          role="note"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg"
        >
          <span aria-hidden="true">⚠︎ </span>
          <span className="font-medium">Stock bas :</span> il en reste {sheet.stock} (alerte à{" "}
          {sheet.alertThreshold} ou moins). Pense à en racheter.
        </p>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-2">
        {sheet && !editing ? (
          <SheetFacts
            sheet={sheet}
            busy={busy}
            onEdit={() => setEditing(true)}
            onRemove={() => void removeOrArchive()}
          />
        ) : sheet ? (
          <section className={`${cardClass} p-5`}>
            <h2 className="mb-4 text-[14px] font-medium">Modifier le produit</h2>
            <SheetForm sheet={sheet} locked={archived} onDone={finishSheet} />
          </section>
        ) : (
          <SheetForm fromLot={fromLot} defaultCategoryId={defaultCategoryId} onDone={finishSheet} />
        )}

        {sheet ? (
          <div className="flex flex-col gap-6">
            <section className={`${cardClass} overflow-hidden`}>
              {fresh === null ? (
                <p className="px-4 py-3 text-[13px] text-fg-muted">Chargement…</p>
              ) : fresh.error ? (
                <p role="alert" className="px-4 py-3 text-[13px] text-danger">
                  {fresh.error}
                </p>
              ) : fresh.lots.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-fg-muted">Aucun lot reçu.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {fresh.lots.map((lot) => (
                    <li key={lot.id}>
                      <LotRow
                        lot={lot}
                        title={`Lot ${lot.lotNumber}`}
                        onOpen={() => onOpenLot(lot)}
                        onRemove={
                          archived || lot.archivedAt ? undefined : () => void removeLot(lot)
                        }
                        removeLabel={`Supprimer ou archiver le lot ${lot.lotNumber}`}
                        removeDisabled={busy}
                      >
                        exp. {formatIsoDate(lot.expirationDate)}
                        {lot.archivedAt ? " · lot archivé" : ""}
                      </LotRow>
                    </li>
                  ))}
                </ul>
              )}
              {!archived &&
                (addingLot ? (
                  <div className="border-t border-line p-5">
                    <LotForm
                      fixedSheet={sheet}
                      onDone={(saved) => {
                        setAddingLot(false);
                        if (saved) void received();
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingLot(true)}
                    className="flex w-full items-center justify-center gap-1.5 border-t border-dashed border-line px-4 py-3 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                  >
                    <span aria-hidden="true">+</span>
                    Ajouter un lot
                  </button>
                ))}
            </section>
            <section>
              <h2 className="mb-2 text-[14px] font-medium">Séances liées</h2>
              {fresh === null ? (
                <p className="text-[13px] text-fg-muted">Chargement…</p>
              ) : fresh.sessions.length === 0 ? (
                <p className="text-[13px] text-fg-muted">Aucune séance pour ce produit.</p>
              ) : (
                <ul className="overflow-hidden rounded-lg border border-line bg-surface">
                  {fresh.sessions.map((item, index) => (
                    <li
                      key={`${item.sessionId}-${item.lotId ?? item.unitId}-${item.createdAt}`}
                      className={index > 0 ? "border-t border-line px-4 py-3" : "px-4 py-3"}
                    >
                      <button
                        type="button"
                        onClick={() => openSession(item.sessionId)}
                        className="text-left text-[14px] font-medium underline-offset-2 hover:underline"
                      >
                        {item.clientFirstName} {item.clientLastName}
                        {item.clientArchived && <ArchiveMention>client archivé</ArchiveMention>}
                        {item.sessionArchived && <ArchiveMention>séance archivée</ArchiveMention>}
                      </button>
                      <p className="mt-0.5 text-[12.5px] text-fg-muted">
                        {formatIsoDate(item.date)}
                        {" · "}
                        {SESSION_STATUS_LABELS[item.status as SessionStatus] ?? item.status}
                        {" · lot "}
                        {item.lotNumber}
                        {item.voidReason ? ` · lien annulé : ${item.voidReason}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : (
          <p className="text-[13px] text-fg-muted lg:pt-1">
            Enregistre le produit pour recevoir un lot et voir les séances liées.
          </p>
        )}
      </div>

      {sheet && (
        <>
          <AuditHistory target={{ kind: "product", id: sheet.id }} />
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          {archived && (
            <div>
              <button
                type="button"
                onClick={() => void unarchive()}
                disabled={busy}
                className={btnPrimary}
              >
                {busy ? "Désarchivage…" : "Désarchiver"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
