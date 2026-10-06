import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 2, avec la **vraie** liste blanche : l'accueil est la première route
 * traduite — réécriture de `/en`, `hreflang`, sitemap, sélecteur de langue.
 */
let mockPathname = "/en";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { middleware } from "@/middleware";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import { isMigratedRoute, localeAlternates, localeHref } from "@/lib/shared/locales";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";

const PUBLIC = "https://bluegenji.test";

describe("accueil traduit — liste blanche", () => {
  it("l'accueil est traduit au lot 2 (les règles, le classement et le bot l'ont rejoint aux lots 3, 4 et 5a), pas ses pages voisines", () => {
    expect(MIGRATED_ROUTES).toContain("/");
    expect(isMigratedRoute("/")).toBe(true);
    expect(isMigratedRoute("/association")).toBe(false);
    expect(isMigratedRoute("/benevoles")).toBe(false);
  });

  it("un lien vers l'accueil prend /en sur une page anglaise, les autres restent français", () => {
    expect(localeHref("/", "en")).toBe("/en");
    expect(localeHref("/", "fr")).toBe("/");
    expect(localeHref("/tournois", "en")).toBe("/tournois");
  });

  it("hreflang réciproques, x-default français", () => {
    expect(localeAlternates("/")).toEqual({ fr: "/", en: "/en", "x-default": "/" });
  });
});

describe("accueil traduit — middleware", () => {
  const previousAppUrl = process.env.APP_URL;
  beforeAll(() => {
    process.env.APP_URL = PUBLIC;
  });
  afterAll(() => {
    process.env.APP_URL = previousAppUrl;
  });

  // La réécriture vers `/` est faite par `next.config.ts`, sur la foi de la
  // marque (`tests/app/locale-rewrites.test.ts`).
  it("/en passe, marqué anglais pour l'accueil — plus de 307", () => {
    for (const path of ["/en", "/en/"]) {
      const response = middleware(new NextRequest(`${PUBLIC}${path}`));
      expect(response.status).not.toBe(307);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/");
      expect(response.headers.get("x-middleware-request-x-bg-locale")).toBe("en");
    }
  });

  it("une page voisine pas encore traduite redirige toujours", () => {
    const response = middleware(new NextRequest(`${PUBLIC}/en/association`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${PUBLIC}/association`);
  });
});

describe("accueil traduit — sitemap", () => {
  it("annonce /en avec les mêmes hreflang que /, et aucune adresse anglaise d'une route non traduite", () => {
    const entries = localizedSitemapEntries(publicSitemapRoutes());
    const home = entries.filter((entry) => entry.path === "/" || entry.path === "/en");
    expect(home.map((entry) => entry.path).sort()).toEqual(["/", "/en"]);
    for (const entry of home) expect(entry.languages).toEqual({ fr: "/", en: "/en", "x-default": "/" });
    for (const entry of entries.filter((e) => e.path.startsWith("/en/"))) {
      expect(isMigratedRoute(entry.path.slice(3))).toBe(true);
    }
  });
});

describe("sélecteur de langue — sur l'accueil, et sur mobile", () => {
  function render(locale: "fr" | "en", pathname: string): string {
    mockPathname = pathname;
    return renderToStaticMarkup(
      <AppLocaleProvider locale={locale}>
        <LanguageSwitcher label={locale === "en" ? "read this page in French" : "lire cette page en anglais"} />
      </AppLocaleProvider>,
    );
  }

  it("visible sur l'accueil : nom complet et code court, chacun dans sa langue", () => {
    const fr = render("fr", "/");
    expect(fr).toContain('href="/en"');
    expect(fr).toContain('hrefLang="en"');
    expect(fr).toMatch(/<span lang="en" class="full">English<\/span><span lang="en" class="short">EN<\/span>/);
    const en = render("en", "/en");
    expect(en).toContain('href="/"');
    expect(en).toMatch(/<span lang="fr" class="short">FR<\/span>/);
  });

  it("muet sur une page non traduite", () => {
    expect(render("fr", "/association")).toBe("");
  });

  it("sur un écran étroit, le code remplace le nom, et l'en-tête resserre le sélecteur", () => {
    const css = readFileSync(join(__dirname, "..", "..", "components/i18n/LanguageSwitcher.module.css"), "utf8");
    expect(css).toMatch(/\.short\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/@media \(max-width: 720px\)\s*\{[\s\S]*\.full\s*\{\s*display:\s*none;[\s\S]*\.short\s*\{\s*display:\s*inline;/);
    const header = readFileSync(join(__dirname, "..", "..", "components/cyber/landing/PublicHeader.module.css"), "utf8");
    expect(header).toMatch(/\.actions > a\[hreflang\]\s*\{\s*padding: 10px 6px;/);
  });
});
