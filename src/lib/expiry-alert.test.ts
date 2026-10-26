import { describe, expect, it } from "vitest";
import { expiryAlertLabel, expiryBannerText } from "./expiry-alert";

describe("alerte d'expiration", () => {
  it("distingue le défaut, un délai choisi et l'absence d'alerte", () => {
    expect(expiryAlertLabel(null)).toBe("30 jours avant (par défaut)");
    expect(expiryAlertLabel(30)).toBe("Alerte 30 jours avant");
    expect(expiryAlertLabel(1)).toBe("Alerte 1 jour avant");
    expect(expiryAlertLabel(0)).toBe("Pas d'alerte");
  });

  it("dit le lot le plus urgent et combien d'autres", () => {
    const notice = {
      expired: true,
      lotNumber: "ER-1",
      usefulUntil: "2026-09-01",
      extra: 2,
    };
    expect(expiryBannerText(notice, 30)).toBe(
      "Périmé : lot ER-1, exp. 1 septembre 2026, et 2 autres.",
    );
    expect(expiryBannerText({ ...notice, expired: false, extra: 0 }, 14)).toBe(
      "Bientôt expiré : lot ER-1, exp. 1 septembre 2026 (alerte 14 jours avant).",
    );
  });
});
