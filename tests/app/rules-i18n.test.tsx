import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 3 : les règles (`/regles`, `/regles/[slug]`) en français et en anglais
 * (`docs/features/I18N.md`). La langue vient de `x-bg-locale`
 * (`requestLocale()`), simulée ici ; la coquille (`PublicPageShell`) a ses
 * propres tests.
 */
let mockLocale: "fr" | "en" = "en";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/components/cyber/landing/PublicPageShell", () => ({
  PublicPageShell: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/tournaments-service", () => ({ getVisibleTournamentSnapshot: jest.fn(async () => null) }));
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReglesPage, { generateMetadata as indexMetadata } from "@/app/regles/page";
import RuleModePage, { generateMetadata as modeMetadata, generateStaticParams } from "@/app/regles/[slug]/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { messagesFor } from "@/lib/server/i18n-messages";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import { isMigratedRoute, localeHref, type Locale } from "@/lib/shared/locales";
import { RULES_PAGE_ANCHORS } from "@/lib/shared/rules-page-outline";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import { RULE_MODE_DEFINITIONS, localizedRuleModes } from "@/lib/shared/tournament-rules";

const SLUGS = RULE_MODE_DEFINITIONS.map((mode) => mode.slug);

async function render(page: Promise<ReactElement>, locale: Locale): Promise<string> {
  return renderToStaticMarkup(<AppLocaleProvider locale={locale}>{await page}</AppLocaleProvider>);
}

const renderIndex = (locale: Locale) => {
  mockLocale = locale;
  return render(ReglesPage(), locale);
};

const renderMode = (slug: string, locale: Locale) => {
  mockLocale = locale;
  return render(RuleModePage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }), locale);
};

