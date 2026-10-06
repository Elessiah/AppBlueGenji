import { describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 7a : les documents légaux du bot, une langue par adresse
 * (`docs/features/I18N.md` § Documents légaux du bot). La langue vient de
 * `x-bg-locale` (`requestLocale()`), simulée ici ; l'en-tête et le pied de
 * page communs ont leurs propres tests.
 */
let mockLocale: "fr" | "en" = "fr";

jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/components/cyber/landing/PublicHeader", () => ({ PublicHeader: () => null }));
jest.mock("@/components/cyber/landing/PublicFooter", () => ({ PublicFooter: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPage, { generateMetadata as privacyMetadata } from "@/app/privacy-policy-bot/page";
import TermsPage, { generateMetadata as termsMetadata } from "@/app/terms-of-service-bot/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { PRIVACY_POLICY, TERMS_OF_SERVICE, type BilingualDoc, type LegalDoc } from "@/lib/shared/bot-legal-content";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import { isMigratedRoute, localeAlternates, localeHref, type Locale } from "@/lib/shared/locales";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import enBot from "@/messages/en/bot.json";
import frBot from "@/messages/fr/bot.json";
import { readSource } from "../helpers/read-source";

type Page = () => Promise<React.JSX.Element>;

const PAGES: readonly [string, string, BilingualDoc, Page, typeof privacyMetadata][] = [
  ["/privacy-policy-bot", "botPrivacy", PRIVACY_POLICY, PrivacyPage, privacyMetadata],
  ["/terms-of-service-bot", "botTerms", TERMS_OF_SERVICE, TermsPage, termsMetadata],
];

async function render(page: Page, locale: Locale): Promise<string> {
  mockLocale = locale;
  const tree = await page();
  return renderToStaticMarkup(<AppLocaleProvider locale={locale}>{tree}</AppLocaleProvider>);
}

/** Le texte lu par le visiteur, sans balisage. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Le texte d'une phrase du document, tel qu'affiché : sans `**` ni `[…](…)`. */
const shown = (source: string) => source.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "");

/** Chaque phrase d'un document, dans l'ordre (titre découpé à son saut de ligne). */
function phrases(doc: LegalDoc): string[] {
  return [
    doc.eyebrow,
    ...doc.title.split("\n"),
    doc.intro,
    doc.lastUpdatedLabel,
    doc.lastUpdated,
    ...doc.sections.flatMap((section) => [
      section.title,
      section.meta,
      ...section.blocks.flatMap((block) => block.items ?? [block.text ?? ""]),
    ]),
    doc.hosting.title,
    doc.hosting.meta,
    doc.hosting.text,
    doc.hosting.linkLabel,
  ].map(shown);
}

/** Le texte du document, dans l'ordre, sans les surtitres « SECTION nn » ajoutés au rendu. */
function documentText(html: string): string {
  return visibleText(html).replace(/SECTION \d{2}/g, "");
}

const sectionLangs = (html: string) =>
  [...html.matchAll(/<section[^>]*>/g)].map((m) => /lang="([^"]*)"/.exec(m[0])?.[1] ?? null);

describe("liste blanche — les documents du bot sont traduits", () => {
  it("ouvre /en/privacy-policy-bot et /en/terms-of-service-bot", () => {
    for (const [route] of PAGES) {
      expect(MIGRATED_ROUTES).toContain(route);
      expect(isMigratedRoute(route)).toBe(true);
      expect(localeHref(route, "en")).toBe(`/en${route}`);
      // L'adresse française — celle du portail développeur de Discord — ne change pas.
      expect(localeHref(route, "fr")).toBe(route);
    }
  });

  it("donne à chaque document son entrée anglaise au sitemap, avec ses hreflang", () => {
    const entries = localizedSitemapEntries(publicSitemapRoutes());
    for (const [route] of PAGES) {
      const languages = { fr: route, en: `/en${route}`, "x-default": route };
      expect(localeAlternates(route)).toEqual(languages);
      expect(entries).toContainEqual(expect.objectContaining({ path: route, languages }));
      expect(entries).toContainEqual(expect.objectContaining({ path: `/en${route}`, languages }));
    }
  });
});

describe.each(PAGES)("%s", (route, shareCard, doc, page, metadata) => {
  it.each<Locale>(["fr", "en"])("rend le texte %s tel quel, mot pour mot et dans l'ordre", async (locale) => {
    const text = documentText(await render(page, locale));
    expect(text).toBe(phrases(doc[locale]).join(""));
  });

  it("sous /en, aucune phrase propre au français", async () => {
    const text = visibleText(await render(page, "en"));
    const english = new Set(phrases(doc.en));
    const frenchOnly = phrases(doc.fr).filter((phrase) => phrase.length > 12 && !english.has(phrase));
    expect(frenchOnly.length).toBeGreaterThan(20);
    for (const phrase of frenchOnly) expect(text).not.toContain(phrase);
  });

  it("chaque section déclare la langue de l'adresse (WCAG 3.1.2)", async () => {
    for (const locale of ["fr", "en"] as const) {
      const langs = sectionLangs(await render(page, locale));
      // Hero + sections du document + hébergeur : aucune n'est oubliée.
      expect(langs).toHaveLength(doc[locale].sections.length + 2);
      expect(new Set(langs)).toEqual(new Set([locale]));
    }
  });

  it("n'a plus de bascule de langue dans la page", async () => {
    for (const locale of ["fr", "en"] as const) {
      const html = await render(page, locale);
      expect(html).not.toContain("<fieldset");
      expect(html).not.toContain("aria-pressed");
    }
  });

  it("anglais : titre, description, canonique, hreflang et carte anglais", async () => {
    mockLocale = "en";
    const meta = await metadata();
    const key = route === "/privacy-policy-bot" ? "privacy" : "terms";
    expect(meta.title).toBe(enBot.legalPages[key].meta.title);
    expect(meta.title).not.toMatch(/Politique|Conditions/);
    expect(String(meta.description)).toBe(enBot.legalPages[key].meta.description);
    expect(meta.alternates).toEqual({
      canonical: `/en${route}`,
      languages: { fr: route, en: `/en${route}`, "x-default": route },
    });
    expect(meta.openGraph).toMatchObject({ locale: "en_US", url: `/en${route}` });
    expect(JSON.stringify(meta.openGraph)).toContain(`/og/en/${shareCard}.png`);
  });

  it("français : titre et description du message, carte française", async () => {
    mockLocale = "fr";
    const meta = await metadata();
    const key = route === "/privacy-policy-bot" ? "privacy" : "terms";
    expect(meta.title).toBe(frBot.legalPages[key].meta.title);
    expect(String(meta.description)).toBe(frBot.legalPages[key].meta.description);
    expect(meta.alternates).toMatchObject({ canonical: route });
    expect(meta.openGraph).toMatchObject({ locale: "fr_FR", url: route });
    expect(JSON.stringify(meta.openGraph)).toContain(`/og/fr/${shareCard}.png`);
  });
});

describe("titres français, sans moitié anglaise depuis le lot 7a", () => {
  it("titre purement français (la page n'affiche plus d'anglais), description d'avant gardée mot pour mot", () => {
    expect(frBot.legalPages.privacy.meta).toEqual({
      title: "Bot — Politique de Confidentialité",
      description:
        "Politique de Confidentialité du bot Discord BlueGenji Bot, disponible en français et en anglais.",
    });
    expect(frBot.legalPages.terms.meta).toEqual({
      title: "Bot — Conditions d'Utilisation",
      description:
        "Conditions d'Utilisation du bot Discord BlueGenji Bot, disponibles en français et en anglais.",
    });
  });
});

describe("liens internes dans la langue de la page", () => {
  it("sous /en, le renvoi d'un document à l'autre reste anglais ; une page encore française garde son adresse", async () => {
    const terms = await render(TermsPage, "en");
    expect(terms).toContain('href="/en/privacy-policy-bot"');
    expect(terms).not.toContain('href="/privacy-policy-bot"');
    expect(terms).toContain('href="/mentions-legales#hebergement"');
    const privacy = await render(PrivacyPage, "en");
    expect(privacy).toContain('href="/en/terms-of-service-bot"');
    expect(privacy).toContain('href="/rgpd#exercer-vos-droits"');
  });

  it("en français, les adresses n'ont pas changé", async () => {
    const terms = await render(TermsPage, "fr");
    expect(terms).toContain('href="/privacy-policy-bot"');
    expect(terms).not.toContain('href="/en/');
  });
});

describe("aucune adresse de l'ancienne bascule à rediriger", () => {
  it("la bascule n'était qu'un état du navigateur : ni paramètre ni ancre lus", () => {
    for (const file of ["app/privacy-policy-bot/page.tsx", "app/terms-of-service-bot/page.tsx", "components/legal/BotLegalDoc.tsx"]) {
      const source = readSource(file);
      expect(source).not.toMatch(/searchParams|useSearchParams|location\.hash/);
    }
  });
});
