import { describe, expect, it } from "vitest";
import { pageBounds, pageSlice, rangeLabel, visiblePages } from "./pagination";

describe("pagination", () => {
  it("découpe la page et ramène un numéro trop grand", () => {
    const rows = [1, 2, 3, 4, 5];
    expect(pageSlice(rows, 1, 2)).toEqual([1, 2]);
    expect(pageSlice(rows, 3, 2)).toEqual([5]);
    expect(pageSlice(rows, 9, 2)).toEqual([5]);
    expect(pageBounds(2, 50, 10)).toEqual({ from: 11, to: 20 });
    expect(pageBounds(1, 0, 10)).toEqual({ from: 0, to: 0 });
  });

  it("écrit le libellé d'affichage", () => {
    expect(rangeLabel(1, 50, 10)).toBe("Affichage de 1 à 10 sur 50 résultats.");
    expect(rangeLabel(1, 1, 10)).toBe("Affichage de 1 à 1 sur 1 résultat.");
    expect(rangeLabel(1, 0, 10)).toBe("Affichage de 0 à 0 sur 0 résultats.");
  });

  it("montre une fenêtre de cinq pages", () => {
    expect(visiblePages(1, 50, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(visiblePages(5, 100, 10)).toEqual([3, 4, 5, 6, 7]);
    expect(visiblePages(10, 100, 10)).toEqual([6, 7, 8, 9, 10]);
    expect(visiblePages(1, 30, 10)).toEqual([1, 2, 3]);
  });
});
