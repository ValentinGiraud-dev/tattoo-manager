import { describe, expect, it } from "vitest";
import type { Category, LinkableItem, ProductSheet } from "../stores/products-store";
import {
  categoryAlertLabel,
  inheritedThreshold,
  lowStockAfterLink,
  sheetThresholdLabel,
} from "./low-stock";

function category(
  id: string,
  parentId: string | null,
  setting: [Category["lowStockMode"], number | null] = [null, null],
): Category {
  return {
    id,
    parentId,
    name: id,
    depth: 0,
    path: id,
    lotCount: 0,
    totalLotCount: 0,
    childCount: 0,
    lowStockMode: setting[0],
    lowStockThreshold: setting[1],
  };
}

describe("seuils", () => {
  it("dit le seuil appliqué et sa provenance", () => {
    const sheet = {
      singleUse: false,
      lowStockThreshold: null,
      alertThreshold: 2,
      alertSource: "Encres",
    } as ProductSheet;
    expect(sheetThresholdLabel(sheet)).toBe("Alerte à 2 pièces ou moins (catégorie Encres)");
    expect(
      sheetThresholdLabel({ ...sheet, singleUse: true, alertThreshold: 10, alertSource: null }),
    ).toBe("Alerte à 10 ou moins");
    expect(sheetThresholdLabel({ ...sheet, lowStockThreshold: 0, alertThreshold: null })).toBe(
      "Pas d'alerte (réglé sur la fiche)",
    );
  });

  it("résume le réglage d'une catégorie", () => {
    expect(categoryAlertLabel({ lowStockMode: "TOTAL", lowStockThreshold: 5 })).toBe(
      "Alerte à 5 ou moins, au total",
    );
    expect(categoryAlertLabel({ lowStockMode: null, lowStockThreshold: null })).toBeNull();
  });

  it("trouve le seuil par produit de la catégorie la plus proche", () => {
    const tree = [
      category("encres", null, ["EACH", 2]),
      category("noires", "encres", ["TOTAL", 5]),
      category("dynamic", "noires"),
    ];
    expect(inheritedThreshold(tree, "dynamic")).toEqual({ threshold: 2, path: "encres" });
    expect(inheritedThreshold(tree, null)).toBeNull();
  });
});

describe("au moment de lier", () => {
  const item = {
    singleUse: true,
    expired: false,
    productName: "Gants M",
    productStock: 12,
    alertThreshold: 10,
  } as LinkableItem;

  it("prévient quand le lien fait passer au seuil", () => {
    expect(lowStockAfterLink(item, 1)).toBeNull();
    expect(lowStockAfterLink(item, 2)).toMatch(/il restera 10 Gants M/);
  });

  it("ne compte ni les pièces (elles restent en stock) ni les lots périmés", () => {
    expect(lowStockAfterLink({ ...item, singleUse: false }, null)).toBeNull();
    expect(lowStockAfterLink({ ...item, expired: true }, 5)).toBeNull();
    expect(lowStockAfterLink({ ...item, alertThreshold: null }, 12)).toBeNull();
  });
});
