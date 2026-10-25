import { expect, test } from "./fixtures";

test("le journal liste les écritures, se filtre et ouvre la fiche concernée", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Journal" })
    .click();
  await expect(page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible();

  const changed = page.getByRole("listitem").filter({ hasText: "Client modifié" });
  await expect(changed).toContainText("Léa Martin");
  await expect(changed).toContainText("Téléphone");
  await expect(changed).toContainText("06 01 02 03 04");
  await expect(page.getByText("Les réponses ne sont pas recopiées dans le journal.")).toBeVisible();
  await expect(page.getByText("Sauvegarde automatique")).toBeVisible();

  await page.getByLabel("Type").selectOption({ label: "Paiements et acomptes" });
  await expect(page.getByText("Paiement enregistré")).toBeVisible();
  await expect(page.getByText("Client modifié")).toHaveCount(0);
  const payment = page.getByRole("listitem").filter({ hasText: "Paiement enregistré" });
  await expect(payment).toContainText("Carte");
  await expect(payment).toContainText("Léa Martin · 15/10/2026");

  await page.getByLabel("Type").selectOption({ label: "Sécurité, sauvegardes et exports" });
  await expect(page.getByText("Sauvegarde automatique")).toBeVisible();
  await expect(page.getByText("Paiement enregistré")).toHaveCount(0);

  await page.getByLabel("Type").selectOption({ label: "Paiements et acomptes" });
  await page.getByRole("button", { name: "Ouvrir la séance" }).click();
  await expect(page.getByRole("button", { name: "← Journal" })).toBeVisible();
  await page.getByRole("button", { name: "← Journal" }).click();
  // Le filtre est gardé au retour.
  await expect(page.getByLabel("Type")).toHaveValue("billing");
  await expect(page.getByText("Paiement enregistré")).toBeVisible();
});

test("la fiche client montre son historique des modifications", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Clients" })
    .click();
  await page.getByRole("row", { name: /Léa Martin/ }).click();

  const history = page.getByRole("button", { name: /Historique des modifications/ });
  await expect(history).toHaveAttribute("aria-expanded", "false");
  await history.click();
  await expect(history).toHaveAttribute("aria-expanded", "true");

  const own = page.getByRole("listitem").filter({ hasText: "Client modifié" });
  await expect(own).toContainText("06 01 02 03 04");
  // Pas de lien vers la fiche déjà ouverte, mais vers la séance du paiement.
  await expect(own.getByRole("button", { name: "Ouvrir le client" })).toHaveCount(0);
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Paiement enregistré" })
      .getByRole("button", { name: "Ouvrir la séance" }),
  ).toBeVisible();
  // Rien sur le stock ni les sauvegardes dans la fiche client.
  await expect(page.getByText("Perte")).toHaveCount(0);
  await expect(page.getByText("Sauvegarde automatique")).toHaveCount(0);
});
