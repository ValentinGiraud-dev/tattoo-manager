import { expect, test } from "./fixtures";

test.describe("réinitialisation des données", () => {
  test("le mot de passe et la confirmation renforcée vident les listes", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("button", { name: "Paramètres" })
      .click();

    await expect(page.getByRole("heading", { name: "Zone dangereuse" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Réinitialiser avec Touch ID" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Réinitialiser Tracink avec Touch ID" }),
    ).toHaveCount(0);

    await page.getByLabel("Mot de passe Tracink").fill("atelier secret");
    await page.getByRole("button", { name: "Réinitialiser les données" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Réinitialiser les données ?");
    await expect(dialog).toContainText("sauvegardes externes");
    const go = dialog.getByRole("button", { name: "Réinitialiser les données" });
    await expect(go).toBeDisabled();
    await dialog.getByLabel(/Pour confirmer, tapez/).fill("RÉINITIALISER");
    await go.click();

    await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
      "Données réinitialisées",
    );
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("button", { name: "Clients" })
      .click();
    await expect(page.getByText("Aucun client pour le moment.")).toBeVisible();
  });
});

test.describe("Touch ID pour la réinitialisation", () => {
  test.use({ scenario: { locked: "unlocked", touchId: true } });

  test("le bouton apparaît seulement quand Touch ID est activé", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("button", { name: "Paramètres" })
      .click();
    await expect(page.getByRole("button", { name: "Réinitialiser avec Touch ID" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Réinitialiser Tracink avec Touch ID" }),
    ).toBeVisible();
  });
});

test.describe("réinitialisation de Tracink", () => {
  test("la confirmation renforcée ramène à la création du mot de passe", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("button", { name: "Paramètres" })
      .click();

    await page.getByLabel("Mot de passe Tracink").fill("atelier secret");
    await page.getByRole("button", { name: "Réinitialiser Tracink", exact: true }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Réinitialiser Tracink ?");
    await expect(dialog).toContainText("ancien mot de passe");
    const go = dialog.getByRole("button", { name: "Réinitialiser Tracink" });
    await expect(go).toBeDisabled();
    await dialog.getByLabel(/Pour confirmer, tapez/).fill("EFFACER");
    await go.click();

    await expect(
      page.getByRole("heading", { name: "Protéger les données de l’atelier" }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Notifications" })).toHaveCount(0);
  });
});
