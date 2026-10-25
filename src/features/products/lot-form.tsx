import { useEffect, useState, type FormEvent } from "react";
import { DateSelector } from "../../components/date-selector";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { sheetTypeLabel } from "../../lib/product-sheets";
import { useProductsStore, type LotSummary, type ProductSheet } from "../../stores/products-store";
import { toast } from "../../stores/toast-store";
import { FormHeader, Notice } from "./form-parts";
import { EditLotForm } from "./lot-edit-form";

/**
 * Réception d'un lot : on choisit la fiche produit, puis on saisit ce qui est
 * imprimé sur la boîte (numéro, dates) et la quantité.
 */
function NewLotForm({
  sheetId: initialSheetId = null,
  fixedSheet,
  onNewSheet,
  onDone,
}: {
  sheetId?: string | null;
  /** Réception sur la fiche : la fiche est déjà choisie, sans page autour. */
  fixedSheet?: ProductSheet;
  /** Ouvre la création d'une fiche (puis revient ici). */
  onNewSheet?: () => void;
  onDone: (saved?: LotSummary) => void;
}) {
  const { create, find, listAllSheets } = useProductsStore();
  const guardedLeave = useGuardedLeave();
  const [sheets, setSheets] = useState<ProductSheet[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState(initialSheetId ?? "");
  const [lotNumber, setLotNumber] = useState("");
  const [existing, setExisting] = useState<LotSummary | null>(null);
  const [expirationDate, setExpirationDate] = useState<string | null>(null);
  const [creationDate, setCreationDate] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const currentYear = new Date().getFullYear();
  const sheet = fixedSheet ?? sheets?.find((candidate) => candidate.id === sheetId) ?? null;

  useEffect(() => {
    if (fixedSheet) return;
    let cancelled = false;
    listAllSheets()
      .then((list) => {
        if (!cancelled) setSheets(list);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [fixedSheet, listAllSheets]);

  const dirty =
    !submitted &&
    (sheetId !== (initialSheetId ?? "") ||
      lotNumber !== "" ||
      expirationDate !== null ||
      creationDate !== null ||
      quantity !== "1");
  useUnsavedChanges(dirty);

  async function lookup(number: string, chosen: ProductSheet | null) {
    if (!chosen || number.trim() === "") {
      setExisting(null);
      return;
    }
    const found = await find(chosen.displayName, number);
    setExisting(found);
    if (found) {
      setExpirationDate(found.expirationDate);
      setCreationDate(found.creationDate);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sheet) {
      setError("Choisis la fiche produit");
      return;
    }
    if (!expirationDate) {
      setError("La date d'expiration est obligatoire");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("La quantité doit être un nombre positif");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await create({
        name: sheet.displayName,
        lotNumber: lotNumber.trim(),
        creationDate,
        expirationDate,
        singleUse: sheet.singleUse,
        afterOpeningMonths: sheet.afterOpeningMonths,
        productUrl: sheet.productUrl,
        quantity: qty,
        categoryId: sheet.categoryId,
        productId: sheet.id,
      });
      if (fixedSheet) {
        setLotNumber("");
        setExisting(null);
        setExpirationDate(null);
        setCreationDate(null);
        setQuantity("1");
      } else {
        setSubmitted(true);
      }
      toast.success(existing ? "Quantité ajoutée au lot" : "Lot ajouté au stock");
      onDone(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  const leave = () => void guardedLeave(() => onDone());
  const otherSheet =
    existing && existing.productId !== null && sheet && existing.productId !== sheet.id;

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={
        fixedSheet ? "flex flex-col gap-4" : "mx-auto flex max-w-xl flex-col gap-4 px-8 py-10"
      }
    >
      {!fixedSheet && <FormHeader title="Réception d'un lot" onBack={leave} />}

      {!fixedSheet && loadError && (
        <p role="alert" className="text-[13px] text-danger">
          {loadError}
        </p>
      )}

      {!fixedSheet && sheets && sheets.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-5 py-6 text-center">
          <p className="text-[14px] text-fg-muted">
            Il faut d&apos;abord une fiche produit : elle porte le nom, la marque, le type et la
            catégorie. Chaque lot reçu y sera rattaché.
          </p>
          <button type="button" onClick={onNewSheet} className={`${btnPrimary} mt-4`}>
            Créer une fiche produit
          </button>
        </div>
      ) : (
        <>
          {!fixedSheet && (
            <div>
              <label className={labelClass}>
                Fiche produit *
                <select
                  required
                  value={sheetId}
                  onChange={(event) => {
                    const next = sheets?.find((s) => s.id === event.target.value) ?? null;
                    setSheetId(event.target.value);
                    void lookup(lotNumber, next);
                  }}
                  disabled={sheets === null}
                  className={fieldClass}
                >
                  <option value="">{sheets === null ? "Chargement…" : "Choisir…"}</option>
                  {sheets?.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                      {option.categoryPath ? ` — ${option.categoryPath}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-1.5 flex items-center justify-between gap-3 text-[12.5px] text-fg-muted">
                <span>
                  {sheet ? sheetTypeLabel(sheet) : "Le type et la catégorie viennent de la fiche."}
                </span>
                <button
                  type="button"
                  onClick={onNewSheet}
                  className="shrink-0 text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                >
                  Nouvelle fiche produit
                </button>
              </div>
            </div>
          )}

          <label className={labelClass}>
            Numéro de lot *
            <input
              required
              autoFocus={fixedSheet !== undefined}
              value={lotNumber}
              onChange={(event) => {
                setLotNumber(event.target.value);
                setExisting(null);
              }}
              onBlur={() => void lookup(lotNumber, sheet)}
              className={fieldClass}
            />
          </label>

          {existing && !otherSheet && (
            <Notice>
              Ce lot est déjà en stock{existing.productId === null ? " (sans fiche)" : ""} : la
              quantité s&apos;ajoute
              {existing.productId === null ? " et il est rattaché à cette fiche" : ""}.
            </Notice>
          )}
          {otherSheet && (
            <Notice>
              Ce numéro est déjà enregistré sous la fiche « {existing.productName} ». Vérifie le
              numéro ou la fiche choisie.
            </Notice>
          )}

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
              disabled={existing !== null}
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
              disabled={existing !== null}
            />
          </div>

          <label className={labelClass}>
            {sheet && !sheet.singleUse ? "Nombre de pièces reçues *" : "Quantité reçue *"}
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
        </>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving || (!fixedSheet && !sheets?.length)}
          className={btnPrimary}
        >
          {saving ? "Enregistrement…" : "Enregistrer la réception"}
        </button>
        <button type="button" onClick={leave} className={btnGhost}>
          Annuler
        </button>
      </div>
    </form>
  );
}

export function LotForm({
  lot,
  sheetId,
  fixedSheet,
  onNewSheet,
  onDone,
}: {
  lot?: LotSummary;
  /** Fiche proposée pour une réception (celle qu'on regarde). */
  sheetId?: string | null;
  /** Réception déjà rattachée à une fiche, sans en-tête de page. */
  fixedSheet?: ProductSheet;
  onNewSheet?: () => void;
  onDone: (saved?: LotSummary) => void;
}) {
  return lot ? (
    <EditLotForm lot={lot} onDone={onDone} />
  ) : (
    <NewLotForm
      sheetId={fixedSheet?.id ?? sheetId}
      fixedSheet={fixedSheet}
      onNewSheet={onNewSheet}
      onDone={onDone}
    />
  );
}
