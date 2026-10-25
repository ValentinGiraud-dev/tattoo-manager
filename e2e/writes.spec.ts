import { expect, test } from "./fixtures";

test("une séance crée un client sur place et le choisit", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Séances" }).click();
  await page.getByRole("button", { name: "Ajouter une séance" }).click();

  const dialog = page.getByRole("dialog", { name: "Nouveau client" });
  await page.getByRole("button", { name: "Nouveau client" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Nouvelle séance" })).toBeVisible();

  await page.getByRole("button", { name: "Nouveau client" }).click();
  await dialog.getByLabel("Prénom *").fill("N");
  await page.keyboard.press("Escape");
  const abandon = page.getByRole("alertdialog", { name: "Abandonner ce client ?" });
  await abandon.getByRole("button", { name: "Continuer la saisie" }).click();
  await expect(dialog.getByLabel("Prénom *")).toHaveValue("N");
  await page.keyboard.press("Escape");
  await abandon.getByRole("button", { name: "Abandonner" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Nouvelle séance" })).toBeVisible();

  await page.getByRole("button", { name: "Nouveau client" }).click();
  await dialog.getByLabel("Prénom *").fill("Nina");
  await dialog.getByLabel("Nom *", { exact: true }).fill("Dupont");
  await dialog.getByLabel("Téléphone").fill("06 12 34 56 78");
  await dialog.getByRole("button", { name: "Créer et choisir" }).click();

  await expect(page.getByRole("list", { name: "Notifications" })).toContainText("Client créé");
  await expect(dialog).toHaveCount(0);
  const client = page.getByLabel("Client *");
  await expect(client).toHaveValue("c2");
  await expect(client.locator("option:checked")).toHaveText("Dupont Nina");
  await expect(page.getByRole("heading", { name: "Nouvelle séance" })).toBeVisible();
});

test("une séance propose un titre et un projet sans écraser le titre saisi", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Séances" }).click();
  await page.getByRole("button", { name: "Ajouter une séance" }).click();

  const title = page.getByLabel("Titre de la séance");
  await expect(title).toBeVisible();
  await expect(page.getByRole("button", { name: "Lier à un projet" })).toBeDisabled();

  await page.getByLabel("Client *").selectOption("c1");
  await expect(page.getByRole("button", { name: "Lier à un projet" })).toBeEnabled();
  await page.getByRole("button", { name: "Lier à un projet" }).click();
  const dialog = page.getByRole("dialog", { name: "Lier à un projet" });
  await dialog.getByRole("button", { name: "Arbre", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(title).toHaveValue("Arbre séance 2");

  await title.fill("Retouche");
  await page.getByRole("button", { name: "Changer le projet, Arbre" }).click();
  await dialog.getByRole("button", { name: "Arbre", exact: true }).click();
  await expect(title).toHaveValue("Retouche");

  await page.getByRole("button", { name: "Retirer" }).click();
  await expect(title).toHaveValue("Retouche");
  await expect(page.getByRole("button", { name: "Lier à un projet" })).toBeEnabled();
});

test("la fiche d'une séance permet aussi de créer un client", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Séances" }).click();
  await page.getByRole("row", { name: /Léa Martin/ }).click();
  await expect(page.getByRole("heading", { name: "Avant-bras" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Modifier la séance" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nouveau client" })).toBeVisible();
  await expect(page.getByLabel("Client *")).toHaveValue("c1");
});

test("créer un client affiche un toast de confirmation", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Clients" }).click();
  await page.getByRole("button", { name: "Ajouter un client" }).click();
  await page.getByLabel("Prénom *").fill("Nina");
  await page.getByLabel("Nom *", { exact: true }).fill("Dupont");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText("Client créé");
});

test("supprimer un client demande confirmation", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Clients" }).click();
  await page.getByRole("button", { name: "Ajouter un client" }).click();
  await page.getByLabel("Prénom *").fill("Nina");
  await page.getByLabel("Nom *", { exact: true }).fill("Dupont");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("heading", { name: "Nina Dupont" })).toBeVisible();

  await page.getByRole("button", { name: "Supprimer" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Supprimer ce client ?" });
  await confirm.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("heading", { name: "Nina Dupont" })).toBeVisible();

  await page.getByRole("button", { name: "Supprimer" }).click();
  await confirm.getByRole("textbox").fill("SUPPRIMER");
  await confirm.getByRole("button", { name: "Supprimer le client" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText("Client supprimé");
  await expect(page.getByRole("heading", { name: "Mes clients" })).toBeVisible();
});

test("archiver un client le retire des actifs et le désarchivage le ramène", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Clients" }).click();
  await page.getByRole("row", { name: /Léa Martin/ }).click();
  await page.getByRole("button", { name: "Archiver" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Archiver ce client ?" });
  await expect(confirm.getByText(/usage unique/)).toBeVisible();
  await confirm.getByRole("button", { name: "Archiver le client" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText("Client archivé");
  await expect(page.getByRole("heading", { name: "Mes clients" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Léa Martin/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Archivés" }).click();
  await page.getByRole("row", { name: /Léa Martin/ }).click();
  await expect(page.getByText("Archivé. Cette fiche est en lecture seule")).toBeVisible();
  await page.getByRole("button", { name: "Désarchiver" }).click();
  await page
    .getByRole("alertdialog", { name: "Désarchiver ce client ?" })
    .getByRole("button", { name: "Désarchiver" })
    .click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Client désarchivé",
  );
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeVisible();
  await expect(page.getByText("Archivé. Cette fiche est en lecture seule")).toHaveCount(0);
});

test("un export CSV prévient qu'il n'est pas chiffré et confirme l'enregistrement", async ({
  page,
}) => {
  await page.getByRole("navigation").getByRole("button", { name: "Rapports" }).click();
  await expect(page.getByText("n’est pas chiffré")).toBeVisible();
  await page.getByRole("button", { name: "Exporter…" }).first().click();
  await expect(page.getByRole("status")).toContainText("12 lignes enregistrées");
});
