import { test, expect } from "@playwright/test";

/**
 * E2E parcours authentifié sur le dashboard tournois.
 *
 * PRÉREQUIS (sinon les tests sont ignorés automatiquement) :
 *  - une base MySQL accessible avec les `DB_*` configurés ;
 *  - `DEV_AUTH_USER_ID` défini sur un user existant (ex. seed : `npm run seed`) ;
 *  - le même id exporté en `E2E_AUTH_USER` pour activer ce fichier.
 *
 * Le bypass DEV_AUTH (`lib/server/auth.ts`) authentifie alors toutes les routes
 * `(secured)` sans passer par OAuth ni le code Discord.
 */
const authConfigured = !!process.env.E2E_AUTH_USER;

test.describe("Dashboard tournois (authentifié)", () => {
  test.skip(
    !authConfigured,
    "Définir E2E_AUTH_USER (+ DEV_AUTH_USER_ID et DB) pour activer le parcours authentifié.",
  );

  test("affiche l'en-tête, les métriques et les sections", async ({ page }) => {
    await page.goto("/tournois");

    // Pas de redirection vers /connexion : l'utilisateur est bien authentifié.
    await expect(page).toHaveURL(/\/tournois/);

    await expect(page.getByRole("heading", { name: /Tournois/ })).toBeVisible();
    await expect(page.getByText("SUIVI TEMPS RÉEL · PHASES MULTIPLES · BRACKETS ARBITRÉS")).toBeVisible();

    // Les quatre sections de statut sont rendues.
    for (const title of ["EN COURS", "INSCRIPTIONS OUVERTES", "PROCHAINEMENT", "TERMINÉS"]) {
      await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
    }
  });

  test("filtre par jeu et recherche", async ({ page }) => {
    await page.goto("/tournois");

    const search = page.getByPlaceholder(/Rechercher un tournoi/);
    await expect(search).toBeVisible();
    await search.fill("xyz-aucun-resultat-attendu");
    await expect(page.getByText(/Aucun tournoi/).first()).toBeVisible();
    await search.clear();

    // Bascule sur un filtre de jeu sans erreur.
    await page.getByRole("button", { name: /Overwatch 2/ }).click();
    await page.getByRole("button", { name: /Marvel Rivals/ }).click();
    await page.getByRole("button", { name: /^Tous/ }).click();
  });

  test("le bouton « Créer un tournoi » mène au formulaire de création", async ({ page }) => {
    await page.goto("/tournois");
    await page.getByRole("button", { name: /Créer un tournoi/ }).click();
    await expect(page).toHaveURL(/\/tournois\/creer/);
  });
});
