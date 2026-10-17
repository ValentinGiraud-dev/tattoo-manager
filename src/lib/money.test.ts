import { describe, expect, it } from "vitest";
import { centsToInput, formatEuros, parseEuros } from "./money";

/** Intl met des espaces insécables : on les remplace pour comparer. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("parseEuros", () => {
  it("accepte les saisies courantes", () => {
    expect(parseEuros("120")).toBe(12_000);
    expect(parseEuros("120,5")).toBe(12_050);
    expect(parseEuros("120.50")).toBe(12_050);
    expect(parseEuros("1 200 €")).toBe(120_000);
    expect(parseEuros("0,05")).toBe(5);
  });

  it("refuse le vide, le négatif et les fractions de centime", () => {
    expect(parseEuros("")).toBeNull();
    expect(parseEuros("-10")).toBeNull();
    expect(parseEuros("12,345")).toBeNull();
    expect(parseEuros("douze")).toBeNull();
  });
});

describe("formatEuros et centsToInput", () => {
  it("affiche en euros à la française", () => {
    expect(plain(formatEuros(123_456))).toBe("1 234,56 €");
    expect(plain(formatEuros(0))).toBe("0,00 €");
  });

  it("prépare un champ de saisie sans décimales inutiles", () => {
    expect(centsToInput(12_000)).toBe("120");
    expect(centsToInput(12_050)).toBe("120,50");
    expect(centsToInput(null)).toBe("");
  });

  it("aller-retour saisie → centimes → saisie", () => {
    for (const cents of [1, 99, 100, 12_345, 10_000_000]) {
      expect(parseEuros(centsToInput(cents))).toBe(cents);
    }
  });
});
