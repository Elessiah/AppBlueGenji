import { test, expect } from "@playwright/test";

/**
 * Header public dynamique sur la page d'accueil (scopé à l'élément <header>,
 * la landing contenant par ailleurs un CTA « Rejoindre le Discord »).
 * - Sans session : boutons « Connexion » + « Rejoindre ».
 * - Connecté (bypass DEV_AUTH) : avatar + pseudo, plus de boutons d'accès.
 */
const authConfigured = !!process.env.E2E_AUTH_USER;

test.describe("Header landing", () => {
  test("visiteur non connecté : boutons Connexion / Rejoindre", async ({ page }) => {
    test.skip(authConfigured, "Bypass actif : l'utilisateur est connecté, header différent.");
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: /Connexion/ })).toBeVisible();
    await expect(header.getByRole("link", { name: /Rejoindre/ })).toBeVisible();
  });

  test("utilisateur connecté : avatar + pseudo, plus de Connexion/Rejoindre", async ({ page }) => {
    test.skip(!authConfigured, "Définir E2E_AUTH_USER pour le header connecté.");
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: /Mon profil/ })).toBeVisible();
    await expect(header.getByRole("link", { name: /Connexion/ })).toHaveCount(0);
    await expect(header.getByRole("link", { name: /Rejoindre/ })).toHaveCount(0);
  });
});
