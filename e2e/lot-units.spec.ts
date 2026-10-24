import { expect, test } from "./fixtures";

test("la date d'ouverture d'une pièce se choisit au-dessus de la liste", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Produits" })
    .click();
  await page.getByRole("button", { name: "Nouvelle fiche produit" }).click();
  await page.getByLabel("Nom *").fill("Noir");
  await page.getByLabel("Marque").fill("Dynamic");
  await page.getByRole("button", { name: "Usage multiple" }).click();
  await page.getByLabel("Durée après ouverture (mois)").fill("12");
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page.getByRole("heading", { name: "Dynamic Noir" })).toBeVisible();

  await page.getByRole("button", { name: "Recevoir un lot" }).first().click();
  await page.getByLabel("Numéro de lot *").fill("N-1");
  await page.getByRole("button", { name: "Date d'expiration *" }).click();
  await page
    .getByRole("dialog", { name: "Choisir une date" })
    .getByRole("button", { name: "15", exact: true })
    .click();
  await page.getByLabel("Nombre de pièces reçues *").fill("2");
  await page.getByRole("button", { name: "Enregistrer la réception" }).click();
  await expect(page.getByRole("heading", { name: "Pièces" })).toBeVisible();

  const opener = page.getByRole("button", { name: "Ouvert le" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Choisir une date" });
  await dialog.getByRole("button", { name: "15", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(opener).toHaveText(/15\s+\S+\s+20\d{2}/);
});
