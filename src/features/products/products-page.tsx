import { useEffect, useState, type FormEvent } from "react";
import { useConfirm } from "../../components/use-confirm";
import { DateSelector } from "../../components/date-selector";
import { SESSION_STATUS_LABELS } from "../../lib/labels";
import type { SessionStatus } from "../../stores/sessions-store";
import { formatIsoDate, formatTimestamp } from "../../lib/format";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import {
  useProductsStore,
  type LotSessionItem,
  type LotSummary,
  type StockMovement,
  type UnitView,
} from "../../stores/products-store";

type View =
  { kind: "list" } | { kind: "form"; lot?: LotSummary } | { kind: "detail"; lot: LotSummary };

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

const fieldClass =
  "mt-1.5 w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[14px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-faint focus:border-accent";
const labelClass = "block text-[12.5px] font-medium text-fg-muted";
const btnPrimary =
  "inline-flex items-center rounded-pill bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-fg transition-[filter] hover:brightness-110 disabled:opacity-45";
const btnGhost =
  "inline-flex items-center rounded-pill border border-line-strong px-3.5 py-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-45";

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE: "Réception",
  CONSUMPTION: "Consommation",
  LOSS: "Perte",
  EXPIRATION: "Péremption",
  RETURN: "Retour",
  ADJUSTMENT: "Ajustement",
};

const MOVEMENT_ARTICLE: Record<string, string> = {
  LOSS: "cette perte",
  EXPIRATION: "cette péremption",
  RETURN: "ce retour",
  ADJUSTMENT: "cet ajustement",
};

const EXIT_ACTIONS: Record<string, { title: string; label: string; body: string }> = {
  CONSUMPTION: {
    title: "Marquer cette pièce comme terminée ?",
    label: "Marquer terminée",
    body: "La pièce sort du stock et ne sera plus proposée dans les séances.",
  },
  LOSS: {
    title: "Déclarer cette pièce perdue ?",
    label: "Déclarer perdue",
    body: "La pièce sort du stock et ne sera plus proposée dans les séances.",
  },
  EXPIRATION: {
    title: "Sortir cette pièce comme périmée ?",
    label: "Sortir comme périmée",
    body: "La pièce sort du stock et ne sera plus proposée dans les séances.",
  },
  RETURN: {
    title: "Renvoyer cette pièce ?",
    label: "Renvoyer la pièce",
    body: "La pièce sort du stock (retour fournisseur) et ne sera plus proposée dans les séances.",
  },
};

const EXIT_LABELS: Record<string, string> = {
  CONSUMPTION: "Terminé",
  LOSS: "Perdu",
  EXPIRATION: "Périmé",
  RETURN: "Renvoyé",
};

function stockLabel(lot: LotSummary): string {
  if (lot.singleUse) {
    if (lot.movementCount === 0) return "Stock non renseigné";
    return `${lot.stock} restant${lot.stock > 1 ? "s" : ""}`;
  }
  const sealed = `${lot.sealedCount} scellé${lot.sealedCount > 1 ? "s" : ""}`;
  const opened = `${lot.openedCount} ouvert${lot.openedCount > 1 ? "s" : ""}`;
  return `${lot.stock} en stock · ${sealed} · ${opened}`;
}

