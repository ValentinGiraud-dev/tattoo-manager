import { describe, expect, it } from "vitest";
import type { LotSummary, ProductSheet } from "../stores/products-store";
import {
  attachCandidates,
  preselectedLots,
  sheetInputFromLot,
  sheetStockLabel,
  sheetSummary,
  sheetTypeLabel,
} from "./product-sheets";

function lot(id: string, name: string, patch: Partial<LotSummary> = {}): LotSummary {
  return {
    id,
    name,
    lotNumber: id.toUpperCase(),
    creationDate: null,
    expirationDate: "2030-01-01",
    singleUse: false,
    afterOpeningMonths: 12,
    productUrl: null,
    categoryId: "inks",
    categoryPath: "Encres",
    productId: null,
    productName: null,
    productBrand: null,
    createdAt: "t",
    updatedAt: "t",
    stock: 1,
    sealedCount: 1,
    openedCount: 0,
    movementCount: 1,
    sessionCount: 0,
    expired: false,
    archivedAt: null,
    productArchived: false,
    ...patch,
  };
}

const lots = [
  lot("b", "Encre noire"),
  lot("a", "encre  NOIRE"),
  lot("c", "Encre rouge"),
  lot("d", "Encre noire", { productId: "sheet" }),
  lot("e", "Encre noire", { singleUse: true }),
];

describe("lots à rattacher", () => {
  it("ne propose que les lots sans fiche du même type", () => {
    expect(attachCandidates(lots, false).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("coche le lot et ses homonymes, sans tenir compte de la casse ni des espaces", () => {
    expect(preselectedLots(lots, lots[0]).sort()).toEqual(["a", "b"]);
  });

  it("pré-remplit la fiche avec le lot", () => {
    expect(sheetInputFromLot(lots[0])).toEqual({
      name: "Encre noire",
      brand: null,
      categoryId: "inks",
      singleUse: false,
      afterOpeningMonths: 12,
      productUrl: null,
      lowStockThreshold: null,
      expiryWarningDays: null,
    });
  });
});

describe("libellés", () => {
  const sheet = {
    singleUse: false,
    afterOpeningMonths: 12,
    lotCount: 2,
    stock: 3,
    expiredStock: 0,
  } as ProductSheet;

  it("dit le stock utilisable et le stock périmé à part", () => {
    expect(sheetStockLabel(sheet)).toBe("3 pièces en stock");
    expect(sheetStockLabel({ ...sheet, expiredStock: 5 })).toBe(
      "3 pièces en stock · 5 dans des lots périmés",
    );
    expect(sheetStockLabel({ ...sheet, singleUse: true, stock: 40 })).toBe("40 en stock");
    expect(sheetStockLabel({ ...sheet, lotCount: 0 })).toBe("Aucun lot");
  });

  it("résume la fiche sans redite quand elle n'a pas de lot", () => {
    expect(sheetSummary(sheet)).toBe("2 lots · 3 pièces en stock");
    expect(sheetSummary({ ...sheet, lotCount: 0 })).toBe("Aucun lot");
  });

  it("résume le type", () => {
    expect(sheetTypeLabel(sheet)).toBe("Usage multiple · 12 mois après ouverture");
    expect(sheetTypeLabel({ singleUse: true, afterOpeningMonths: null })).toBe("Usage unique");
  });
});
