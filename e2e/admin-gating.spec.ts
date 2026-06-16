import { test, expect } from "@playwright/test";

/**
 * Gating admin de la création de tournoi. L'utilisateur `fresh` n'est PAS admin :
 * le bouton « Créer un tournoi » doit être masqué et l'accès direct à
 * `/tournois/creer` doit rediriger vers `/tournois`.
 *
 * Activer : `E2E_AUTH_USER=fresh npm run test:e2e`.
 */
const isFresh = process.env.E2E_AUTH_USER === "fresh";

test.describe("Création de tournoi réservée aux admins", () => {
  test.skip(!isFresh, "Définir E2E_AUTH_USER=fresh (utilisateur non-admin) pour ce test.");

  test("le bouton « Créer un tournoi » est masqué pour un non-admin", async ({ page }) => {
    await page.goto("/tournois");
    await expect(page).toHaveURL(/\/tournois/);
    await expect(page.getByRole("button", { name: /Créer un tournoi/ })).toHaveCount(0);
  });

  test("l'accès direct à /tournois/creer redirige un non-admin", async ({ page }) => {
    await page.goto("/tournois/creer");
    await expect(page).toHaveURL(/\/tournois(\?|$|\/)/);
    await expect(page).not.toHaveURL(/\/tournois\/creer/);
  });
});
