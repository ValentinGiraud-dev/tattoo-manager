import { expect, test } from "./fixtures";

test("créer un client affiche un toast de confirmation", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Clients" }).click();
  await page.getByRole("button", { name: "Nouveau client" }).click();
  await page.getByLabel("Prénom *").fill("Nina");
  await page.getByLabel("Nom *", { exact: true }).fill("Dupont");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText("Client créé");
});

test("un export CSV prévient qu'il n'est pas chiffré et confirme l'enregistrement", async ({
  page,
}) => {
  await page.getByRole("navigation").getByRole("button", { name: "Rapports" }).click();
  await expect(page.getByText("n’est pas chiffré")).toBeVisible();
  await page.getByRole("button", { name: "Exporter…" }).first().click();
  await expect(page.getByRole("status")).toContainText("12 lignes enregistrées");
});
