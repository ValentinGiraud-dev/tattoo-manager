import { expect, test } from "./fixtures";

test("la fiche valide un report puis change le statut depuis le formulaire", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Séances" }).click();
  await expect(page.getByRole("heading", { name: "Mes séances" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Créé le" })).toHaveCount(0);
  const row = page.getByRole("row", { name: /Léa Martin/ });
  await expect(row).toContainText("À remplir");
  await row.click();

  await expect(page.getByRole("heading", { name: "Avant-bras" })).toBeVisible();
  await expect(page.getByLabel("Client *")).toBeVisible();
  await expect(page.getByRole("button", { name: "Modifier" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remplir Questionnaire de santé" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un document" })).toBeVisible();

  await page.getByRole("radio", { name: "Décaler" }).check();
  await page.getByLabel("Motif *").fill("Peau irritée");
  await page
    .getByRole("checkbox", {
      name: "Je valide et certifie mes choix pour la prestation, ainsi que la fiche de soin est transmise.",
    })
    .check();
  await page.getByRole("button", { name: "Valider", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Valider le report de la prestation ?" });
  await expect(dialog).toContainText("Peau irritée");
  await expect(dialog).toContainText("définitive");
  await dialog.getByRole("button", { name: "Valider définitivement" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Documents validés",
  );
  await expect(page.getByText(/Validé le /)).toBeVisible();
  await expect(page.getByText("Peau irritée")).toBeVisible();

  const status = page.getByLabel("Statut de la séance");
  await expect(status).toHaveValue("RESCHEDULED");
  await status.selectOption("Terminée");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Séance enregistrée",
  );
  await expect(status).toHaveValue("COMPLETED");

  await page.getByRole("button", { name: "← Séances" }).click();
  await expect(page.getByRole("row", { name: /Léa Martin/ })).toContainText("Décaler");
});
