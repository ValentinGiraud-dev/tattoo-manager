import { useCallback, useEffect, useState } from "react";
import { ArchiveBanner, ArchiveMention } from "../../components/archive-controls";
import { BackButton } from "../../components/back-button";
import { DateSelector } from "../../components/date-selector";
import { btnGhost, btnPrimary, labelClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate, formatTimestamp } from "../../lib/format";
import { SESSION_STATUS_LABELS } from "../../lib/labels";
import {
  useProductsStore,
  type LotSessionItem,
  type LotSummary,
  type ProductSheet,
  type StockMovement,
  type UnitView,
} from "../../stores/products-store";
import type { SessionStatus } from "../../stores/sessions-store";
import { toast } from "../../stores/toast-store";
import { useUIStore } from "../../stores/ui-store";
import { AuditHistory } from "../journal/audit-history";
import { EXIT_ACTIONS, EXIT_LABELS, MOVEMENT_LABELS, stockLabel } from "./lot-labels";

import { MovementForm } from "./movement-form";

const NO_SHEET = "__aucune__";

export function LotDetail({
  lot,
  onEdit,
  onBack,
  onChange,
  onOpenSheet,
  onCreateSheet,
  backLabel,
}: {
  lot: LotSummary;
  onEdit: () => void;
  onBack: () => void;
  /** Ouvert depuis une fiche produit : le retour y ramène (sinon, retour d'écran). */
  backLabel?: string;
  onChange: (lot: LotSummary) => void;
  onOpenSheet: (sheetId: string) => void;
  /** Crée la fiche produit de ce lot (pré-remplie avec lui). */
  onCreateSheet: (lot: LotSummary) => void;
}) {
  const {
    listSessions,
    listUnits,
    listMovements,
    openUnit,
    exitUnit,
    undoMovement,
    get,
    listAllSheets,
    setLotSheet,
    previewLotRemoval,
    deleteLot,
    archiveLot,
    restoreLot,
  } = useProductsStore();
  const openSession = useUIStore((state) => state.openSession);
  const confirm = useConfirm();
  const [removal, setRemoval] = useState<"delete" | "archive" | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<LotSessionItem[]>([]);
  const [units, setUnits] = useState<UnitView[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== lot.id;
  const [openDates, setOpenDates] = useState<Record<string, string | null>>({});
  const currentYear = new Date().getFullYear();
  const locked = lot.archivedAt !== null;

  useEffect(() => {
    if (locked) return;
    let cancelled = false;
    previewLotRemoval(lot.id)
      .then((preview) => {
        if (!cancelled) setRemoval(preview.canDelete ? "delete" : "archive");
      })
      .catch(() => {
        if (!cancelled) setRemoval(null);
      });
    return () => {
      cancelled = true;
    };
  }, [locked, lot.id, previewLotRemoval]);

  async function removeOrArchive() {
    setError(null);
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
      try {
        await deleteLot(lot.id);
        toast.success("Lot supprimé");
        onBack();
      } catch (deleteError) {
        setError(String(deleteError));
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
    try {
      await archiveLot(lot.id);
      toast.success("Lot archivé");
      onBack();
    } catch (archiveError) {
      setError(String(archiveError));
      setBusy(false);
    }
  }

  async function unarchive() {
    const ok = await confirm({
      title: "Désarchiver ce lot ?",
      body: "Il revient dans le stock et le sélecteur des séances.",
      confirmLabel: "Désarchiver",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await restoreLot(lot.id);
      toast.success("Lot désarchivé");
      onChange(await get(lot.id));
    } catch (restoreError) {
      setError(String(restoreError));
    } finally {
      setBusy(false);
    }
  }

  const fetchLot = useCallback(
    (lotId: string) => Promise.all([listSessions(lotId), listUnits(lotId), listMovements(lotId)]),
    [listSessions, listUnits, listMovements],
  );

  const apply = useCallback(
    ([sessionItems, unitItems, movementItems]: Awaited<ReturnType<typeof fetchLot>>) => {
      setSessions(sessionItems);
      setUnits(unitItems);
      setMovements(movementItems);
      setOpenDates((current) => {
        const dates = { ...current };
        for (const unit of unitItems) {
          if (dates[unit.id] === undefined) dates[unit.id] = unit.openedAt;
        }
        return dates;
      });
    },
    [],
  );

  async function refresh(lotId: string) {
    apply(await fetchLot(lotId));
  }

  useEffect(() => {
    let cancelled = false;
    fetchLot(lot.id)
      .then((data) => {
        if (cancelled) return;
        apply(data);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(lot.id);
      });
    return () => {
      cancelled = true;
    };
  }, [apply, fetchLot, lot.id]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      const next = await get(lot.id);
      onChange(next);
      await refresh(next.id);
    } catch (actionError) {
      setError(String(actionError));
    } finally {
      setBusy(false);
    }
  }

  function unitState(unit: UnitView): string {
    if (!unit.inStock) return EXIT_LABELS[unit.exitType ?? ""] ?? "Sortie";
    return unit.openedAt ? `ouverte le ${formatIsoDate(unit.openedAt)}` : "scellée";
  }

  async function confirmExit(unit: UnitView, position: number, type: string) {
    const action = EXIT_ACTIONS[type];
    const ok = await confirm({
      title: action.title,
      details: [`${lot.name} · lot ${lot.lotNumber}`, `Pièce ${position} · ${unitState(unit)}`],
      body: action.body,
      confirmLabel: action.label,
      cancelLabel: "Retour",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      await exitUnit(unit.id, type);
      toast.success("Pièce sortie du stock");
    });
  }

  async function confirmRestock(unit: UnitView, position: number, movementId: string) {
    const ok = await confirm({
      title: "Remettre cette pièce en stock ?",
      details: [`${lot.name} · lot ${lot.lotNumber}`, `Pièce ${position} · ${unitState(unit)}`],
      body: "La sortie est annulée par un mouvement inverse. L'historique garde les deux mouvements.",
      confirmLabel: "Remettre en stock",
      cancelLabel: "Retour",
    });
    if (!ok) return;
    await run(async () => {
      await undoMovement(movementId);
      toast.success("Pièce remise en stock");
    });
  }

  async function confirmUndo(movement: StockMovement) {
    const label =
      movement.type === "CONSUMPTION" && movement.unitId
        ? "Terminé"
        : (MOVEMENT_LABELS[movement.type] ?? movement.type);
    const quantity = movement.quantity > 0 ? `+${movement.quantity}` : `${movement.quantity}`;
    const ok = await confirm({
      title: "Annuler ce mouvement ?",
      details: [
        `${lot.name} · lot ${lot.lotNumber}`,
        `${label} · ${quantity} · ${formatTimestamp(movement.createdAt)}`,
      ],
      body: "Un mouvement inverse est ajouté. Le mouvement d'origine reste visible dans l'historique.",
      confirmLabel: "Annuler le mouvement",
      cancelLabel: "Garder",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      await undoMovement(movement.id);
      toast.success("Mouvement annulé");
    });
  }

  async function chooseSheet() {
    setError(null);
    let sheets: ProductSheet[];
    try {
      sheets = (await listAllSheets()).filter((sheet) => sheet.singleUse === lot.singleUse);
    } catch (loadError) {
      setError(String(loadError));
      return;
    }
    const choices: { value: string; label: string; description?: string }[] = sheets
      .filter((sheet) => sheet.id !== lot.productId)
      .map((sheet) => ({
        value: sheet.id,
        label: sheet.displayName,
        description: sheet.categoryPath ?? undefined,
      }));
    if (lot.productId) choices.push({ value: NO_SHEET, label: "Aucune fiche (détacher le lot)" });
    if (choices.length === 0) {
      setError(
        `Aucune fiche produit en ${lot.singleUse ? "usage unique" : "usage multiple"} : crée-la d'abord.`,
      );
      return;
    }
    const result = await confirm({
      title: lot.productId ? "Changer la fiche de ce lot ?" : "Rattacher ce lot à une fiche ?",
      details: [`${lot.name} · lot ${lot.lotNumber}`],
      body: "Le nom, le numéro et la péremption du lot ne changent pas. Il est rangé dans la catégorie de la fiche choisie.",
      choices,
      confirmLabel: lot.productId ? "Changer de fiche" : "Rattacher le lot",
      cancelLabel: "Annuler",
    });
    if (!result?.choice) return;
    const sheetId = result.choice === NO_SHEET ? null : result.choice;
    setBusy(true);
    try {
      const saved = await setLotSheet(lot.id, sheetId);
      onChange(saved);
      toast.success(sheetId ? "Lot rattaché à la fiche" : "Lot détaché de sa fiche");
    } catch (attachError) {
      setError(String(attachError));
    } finally {
      setBusy(false);
    }
  }

  const sheetName = [lot.productBrand, lot.productName].filter(Boolean).join(" ");

  const rows: [string, string | null][] = [
    ["Lot", lot.lotNumber],
    ["Catégorie", lot.categoryPath ?? "Sans catégorie"],
    ["Type", lot.singleUse ? "Usage unique" : "Usage multiple"],
    ["Stock", stockLabel(lot)],
    ["Expiration", formatIsoDate(lot.expirationDate)],
    ["Fabrication", lot.creationDate ? formatIsoDate(lot.creationDate) : null],
    ["Après ouverture", lot.afterOpeningMonths != null ? `${lot.afterOpeningMonths} mois` : null],
    ["URL", lot.productUrl],
    ["Créé le", formatTimestamp(lot.createdAt)],
    ["Modifié le", formatTimestamp(lot.updatedAt)],
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
      {locked && (
        <ArchiveBanner>
          Lot archivé. Il est en lecture seule et absent du stock. Désarchive-le pour le modifier.
        </ArchiveBanner>
      )}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[12px] text-fg-faint">
            {lot.singleUse ? "Usage unique" : "Usage multiple"}
            {lot.expired ? " · Périmé" : ""}
          </p>
          <h1 className="text-[24px] font-medium tracking-tight">{lot.name}</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            Lot {lot.lotNumber} · {stockLabel(lot)}
          </p>
        </div>
        {locked ? (
          <button
            type="button"
            onClick={() => void unarchive()}
            disabled={busy}
            className={btnPrimary}
          >
            {busy ? "Désarchivage…" : "Désarchiver"}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void removeOrArchive()}
              disabled={busy}
              className={btnGhost}
            >
              <span className="text-danger">
                {busy ? "En cours…" : removal === "delete" ? "Supprimer" : "Archiver"}
              </span>
            </button>
            <button type="button" onClick={onEdit} className={btnPrimary}>
              Modifier
            </button>
          </div>
        )}
      </div>

      {lot.expired && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
          La date de péremption est dépassée. Le lot reste utilisable : rien n&apos;est jeté
          automatiquement.
        </p>
      )}

      {lot.productId ? (
        <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="min-w-0 flex-1 text-[13.5px]">
            <span className="text-fg-faint">Fiche produit </span>
            <span className="font-medium text-fg">
              {sheetName}
              {lot.productArchived && <ArchiveMention>fiche archivée</ArchiveMention>}
            </span>
          </p>
          <button
            type="button"
            onClick={() => onOpenSheet(lot.productId as string)}
            className={btnGhost}
          >
            Ouvrir la fiche
          </button>
          {!locked && (
            <button
              type="button"
              onClick={() => void chooseSheet()}
              disabled={busy}
              className={btnGhost}
            >
              Changer…
            </button>
          )}
        </section>
      ) : (
        <section
          role="note"
          className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
        >
          <p className="text-[13.5px] text-fg">
            <span aria-hidden="true">⚠︎ </span>
            <span className="font-medium">Lot sans fiche produit.</span> Crée sa fiche ou choisis-en
            une : sans fiche, ce lot n&apos;est pas compté dans le stock du produit.
          </p>
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onCreateSheet(lot)} className={btnPrimary}>
                Créer la fiche produit
              </button>
              <button
                type="button"
                onClick={() => void chooseSheet()}
                disabled={busy}
                className={btnGhost}
              >
                Choisir une fiche existante…
              </button>
            </div>
          )}
        </section>
      )}

      <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-[13.5px]">
            <dt className="text-fg-faint">{label}</dt>
            <dd className="break-all whitespace-pre-wrap text-fg">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      {lot.singleUse && !locked ? (
        <MovementForm
          lot={lot}
          onSaved={(saved) => {
            onChange(saved);
            void refresh(saved.id);
          }}
        />
      ) : !lot.singleUse ? (
        <section>
          <h2 className="mb-2 text-[14px] font-medium">Pièces</h2>
          {loading ? (
            <p className="text-[13px] text-fg-muted">Chargement…</p>
          ) : (
            <ul className="overflow-hidden rounded-lg border border-line bg-surface">
              {units.map((unit, index) => {
                return (
                  <li
                    key={unit.id}
                    className={index > 0 ? "border-t border-line px-4 py-3" : "px-4 py-3"}
                  >
                    <p className="text-[14px] font-medium">Pièce {index + 1}</p>
                    <p className="mt-0.5 text-[12.5px] text-fg-muted">
                      {unit.inStock
                        ? unit.openedAt
                          ? `Ouvert le ${formatIsoDate(unit.openedAt)}`
                          : "Scellé"
                        : (EXIT_LABELS[unit.exitType ?? ""] ?? "Sorti")}
                      {unit.inStock && unit.openedAt
                        ? ` · à utiliser jusqu'au ${formatIsoDate(unit.usefulUntil)}`
                        : ""}
                    </p>
                    {unit.inStock && unit.expired && (
                      <p className="mt-1.5 text-[12.5px] text-warning">
                        <span aria-hidden="true">⚠︎ </span>
                        {unit.openedAt
                          ? "Délai après ouverture ou péremption dépassé."
                          : "Date de péremption dépassée."}
                      </p>
                    )}
                    {!unit.inStock && unit.exitMovementId && (
                      <button
                        type="button"
                        className={`${btnGhost} mt-3`}
                        disabled={busy}
                        onClick={() => {
                          const movementId = unit.exitMovementId;
                          if (!movementId) return;
                          void confirmRestock(unit, index + 1, movementId);
                        }}
                      >
                        Remettre en stock
                      </button>
                    )}
                    {unit.inStock && !locked && (
                      <div className="mt-3 flex flex-col gap-3">
                        {unit.usedInSessions && unit.openedAt ? (
                          <p className="text-[12.5px] text-fg-muted">
                            Date d&apos;ouverture figée : la pièce a déjà servi en séance.
                          </p>
                        ) : (
                          <div>
                            <label className={labelClass} htmlFor={`open-${unit.id}`}>
                              Ouvert le
                            </label>
                            <DateSelector
                              id={`open-${unit.id}`}
                              value={openDates[unit.id] ?? unit.openedAt}
                              onChange={(value) =>
                                setOpenDates((current) => ({ ...current, [unit.id]: value }))
                              }
                              placeholder="Choisir la date d'ouverture"
                              minYear={currentYear - 10}
                              maxYear={currentYear}
                            />
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {!(unit.usedInSessions && unit.openedAt) && (
                            <button
                              type="button"
                              className={btnPrimary}
                              onClick={() => {
                                const date = openDates[unit.id];
                                if (!date) {
                                  setError("La date d'ouverture est obligatoire");
                                  return;
                                }
                                void run(async () => {
                                  await openUnit(unit.id, date);
                                  toast.success("Ouverture enregistrée");
                                  await refresh(lot.id);
                                });
                              }}
                            >
                              Enregistrer l&apos;ouverture
                            </button>
                          )}
                          {(
                            [
                              ["CONSUMPTION", "Terminé"],
                              ["LOSS", "Perdu"],
                              ["EXPIRATION", "Périmé"],
                              ["RETURN", "Renvoyé"],
                            ] as const
                          ).map(([type, label]) => (
                            <button
                              key={type}
                              type="button"
                              className={btnGhost}
                              disabled={busy}
                              onClick={() => void confirmExit(unit, index + 1, type)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-[14px] font-medium">Mouvements</h2>
        {loading ? (
          <p className="text-[13px] text-fg-muted">Chargement…</p>
        ) : movements.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[13px] text-fg-muted">
            Aucun mouvement.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-line bg-surface">
            {movements.map((movement, index) => (
              <li
                key={movement.id}
                className={
                  index > 0
                    ? "flex items-start justify-between gap-3 border-t border-line px-4 py-3"
                    : "flex items-start justify-between gap-3 px-4 py-3"
                }
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">
                    {movement.type === "CONSUMPTION" && movement.unitId
                      ? "Terminé"
                      : (MOVEMENT_LABELS[movement.type] ?? movement.type)}
                    {" · "}
                    {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-fg-muted">
                    {formatTimestamp(movement.createdAt)}
                    {movement.reason ? ` · ${movement.reason}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={busy}
                  onClick={() => void confirmUndo(movement)}
                >
                  Annuler
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[14px] font-medium">Séances liées</h2>
        <p className="mb-3 text-[12.5px] text-fg-muted">
          Traçabilité : chaque lien reste enregistré.
        </p>
        {loading ? (
          <p className="text-[13px] text-fg-muted">Chargement…</p>
        ) : sessions.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[13px] text-fg-muted">
            Aucune séance pour ce lot.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-line bg-surface">
            {sessions.map((item, index) => (
              <li
                key={`${item.sessionId}-${item.unitId ?? item.lotId}-${item.createdAt}`}
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
                  {item.bodyArea ? ` · ${item.bodyArea}` : ""}
                  {" · "}
                  {SESSION_STATUS_LABELS[item.status as SessionStatus] ?? item.status}
                  {item.quantity > 0 ? ` · ${item.quantity}` : ""}
                  {item.voidReason ? ` · lien annulé : ${item.voidReason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AuditHistory key={lot.id} target={{ kind: "lot", id: lot.id }} />
    </div>
  );
}