function LotForm({ lot, onDone }: { lot?: LotSummary; onDone: (saved?: LotSummary) => void }) {
  const { create, update, find } = useProductsStore();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(lot?.name ?? "");
  const [lotNumber, setLotNumber] = useState(lot?.lotNumber ?? "");
  const [existing, setExisting] = useState<LotSummary | null>(null);
  const [creationDate, setCreationDate] = useState<string | null>(lot?.creationDate ?? null);
  const [expirationDate, setExpirationDate] = useState<string | null>(lot?.expirationDate ?? null);
  const [singleUse, setSingleUse] = useState(lot?.singleUse ?? true);
  const [afterOpeningMonths, setAfterOpeningMonths] = useState(
    lot?.afterOpeningMonths?.toString() ?? "",
  );
  const [productUrl, setProductUrl] = useState(lot?.productUrl ?? "");
  const [quantity, setQuantity] = useState("1");
  const currentYear = new Date().getFullYear();
  const locked = existing != null;
  /** Lot déjà utilisé en séance : son identité est figée (règle vérifiée en Rust). */
  const identityLocked = (lot?.sessionCount ?? 0) > 0;
  const fieldClassLocked = `${fieldClass} disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted`;
  const [submitted, setSubmitted] = useState(false);
  const guardedLeave = useGuardedLeave();
  const dirty =
    !submitted &&
    (name !== (lot?.name ?? "") ||
      lotNumber !== (lot?.lotNumber ?? "") ||
      creationDate !== (lot?.creationDate ?? null) ||
      expirationDate !== (lot?.expirationDate ?? null) ||
      singleUse !== (lot?.singleUse ?? true) ||
      afterOpeningMonths !== (lot?.afterOpeningMonths?.toString() ?? "") ||
      productUrl !== (lot?.productUrl ?? "") ||
      (!lot && quantity !== "1"));
  useUnsavedChanges(dirty);

  async function lookup() {
    if (lot) return;
    const found = await find(name, lotNumber);
    setExisting(found);
    if (!found) return;
    setSingleUse(found.singleUse);
    setExpirationDate(found.expirationDate);
    setCreationDate(found.creationDate);
    setAfterOpeningMonths(found.afterOpeningMonths?.toString() ?? "");
    setProductUrl(found.productUrl ?? "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!expirationDate) {
      setError("La date d'expiration est obligatoire");
      return;
    }
    let months: number | null = null;
    if (!singleUse && afterOpeningMonths.trim() !== "") {
      months = Number(afterOpeningMonths);
      if (!Number.isInteger(months) || months <= 0) {
        setError("La durée après ouverture doit être un nombre de mois positif");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      if (lot) {
        const saved = await update(lot.id, {
          name: name.trim(),
          lotNumber: lotNumber.trim(),
          creationDate,
          expirationDate,
          afterOpeningMonths: singleUse ? null : months,
          productUrl: emptyToNull(productUrl),
        });
        setSubmitted(true);
        onDone(saved);
        return;
      }
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        setError("La quantité doit être un nombre positif");
        setSaving(false);
        return;
      }
      const saved = await create({
        name: name.trim(),
        lotNumber: lotNumber.trim(),
        creationDate,
        expirationDate,
        singleUse,
        afterOpeningMonths: singleUse ? null : months,
        productUrl: emptyToNull(productUrl),
        quantity: qty,
      });
      setSubmitted(true);
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
          onClick={() => void guardedLeave(() => onDone())}
          className="mb-4 text-[13px] text-fg-muted hover:text-fg"
        >
          ← Retour
        </button>
        <h1 className="text-[24px] font-medium tracking-tight">
          {lot ? "Modifier le lot" : "Nouveau lot"}
        </h1>
      </div>

      {locked && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
          Ce lot existe déjà. Seule la quantité sera ajoutée.
        </p>
      )}

      {identityLocked && lot && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
          Ce lot a servi dans {lot.sessionCount} séance{lot.sessionCount > 1 ? "s" : ""}. Son nom,
          son numéro, sa péremption et sa durée après ouverture figurent dans l&apos;historique de
          traçabilité : ils ne sont plus modifiables. Si une valeur est fausse, crée un nouveau lot.
        </p>
      )}

      <label className={labelClass}>
        Nom *
        <input
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setExisting(null);
          }}
          onBlur={() => void lookup()}
          disabled={identityLocked}
          placeholder="Ex. Encre noire, aiguille 3RL"
          className={fieldClassLocked}
        />
      </label>

      <label className={labelClass}>
        Numéro de lot *
        <input
          required
          value={lotNumber}
          onChange={(event) => {
            setLotNumber(event.target.value);
            setExisting(null);
          }}
          onBlur={() => void lookup()}
          disabled={identityLocked}
          className={fieldClassLocked}
        />
        <p className="mt-1.5 text-[12.5px] text-fg-muted">
          Une boîte qui mélange plusieurs tailles se saisit en un lot par taille, avec le même
          numéro.
        </p>
      </label>

      <fieldset className="flex flex-col gap-2" disabled={locked || Boolean(lot)}>
        <legend className={labelClass}>Type *</legend>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setSingleUse(true)}
            className={[
              "rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              singleUse
                ? "bg-accent text-accent-fg"
                : "border border-line-strong text-fg-muted hover:bg-surface-3",
            ].join(" ")}
          >
            Usage unique
          </button>
          <button
            type="button"
            onClick={() => setSingleUse(false)}
            className={[
              "rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              !singleUse
                ? "bg-accent text-accent-fg"
                : "border border-line-strong text-fg-muted hover:bg-surface-3",
            ].join(" ")}
          >
            Usage multiple
          </button>
        </div>
      </fieldset>

      <div>
        <label htmlFor="lot-expiration" className={labelClass}>
          Date d&apos;expiration *
        </label>
        <DateSelector
          id="lot-expiration"
          value={expirationDate}
          onChange={setExpirationDate}
          placeholder="Choisir la date d'expiration"
          minYear={currentYear - 5}
          maxYear={currentYear + 20}
          disabled={locked || identityLocked}
        />
      </div>

      <div>
        <label htmlFor="lot-creation" className={labelClass}>
          Date de fabrication
        </label>
        <DateSelector
          id="lot-creation"
          value={creationDate}
          onChange={setCreationDate}
          placeholder="Optionnel"
          minYear={currentYear - 20}
          maxYear={currentYear + 1}
          disabled={locked}
        />
      </div>

      {!singleUse && (
        <label className={labelClass}>
          Durée après ouverture (mois)
          <input
            type="number"
            min={1}
            step={1}
            value={afterOpeningMonths}
            onChange={(event) => setAfterOpeningMonths(event.target.value)}
            disabled={locked || identityLocked}
            placeholder="Ex. 12"
            className={fieldClassLocked}
          />
        </label>
      )}

      {!lot && (
        <label className={labelClass}>
          {singleUse ? "Quantité reçue *" : "Nombre de pièces *"}
          <input
            required
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={fieldClass}
          />
        </label>
      )}

      <label className={labelClass}>
        URL produit
        <input
          type="url"
          value={productUrl}
          onChange={(event) => setProductUrl(event.target.value)}
          disabled={locked}
          placeholder="https://…"
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

