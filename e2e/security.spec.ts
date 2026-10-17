import { expect, test } from "./fixtures";

test.describe("première ouverture", () => {
  test.use({ scenario: { locked: "setup" } });

  test("crée le mot de passe, montre la clé de secours une fois, puis ouvre l'app", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Protéger les données de l’atelier" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Protéger mes données" }).click();
    await expect(page.getByRole("alert")).toContainText("au moins 8 caractères");

    await page.getByLabel("Mot de passe de Tracink").fill("atelier secret");
    await page.getByLabel("Confirmer le mot de passe").fill("atelier secret");
    await page.getByRole("button", { name: "Protéger mes données" }).click();

    await expect(page.getByLabel("Clé de secours", { exact: true })).toHaveText(
      "7KQ2-M9XD-4HBR-T6WC-PZ3N-8FJA",
    );
    const next = page.getByRole("button", { name: "Continuer" });
    await expect(next).toBeDisabled();
    await page.getByLabel("J’ai noté la clé de secours en lieu sûr.").check();
    await next.click();

    await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
  });
});

test.describe("verrouillage", () => {
  test("⌘L verrouille, un mauvais mot de passe est refusé, le bon rouvre", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
    await page.keyboard.press("Meta+l");
    await expect(page.getByRole("heading", { name: "Tracink est verrouillé" })).toBeVisible();
    // L'app est masquée pendant le verrouillage.
    await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeHidden();

    await page.getByLabel("Mot de passe").fill("faux");
    await page.getByRole("button", { name: "Déverrouiller" }).click();
    await expect(page.getByRole("alert")).toHaveText("Mot de passe incorrect.");

    await page.getByLabel("Mot de passe").fill("atelier secret");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
  });
});
