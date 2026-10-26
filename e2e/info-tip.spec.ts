import { expect, test } from "./fixtures";

test("l'icône des sauvegardes explique le rythme au survol", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Paramètres" })
    .click();

  const tip = page.getByRole("button", { name: "Informations : Sauvegardes" });
  await expect(tip).toBeVisible();
  await expect(page.getByText("Une copie chiffrée complète")).toHaveCount(0);

  await tip.hover();
  await expect(page.getByRole("note", { name: "Sauvegardes" })).toContainText(
    "Une copie chiffrée complète",
  );

  await page.keyboard.press("Escape");
  await expect(page.getByRole("note", { name: "Sauvegardes" })).toHaveCount(0);
});
