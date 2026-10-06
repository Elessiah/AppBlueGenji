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

  // `/association` n'est pas traduite : ni sélecteur ni `hreflang` (l'accueil,
  // traduit au lot 2, et `/connexion`, au lot 6, en portent — contrôles ci-dessous).
  test("une page française non traduite garde lang=fr, son nonce, et aucun sélecteur ni hreflang", async ({ page }) => {
    const response = await page.goto("/association");
    const csp = response?.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    // Next retire l'attribut `nonce` du DOM après exécution : on le lit dans le HTML servi.
    expect(await response?.text()).toContain(`nonce="${nonce}"`);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
    await expect(page.locator("a[hreflang]")).toHaveCount(0);
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
});
