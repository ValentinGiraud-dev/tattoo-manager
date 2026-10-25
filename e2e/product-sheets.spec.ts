import { expect, test } from "./fixtures";

async function openProducts(page: import("@playwright/test").Page) {
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Produits" })
    .click();
}

test("un lot reçu avant les fiches est signalé, puis rattaché à sa nouvelle fiche", async ({
  page,
}) => {
  await openProducts(page);
  await expect(page.getByRole("heading", { name: "1 lot sans fiche produit" })).toBeVisible();
  await page.getByRole("button", { name: /Encre rouge/ }).click();

  await expect(page.getByText("Lot sans fiche produit.")).toBeVisible();
  await page.getByRole("button", { name: "Créer la fiche produit" }).click();

  // Pré-remplie avec le lot, qui est coché pour être rattaché.
  await expect(page.getByLabel("Nom *")).toHaveValue("Encre rouge");
  await expect(page.getByRole("checkbox", { name: /Encre rouge · lot ER-1/ })).toBeChecked();
  await page.getByLabel("Marque").fill("Dynamic");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Fiche créée · 1 lot rattaché",
  );

  await expect(page.getByRole("heading", { name: "Dynamic Encre rouge" })).toBeVisible();
  // Le lot est périmé : son stock est compté à part.
  await expect(page.getByText("0 en stock · 4 dans des lots périmés").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Lot ER-1/ })).toBeVisible();

  await page.getByRole("button", { name: "← Produits" }).click();
  await expect(page.getByRole("heading", { name: /sans fiche produit/ })).toBeHidden();
  await expect(page.getByRole("row", { name: /Dynamic Encre rouge/ })).toBeVisible();
});

test("recevoir un lot d'un produit sans fiche : la fiche se crée en chemin", async ({ page }) => {
  await openProducts(page);
  await page.getByRole("button", { name: "Ajouter un lot" }).click();
  await page.getByRole("button", { name: "Créer une fiche produit" }).click();

  await page.getByLabel("Nom *").fill("Gants nitrile M");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();

  // Retour à la réception, avec la nouvelle fiche choisie.
  await expect(page.getByRole("heading", { name: "Réception d'un lot" })).toBeVisible();
  await expect(page.getByLabel("Fiche produit *")).toHaveValue("p1");
  await expect(page.getByText("Usage unique", { exact: true })).toBeVisible();
  await page.getByLabel("Numéro de lot *").fill("GN-24");
  await page.getByRole("button", { name: "Date d'expiration *" }).click();
  await page
    .getByRole("dialog", { name: "Choisir une date" })
    .getByRole("button", { name: "15", exact: true })
    .click();
  await page.getByLabel("Quantité reçue *").fill("100");
  await page.getByRole("button", { name: "Enregistrer la réception" }).click();

  await expect(page.getByRole("heading", { name: "Gants nitrile M" })).toBeVisible();
  await expect(page.getByText("Fiche produit", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir la fiche" })).toBeVisible();
});
