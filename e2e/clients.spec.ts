import { expect, test } from "./fixtures";

test("nouveau client montre la carte vide, sans ajouter de séance", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Clients" }).click();
  await page.getByRole("button", { name: "Ajouter un client" }).click();
  await expect(page.getByRole("heading", { name: "Nouveau client" })).toBeVisible();
  await expect(page.getByText("Aucune séance pour ce client.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter une séance" })).toHaveCount(0);
  await expect(page.getByLabel("Nom *", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Prénom *")).toBeVisible();
});

test("la liste clients ouvre la fiche, le menu ouvre la modification", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { name: "Mes clients" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Nom du client" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1 séance" })).toBeVisible();

  await page.getByRole("row", { name: /Léa Martin/ }).click();
  await expect(page.getByRole("heading", { name: "Léa Martin" })).toBeVisible();
  await expect(page.getByLabel("Nom *", { exact: true })).toHaveValue("Martin");
  await expect(page.getByLabel("Prénom *")).toHaveValue("Léa");
  await expect(page.getByRole("button", { name: "Ajouter une séance" })).toBeVisible();
  await expect(page.getByText("Aucune séance pour ce client.")).toHaveCount(0);

  await page.getByRole("button", { name: "← Clients" }).click();
  await page.getByRole("button", { name: "Actions pour Léa Martin" }).click();
  await page.getByRole("menuitem", { name: "Modifier" }).click();
  await expect(page.getByRole("heading", { name: "Léa Martin" })).toBeVisible();
  await expect(page.getByLabel("Nom *", { exact: true })).toHaveValue("Martin");
});
