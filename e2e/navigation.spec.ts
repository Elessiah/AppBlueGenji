import { test, expect, type Page } from "./helpers/test";

/**
 * Barre de navigation de l'espace connecté (`components/site-nav.tsx`, D8) au
 * **navigateur** : les tests unitaires (`tests/app/navigation-a11y.test.tsx`)
 * lisent le CSS et l'ordre du HTML ; ici, à 375 et à 1280 px, une seule copie
 * de chaque lien est exposée (visible, atteignable au clavier) et l'ordre de
 * la touche Tab suit l'ordre visuel — logo puis compte puis liens en étroit,
 * liens puis logo en large.
 *
 * La barre n'existe qu'en session : sans `E2E_AUTH_USER`, ces tests sont sautés.
 */
const authConfigured = !!process.env.E2E_AUTH_USER;

const LINKS = ["Joueurs", "Équipes", "Tournois", "Classement"];

/** Noms accessibles des éléments focalisables **rendus** de la barre, dans l'ordre du DOM (= ordre de Tab, aucun `tabindex` positif). */
async function focusableNames(page: Page): Promise<string[]> {
  return page.getByRole("navigation", { name: "Navigation principale" }).evaluate((nav) =>
    [...nav.querySelectorAll<HTMLElement>("a[href], button, input, select, [tabindex]")]
      .filter((el) => el.tabIndex >= 0 && el.checkVisibility())
      .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim()),
  );
}

async function openPlayers(page: Page, width: number): Promise<Page> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/joueurs");
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  return page;
}

test.describe("Barre de navigation — une copie par largeur, ordre du clavier (D8)", () => {
  test.skip(!authConfigured, "Définir E2E_AUTH_USER : la barre n'existe qu'en session.");  // NOSONAR typescript:S1607 — skip conditionnel, sa raison est le second argument

  for (const width of [375, 1280]) {
    test(`${width} px : chaque lien et le logo n'apparaissent qu'une fois`, async ({ page }) => {
      await openPlayers(page, width);
      const names = await focusableNames(page);

      for (const link of LINKS) expect(names.filter((name) => name === link)).toHaveLength(1);
      expect(names.filter((name) => name === "Accueil")).toHaveLength(1);
    });
  }

  test("375 px : logo d'abord, liens en dernier", async ({ page }) => {
    await openPlayers(page, 375);
    const names = await focusableNames(page);

    expect(names[0]).toBe("Accueil");
    expect(names.slice(-LINKS.length)).toEqual(LINKS);
  });

  test("1280 px : liens d'abord, puis le logo", async ({ page }) => {
    await openPlayers(page, 1280);
    const names = await focusableNames(page);

    expect(names.slice(0, LINKS.length + 1)).toEqual([...LINKS, "Accueil"]);
  });

  test("1280 px : Tab passe du dernier lien au logo", async ({ page }) => {
    await openPlayers(page, 1280);
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await nav.getByRole("link", { name: "Classement", exact: true }).focus();

    await page.keyboard.press("Tab");

    await expect(nav.getByRole("link", { name: "Accueil", exact: true })).toBeFocused();
  });
});
