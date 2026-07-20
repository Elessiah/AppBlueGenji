import { test, expect, type Page } from "@playwright/test";

/**
 * E2E du mode de tournoi « Survie » (parcours authentifié admin/arbitre).
 *
 * PRÉREQUIS (sinon les tests sont ignorés automatiquement) :
 *  - une base MySQL accessible avec les `DB_*` configurés ;
 *  - `DEV_AUTH_USER_ID` défini sur un user **admin/arbitre** existant ;
 *  - le même id exporté en `E2E_AUTH_USER` pour activer ce fichier.
 *
 * Voir `e2e/README.md` et `docs/features/SURVIVAL_MODE.md`.
 */
const authConfigured = !!process.env.E2E_AUTH_USER;

async function isReferee(page: Page): Promise<boolean> {
  const me = await page.request.get("/api/auth/me");
  if (!me.ok()) return false;
  const user = (await me.json())?.user;
  if (!user) return false;
  // `can(user, "tournaments")` : admin OU rôle ARBITRE.
  return Boolean(user.isAdmin) || (Array.isArray(user.roles) && user.roles.includes("ARBITRE"));
}

test.describe("Tournoi mode Survie (authentifié)", () => {
  test.skip(
    !authConfigured,
    "Définir E2E_AUTH_USER (+ DEV_AUTH_USER_ID admin/arbitre et DB) pour activer ce parcours.",
  );

  test("le formulaire révèle le champ « rounds avant élimination » et masque la petite finale", async ({
    page,
  }) => {
    await page.goto("/tournois/creer");
    if (!(await isReferee(page))) {
      test.skip(true, "L'utilisateur bypass courant n'a pas la permission tournois.");
    }
    await expect(page).toHaveURL(/\/tournois\/creer/);

    const formatSelect = page.locator('select:has(option[value="SURVIVAL"])');
    await expect(formatSelect).toBeVisible();

    // SINGLE (défaut) : petite finale proposée, pas de champ Survie.
    await formatSelect.selectOption("SINGLE");
    await expect(page.getByText("Petite finale")).toBeVisible();
    await expect(page.locator("#survival-rounds")).toHaveCount(0);

    // SURVIVAL : champ rounds visible (défaut 3), petite finale masquée.
    await formatSelect.selectOption("SURVIVAL");
    const roundsInput = page.locator("#survival-rounds");
    await expect(roundsInput).toBeVisible();
    await expect(roundsInput).toHaveValue("3");
    await expect(page.getByText("Petite finale")).toHaveCount(0);
  });

  test("crée un tournoi Survie et affiche la vue dédiée", async ({ page }) => {
    await page.goto("/tournois/creer");
    if (!(await isReferee(page))) {
      test.skip(true, "L'utilisateur bypass courant n'a pas la permission tournois.");
    }

    const name = `E2E Survie ${Date.now()}`;
    await page.getByPlaceholder("Mon tournoi").fill(name);

    const formatSelect = page.locator('select:has(option[value="SURVIVAL"])');
    await formatSelect.selectOption("SURVIVAL");
    await page.locator("#survival-rounds").fill("2");

    await page.getByRole("button", { name: /Créer le tournoi/ }).click();

    // Redirection vers la page détail du tournoi créé.
    await expect(page).toHaveURL(/\/tournois\/\d+$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // La page détail rend bien le format « Survie » et ses sections.
    await expect(page.getByText("Survie", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Arbre du tournoi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inscriptions" })).toBeVisible();
  });
});

test.describe("Formulaire de création — mode Survie (public gating)", () => {
  test("la permission tournois est requise pour accéder au formulaire", async ({ page }) => {
    test.skip(
      !authConfigured,
      "Nécessite E2E_AUTH_USER pour vérifier le gating de permission.",
    );
    await page.goto("/tournois/creer");
    // Un non-arbitre est redirigé hors du formulaire ; un arbitre y reste.
    if (await isReferee(page)) {
      await expect(page).toHaveURL(/\/tournois\/creer/);
    } else {
      await expect(page).not.toHaveURL(/\/tournois\/creer/);
    }
  });
});
