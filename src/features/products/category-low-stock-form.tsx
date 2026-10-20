import { useState, type FormEvent } from "react";
import { btnGhost, btnPrimary, inlineFieldClass } from "../../components/styles";
import { LOW_STOCK_MODES } from "../../lib/low-stock";
import type { Category, LowStockMode, LowStockSetting } from "../../stores/products-store";

/** Seuil de stock bas d'une catégorie : par produit, au total, ou aucun. */
export function LowStockForm({
  category,
  onSubmit,
  onCancel,
}: {
  category: Category;
  onSubmit: (setting: LowStockSetting) => Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<LowStockMode | "">(category.lowStockMode ?? "");
  const [threshold, setThreshold] = useState(category.lowStockThreshold?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(threshold);
    if (mode !== "" && (threshold.trim() === "" || !Number.isInteger(value) || value < 1)) {
      setError("Le seuil d'alerte doit être un nombre entier positif");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(mode === "" ? { mode: null, threshold: null } : { mode, threshold: value });
    } catch (submitError) {
      setError(String(submitError));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1.5 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          autoFocus
          value={mode}
          onChange={(event) => setMode(event.target.value as LowStockMode | "")}
          aria-label="Alerte de stock bas"
          className={`${inlineFieldClass} py-1.5`}
        >
          {LOW_STOCK_MODES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {mode !== "" && (
          <label className="flex items-center gap-2 text-[13px] text-fg-muted">
            alerte à
            <input
              type="number"
              min={1}
              step={1}
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              aria-label="Seuil d'alerte"
              className={`${inlineFieldClass} w-20 py-1.5`}
            />
            ou moins
          </label>
        )}
        <button type="submit" disabled={busy} className={btnPrimary}>
          Enregistrer
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btnGhost}>
          Annuler
        </button>
      </div>
      <p className="text-[12px] text-fg-faint">
        {mode === "TOTAL"
          ? "Alerte quand la somme du stock des produits de la catégorie (sous-catégories comprises) atteint le seuil."
          : mode === "EACH"
            ? "Seuil de chaque produit de la catégorie et de ses sous-catégories, sauf s'il a le sien."
            : "Les produits gardent leur propre seuil, s'ils en ont un."}
      </p>
      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
