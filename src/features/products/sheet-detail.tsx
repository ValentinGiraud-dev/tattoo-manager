import { useEffect, useState } from "react";
import { ArchiveBanner } from "../../components/archive-controls";
import { BackButton } from "../../components/back-button";
import { btnGhost, btnPrimary, cardClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate, formatTimestamp } from "../../lib/format";
import { sheetThresholdLabel } from "../../lib/low-stock";
import { sheetStockLabel, sheetSummary, sheetTypeLabel } from "../../lib/product-sheets";
import { useProductsStore, type LotSummary, type ProductSheet } from "../../stores/products-store";
import { toast } from "../../stores/toast-store";
import { LotRow } from "./lot-row";

type Loaded = { key: string; lots: LotSummary[] | null; error: string | null };

/** Fiche produit : ce qu'elle impose aux lots, et ses lots reçus. */
export function SheetDetail({
  sheet,
  backLabel,
  onBack,
  onEdit,
  onReceive,
  onOpenLot,
  onChanged,
}: {
  sheet: ProductSheet;
  /** Ouverte depuis un lot de Produits : le retour y ramène (sinon, retour d'écran). */
  backLabel?: string;
  onBack: () => void;
  onEdit: () => void;
  onReceive: () => void;
  onOpenLot: (lot: LotSummary) => void;
  onChanged: (sheet: ProductSheet) => void;
}) {
  const { listAllLots, deleteSheet, previewSheetRemoval, archiveSheet, restoreSheet, getSheet } =
    useProductsStore();
  const confirm = useConfirm();
  // La liste est relue quand la fiche change (réception, rattachement…).
  const key = `${sheet.id}:${sheet.updatedAt}:${sheet.lotCount}:${sheet.stock}`;
  const [loaded, setLoaded] = useState<Loaded>({ key: "", lots: null, error: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"delete" | "archive" | null>(null);
  const lots = loaded.key === key ? loaded.lots : null;
  const archived = sheet.archivedAt !== null;

  useEffect(() => {
    if (archived) return;
    let cancelled = false;
    previewSheetRemoval(sheet.id)
      .then((preview) => {
        if (!cancelled) setAction(preview.canDelete ? "delete" : "archive");
      })
      .catch(() => {
        if (!cancelled) setAction(null);
      });
    return () => {
      cancelled = true;
    };
  }, [archived, previewSheetRemoval, sheet.id]);

  useEffect(() => {
    let cancelled = false;
    listAllLots()
      .then((all) => {
        if (!cancelled) {
          setLoaded({ key, lots: all.filter((lot) => lot.productId === sheet.id), error: null });
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setLoaded({ key, lots: [], error: String(loadError) });
      });
    return () => {
      cancelled = true;
    };
  }, [key, sheet.id, listAllLots]);

  async function removeOrArchive() {
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
      onChanged(await getSheet(sheet.id));
    } catch (restoreError) {
      setError(String(restoreError));
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string | null][] = [
    ["Marque", sheet.brand],
    ["Catégorie", sheet.categoryPath ?? "Sans catégorie"],
    ["Type", sheetTypeLabel(sheet)],
    ["Stock", sheetStockLabel(sheet)],
    ["Stock bas", sheetThresholdLabel(sheet)],
    ["Lien", sheet.productUrl],
    ["Créée le", formatTimestamp(sheet.createdAt)],
  ];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-8 py-10">
      {backLabel ? (
        <button
          type="button"
          onClick={onBack}
          className="self-start text-[13px] text-fg-muted hover:text-fg"
        >
          ← {backLabel}
        </button>
      ) : (
        <BackButton listLabel="Produits" onList={onBack} />
      )}
      {archived && (
        <ArchiveBanner>
          Fiche archivée. Elle est en lecture seule et absente du sélecteur. Désarchive-la pour la
          modifier. Ses lots restent utilisables.
        </ArchiveBanner>
      )}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[12px] text-fg-faint">Fiche produit</p>
          <h1 className="text-[24px] font-medium tracking-tight">{sheet.displayName}</h1>
          <p className="mt-1 text-[13px] text-fg-muted">{sheetSummary(sheet)}</p>
        </div>
        <div className="flex shrink-0 gap-2">
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
              <button type="button" onClick={onEdit} className={btnGhost}>
                Modifier
              </button>
              <button type="button" onClick={onReceive} className={btnPrimary}>
                Recevoir un lot
              </button>
            </>
          )}
        </div>
      </div>

      {sheet.lowStock && sheet.alertThreshold !== null && (
        <p
          role="note"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg"
        >
          <span aria-hidden="true">⚠︎ </span>
          <span className="font-medium">Stock bas :</span> il en reste {sheet.stock} (alerte à{" "}
          {sheet.alertThreshold} ou moins). Pense à en racheter.
        </p>
      )}

      <dl className={`${cardClass} grid gap-3 p-4`}>
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-[13.5px]">
            <dt className="text-fg-faint">{label}</dt>
            <dd className="break-all whitespace-pre-wrap text-fg">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h2 className="mb-2 text-[14px] font-medium">Lots</h2>
        {loaded.error && loaded.key === key && (
          <p role="alert" className="mb-2 text-[13px] text-danger">
            {loaded.error}
          </p>
        )}
        {lots === null ? (
          <p className="text-[13px] text-fg-faint">Chargement…</p>
        ) : lots.length === 0 ? (
          <div className={`${cardClass} px-5 py-6 text-center`}>
            <p className="text-[13.5px] text-fg-muted">Aucun lot reçu pour cette fiche.</p>
            {!archived && (
              <button type="button" onClick={onReceive} className={`${btnGhost} mt-3`}>
                Recevoir un lot
              </button>
            )}
          </div>
        ) : (
          <ul className={`${cardClass} divide-y divide-line overflow-hidden`}>
            {lots.map((lot) => (
              <li key={lot.id}>
                <LotRow lot={lot} title={`Lot ${lot.lotNumber}`} onOpen={() => onOpenLot(lot)}>
                  exp. {formatIsoDate(lot.expirationDate)}
                  {lot.archivedAt ? " · lot archivé" : ""}
                </LotRow>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
