import { test, expect } from "@playwright/test";

/**
 * E2E auth — ne dépend ni de la DB ni du bypass DEV_AUTH.
 *
 * Couvre :
 *  - le rendu de la page de connexion (deux voies : Google + code Discord) ;
 *  - le flux Discord en deux étapes (demande d'ID → saisie du code) ;
 *  - la protection des routes `(secured)` : un visiteur non authentifié est
 *    redirigé vers /connexion (la garde `requireCurrentUser` ne touche pas la DB
 *    quand il n'y a ni cookie de session ni DEV_AUTH_USER_ID).
 */

test.describe("Connexion", () => {
  test("affiche les deux voies d'authentification", async ({ page }) => {
    await page.goto("/connexion");

    await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
    await expect(page.getByText("BLUEGENJI · ACCÈS MEMBRE")).toBeVisible();

    // Voie 1 : Google OAuth
    const google = page.getByRole("link", { name: "Continuer avec Google" });
    await expect(google).toBeVisible();
    await expect(google).toHaveAttribute("href", /\/api\/auth\/google\/start/);

    // Voie 2 : code Discord (étape 1 = demande d'un code)
    await expect(page.getByPlaceholder("123456789012345678")).toBeVisible();
    await expect(page.getByRole("button", { name: /Recevoir un code/ })).toBeVisible();
  });

  test("le flux Discord passe à l'étape de saisie du code", async ({ page }) => {
    // Le bot interne n'est pas joignable en E2E : la requête échoue et un toast
    // d'erreur apparaît, mais l'UI ne doit pas crasher.
    await page.route("**/api/auth/discord/request", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ expiresAt: new Date(Date.now() + 600_000).toISOString() }),
      }),
    );

    await page.goto("/connexion");
    await page.getByPlaceholder("123456789012345678").fill("123456789012345678");
    await page.getByRole("button", { name: /Recevoir un code/ }).click();

    // Étape 2 : champ du code à 6 chiffres + bouton "Se connecter"
    await expect(page.locator('input[name="code"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();

    // Retour arrière possible
    await page.getByRole("button", { name: /CHANGER D'ID/ }).click();
    await expect(page.getByRole("button", { name: /Recevoir un code/ })).toBeVisible();
  });
});

test.describe("Protection des routes sécurisées", () => {
  // Ces tests vérifient la redirection en l'ABSENCE de session. Si le bypass
  // DEV_AUTH est actif (E2E_AUTH_USER défini), l'utilisateur est authentifié et
  // les routes ne redirigent plus : on les ignore alors.
  test.skip(!!process.env.E2E_AUTH_USER, "Bypass DEV_AUTH actif : pas de redirection attendue.");

  for (const path of ["/tournois", "/equipes", "/joueurs", "/profil"]) {
    test(`redirige ${path} vers /connexion sans session`, async ({ page }) => {
      await page.context().clearCookies();
      await page.goto(path);
      await expect(page).toHaveURL(/\/connexion/);
    });
  }
});
