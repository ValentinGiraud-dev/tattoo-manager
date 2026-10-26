import { useEffect, useState, type FormEvent } from "react";
import {
  btnGhost,
  btnPrimary,
  cardClass,
  fieldClass,
  inlineFieldClass,
  labelClass,
} from "../../components/styles";
import { InfoTip } from "../../components/info-tip";
import { useGuardedLeave, useUnsavedChanges } from "../../components/unsaved-changes";
import { formatIsoDate } from "../../lib/format";
import { inheritedThreshold } from "../../lib/low-stock";
import { attachCandidates, preselectedLots, sheetInputFromLot } from "../../lib/product-sheets";
import {
  useProductsStore,
  type LotSummary,
  type ProductSheet,
  type ProductSheetInput,
} from "../../stores/products-store";
import { toast } from "../../stores/toast-store";
import { CategorySelect } from "./category-select";
import { emptyToNull } from "./lot-labels";

function TypeToggle({
  singleUse,
  onChange,
  disabled,
}: {
  singleUse: boolean;
  onChange: (singleUse: boolean) => void;
  disabled: boolean;
}) {
  const option = (value: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={singleUse === value}
      onClick={() => onChange(value)}
      disabled={disabled}
      className={[
        "rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-60",
        singleUse === value
          ? "bg-accent text-accent-fg"
          : "border border-line-strong text-fg-muted hover:bg-surface-3",
      ].join(" ")}
    >
      {label}
    </button>
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="flex items-center gap-0.5 text-[12.5px] font-medium text-fg-muted">
        Type *
        {disabled ? null : (
          <InfoTip label="Type">
            Usage unique : aiguilles, cartouches, gants. Usage multiple : encres et tout produit
            entamé puis réutilisé.
          </InfoTip>
        )}
      </legend>
      <div className="mt-1 flex gap-2">
        {option(true, "Usage unique")}
        {option(false, "Usage multiple")}
      </div>
      {disabled ? (
        <p className="text-[12.5px] text-fg-muted">
          La fiche a déjà des lots : son type ne change plus.
        </p>
      ) : null}
    </fieldset>
  );
}

type AlertChoice = "inherit" | "none" | "custom";
type ExpiryChoice = "default" | "none" | "custom";

function alertChoice(threshold: number | null): AlertChoice {
  if (threshold === null) return "inherit";
  return threshold === 0 ? "none" : "custom";
}

function expiryChoice(days: number | null): ExpiryChoice {
  if (days === null) return "default";
  return days === 0 ? "none" : "custom";
}

/**
 * Création ou modification d'une fiche produit. Créée depuis un lot sans fiche
 * (`fromLot`), elle est pré-remplie et propose d'y rattacher ses homonymes.
 */
