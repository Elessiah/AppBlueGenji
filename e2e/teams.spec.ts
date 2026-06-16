import { test, expect } from "@playwright/test";

/**
 * Gestion d'équipe : description à la création + self-service (bouton Rejoindre).
 * Lecture seule (n'effectue aucune mutation) pour rester ré-exécutable.
 * Activer : `E2E_AUTH_USER=fresh npm run test:e2e` (utilisateur sans équipe).
 */
const isFresh = process.env.E2E_AUTH_USER === "fresh";

test.describe("Gestion d'équipe (authentifié)", () => {
  test.skip(!isFresh, "Définir E2E_AUTH_USER=fresh (utilisateur sans équipe) pour ce test.");

  test("le formulaire de création expose un champ description", async ({ page }) => {
    await page.goto("/equipes/creer");
    await expect(page.getByRole("heading", { name: /Créer mon équipe/ })).toBeVisible();
    const descField = page.locator(".field", { hasText: "Description" }).locator("textarea");
    await expect(descField).toBeVisible();
  });

  test("un joueur sans équipe voit le bouton « Rejoindre » sur une fiche équipe", async ({ page }) => {
    await page.goto("/equipes");
    await expect(page.getByRole("heading", { name: /Équipes/ })).toBeVisible();

    const firstTeam = page.locator('a[href^="/equipes/"]:not([href$="/creer"])').first();
    await expect(firstTeam).toBeVisible();
    await firstTeam.click();

    await expect(page).toHaveURL(/\/equipes\/\d+/);
    await expect(page.getByRole("button", { name: /Rejoindre cette équipe/ })).toBeVisible();
  });

  // Doit rester en dernier : crée puis dissout une équipe (mutation).
  test("le propriétaire peut dissoudre son équipe (soft-delete)", async ({ page }) => {
    const teamName = `E2E Dissolution ${Date.now()}`;

    // Création.
    await page.goto("/equipes/creer");
    await page.getByPlaceholder("Mon équipe").fill(teamName);
    await page.locator(".field", { hasText: "Description" }).locator("textarea").fill("Équipe de test à dissoudre.");
    await page.getByRole("button", { name: /Créer l'équipe/ }).click();
    await expect(page).toHaveURL(/\/equipes\/\d+/);
    const teamUrl = page.url();

    // Le bouton d'accès rapide à mon équipe apparaît dans la nav (après reload,
    // le layout serveur recalcule l'équipe active).
    await page.reload();
    await expect(page.getByRole("link", { name: /Mon équipe/ })).toBeVisible();

    // Dissolution (propriétaire).
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Dissoudre l'équipe/ }).click();
    await expect(page.getByText(/Équipe dissoute\. Ses statistiques/)).toBeVisible();
    await page.waitForURL("**/equipes", { timeout: 5000 });

    // La fiche reste consultable mais affiche le bandeau « dissoute ».
    await page.goto(teamUrl);
    await expect(page.getByText(/ne peut plus être rejointe ni administrée/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Rejoindre cette équipe/ })).toHaveCount(0);
  });
});
