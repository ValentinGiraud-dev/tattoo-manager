import { expect, test } from "./fixtures";

test("les boutons du jour ouvrent la séance sur les documents ou la traçabilité", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Ajouter les documents" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeInViewport();

  await page.getByRole("button", { name: "← Accueil" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "Compléter la traçabilité" }).click();
  await expect(page.getByRole("heading", { name: "Produits utilisés" })).toBeInViewport();
});
