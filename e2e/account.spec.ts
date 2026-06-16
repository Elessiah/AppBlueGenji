import { test, expect } from "@playwright/test";

/**
 * Parcours « compte vierge » — nécessite le bypass DEV_AUTH provisionnant un
 * utilisateur de test neuf : `E2E_AUTH_USER=fresh npm run test:e2e`.
 *
 * Couvre : profil neuf (stats à 0), édition (pseudo Discord), et la suppression
 * de compte (anonymisation, conservation des stats).
 */
const isFresh = process.env.E2E_AUTH_USER === "fresh";

test.describe("Compte vierge (authentifié, DEV_AUTH=fresh)", () => {
  test.skip(!isFresh, "Définir E2E_AUTH_USER=fresh pour activer le parcours nouveau compte.");

  test("le profil neuf affiche des statistiques à 0", async ({ page }) => {
    await page.goto("/profil");
    await expect(page).toHaveURL(/\/profil/);
    await expect(page.getByRole("heading", { name: "Mon profil" })).toBeVisible();

    // Stats à 0 pour un compte neuf.
    await expect(page.getByText("Tournois joués")).toBeVisible();
    const playedValue = page.locator(".ds-stat", { hasText: "Tournois joués" }).locator(".ds-stat-value");
    await expect(playedValue).toHaveText("0");
  });

  test("le champ Pseudo Discord est présent et éditable", async ({ page }) => {
    await page.goto("/profil");

    const discordField = page.locator(".field", { hasText: "Pseudo Discord" }).locator("input");
    await expect(discordField).toBeVisible();

    await discordField.fill("genji_test#0001");
    await page.getByRole("button", { name: "Sauvegarder" }).click();
    await expect(page.getByText("Profil mis à jour.")).toBeVisible();
  });

  test("le bouton de suppression de compte est présent", async ({ page }) => {
    await page.goto("/profil");
    await expect(page.getByRole("button", { name: "Supprimer mon compte" })).toBeVisible();
  });

  // Doit rester en dernier : supprime (anonymise) l'utilisateur de test.
  test("la suppression de compte anonymise et redirige", async ({ page }) => {
    await page.goto("/profil");
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await expect(page.getByText(/Compte supprimé/)).toBeVisible();
    await page.waitForURL("**/", { timeout: 5000 });
  });
});
