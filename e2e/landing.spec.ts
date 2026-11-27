import { test, expect } from "./helpers/test";

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
    test.skip(authConfigured, "Bypass actif : l'utilisateur est connecté, header différent.");  // NOSONAR typescript:S1607 — skip conditionnel, sa raison est le second argument
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: /Rejoindre/ })).toBeVisible();
    await expect(header.getByRole("link", { name: /^Connexion$/ })).toHaveCount(0);
  });

  test("utilisateur connecté : avatar + pseudo, plus de Rejoindre", async ({ page }) => {
    test.skip(!authConfigured, "Définir E2E_AUTH_USER pour le header connecté.");  // NOSONAR typescript:S1607 — skip conditionnel, sa raison est le second argument
    await page.goto("/");
    const header = page.locator("header").first();
    // Le menu du compte s'ouvre par un bouton dont le nom commence par le pseudo affiché (WCAG 2.5.3).
    await expect(header.getByRole("button", { name: /, menu du compte$/ })).toBeVisible();
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

  test("le menu burger ouvre sur les annonces GETI, sans la partie compétitive", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header").first();
    const burger = header.getByRole("button", { name: /Ouvrir le menu/ });
    const nav = header.getByRole("navigation", { name: "Navigation principale" });
    // Un clic avant l'hydratation est perdu : on réessaie jusqu'à l'ouverture.
    await expect(async () => {
      if (!(await nav.isVisible())) await burger.click();
      await expect(nav).toBeVisible({ timeout: 1_000 });
    }).toPass();

    await expect(nav.getByRole("link").first()).toHaveText("Annonces GETI");
    await expect(nav.getByRole("link", { name: "Annonces GETI" })).toHaveAttribute("href", "/geti-info/lfp");
    for (const name of ["Tournois", "Équipes", "Classement", "Joueurs"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
  });

  test("l'accueil annonce les annonces GETI et ses six catégories", async ({ page }) => {
    await page.goto("/");
    const spotlight = page.locator("section", { has: page.locator("#geti-spotlight-title") });
    await expect(spotlight.getByRole("link", { name: "Voir les annonces GETI" })).toHaveAttribute("href", "/geti-info/lfp");
    await expect(spotlight.getByRole("list", { name: "Parcourir" }).getByRole("link")).toHaveCount(6);
    await expect(spotlight.getByRole("link", { name: "Scrims" })).toHaveAttribute("href", "/geti-info/lfs");
  });

  test("l'accueil anglais annonce les annonces GETI en anglais", async ({ page }) => {
    await page.goto("/en");
    const spotlight = page.locator("section", { has: page.locator("#geti-spotlight-title") });
    await expect(spotlight.getByRole("link", { name: "Browse GETI posts" })).toHaveAttribute("href", "/en/geti-info/lfp");
    await expect(spotlight.getByRole("link", { name: "Scrims" })).toHaveAttribute("href", "/en/geti-info/lfs");
  });
});
