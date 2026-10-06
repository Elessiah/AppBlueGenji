import { test, expect } from "./helpers/test";

/**
 * Infrastructure bilingue (`docs/features/I18N.md`), contrôlée dans un vrai
 * navigateur — ce que les tests unitaires du middleware ne voient pas : la
 * réponse réellement servie par Next, nonce apposé sur les scripts compris.
 *
 * Au lot 0, aucune route n'est traduite : toute adresse `/en/…` renvoie vers la
 * française. Chaque lot qui traduit une route y ajoute son contrôle `lang="en"`
 * et `hreflang`.
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

  test("aucune redirection selon Accept-Language", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0, headers: { "accept-language": "en-US,en;q=0.9" } });
    expect(response.status()).toBe(200);
  });

  test("la page française garde lang=fr, son nonce, et aucun sélecteur ni hreflang", async ({ page }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    // Next retire l'attribut `nonce` du DOM après exécution : on le lit dans le HTML servi.
    expect(await response?.text()).toContain(`nonce="${nonce}"`);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
    await expect(page.locator("a[hreflang]")).toHaveCount(0);
  });
});
