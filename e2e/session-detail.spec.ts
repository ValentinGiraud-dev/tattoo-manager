import { expect, test } from "./fixtures";

test("la fiche note l'hygiène et change le statut depuis le formulaire", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Séances" }).click();
  await expect(page.getByRole("heading", { name: "Mes séances" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Date de la séance" })).toBeVisible();
  await page.getByRole("row", { name: /Léa Martin/ }).click();

  await expect(page.getByRole("heading", { name: "Avant-bras" })).toBeVisible();
  await expect(page.getByLabel("Client *")).toBeVisible();
  await expect(page.getByRole("button", { name: "Modifier" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remplir Questionnaire de santé" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un document" })).toBeVisible();

  const hygiene = page.getByRole("checkbox", {
    name: "J’ai expliqué les règles d’hygiène après le tatouage.",
  });
  await expect(hygiene).not.toBeChecked();
  await hygiene.check();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Conseils d’hygiène notés",
  );
  await expect(hygiene).toBeChecked();

  const status = page.getByLabel("Statut de la séance");
  await expect(status).toHaveValue("PLANNED");
  await status.selectOption("Terminée");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Séance enregistrée",
  );
  await expect(status).toHaveValue("COMPLETED");
});
