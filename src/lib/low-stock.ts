/**
 * Libellés du stock bas. Les seuils appliqués et l'état « stock bas » sont
 * calculés en Rust (`services/low_stock.rs`) ; ici on ne fait que les dire.
 */
import type { Category, LinkableItem, LowStockMode, ProductSheet } from "../stores/products-store";

/** « 2 ou moins », « 1 pièce ou moins ». */
function atOrBelow(threshold: number, singleUse: boolean): string {
  if (singleUse) return `${threshold} ou moins`;
  return `${threshold} pièce${threshold > 1 ? "s" : ""} ou moins`;
}

/** Seuil appliqué à une fiche, et d'où il vient. */
export function sheetThresholdLabel(sheet: ProductSheet): string {
  if (sheet.alertThreshold === null) {
    return sheet.lowStockThreshold === 0 ? "Pas d'alerte (réglé sur la fiche)" : "Pas d'alerte";
  }
  const level = `Alerte à ${atOrBelow(sheet.alertThreshold, sheet.singleUse)}`;
  return sheet.alertSource ? `${level} (catégorie ${sheet.alertSource})` : level;
}

/** Réglage d'une catégorie : « 2 par produit », « 5 au total », ou `null`. */
export function categoryAlertLabel(category: Pick<Category, "lowStockMode" | "lowStockThreshold">) {
  if (category.lowStockMode === null || category.lowStockThreshold === null) return null;
  return category.lowStockMode === "EACH"
    ? `Alerte à ${category.lowStockThreshold} ou moins, par produit`
    : `Alerte à ${category.lowStockThreshold} ou moins, au total`;
}

/**
 * Seuil « par produit » que la catégorie transmettrait à une nouvelle fiche
 * (catégorie la plus proche réglée par produit). Aide d'affichage du formulaire :
 * Rust recalcule le seuil appliqué à l'enregistrement.
 */
export function inheritedThreshold(
  categories: Category[],
  categoryId: string | null,
): { threshold: number; path: string } | null {
  const byId = new Map(categories.map((category) => [category.id, category]));
  let current = categoryId;
  for (let depth = 0; current && depth < 50; depth += 1) {
    const category = byId.get(current);
    if (!category) return null;
    if (category.lowStockMode === "EACH" && category.lowStockThreshold !== null) {
      return { threshold: category.lowStockThreshold, path: category.path };
    }
    current = category.parentId;
  }
  return null;
}

/**
 * Avertissement au moment de lier un produit : le stock de la fiche passera
 * (ou est déjà) au niveau du seuil. `null` sans fiche, sans seuil ou au-dessus.
 */
export function lowStockAfterLink(item: LinkableItem, quantity: number | null): string | null {
  if (item.productStock === null || item.alertThreshold === null || !item.productName) return null;
  // Un lot périmé ne compte déjà pas dans le stock surveillé ; une pièce liée reste en stock.
  const used = item.singleUse && !item.expired ? (quantity ?? 0) : 0;
  const remaining = Math.max(0, item.productStock - used);
  if (remaining > item.alertThreshold) return null;
  return `Stock bas : il restera ${remaining} ${item.productName} (alerte à ${item.alertThreshold} ou moins). Pense à en racheter.`;
}

export const LOW_STOCK_MODES: { value: LowStockMode | ""; label: string }[] = [
  { value: "", label: "Pas d'alerte" },
  { value: "EACH", label: "Pour chaque produit" },
  { value: "TOTAL", label: "Sur le total de la catégorie" },
];