/** Le texte lu par le visiteur (et les attributs lus par un lecteur d'écran), sans balisage. */
function visibleText(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].map((m) => m[1]);
  return [html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "), ...attributes]
    .join(" ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

type Tree = { [key: string]: string | Tree | Tree[] | string[] };
function leaves(tree: unknown): string[] {
  if (typeof tree === "string") return [tree];
  return Object.values(tree as Tree).flatMap(leaves);
}

/** Les phrases françaises propres aux règles (celles que l'anglais a réécrites). */
const FRENCH_ONLY = (() => {
  const en = new Set(leaves(messagesFor("en").rules));
  return leaves(messagesFor("fr").rules)
    .filter((text) => !en.has(text))
    .map((text) => text.replace(/<\/?b>/g, ""))
    .filter((text) => !/[{}]/.test(text) && text.length >= 8);
})();

beforeEach(() => {
  mockLocale = "en";
});

describe("liste blanche — les règles sont traduites", () => {
  it("ouvre /en/regles et chaque mode, et rien d'autre de neuf", () => {
    expect(MIGRATED_ROUTES).toEqual(expect.arrayContaining(["/regles", "/regles/[slug]"]));
    expect(isMigratedRoute("/regles")).toBe(true);
    for (const slug of SLUGS) expect(isMigratedRoute(`/regles/${slug}`)).toBe(true);
    expect(localeHref("/regles/survie", "en")).toBe("/en/regles/survie");
  });

  it("donne à chaque page de règles son entrée anglaise au sitemap, avec ses hreflang", () => {
    const entries = localizedSitemapEntries(publicSitemapRoutes());
    for (const path of ["/regles", ...SLUGS.map((slug) => `/regles/${slug}`)]) {
      const languages = { fr: path, en: `/en${path}`, "x-default": path };
      expect(entries).toContainEqual(expect.objectContaining({ path, languages }));
      expect(entries).toContainEqual(expect.objectContaining({ path: `/en${path}`, languages }));
    }
  });

  it("pré-génère le même slug dans les deux langues", () => {
    expect(generateStaticParams()).toEqual(SLUGS.map((slug) => ({ slug })));
  });
});

describe("métadonnées par langue", () => {
  it("index : titre, description, canonique et hreflang anglais", async () => {
    mockLocale = "en";
    const metadata = await indexMetadata();
    expect(metadata.title).toBe("Tournament rules");
    expect(String(metadata.description)).toContain("BlueGenji's Survival");
    expect(String(metadata.description).length).toBeLessThanOrEqual(165);
    expect(metadata.alternates).toEqual({
      canonical: "/en/regles",
      languages: { fr: "/regles", en: "/en/regles", "x-default": "/regles" },
    });
    expect(metadata.openGraph).toMatchObject({ locale: "en_US", url: "/en/regles" });
  });

  it("index : le français garde son titre et sa canonique, avec les mêmes hreflang", async () => {
    mockLocale = "fr";
    const metadata = await indexMetadata();
    expect(metadata.title).toBe("Règles des tournois");
    expect(metadata.alternates?.canonical).toBe("/regles");
    expect(metadata.alternates?.languages).toEqual({ fr: "/regles", en: "/en/regles", "x-default": "/regles" });
    expect(metadata.openGraph).toMatchObject({ locale: "fr_FR" });
  });

  it.each(SLUGS.map((slug) => [slug]))("%s : titre et description dans la langue de l'adresse", async (slug) => {
    const en = localizedRuleModes(messagesFor("en").rules).find((mode) => mode.slug === slug)!;
    mockLocale = "en";
    const metadata = await modeMetadata({ params: Promise.resolve({ slug }) });
    expect(metadata.title).toBe(`Rules: ${en.label}`);
    expect(metadata.description).toBe(en.tagline);
    expect(metadata.alternates?.canonical).toBe(`/en/regles/${slug}`);
    expect(metadata.alternates?.languages).toEqual({
      fr: `/regles/${slug}`,
      en: `/en/regles/${slug}`,
      "x-default": `/regles/${slug}`,
    });
  });

  it("slug inconnu : métadonnées de l'index, en anglais", async () => {
    mockLocale = "en";
    const metadata = await modeMetadata({ params: Promise.resolve({ slug: "inconnu" }) });
    expect(metadata.title).toBe("Tournament rules");
    expect(metadata.alternates?.canonical).toBe("/en/regles");
  });
});

describe("rendu anglais — aucune phrase française", () => {
  it("index", async () => {
    const html = await renderIndex("en");
    const text = visibleText(html);
    expect(text).toContain("How a BlueGenji");
    expect(text).toContain("Common rules");
    for (const french of FRENCH_ONLY) expect(text).not.toContain(french);
    expect(text).not.toMatch(/[éèêàçùôœ]/);
    // Les cartes mènent aux pages anglaises.
    for (const slug of SLUGS) expect(html).toContain(`href="/en/regles/${slug}"`);
  });

  it.each(SLUGS.map((slug) => [slug]))("%s", async (slug) => {
    const html = await renderMode(slug, "en");
    const text = visibleText(html);
    for (const french of FRENCH_ONLY) expect(text).not.toContain(french);
    expect(text).not.toMatch(/[éèêàçùôœ]/);
    expect(text).toContain("The essentials");
    expect(html).toContain('href="/en/regles"');
    expect(html).toContain('aria-label="Rules contents"');
    // Délais réels injectés, aucun argument ICU laissé brut.
    expect(text).toContain("after 15 minutes");
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it("fil d'Ariane : noms traduits, adresses anglaises", async () => {
    const html = await renderMode("ronde-suisse", "en");
    const json = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const data = JSON.parse(json.replace(/\\u003c/g, "<")) as { itemListElement: { name: string; item: string }[] };
    expect(data.itemListElement.map((item) => item.name)).toEqual(["Home", "Tournament rules", "Swiss"]);
    expect(data.itemListElement[2].item).toMatch(/\/en\/regles\/ronde-suisse$/);
  });

  it("garde les ancres françaises : un lien vers une section vaut dans les deux langues", async () => {
    const anchors = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const fr = await renderMode("survie", "fr");
    const en = await renderMode("survie", "en");
    expect(anchors(en)).toEqual(anchors(fr));
    expect(anchors(en)).toEqual(expect.arrayContaining([RULES_PAGE_ANCHORS.details, "regle-coupes"]));
  });

  it("un slug inconnu reste une 404", async () => {
    await expect(renderMode("inconnu", "en")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("rendu français — inchangé", () => {
  it("index", async () => {
    const text = visibleText(await renderIndex("fr"));
    expect(text).toContain("Comment se joue");
    expect(text).toContain("Report des scores et forfaits fonctionnent de la même façon partout.");
    expect(text).toContain("au bout de 15 minutes.");
  });

  it("page d'un mode : textes, gras et liens sans préfixe", async () => {
    const html = await renderMode("double-elimination", "fr");
    expect(html).toContain("La grande finale se joue en <strong>un seul match</strong>");
    expect(html).toContain('href="/regles"');
    expect(html).toContain('aria-label="Sommaire des règles"');
    expect(html).not.toContain("/en/");
    expect(visibleText(html)).toContain("Bracket haut · invaincues".toUpperCase());
  });
});

describe("glossaire figé (I18N.md)", () => {
  const en = messagesFor("en").rules;

  it("nomme chaque mode avec le terme du glossaire", () => {
    expect(en.modes.SINGLE.label).toBe("Single elimination");
    expect(en.modes.DOUBLE.label).toBe("Double elimination");
    expect(en.modes.SWISS.label).toBe("Swiss");
    expect(en.modes.SURVIVAL.label).toBe("Survival (cuts)");
    expect(en.modes.BG_SURVIE.label).toBe("BlueGenji's Survival");
    expect(en.modes.MULTI.label).toContain("Multi-stage");
  });

  it("n'emploie aucun terme français ni écart au glossaire", () => {
    const all = leaves(en).join("\n");
    for (const banned of [/Survie/, /Ronde/, /\bBO\d/, /\bHeal\b/i, /\bManche\b/i, /petite finale/i, /bracket haut/i]) {
      expect(all).not.toMatch(banned);
    }
    expect(all).toContain("Bo5");
    expect(all).toContain("Upper bracket");
    expect(all).toContain("Lower bracket");
    expect(all).toContain("Grand final");
    expect(all).toContain("forfeit");
    expect(all).toContain("referee");
  });

  it("écrit l'orthographe américaine", () => {
    const all = leaves(en).join("\n");
    expect(all).not.toMatch(/\b(colour|favour|centre|cancelled)\b/i);
  });
});
