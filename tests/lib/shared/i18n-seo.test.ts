import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/shared/i18n-routes", () => ({ MIGRATED_ROUTES: ["/", "/regles", "/regles/[slug]"] }));

import { pageMetadata } from "@/lib/shared/page-metadata";
import { localizedSitemapEntries, type SitemapRoute } from "@/lib/shared/sitemap";
import { webSiteJsonLd } from "@/lib/shared/structured-data";

const base = { title: "Règles", description: "Les règles." };

describe("pageMetadata — canonical et hreflang par langue", () => {
  it("pose la canonique de la langue et les hreflang réciproques d'une route traduite", () => {
    const fr = pageMetadata({ ...base, path: "/regles" });
    const en = pageMetadata({ ...base, path: "/regles", locale: "en" });
    const languages = { fr: "/regles", en: "/en/regles", "x-default": "/regles" };
    expect(fr.alternates).toEqual({ canonical: "/regles", languages });
    expect(en.alternates).toEqual({ canonical: "/en/regles", languages });
    expect(en.openGraph).toMatchObject({ locale: "en_US", url: "/en/regles" });
    expect(fr.openGraph).toMatchObject({ locale: "fr_FR", url: "/regles" });
  });

  it("vise /en pour l'accueil anglais", () => {
    expect(pageMetadata({ ...base, path: "/", locale: "en" }).alternates).toMatchObject({ canonical: "/en" });
  });

  it("n'annonce aucune version anglaise d'une route pas encore traduite", () => {
    expect(pageMetadata({ ...base, path: "/classement" }).alternates).toEqual({ canonical: "/classement" });
  });
});

describe("localizedSitemapEntries — une entrée par langue traduite", () => {
  const routes: SitemapRoute[] = [
    { path: "/regles", changeFrequency: "monthly", priority: 0.7 },
    { path: "/classement", changeFrequency: "daily", priority: 0.8 },
  ];

  it("double une route traduite, avec les mêmes hreflang sur les deux entrées", () => {
    const entries = localizedSitemapEntries(routes);
    const languages = { fr: "/regles", en: "/en/regles", "x-default": "/regles" };
    expect(entries).toEqual([
      { path: "/regles", changeFrequency: "monthly", priority: 0.7, languages },
      { path: "/en/regles", changeFrequency: "monthly", priority: 0.7, languages },
      { path: "/classement", changeFrequency: "daily", priority: 0.8 },
    ]);
  });
});

describe("JSON-LD — langue du site", () => {
  it("suit la langue de la page", () => {
    expect(webSiteJsonLd("https://bluegenji.test", "x").inLanguage).toBe("fr-FR");
    expect(webSiteJsonLd("https://bluegenji.test", "x", "en").inLanguage).toBe("en-US");
  });
});
