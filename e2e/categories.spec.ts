import { expect, test } from "./fixtures";

test("créer Aiguilles › RL, y ranger un lot et filtrer la liste", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Produits" })
    .click();
  await page.getByRole("button", { name: "Gérer" }).click();
  await expect(page.getByRole("heading", { name: "Catégories" })).toBeVisible();

  await page.getByRole("button", { name: "Créer la première catégorie" }).click();
  await page.getByLabel("Nom de la catégorie").fill("Aiguilles");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Catégorie « Aiguilles » créée",
  );

  await page.getByRole("button", { name: "+ Sous-catégorie" }).click();
  await page.getByLabel("Nom de la catégorie").fill("RL");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "« Aiguilles › RL » créée",
  );

  // Un nom déjà pris au même niveau est refusé, avec le message du backend.
  await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
  await page.getByLabel("Nom de la catégorie").fill("aiguilles");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Une catégorie porte déjà ce nom à cet endroit");
  await page.getByRole("button", { name: "Annuler" }).click();

  await page.getByRole("button", { name: "← Produits" }).click();
  const tree = page.getByRole("navigation", { name: "Catégories" });
  // Les sous-catégories sont repliées tant qu'on ne les ouvre pas.
  await expect(tree.getByRole("button", { name: /^RL/ })).toBeHidden();
  await tree.getByRole("button", { name: "Déplier Aiguilles" }).click();
  await tree.getByRole("button", { name: /^RL/ }).click();
  await expect(page.getByRole("heading", { name: "Ma traçabilité" })).toBeVisible();
  await expect(tree.getByRole("button", { name: /^RL/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Aucun produit dans cette catégorie.")).toBeVisible();

  // La nouvelle fiche est proposée dans la catégorie affichée.
  await page.getByRole("button", { name: "Ajouter un produit ici" }).click();
  await expect(page.getByRole("combobox", { name: "Catégorie" })).toHaveValue("cat2");
  await page.getByLabel("Nom *").fill("Aiguille 3RL");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Fiche produit créée",
  );
  await expect(page.getByRole("heading", { name: "Aiguille 3RL" })).toBeVisible();
  await expect(page.getByText("Aiguilles › RL", { exact: true })).toBeVisible();

  // Réception d'un lot depuis la fiche : le formulaire se déplie, la fiche est déjà choisie.
  await page.getByRole("button", { name: "Ajouter un lot" }).click();
  await page.getByLabel("Numéro de lot *").fill("A-1");
  await page.getByRole("button", { name: "Date d'expiration *" }).click();
  await page
    .getByRole("dialog", { name: "Choisir une date" })
    .getByRole("button", { name: "15", exact: true })
    .click();
  await page.getByRole("button", { name: "Enregistrer la réception" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Lot ajouté au stock",
  );

  // La catégorie parente inclut ses sous-catégories.
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Produits" })
    .click();
  await tree.getByRole("button", { name: /^Aiguilles/ }).click();
  await expect(page.getByRole("row", { name: /Aiguille 3RL/ })).toBeVisible();
  // Le lot sans fiche et sans catégorie n'est pas dans « Aiguilles ».
  await expect(page.getByRole("button", { name: /Encre rouge/ })).toBeHidden();
});

test("supprimer une catégorie fait remonter son contenu, après confirmation", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Produits" })
    .click();
  await page.getByRole("button", { name: "Gérer" }).click();
  for (const [name, parentRow] of [
    ["Aiguilles", null],
    ["RL", "Aiguilles"],
  ] as const) {
    if (parentRow) {
      await page.getByRole("button", { name: "+ Sous-catégorie" }).click();
    } else {
      await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
    }
    await page.getByLabel("Nom de la catégorie").fill(name);
    await page.getByRole("button", { name: "Créer", exact: true }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Supprimer…" }).last().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Supprimer la catégorie « Aiguilles › RL » ?");
  await expect(dialog).toContainText("Elle est vide");
  await dialog.getByRole("button", { name: "Supprimer la catégorie" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Catégorie supprimée",
  );
  await expect(page.getByText("RL", { exact: true })).toBeHidden();
  await expect(page.getByText("Aiguilles", { exact: true })).toBeVisible();
});
