import { test, expect } from "@playwright/test";

/**
 * Header public dynamique sur la page d'accueil (scopé à l'élément <header>,
 * la landing contenant par ailleurs un CTA « Rejoindre le Discord »).
 * - Sans session : un seul bouton « Rejoindre » (vers `/connexion`).
 * - Connecté (bypass DEV_AUTH) : avatar + pseudo, plus de bouton d'accès.
 * - Dans les deux cas : le menu burger, à gauche de la marque.
 */
const authConfigured = !!process.env.E2E_AUTH_USER;

test.describe("Header landing", () => {
  test("visiteur non connecté : bouton Rejoindre unique", async ({ page }) => {
    test.skip(authConfigured, "Bypass actif : l'utilisateur est connecté, header différent.");
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: /Rejoindre/ })).toBeVisible();
    await expect(header.getByRole("link", { name: /^Connexion$/ })).toHaveCount(0);
  });

  test("utilisateur connecté : avatar + pseudo, plus de Rejoindre", async ({ page }) => {
    test.skip(!authConfigured, "Définir E2E_AUTH_USER pour le header connecté.");
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: /Mon profil/ })).toBeVisible();
    await expect(header.getByRole("link", { name: /Rejoindre/ })).toHaveCount(0);
  });

  test("CTA de bas de page : « Créer un compte » seulement hors session", async ({ page }) => {
    await page.goto("/");
    const cta = page.locator("section", { hasText: "REJOINDRE LA SCÈNE" }).last();

    if (authConfigured) {
      await expect(cta.getByRole("link", { name: /Inscrire mon équipe/ })).toBeVisible();
      await expect(cta.getByRole("link", { name: /Créer un compte/ })).toHaveCount(0);
    } else {
      await expect(cta.getByRole("link", { name: /Créer un compte/ })).toHaveAttribute(
        "href",
        "/connexion",
      );
    }
  });

  test("le menu burger est visible et libellé, avant la marque", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header").first();
    const burger = header.getByRole("button", { name: /Ouvrir le menu/ });
    await expect(burger).toBeVisible();
    await expect(burger).toContainText("MENU");

    await burger.click();
    await expect(header.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  });
});
