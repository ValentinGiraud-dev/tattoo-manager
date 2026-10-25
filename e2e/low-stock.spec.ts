import { expect, test } from "./fixtures";

test("un seuil par produit sur la catégorie s'applique, l'accueil prévient et ouvre la fiche", async ({
  page,
}) => {
  const menu = page.getByRole("navigation", { name: "Navigation principale" });
  await menu.getByRole("button", { name: "Produits" }).click();

  // Catégorie « Gants » : alerte à 2 ou moins pour chaque produit.
  await page.getByRole("button", { name: "Gérer" }).click();
  await page.getByRole("button", { name: "Créer la première catégorie" }).click();
  await page.getByLabel("Nom de la catégorie").fill("Gants");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await page.getByRole("button", { name: "Stock bas…" }).click();
  await page.getByLabel("Alerte de stock bas").selectOption({ label: "Pour chaque produit" });
  await page.getByLabel("Seuil d'alerte").fill("2");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Seuil de stock bas enregistré",
  );
  await expect(page.getByText("Alerte à 2 ou moins, par produit")).toBeVisible();

  // Nouvelle fiche dans « Gants » : le seuil de la catégorie est proposé.
  await page.getByRole("button", { name: "← Produits" }).click();
  await page.getByRole("button", { name: "Ajouter un produit" }).click();
  await page.getByLabel("Nom *").fill("Gants nitrile M");
  await page.getByRole("combobox", { name: "Catégorie" }).selectOption({ label: "Gants" });
  await expect(page.getByText("Comme la catégorie : alerte à 2 ou moins (Gants)")).toBeVisible();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();

  // Aucun lot : 0 en stock, donc sous le seuil.
  await expect(page.getByText("Stock bas :", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Alerte à 2 ou moins (catégorie Gants)")).toBeVisible();

  await page.getByRole("button", { name: "← Produits" }).click();
  await expect(page.getByRole("button", { name: "Stock bas (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Stock bas (1)" }).click();
  await expect(page.getByRole("row", { name: /Gants nitrile M/ })).toBeVisible();
  // Le filtre masque ce qui n'est pas en stock bas (le lot sans fiche).
  await expect(page.getByRole("heading", { name: /sans fiche produit/ })).toBeHidden();

  await menu.getByRole("button", { name: "Accueil" }).click();
  const panel = page.getByRole("complementary", { name: "À traiter" });
  await expect(panel.getByText("Stock bas", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: /Gants nitrile M/ }).click();
  await expect(page.getByRole("heading", { name: "Gants nitrile M" })).toBeVisible();
  await page.getByRole("button", { name: "← Accueil" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("« Pas d'alerte » sur une fiche l'emporte sur sa catégorie", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Produits" })
    .click();
  await page.getByRole("button", { name: "Ajouter un produit" }).click();
  await page.getByLabel("Nom *").fill("Film étirable");
  await page.getByLabel("Pas d'alerte pour ce produit").check();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByText("Pas d'alerte (réglé sur la fiche)")).toBeVisible();
  await expect(page.getByText("Stock bas :")).toBeHidden();
});
