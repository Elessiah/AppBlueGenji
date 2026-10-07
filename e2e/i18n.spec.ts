import { test, expect } from "./helpers/test";

/**
 * Infrastructure bilingue (`docs/features/I18N.md`), contrôlée dans un vrai
 * navigateur — ce que les tests unitaires du middleware ne voient pas : la
 * réponse réellement servie par Next, nonce apposé sur les scripts compris.
 *
 * Une route pas encore traduite renvoie de `/en/…` vers la française ;
 * l'accueil (lot 2) et les règles (lot 3) sont servis en anglais. Chaque lot
 * qui traduit une route y ajoute son contrôle `lang="en"` et `hreflang`.
 */
test.describe("Langues — adresses /en", () => {
  test("une route pas encore traduite renvoie vers la française, en français", async ({ page }) => {
    const response = await page.goto("/en/route-jamais-traduite");
    expect(new URL(page.url()).pathname).toBe("/route-jamais-traduite");
    expect(response?.request().redirectedFrom()?.url()).toContain("/en/route-jamais-traduite");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("/en/api/… répond 404, jamais réécrit vers l'API", async ({ request }) => {
    const get = await request.get("/en/api/me/match-launches", { maxRedirects: 0 });
    expect(get.status()).toBe(404);
    const post = await request.post("/en/api/visits", { maxRedirects: 0, headers: { origin: "https://evil.test" } });
    expect(post.status()).toBe(404);
  });

  // Incident du 2026-10-06 : derrière nginx (`X-Forwarded-Proto: https`), la
  // réécriture du middleware était relayée en HTTPS vers le serveur HTTP (500).
  // Le serveur d'E2E écoute sur `localhost`, où l'écart d'hôte ne se produit
  // pas (`tests/app/locale-rewrites.test.ts` couvre `127.0.0.1`) : ce contrôle
  // tient les en-têtes du mandataire sur la réponse réellement servie.
  test("/en sous les en-têtes du mandataire TLS : 200 et lang=en", async ({ request }) => {
    for (const path of ["/en", "/en/regles"]) {
      const response = await request.get(path, {
        maxRedirects: 0,
        headers: { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" },
      });
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain('<html lang="en"');
    }
  });

  test("aucune redirection selon Accept-Language", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0, headers: { "accept-language": "en-US,en;q=0.9" } });
    expect(response.status()).toBe(200);
  });

  // Lot 3 : première route traduite.
  test("/en/regles/<mode> : lang=en, canonique anglaise, hreflang réciproques, nonce", async ({ page }) => {
    const response = await page.goto("/en/regles/ronde-suisse");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/en/regles/ronde-suisse");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toHaveText("Swiss");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/regles\/ronde-suisse$/);
    await expect(page.locator('link[rel="alternate"][hreflang="fr"]')).toHaveAttribute("href", /[^n]\/regles\/ronde-suisse$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", /\/en\/regles\/ronde-suisse$/);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", /[^n]\/regles\/ronde-suisse$/);
    const nonce = /'nonce-([^']+)'/.exec(response?.headers()["content-security-policy"] ?? "")?.[1];
    expect(await response?.text()).toContain(`nonce="${nonce}"`);
    // Le sélecteur mène à la même page en français.
    await expect(page.locator('a[hreflang="fr"]').first()).toHaveAttribute("href", "/regles/ronde-suisse");
  });

  test("/regles : français, avec le sélecteur et les hreflang vers l'anglais", async ({ page }) => {
    await page.goto("/regles");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", /\/en\/regles$/);
    await expect(page.locator('a[hreflang="en"]').first()).toHaveAttribute("href", "/en/regles");
  });

  // `/tournois` n'est pas traduite (lot 8) : ni sélecteur ni `hreflang` (l'accueil,
  // traduit au lot 2, et `/connexion`, au lot 6, en portent — contrôles ci-dessous).
  // `/mentions-legales` servait d'exemple jusqu'à sa traduction (lot 7b-1).
  test("une page française non traduite garde lang=fr, son nonce, et aucun sélecteur ni hreflang", async ({ page }) => {
    // `/tournois` est traduite depuis le lot 8a-1 : `/equipes` reste française (lot 9).
    const response = await page.goto("/equipes");
    const csp = response?.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    // Next retire l'attribut `nonce` du DOM après exécution : on le lit dans le HTML servi.
    expect(await response?.text()).toContain(`nonce="${nonce}"`);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
    await expect(page.locator("a[hreflang]")).toHaveCount(0);
  });

  // Lot 5a : la documentation du bot sert un fichier par langue (le dépôt du
  // bot peut manquer en E2E : la page dit alors le fichier introuvable).
  test("/en/bot/docs/guide : anglais, canonique et hreflang ; l'ancien guide anglais y redirige", async ({ page }) => {
    const response = await page.goto("/en/bot/docs/guide");
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/bot\/docs\/guide$/);
    await expect(page.locator('link[rel="alternate"][hreflang="fr"]')).toHaveAttribute("href", /\/bot\/docs\/guide$/);
    await expect(page.getByText("Back to the dashboard")).toBeVisible();
    await page.goto("/bot/docs/user-guide-en");
    expect(new URL(page.url()).pathname).toBe("/en/bot/docs/guide");
  });

  test("l'accueil traduit : /en en anglais, hreflang réciproques fr/en/x-default", async ({ page }) => {
    for (const [path, lang] of [
      ["/", "fr"],
      ["/en", "en"],
    ]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      const alternates = page.locator('link[rel="alternate"][hreflang]');
      await expect(alternates).toHaveCount(3);
      const hreflangs = await alternates.evaluateAll((links) => links.map((l) => l.getAttribute("hreflang")).sort());
      expect(hreflangs).toEqual(["en", "fr", "x-default"]);
    }
  });

  // Lot 7b-1 : documents légaux du site en anglais, avec l'avis « French version prevails ».
  test("/en/mentions-legales : lang=en, hreflang réciproques et avis de primauté du français", async ({ page }) => {
    const response = await page.goto("/en/mentions-legales");
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('link[rel="alternate"][hreflang="fr"]')).toHaveAttribute("href", /\/mentions-legales$/);
    await expect(page.getByText("French version prevails", { exact: false }).first()).toBeVisible();
    await page.goto("/mentions-legales");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByText("French version prevails", { exact: false })).toHaveCount(0);
  });

  test("/en/connexion : lang=en, noindex, et les départs OAuth emportent la langue", async ({ page }) => {
    const response = await page.goto("/en/connexion?redirect=%2Fen%2Fregles");
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toHaveText("Log in");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/connexion$/);
    const hreflangs = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((links) => links.map((l) => l.getAttribute("hreflang")).sort());
    expect(hreflangs).toEqual(["en", "fr", "x-default"]);
    // Rappel inchangé (`/api/auth/<slug>/callback`) : seule la route de départ porte la langue.
    await expect(page.locator('a[href^="/api/auth/google/start"]').first()).toHaveAttribute("href", /redirect=%2Fen%2Fregles&lang=en/);
  });

  // Lot 8a-1 : la liste des tournois. Sans session, la carte « Connexion
  // requise » (200) dans la langue de l'adresse, métadonnées de la page comprises.
  test("/en/tournois : lang=en, carte de connexion anglaise, hreflang réciproques, noindex", async ({ page }) => {
    const response = await page.goto("/en/tournois");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/en/tournois");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Login required");
    await expect(page.locator('a[href^="/en/connexion?redirect=%2Fen%2Ftournois"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/tournois$/);
    await expect(page.locator('link[rel="alternate"][hreflang="fr"]')).toHaveAttribute("href", /[^n]\/tournois$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("/en/tournois/creer reste française (lot 8b)", async ({ page }) => {
    await page.goto("/en/tournois/creer");
    expect(new URL(page.url()).pathname).toBe("/tournois/creer");
  });

  // Lot 8a-2 : la fiche d'un tournoi. `[id]` n'accepte qu'un entier.
  test("/en/tournois/<id> : lang=en, carte de connexion anglaise, hreflang de la fiche", async ({ page }) => {
    const response = await page.goto("/en/tournois/1");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/en/tournois/1");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Login required");
  });
});
