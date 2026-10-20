import { expect, test } from "./fixtures";

test.describe("rotation de la clé", () => {
  test("rechiffrer demande l'ancien mot de passe, une confirmation renforcée, puis montre la nouvelle clé de secours", async ({
    page,
  }) => {
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("button", { name: "Paramètres" })
      .click();
    await page.getByRole("button", { name: "Rechiffrer avec une nouvelle clé…" }).click();

    const section = page.locator("form").filter({ hasText: "Rechiffrer les données…" });
    // Même mot de passe : refusé avant tout envoi.
    await section.getByLabel("Mot de passe actuel").fill("atelier secret");
    await section.getByLabel("Nouveau mot de passe").fill("atelier secret");
    await section.getByLabel("Confirmer le mot de passe").fill("atelier secret");
    await section.getByRole("button", { name: "Rechiffrer les données…" }).click();
    await expect(section.getByRole("alert")).toHaveText(
      "Choisissez un mot de passe différent de l’actuel.",
    );

    await section.getByLabel("Nouveau mot de passe").fill("une toute autre phrase");
    await section.getByLabel("Confirmer le mot de passe").fill("une toute autre phrase");
    await section.getByRole("button", { name: "Rechiffrer les données…" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Rechiffrer toutes les données ?");
    await expect(dialog).toContainText("sauvegardes externes déjà faites");
    const go = dialog.getByRole("button", { name: "Rechiffrer les données" });
    await expect(go).toBeDisabled();
    await dialog.getByLabel(/Pour confirmer, tapez/).fill("rechiffrer");
    await go.click();

    await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
      "Données rechiffrées avec une nouvelle clé",
    );
    await expect(page.getByLabel("Clé de secours", { exact: true })).toHaveText(
      "9QWE-RTY2-ZXC4-VBN6-MKL8-PJH3",
    );
    await page.getByLabel("J’ai noté la clé de secours en lieu sûr.").check();
    await page.getByRole("button", { name: "Terminé" }).click();
    await expect(page.getByLabel("Clé de secours", { exact: true })).toBeHidden();
  });
});

test.describe("rechiffrement interrompu", () => {
  test.use({ scenario: { locked: "locked", rotationPending: true } });

  test("l'écran verrouillé explique que l'ancien ou le nouveau mot de passe le termine", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: "Tracink est verrouillé" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("ancien ou le nouveau mot de passe");
  });
});
