import { describe, expect, it } from "vitest";
import { formatBytes, formatIsoDate, formatRelative, isOlderThan } from "./format";

const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("formatIsoDate", () => {
  it("écrit une date métier en toutes lettres, sans décalage de fuseau", () => {
    expect(formatIsoDate("2026-10-01")).toBe("1 octobre 2026");
    expect(formatIsoDate("2026-12-31")).toBe("31 décembre 2026");
  });

  it("laisse passer une valeur inattendue", () => {
    expect(formatIsoDate("bientôt")).toBe("bientôt");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it("parle en minutes, heures puis jours", () => {
    expect(formatRelative("2026-10-15T11:59:40Z", now)).toBe("à l’instant");
    expect(formatRelative("2026-10-15T11:55:00Z", now)).toBe("il y a 5 minutes");
    expect(formatRelative("2026-10-15T09:00:00Z", now)).toBe("il y a 3 heures");
    expect(formatRelative("2026-10-14T12:00:00Z", now)).toBe("hier");
    expect(formatRelative("2026-10-11T12:00:00Z", now)).toBe("il y a 4 jours");
  });
});

describe("isOlderThan", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it("considère l'absence de date comme trop ancienne", () => {
    expect(isOlderThan(null, 1000, now)).toBe(true);
    expect(isOlderThan("n'importe quoi", 1000, now)).toBe(true);
  });
  it("compare à la durée donnée", () => {
    expect(isOlderThan("2026-10-15T11:00:00Z", 2 * 3600_000, now)).toBe(false);
    expect(isOlderThan("2026-10-15T09:00:00Z", 2 * 3600_000, now)).toBe(true);
  });
});

describe("formatBytes", () => {
  it("choisit l'unité", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(plain(formatBytes(1536))).toBe("1,5 Ko");
    expect(plain(formatBytes(18_400_000))).toBe("17,5 Mo");
  });
});
