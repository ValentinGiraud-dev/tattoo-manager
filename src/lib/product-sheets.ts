/** Aides d'affichage des fiches produit (sans règle métier : Rust décide). */
import type { LotSummary, ProductSheet, ProductSheetInput } from "../stores/products-store";

function same(a: string, b: string): boolean {
  const clean = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
  return clean(a) === clean(b);
}

/** Lots sans fiche du même type, ceux du même nom que `lot` en premier. */
export function attachCandidates(lots: LotSummary[], singleUse: boolean): LotSummary[] {
  return lots
    .filter((lot) => lot.productId === null && lot.singleUse === singleUse && !lot.archivedAt)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "fr-FR", { sensitivity: "base" }) ||
        a.lotNumber.localeCompare(b.lotNumber, "fr-FR"),
    );
}

/** Lots cochés d'office en créant la fiche d'un lot : le lot et ses homonymes. */
export function preselectedLots(lots: LotSummary[], from: LotSummary): string[] {
  return attachCandidates(lots, from.singleUse)
    .filter((lot) => lot.id === from.id || same(lot.name, from.name))
    .map((lot) => lot.id);
}

/** Fiche pré-remplie à partir d'un lot reçu avant les fiches. */
export function sheetInputFromLot(lot: LotSummary): ProductSheetInput {
  return {
    name: lot.name.trim(),
    brand: null,
    categoryId: lot.categoryId,
    singleUse: lot.singleUse,
    afterOpeningMonths: lot.singleUse ? null : lot.afterOpeningMonths,
    productUrl: lot.productUrl,
    lowStockThreshold: null,
    expiryWarningDays: null,
  };
}

/** « 12 en stock », « 3 en stock · 5 dans des lots périmés », « Aucun lot ». */
export function sheetStockLabel(sheet: ProductSheet): string {
  if (sheet.lotCount === 0) return "Aucun lot";
  const unit = sheet.singleUse ? "" : sheet.stock > 1 ? " pièces" : " pièce";
  const main = `${sheet.stock}${unit} en stock`;
  if (sheet.expiredStock === 0) return main;
  return `${main} · ${sheet.expiredStock} dans des lots périmés`;
}

/** « 2 lots · 3 pièces en stock », ou « Aucun lot ». */
export function sheetSummary(sheet: ProductSheet): string {
  if (sheet.lotCount === 0) return "Aucun lot";
  return `${sheet.lotCount} lot${sheet.lotCount > 1 ? "s" : ""} · ${sheetStockLabel(sheet)}`;
}

/** Type et durée d'une fiche : « Usage multiple · 12 mois après ouverture ». */
export function sheetTypeLabel(sheet: {
  singleUse: boolean;
  afterOpeningMonths: number | null;
}): string {
  if (sheet.singleUse) return "Usage unique";
  return sheet.afterOpeningMonths
    ? `Usage multiple · ${sheet.afterOpeningMonths} mois après ouverture`
    : "Usage multiple";
}
