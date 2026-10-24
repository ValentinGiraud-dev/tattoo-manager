import { expect, test } from "./fixtures";

test("la fiche note l'hygiène et change le statut sans ouvrir le formulaire", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "Séances" }).click();
  await page.getByRole("button", { name: /Léa Martin/ }).click();

  await expect(page.getByRole("heading", { name: "Avant-bras" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Modifier" })).toBeVisible();

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
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Statut mis à jour",
  );
  await expect(status).toHaveValue("COMPLETED");
  await expect(page.getByRole("button", { name: "Modifier" })).toBeVisible();
});
