import { useState, type FormEvent } from "react";
import { DateSelector } from "../../components/date-selector";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { useProductsStore, type LotSummary } from "../../stores/products-store";
import { toast } from "../../stores/toast-store";
import { CategorySelect } from "./category-select";
import { FormHeader, Notice } from "./form-parts";
import { emptyToNull } from "./lot-labels";

/** Correction d'un lot déjà reçu. Son identité est figée s'il a servi en séance. */
export function EditLotForm({
  lot,
  onDone,
}: {
  lot: LotSummary;
  onDone: (saved?: LotSummary) => void;
}) {
  const { update, categories } = useProductsStore();
  const guardedLeave = useGuardedLeave();
  const [name, setName] = useState(lot.name);
  const [lotNumber, setLotNumber] = useState(lot.lotNumber);
  const [categoryId, setCategoryId] = useState<string | null>(lot.categoryId);
  const [creationDate, setCreationDate] = useState<string | null>(lot.creationDate);
  const [expirationDate, setExpirationDate] = useState<string | null>(lot.expirationDate);
  const [afterOpeningMonths, setAfterOpeningMonths] = useState(
    lot.afterOpeningMonths?.toString() ?? "",
  );
  const [productUrl, setProductUrl] = useState(lot.productUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const currentYear = new Date().getFullYear();
  /** Lot déjà utilisé en séance : son identité est figée (règle vérifiée en Rust). */
  const identityLocked = lot.sessionCount > 0;
  const dirty =
    !submitted &&
    (name !== lot.name ||
      lotNumber !== lot.lotNumber ||
      creationDate !== lot.creationDate ||
      expirationDate !== lot.expirationDate ||
      afterOpeningMonths !== (lot.afterOpeningMonths?.toString() ?? "") ||
      productUrl !== (lot.productUrl ?? "") ||
      categoryId !== lot.categoryId);
  useUnsavedChanges(dirty);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!expirationDate) {
      setError("La date d'expiration est obligatoire");
      return;
    }
    let months: number | null = null;
    if (!lot.singleUse && afterOpeningMonths.trim() !== "") {
      months = Number(afterOpeningMonths);
      if (!Number.isInteger(months) || months <= 0) {
        setError("La durée après ouverture doit être un nombre de mois positif");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await update(lot.id, {
        name: name.trim(),
        lotNumber: lotNumber.trim(),
        creationDate,
        expirationDate,
        afterOpeningMonths: lot.singleUse ? null : months,
        productUrl: emptyToNull(productUrl),
        categoryId,
      });
      setSubmitted(true);
      toast.success("Lot enregistré");
      onDone(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  const leave = () => void guardedLeave(() => onDone());

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="mx-auto flex max-w-xl flex-col gap-4 px-8 py-10"
    >
      <FormHeader title="Modifier le lot" onBack={leave} />

      {identityLocked && (
        <Notice>
          Ce lot a servi dans {lot.sessionCount} séance{lot.sessionCount > 1 ? "s" : ""}. Son nom,
          son numéro, sa péremption et sa durée après ouverture figurent dans l&apos;historique de
          traçabilité : ils ne sont plus modifiables. Si une valeur est fausse, crée un nouveau lot.
        </Notice>
      )}

      <label className={labelClass}>
        Nom *
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={identityLocked}
          className={fieldClass}
        />
      </label>

      {lot.productId ? (
        <p className="text-[13px] text-fg-muted">
          Catégorie : {lot.categoryPath ?? "sans catégorie"} (celle de la fiche «{" "}
          {[lot.productBrand, lot.productName].filter(Boolean).join(" ")} »).
        </p>
      ) : (
        <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
      )}

      <label className={labelClass}>
        Numéro de lot *
        <input
          required
          value={lotNumber}
          onChange={(event) => setLotNumber(event.target.value)}
          disabled={identityLocked}
          className={fieldClass}
        />
      </label>

      <p className="text-[13px] text-fg-muted">
        Type : {lot.singleUse ? "usage unique" : "usage multiple"} (ne change pas).
      </p>

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
          disabled={identityLocked}
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
        />
      </div>

      {!lot.singleUse && (
        <label className={labelClass}>
          Durée après ouverture (mois)
          <input
            type="number"
            min={1}
            step={1}
            value={afterOpeningMonths}
            onChange={(event) => setAfterOpeningMonths(event.target.value)}
            disabled={identityLocked}
            placeholder="Ex. 12"
            className={fieldClass}
          />
        </label>
      )}

      <label className={labelClass}>
        Lien du produit
        <input
          type="url"
          value={productUrl}
          onChange={(event) => setProductUrl(event.target.value)}
          placeholder="https://…"
          className={fieldClass}
        />
      </label>

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={leave} className={btnGhost}>
          Annuler
        </button>
      </div>
    </form>
  );
}