function MovementForm({ lot, onSaved }: { lot: LotSummary; onSaved: (lot: LotSummary) => void }) {
  const recordMovement = useProductsStore((state) => state.recordMovement);
  const confirm = useConfirm();
  const [movementType, setMovementType] = useState("PURCHASE");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty === 0 || (movementType !== "ADJUSTMENT" && qty < 0)) {
      setError(
        movementType === "ADJUSTMENT"
          ? "L'ajustement est un nombre non nul, négatif pour retirer"
          : "La quantité doit être un nombre positif",
      );
      return;
    }
    if (movementType !== "PURCHASE") {
      const signed = movementType === "ADJUSTMENT" ? qty : -qty;
      const ok = await confirm({
        title: `Enregistrer ${MOVEMENT_ARTICLE[movementType] ?? "ce mouvement"} ?`,
        details: [
          `${lot.name} · lot ${lot.lotNumber}`,
          `${MOVEMENT_LABELS[movementType] ?? movementType} : ${signed > 0 ? `+${signed}` : signed}`,
          `Stock actuel : ${lot.stock}`,
          ...(reason.trim() ? [`Raison : ${reason.trim()}`] : []),
        ],
        body: "Le mouvement s'ajoute à l'historique du lot. Pour le corriger, il faudra l'annuler par un mouvement inverse.",
        confirmLabel: "Enregistrer le mouvement",
        cancelLabel: "Retour",
        tone: signed < 0 ? "danger" : "default",
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await recordMovement({
        lotId: lot.id,
        movementType,
        quantity: qty,
        reason: emptyToNull(reason),
      });
      setReason("");
      onSaved(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <h2 className="text-[14px] font-medium">Mouvement de stock</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Type
          <select
            value={movementType}
            onChange={(event) => setMovementType(event.target.value)}
            className={fieldClass}
          >
            <option value="PURCHASE">Réception</option>
            <option value="LOSS">Perte</option>
            <option value="EXPIRATION">Péremption</option>
            <option value="RETURN">Retour</option>
            <option value="ADJUSTMENT">Ajustement</option>
          </select>
        </label>
        <label className={labelClass}>
          Quantité
          <input
            type="number"
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      <label className={labelClass}>
        Raison {movementType === "ADJUSTMENT" ? "*" : ""}
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required={movementType === "ADJUSTMENT"}
          placeholder={movementType === "ADJUSTMENT" ? "Ex. comptage" : "Optionnel"}
          className={fieldClass}
        />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <button type="submit" disabled={saving} className={`${btnPrimary} self-start`}>
        {saving ? "Enregistrement…" : "Enregistrer le mouvement"}
      </button>
    </form>
  );
}

function LotDetail({
  lot,
  onEdit,
  onBack,
  onChange,
}: {
  lot: LotSummary;
  onEdit: () => void;
  onBack: () => void;
  onChange: (lot: LotSummary) => void;
}) {
  const { listSessions, listUnits, listMovements, openUnit, exitUnit, undoMovement, get } =
    useProductsStore();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<LotSessionItem[]>([]);
  const [units, setUnits] = useState<UnitView[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openDates, setOpenDates] = useState<Record<string, string | null>>({});
  const currentYear = new Date().getFullYear();

  async function refresh(next = lot) {
    const [sessionItems, unitItems, movementItems] = await Promise.all([
      listSessions(next.id),
      listUnits(next.id),
      listMovements(next.id),
    ]);
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
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh()
      .then(() => {
        if (!cancelled) setError(null);
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
  }, [listMovements, listSessions, listUnits, lot.id]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      const next = await get(lot.id);
      onChange(next);
      await refresh(next);
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
    });
  }

  const rows: [string, string | null][] = [
    ["Lot", lot.lotNumber],
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
      <button
        type="button"
        onClick={onBack}
        className="self-start text-[13px] text-fg-muted hover:text-fg"
      >
        ← Produits
      </button>
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
        <button type="button" onClick={onEdit} className={btnPrimary}>
          Modifier
        </button>
      </div>

      {lot.expired && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted">
          La date de péremption est dépassée. Le lot reste utilisable : rien n&apos;est jeté
          automatiquement.
        </p>
      )}

      <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-[13.5px]">
            <dt className="text-fg-faint">{label}</dt>
            <dd className="break-all whitespace-pre-wrap text-fg">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {lot.singleUse ? (
        <MovementForm
          lot={lot}
          onSaved={(saved) => {
            onChange(saved);
            void refresh(saved);
          }}
        />
      ) : (
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
                    {unit.inStock && (
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
                                  await refresh();
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
      )}

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
                <p className="text-[14px] font-medium">
                  {item.clientFirstName} {item.clientLastName}
                </p>
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
    </div>
  );
}

export default function ProductsPage() {
  const { lots, search, loading, error, load } = useProductsStore();
  const [view, setView] = useState<View>({ kind: "list" });

  useEffect(() => {
    void load("");
  }, [load]);

  if (view.kind === "form") {
    return (
      <LotForm
        lot={view.lot}
        onDone={(saved) =>
          setView(
            saved
              ? { kind: "detail", lot: saved }
              : view.lot
                ? { kind: "detail", lot: view.lot }
                : { kind: "list" },
          )
        }
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <LotDetail
        lot={view.lot}
        onEdit={() => setView({ kind: "form", lot: view.lot })}
        onBack={() => setView({ kind: "list" })}
        onChange={(lot) => setView({ kind: "detail", lot })}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-medium tracking-tight">Produits</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {loading ? "Chargement…" : `${lots.length} lot${lots.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button type="button" onClick={() => setView({ kind: "form" })} className={btnPrimary}>
          Nouveau lot
        </button>
      </div>

      <input
        type="search"
        placeholder="Rechercher (nom, lot)…"
        value={search}
        onChange={(event) => void load(event.target.value)}
        className={fieldClass}
      />

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {!loading && lots.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-5 py-10 text-center">
          <p className="text-[14px] text-fg-muted">
            {search ? "Aucun résultat." : "Aucun lot pour le moment."}
          </p>
          {!search && (
            <button
              type="button"
              onClick={() => setView({ kind: "form" })}
              className={`${btnGhost} mt-4`}
            >
              Créer le premier lot
            </button>
          )}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {lots.map((lot, index) => (
            <li key={lot.id} className={index > 0 ? "border-t border-line" : undefined}>
              <button
                type="button"
                onClick={() => setView({ kind: "detail", lot })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] font-medium">{lot.name}</span>
                    <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-[11px] text-fg-muted">
                      {lot.singleUse ? "Unique" : "Multiple"}
                    </span>
                    {lot.expired && (
                      <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-[11px] text-fg-muted">
                        Périmé
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">
                    Lot {lot.lotNumber} · exp. {formatIsoDate(lot.expirationDate)} ·{" "}
                    {stockLabel(lot)}
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