export function SheetForm({
  sheet,
  fromLot,
  defaultCategoryId = null,
  locked = false,
  onDone,
}: {
  sheet?: ProductSheet;
  fromLot?: LotSummary;
  defaultCategoryId?: string | null;
  /** Fiche archivée : les champs se lisent, rien ne s'enregistre. */
  locked?: boolean;
  onDone: (saved?: ProductSheet) => void;
}) {
  const { categories, createSheet, updateSheet, listAllLots } = useProductsStore();
  const guardedLeave = useGuardedLeave();
  const initial: ProductSheetInput = sheet
    ? {
        name: sheet.name,
        brand: sheet.brand,
        categoryId: sheet.categoryId,
        singleUse: sheet.singleUse,
        afterOpeningMonths: sheet.afterOpeningMonths,
        productUrl: sheet.productUrl,
        lowStockThreshold: sheet.lowStockThreshold,
        expiryWarningDays: sheet.expiryWarningDays,
      }
    : fromLot
      ? sheetInputFromLot(fromLot)
      : {
          name: "",
          brand: null,
          categoryId: defaultCategoryId,
          singleUse: true,
          afterOpeningMonths: null,
          productUrl: null,
          lowStockThreshold: null,
          expiryWarningDays: null,
        };
  const [name, setName] = useState(initial.name);
  const [brand, setBrand] = useState(initial.brand ?? "");
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [singleUse, setSingleUse] = useState(initial.singleUse);
  const [months, setMonths] = useState(initial.afterOpeningMonths?.toString() ?? "");
  const [productUrl, setProductUrl] = useState(initial.productUrl ?? "");
  const [alert, setAlert] = useState<AlertChoice>(alertChoice(initial.lowStockThreshold));
  const [alertValue, setAlertValue] = useState(
    initial.lowStockThreshold ? String(initial.lowStockThreshold) : "",
  );
  const [expiry, setExpiry] = useState<ExpiryChoice>(expiryChoice(initial.expiryWarningDays));
  const [expiryValue, setExpiryValue] = useState(
    initial.expiryWarningDays ? String(initial.expiryWarningDays) : "",
  );
  const inherited = inheritedThreshold(categories, categoryId);
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Lots sans fiche, proposés au rattachement (création seulement).
  useEffect(() => {
    if (sheet) return;
    let cancelled = false;
    listAllLots()
      .then((all) => {
        if (cancelled) return;
        setLots(all);
        if (fromLot) setSelected(preselectedLots(all, fromLot));
      })
      .catch(() => {
        // Sans la liste, la fiche se crée quand même ; les lots se rattachent ensuite.
      });
    return () => {
      cancelled = true;
    };
  }, [sheet, fromLot, listAllLots]);

  const candidates = attachCandidates(lots, singleUse);
  const chosen = selected.filter((id) => candidates.some((lot) => lot.id === id));
  const typeLocked = (sheet?.lotCount ?? 0) > 0;

  const dirty =
    !submitted &&
    (name !== initial.name ||
      brand !== (initial.brand ?? "") ||
      categoryId !== initial.categoryId ||
      singleUse !== initial.singleUse ||
      months !== (initial.afterOpeningMonths?.toString() ?? "") ||
      productUrl !== (initial.productUrl ?? "") ||
      alert !== alertChoice(initial.lowStockThreshold) ||
      (alert === "custom" && alertValue !== String(initial.lowStockThreshold ?? "")) ||
      expiry !== expiryChoice(initial.expiryWarningDays) ||
      (expiry === "custom" && expiryValue !== String(initial.expiryWarningDays ?? "")));
  useUnsavedChanges(dirty);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    if (name.trim() === "") {
      setError("Le nom du produit est obligatoire");
      return;
    }
    let afterOpeningMonths: number | null = null;
    if (!singleUse && months.trim() !== "") {
      afterOpeningMonths = Number(months);
      if (!Number.isInteger(afterOpeningMonths) || afterOpeningMonths <= 0) {
        setError("La durée après ouverture doit être un nombre de mois positif");
        return;
      }
    }
    let lowStockThreshold: number | null = alert === "none" ? 0 : null;
    if (alert === "custom") {
      lowStockThreshold = Number(alertValue);
      if (
        alertValue.trim() === "" ||
        !Number.isInteger(lowStockThreshold) ||
        lowStockThreshold < 1
      ) {
        setError("Le seuil d'alerte doit être un nombre entier positif");
        return;
      }
    }
    let expiryWarningDays: number | null = expiry === "none" ? 0 : null;
    if (expiry === "custom") {
      expiryWarningDays = Number(expiryValue);
      if (
        expiryValue.trim() === "" ||
        !Number.isInteger(expiryWarningDays) ||
        expiryWarningDays < 1 ||
        expiryWarningDays > 3650
      ) {
        setError("Le délai d'alerte doit être un nombre entier de jours, entre 1 et 3 650");
        return;
      }
    }
    const input: ProductSheetInput = {
      name: name.trim(),
      brand: emptyToNull(brand),
      categoryId,
      singleUse,
      afterOpeningMonths,
      productUrl: emptyToNull(productUrl),
      lowStockThreshold,
      expiryWarningDays,
    };
    setSaving(true);
    setError(null);
    try {
      const saved = sheet ? await updateSheet(sheet.id, input) : await createSheet(input, chosen);
      setSubmitted(true);
      toast.success(
        sheet
          ? "Fiche produit enregistrée"
          : chosen.length > 0
            ? `Fiche créée · ${chosen.length} lot${chosen.length > 1 ? "s" : ""} rattaché${chosen.length > 1 ? "s" : ""}`
            : "Fiche produit créée",
      );
      onDone(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  function leave() {
    void guardedLeave(() => onDone());
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <fieldset disabled={locked} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Nom *
            <input
              autoFocus
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex. Triple Black, Aiguille 3RL"
              maxLength={120}
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            Marque
            <input
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              placeholder="Ex. Dynamic"
              maxLength={120}
              className={fieldClass}
            />
          </label>
        </div>

        <CategorySelect
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
          disabled={locked}
        />

        <TypeToggle singleUse={singleUse} onChange={setSingleUse} disabled={typeLocked} />

        {!singleUse && (
          <label className={labelClass}>
            Durée après ouverture (mois)
            <input
              type="number"
              min={1}
              step={1}
              value={months}
              onChange={(event) => setMonths(event.target.value)}
              placeholder="Ex. 12"
              className={fieldClass}
            />
          </label>
        )}

        <label className={labelClass}>
          <span className="inline-flex items-center gap-0.5">
            Lien du produit
            {sheet ? (
              <InfoTip label="Lien du produit">
                La durée après ouverture et le lien servent aux prochains lots. Les lots déjà reçus
                gardent les leurs. La catégorie s&apos;applique à tous les lots de la fiche.
              </InfoTip>
            ) : null}
          </span>
          <input
            type="url"
            value={productUrl}
            onChange={(event) => setProductUrl(event.target.value)}
            placeholder="https://…"
            className={fieldClass}
          />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="flex items-center gap-0.5 text-[12.5px] font-medium text-fg-muted">
            Alerte de stock bas
            <InfoTip label="Alerte de stock bas">
              Compté sur les lots non périmés de la fiche. Les seuils des catégories se règlent dans
              « Gérer » les catégories.
            </InfoTip>
          </legend>
          {(
            [
              [
                "inherit",
                inherited
                  ? `Comme la catégorie : alerte à ${inherited.threshold} ou moins (${inherited.path})`
                  : "Comme la catégorie (aucun seuil réglé pour l'instant)",
              ],
              ["none", "Pas d'alerte pour ce produit"],
              ["custom", "Alerte quand il en reste"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2.5 text-[13.5px] text-fg">
              <input
                type="radio"
                name="low-stock"
                checked={alert === value}
                onChange={() => setAlert(value)}
              />
              {label}
              {value === "custom" && (
                <>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={alertValue}
                    onFocus={() => setAlert("custom")}
                    onChange={(event) => {
                      setAlert("custom");
                      setAlertValue(event.target.value);
                    }}
                    aria-label="Seuil d'alerte"
                    className={`${inlineFieldClass} w-20`}
                  />
                  <span>{singleUse ? "ou moins" : "pièces ou moins"}</span>
                </>
              )}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="flex items-center gap-0.5 text-[12.5px] font-medium text-fg-muted">
            Alerte d&apos;expiration
            <InfoTip label="Alerte d'expiration">
              Sur les lots et les pièces encore en stock. Pour une pièce ouverte, c&apos;est la plus
              proche entre la date d&apos;expiration et la fin de la durée après ouverture. Un
              produit déjà périmé reste signalé.
            </InfoTip>
          </legend>
          {(
            [
              ["default", "30 jours avant (par défaut)"],
              ["none", "Pas d'alerte pour ce produit"],
              ["custom", "Alerte"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2.5 text-[13.5px] text-fg">
              <input
                type="radio"
                name="expiry-warning"
                checked={expiry === value}
                onChange={() => setExpiry(value)}
              />
              {label}
              {value === "custom" && (
                <>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={expiryValue}
                    onFocus={() => setExpiry("custom")}
                    onChange={(event) => {
                      setExpiry("custom");
                      setExpiryValue(event.target.value);
                    }}
                    aria-label="Délai d'alerte"
                    className={`${inlineFieldClass} w-20`}
                  />
                  <span>jours avant</span>
                </>
              )}
            </label>
          ))}
        </fieldset>

        {!sheet && candidates.length > 0 && (
          <fieldset className={`${cardClass} flex flex-col gap-1 p-4`}>
            <legend className="sr-only">Lots à rattacher</legend>
            <p className="mb-2 flex items-center gap-1 text-[13.5px] font-medium text-fg">
              Rattacher des lots sans fiche
              <InfoTip label="Rattacher des lots sans fiche">
                Leur nom, leur numéro et leur péremption ne changent pas. Ils sont rangés dans la
                catégorie de la fiche.
              </InfoTip>
            </p>
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {candidates.map((lot) => (
                <label
                  key={lot.id}
                  className="flex items-center gap-2.5 rounded-sm px-1 py-1.5 text-[13.5px] text-fg hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(lot.id)}
                    onChange={() => toggle(lot.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {lot.name} · lot {lot.lotNumber}
                  </span>
                  <span className="shrink-0 text-[12px] text-fg-faint">
                    exp. {formatIsoDate(lot.expirationDate)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </fieldset>

      {!locked && (
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? "Enregistrement…" : sheet ? "Enregistrer" : "Ajouter"}
          </button>
          <button type="button" onClick={leave} className={btnGhost}>
            Annuler
          </button>
        </div>
      )}
    </form>
  );
}
