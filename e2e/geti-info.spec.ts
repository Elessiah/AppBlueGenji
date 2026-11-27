import { test, expect } from "./helpers/test";

/**
 * Page publique des annonces GETI (`/geti-info`, `docs/features/GETI_INFO.md`
 * § Page) : onglets à adresse propre, carte du serveur officiel, fenêtre
 * « Publier », filtres gardés dans l'adresse, version anglaise.
 *
 * La page se lit sans session. La CI n'a pas de base : la liste y est
 * « momentanément indisponible », le reste de la page est rendu quand même —
 * les contrôles qui portent sur des annonces ne jouent que sur une base seedée.
 */
const GETI_INVITE = "https://discord.gg/geti-geeking-time-318519377752227840";

test.describe("GETI Info — page publique", () => {
  test("six catégories, chacune à son adresse", async ({ page }) => {
    await page.goto("/geti-info");
    await expect(page.getByRole("heading", { level: 1, name: /GETI Info/ })).toBeVisible();

    const tabs = page.getByRole("navigation", { name: "Je cherche" });
    await expect(tabs.getByRole("link")).toHaveCount(6);
    await expect(tabs.getByRole("link", { name: "Un joueur" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Un scrim" })).toHaveAttribute("href", "/geti-info/lfs");

    await tabs.getByRole("link", { name: "Un scrim" }).click();
    await expect(page).toHaveURL(/\/geti-info\/lfs$/);
    await expect(page.getByRole("heading", { level: 2, name: "Je cherche un scrim" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Un scrim" })).toHaveAttribute("aria-current", "page");
  });

  test("une catégorie inconnue répond 404", async ({ page }) => {
    const response = await page.goto("/geti-info/inconnue");
    expect(response?.status()).toBe(404);
  });

  test("la carte du serveur officiel de GETI mène à son invitation, sans cadre", async ({ page }) => {
    await page.goto("/geti-info/lft");
    const card = page.getByRole("region", { name: "Serveur Discord officiel de GETI" });
    await expect(card.getByRole("link", { name: /Rejoindre/ })).toHaveAttribute("href", GETI_INVITE);
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("« Publier » ouvre une fenêtre vers le salon de la catégorie, refermée par Échap", async ({ page }) => {
    await page.goto("/geti-info/lfstaff");
    const trigger = page.getByRole("button", { name: "Publier une annonce" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Publier une annonce" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Ouvrir le salon/ })).toHaveAttribute(
      "href",
      "https://discord.com/channels/676570513023172637/679323814106103819",
    );
    await expect(dialog.getByRole("link", { name: /Rejoindre le serveur Discord GETI/ })).toHaveAttribute("href", GETI_INVITE);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("« Créer une alerte » sans session mène à la connexion, refermée par Échap", async ({ page }) => {
    await page.goto("/geti-info/lfp?role=tank");
    const trigger = page.getByRole("button", { name: "Créer une alerte" });
    const dialog = page.getByRole("dialog", { name: "Alertes d'annonces" });
    // Un clic parti avant l'hydratation est perdu : on le rejoue jusqu'à l'ouverture.
    await expect(async () => {
      await trigger.click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass();
    const login = dialog.getByRole("link", { name: "Se connecter" });
    // Sous le bypass DEV_AUTH, un compte est connecté : la fenêtre montre le formulaire.
    test.skip((await login.count()) === 0, "Session active (bypass DEV_AUTH) : le parcours sans session ne joue pas."); // NOSONAR typescript:S1607 — skip conditionnel, sa raison est le second argument
    await expect(login).toHaveAttribute("href", "/connexion");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("« Create an alert » en anglais", async ({ page }) => {
    await page.goto("/en/geti-info/lft");
    const dialog = page.getByRole("dialog", { name: "Post alerts" });
    // L'annonce de recrutement, en anglais, se referme par « Later » (le traitement commun ne connaît que « Plus tard »).
    const later = page.getByRole("button", { name: "Later", exact: true });
    await expect(async () => {
      if (await later.isVisible()) await later.click({ timeout: 1_000 });
      await page.getByRole("button", { name: "Create an alert" }).click({ timeout: 2_000 });
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass();
  });

  test("un filtre coché au clavier s'écrit dans l'adresse, et se réinitialise", async ({ page }) => {
    await page.goto("/geti-info/lfp");
    const filters = page.getByRole("form", { name: "Filtres" });
    const tank = filters.getByRole("group", { name: "Rôle" }).getByRole("checkbox", { name: "Tank", exact: true });
    // Rejoué jusqu'à ce que la page réponde : une touche reçue avant l'hydratation ne fait rien.
    await expect(async () => {
      if (!(await tank.isChecked())) {
        await tank.focus();
        await page.keyboard.press("Space");
      }
      await expect(page).toHaveURL(/\/geti-info\/lfp\?role=tank$/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(tank).toBeChecked();
    await expect(tank).toBeFocused();

    await filters.getByRole("button", { name: "Réinitialiser tous les filtres" }).click();
    await expect(page).toHaveURL(/\/geti-info\/lfp$/);
    await expect(tank).not.toBeChecked();
  });

  test("une adresse partagée rétablit les filtres ; chaque catégorie n'offre que les siens", async ({ page }) => {
    await page.goto("/geti-info/lfs?rmin=diamond-3&lvl=advanced&day=tue");
    const filters = page.getByRole("form", { name: "Filtres" });
    await expect(filters.getByLabel("Rang minimum")).toHaveValue("diamond-3");
    await expect(filters.getByRole("checkbox", { name: "Avancé" })).toBeChecked();
    await expect(filters.getByRole("checkbox", { name: "Mardi" })).toBeChecked();
    // Un scrim se cherche par niveau, pas par rôle.
    await expect(filters.getByRole("group", { name: "Rôle" })).toHaveCount(0);
    await expect(page.getByTestId("geti-count")).toBeVisible();
  });

  test("à 375 px, les filtres se replient derrière un bouton et rien ne déborde", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/geti-info/lfp");
    const toggle = page.getByRole("button", { name: /^Filtres/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("form", { name: "Filtres" })).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("form", { name: "Filtres" })).toBeVisible();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflows).toBe(false);
  });

  test("version anglaise sous /en, liens gardés dans la langue", async ({ page }) => {
    await page.goto("/en/geti-info/lfsub");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 2, name: "Looking for a sub" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Looking for" });
    await expect(tabs.getByRole("link", { name: "A cast" })).toHaveAttribute("href", "/en/geti-info/lfcast");
    await expect(page.getByRole("button", { name: "Publish a post" })).toBeVisible();
  });

  test("base seedée : annonces, pseudo copié en un clic, étiquettes mises en avant", async ({ page, context }) => {
    await page.goto("/geti-info/lfp?role=tank");
    const posts = page.getByTestId("geti-post");
    test.skip((await posts.count()) === 0, "Aucune annonce : base absente ou non seedée."); // NOSONAR typescript:S1607 — skip conditionnel, sa raison est le second argument

    await expect(page.getByTestId("geti-count")).toContainText(/annonce/);
    const first = posts.first();
    // L'étiquette qui répond au filtre est signalée autrement que par la couleur.
    await expect(first.locator('[data-match="true"]').first()).toContainText("Correspond à ta recherche");

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const tag = (await first.getByTestId("geti-tag").innerText()).replace(/^Pseudo Discord\s*:\s*/, "").trim();
    await first.getByRole("button", { name: /Copier le pseudo/ }).click();
    await expect(page.getByText(`Pseudo Discord copié : ${tag}`, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(tag);
  });

  test("base seedée : une annonce close n'apparaît que sur demande", async ({ page }) => {
    await page.goto("/geti-info/lfp?closed=1");
    const posts = page.getByTestId("geti-post");
    test.skip((await posts.count()) === 0, "Aucune annonce : base absente ou non seedée."); // NOSONAR typescript:S1607 — skip conditionnel, sa raison est le second argument
    const withClosed = await posts.count();

    await page.getByRole("form", { name: "Filtres" }).getByRole("checkbox", { name: "Montrer les annonces closes" }).uncheck();
    await expect(page).toHaveURL(/\/geti-info\/lfp$/);
    await expect.poll(() => posts.count()).toBeLessThan(withClosed);
  });
});
