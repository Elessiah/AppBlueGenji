import { test, expect } from "@playwright/test";

/**
 * Filtres des annuaires (joueurs / équipes / tournois). Lecture seule.
 * Activer : `E2E_AUTH_USER=<id> npm run test:e2e` (ou `fresh`).
 */
const authConfigured = !!process.env.E2E_AUTH_USER;

test.describe("Filtres des annuaires (authentifié)", () => {
  test.skip(!authConfigured, "Définir E2E_AUTH_USER pour activer les parcours authentifiés.");

  test("/joueurs : recherche + filtres de rôle/statut + tri", async ({ page }) => {
    await page.goto("/joueurs");
    await expect(page.getByRole("heading", { name: /Joueurs/ })).toBeVisible();

    await expect(page.getByPlaceholder(/Rechercher un pseudo/)).toBeVisible();

    // Filtres de rôle.
    for (const role of ["DPS", "Tank", "Heal", "Coach"]) {
      await page.getByRole("button", { name: new RegExp(`^${role}$`) }).first().click();
    }
    // Statut free agents + tri.
    await page.getByRole("button", { name: /FREE AGENTS/ }).click();
    await page.getByRole("button", { name: /^Tournois$/ }).click();
    await page.getByRole("button", { name: /^Tous$/ }).first().click();
  });

  test("/equipes : recherche + filtre par jeu + tri", async ({ page }) => {
    await page.goto("/equipes");
    await expect(page.getByRole("heading", { name: /Équipes/ })).toBeVisible();

    await expect(page.getByPlaceholder(/Rechercher une équipe/)).toBeVisible();

    await page.getByRole("button", { name: /Overwatch 2/ }).click();
    await page.getByRole("button", { name: /Marvel Rivals/ }).click();
    await page.getByRole("button", { name: /^Toutes/ }).click();

    // Tri.
    await page.getByRole("button", { name: /^Nom$/ }).click();
    await page.getByRole("button", { name: /^Victoires$/ }).click();
  });

  test("/tournois : recherche sans résultat + filtres de jeu", async ({ page }) => {
    await page.goto("/tournois");
    const search = page.getByPlaceholder(/Rechercher un tournoi/);
    await expect(search).toBeVisible();

    await search.fill("zzz-aucun-resultat-xyz");
    await expect(page.getByText(/Aucun tournoi/).first()).toBeVisible();
    await search.clear();

    await page.getByRole("button", { name: /Overwatch 2/ }).click();
    await page.getByRole("button", { name: /Marvel Rivals/ }).click();
    await page.getByRole("button", { name: /^Tous/ }).click();
  });
});
