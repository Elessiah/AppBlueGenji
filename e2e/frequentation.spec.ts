import { test, expect } from "./helpers/test";

/**
 * Page `/frequentation` (`docs/features/STATS_PAGE.md`) : non référencée,
 * lisible en français et en anglais, sans défilement horizontal à 375 px.
 */
test.describe("Statistiques de fréquentation", () => {
  test("FR : noindex, titre et lien vers /rgpd", async ({ page }) => {
    await page.goto("/frequentation");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex, nofollow/);
    await expect(page.locator('a[href="/rgpd#audience-detaillee"]')).toBeVisible();
  });

  test("EN à 375 px : en anglais, sans défilement horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/en/frequentation");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('a[href="/en/rgpd#audience-detaillee"]')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("une page vue part sans cookie et répond 200", async ({ request, baseURL }) => {
    const response = await request.post("/api/audience", {
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Firefox/130.0", origin: baseURL ?? "" },
      data: { v: [{ p: "/regles", t: 1000, a: 1000, d: "mobile" }] },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });
});
