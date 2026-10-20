import { expect, test } from "./fixtures";

test("un produit périmé s'ouvre depuis l'accueil, et le retour ramène à l'accueil", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Encre rouge · lot ER-1/ }).click();
  await expect(page.getByRole("heading", { name: "Encre rouge" })).toBeVisible();
  await page.getByRole("button", { name: "← Accueil" }).click();
  await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
});

test("accueil → séance → client → séance : le retour remonte chaque niveau", async ({ page }) => {
  await page
    .getByRole("button", { name: /Léa Martin/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "← Accueil" })).toBeVisible();
  await page.getByRole("button", { name: "Léa Martin" }).click();

  await expect(page.getByRole("heading", { name: "Léa Martin" })).toBeVisible();
  // Depuis la fiche client, rouvrir la séance : un niveau de plus.
  await page.getByRole("button", { name: /15 octobre 2026 · 14:00/ }).click();
  await expect(page.getByRole("button", { name: "← Clients" })).toBeVisible();

  await page.getByRole("button", { name: "← Clients" }).click();
  await expect(page.getByRole("heading", { name: "Léa Martin" })).toBeVisible();
  await page.getByRole("button", { name: "← Séances" }).click();
  await expect(page.getByRole("button", { name: "Modifier" })).toBeVisible();
  await expect(page.getByText("Léa Martin · 15 octobre 2026")).toBeVisible();
  // La séance avait été ouverte depuis l'accueil : le retour y ramène encore.
  await page.getByRole("button", { name: "← Accueil" }).click();
  await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
});

test("le menu ramène toujours à la liste", async ({ page }) => {
  await page.getByRole("button", { name: /Encre rouge · lot ER-1/ }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Produits" }).click();
  await expect(page.getByRole("heading", { name: "Produits" })).toBeVisible();
});
