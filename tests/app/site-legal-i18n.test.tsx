import { describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 7b-1 : conditions d'utilisation, mentions légales et déclaration
 * d'accessibilité, une langue par adresse (`docs/features/I18N.md` § Textes
 * légaux du site). Le français fait foi et ne bouge pas d'un caractère ;
 * l'anglais est une traduction qui le dit. La langue vient de `x-bg-locale`
 * (`requestLocale()`), simulée ici ; en-tête et pied de page ont leurs tests.
 */
let mockLocale: "fr" | "en" = "fr";

jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/components/cyber/landing/PublicHeader", () => ({ PublicHeader: () => null }));
jest.mock("@/components/cyber/landing/PublicFooter", () => ({ PublicFooter: () => null }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import AccessibilityPage, { generateMetadata as accessibilityMetadata } from "@/app/accessibilite/page";
import TermsPage, { generateMetadata as termsMetadata } from "@/app/conditions-utilisation/page";
import LegalNoticePage, { generateMetadata as legalNoticeMetadata } from "@/app/mentions-legales/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { ToastProvider } from "@/components/ui/toast";
import {
  COPYRIGHT_NOTICE_ELEMENTS,
  NOTIFIER_FOLLOW_UP,
  copyrightNoticeElementsText,
} from "@/lib/shared/content-reports";
import { CONFORMITY_LABELS, EVALUATION_METHODS, KNOWN_ISSUES } from "@/lib/shared/accessibility-statement";
import {
  CONFORMITY_LABELS_EN,
  EVALUATION_METHODS_EN,
  KNOWN_ISSUES_EN,
  accessibilityStatementDateLabelEn,
} from "@/lib/shared/accessibility-statement-en";
import { FRENCH_VERSION_PREVAILS, TERMS_TRANSLATION_NOTE } from "@/lib/shared/french-version-prevails";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import { AUTHORITY_CONTACT_LANGUAGES } from "@/lib/shared/legal-contact";
import { WEB_ACCESS_LOG_FIELDS } from "@/lib/shared/legal-durations";
import {
  AUTHORITY_CONTACT_LANGUAGES_EN,
  COPYRIGHT_NOTICE_ELEMENTS_EN,
  NOTIFIER_FOLLOW_UP_EN,
  REPORT_FORM_NAME_EN,
  WEB_ACCESS_LOG_FIELDS_EN,
  copyrightNoticeElementsTextEn,
} from "@/lib/shared/legal-text-en";
import { isMigratedRoute, localeAlternates, type Locale } from "@/lib/shared/locales";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import { STREAM_NOTICE_OBJECTION, STREAM_NOTICE_SHOWN } from "@/lib/shared/stream-notice";
import { STREAM_NOTICE_OBJECTION_EN, STREAM_NOTICE_SHOWN_EN } from "@/lib/shared/legal-text-en";
import { TERMS_SECTIONS, TERMS_VERSION, formatTermsDate, formatTermsDateIn } from "@/lib/shared/terms-of-use";
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";
import enLegal from "@/messages/en/legal.json";
import enShell from "@/messages/en/shell.json";
import frLegal from "@/messages/fr/legal.json";
import { legalPageText, withoutFrenchPassages } from "../helpers/legal-text";
import { readSource } from "../helpers/read-source";

type Page = () => Promise<React.JSX.Element>;
type MetadataFn = typeof termsMetadata;

/** [route, fixture, carte d'aperçu, page, métadonnées, clé de `legal.pages`]. */
const PAGES: readonly [string, string, string, Page, MetadataFn, keyof typeof frLegal.pages][] = [
  ["/conditions-utilisation", "conditions-utilisation", "terms", TermsPage, termsMetadata, "terms"],
  ["/mentions-legales", "mentions-legales", "legalNotice", LegalNoticePage, legalNoticeMetadata, "legalNotice"],
  ["/accessibilite", "accessibilite", "accessibility", AccessibilityPage, accessibilityMetadata, "accessibility"],
];

async function render(page: Page, locale: Locale): Promise<string> {
  mockLocale = locale;
  const tree = await page();
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <ShellTextProvider locale={locale} messages={locale === "en" ? enShell : undefined}>
        <ToastProvider>{tree}</ToastProvider>
      </ShellTextProvider>
    </AppLocaleProvider>,
  );
}

/** Le texte français de référence, relevé sur `main` avant le lot 7b. */
const fixture = (name: string) =>
  readFileSync(join(__dirname, "..", "fixtures", "legal-fr", `${name}.txt`), "utf8").replace(/\r\n/g, "\n").trimEnd();

/** Mots-outils du français : aucun ne doit rester dans un texte anglais hors passage `lang="fr"`. */
const FRENCH_WORDS = /\b(le|la|les|des|du|une|est|pour|vous|avec|dans|et|ou|sur|aux|qui|que|cette|ces|leur|nous|pas|sont)\b/i;

describe("français : le texte qui fait foi ne bouge pas", () => {
  it.each(PAGES)("%s rend, au caractère près, le texte d'avant le lot 7b", async (_route, name, _card, page) => {
    expect(legalPageText(await render(page, "fr"))).toBe(fixture(name));
  });

  it.each(PAGES)("%s ne parle jamais de sa traduction", async (_route, _name, _card, page) => {
    const html = await render(page, "fr");
    expect(html).not.toContain("data-translation-notice");
    expect(html).not.toContain(FRENCH_VERSION_PREVAILS.body);
    expect(html).not.toContain("hrefLang");
    expect(html).not.toContain('href="/en/');
  });

  it("la version des conditions n'avance pas pour une traduction", () => {
    expect(TERMS_VERSION).toBe(3);
  });
});

describe("anglais : une traduction, qui le dit", () => {
  it.each(PAGES)("%s porte la mention « the French version prevails » et lie la page française", async (route, _name, _card, page) => {
    const html = await render(page, "en");
    expect(html).toContain('role="note"');
    expect(legalPageText(html)).toContain(FRENCH_VERSION_PREVAILS.body);
    expect(html).toContain(`<a href="${route}" hrefLang="fr">${FRENCH_VERSION_PREVAILS.link}</a>`);
  });

  it.each(PAGES)("%s ne laisse aucun français hors des passages annoncés lang=\"fr\"", async (_route, _name, _card, page) => {
    const text = legalPageText(withoutFrenchPassages(await render(page, "en")));
    const offending = text.split("\n").filter((line) => FRENCH_WORDS.test(line));
    expect(offending).toEqual([]);
  });

  it.each(PAGES)("%s : liens vers une page encore française signalés (hrefLang, « (in French) »)", async (_route, _name, _card, page) => {
    const html = await render(page, "en");
    for (const [, href] of html.matchAll(/<a href="(\/rgpd[^"]*)"([^>]*)>/g)) {
      expect([href, html.includes(`href="${href}" hrefLang="fr"`)]).toEqual([href, true]);
    }
    // Les pages traduites sont liées en anglais, sans mention.
    expect(html).not.toMatch(/href="\/(conditions-utilisation|mentions-legales|accessibilite|regles|association)[#"][^>]*>[^<]*\(in French\)/);
  });

  it("les conditions anglaises gardent articles, ancres, version et date", async () => {
    const html = await render(TermsPage, "en");
    const text = legalPageText(html);
    expect(text).toContain(`VERSION ${TERMS_VERSION}`);
    expect(text).toContain(`IN FORCE SINCE ${formatTermsDateIn("en").toUpperCase()}`);
    TERMS_SECTIONS.forEach((section, index) => {
      expect(html).toContain(`id="${section.id}"`);
      expect(text).toContain(`ARTICLE ${String(index + 1).padStart(2, "0")}`);
    });
    expect(html).toContain('href="/en/mentions-legales#editeur"');
    expect(html).toContain('href="/en/regles"');
  });

  it("la déclaration anglaise reprend statut, date et réglages du menu d'accessibilité en anglais", async () => {
    const text = legalPageText(await render(AccessibilityPage, "en"));
    expect(text).toContain(CONFORMITY_LABELS_EN.NONE);
    expect(text).toContain(accessibilityStatementDateLabelEn());
    for (const setting of Object.values(enShell.a11yMenu.settings)) {
      expect(text).toContain(`${setting.label} — ${setting.description}`);
    }
    expect(text).toContain(`“${enShell.skipLink.label}”`);
  });

  it("les mentions anglaises gardent leurs ancres (conditions, documents du bot)", async () => {
    const html = await render(LegalNoticePage, "en");
    for (const id of ["editeur", "hebergement", "propriete-intellectuelle", "contenus-membres", "autorites", "donnees-personnelles", "cookies"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("coordonnées : toujours encodées, révélées au clic", () => {
  it.each(PAGES)("%s n'écrit aucune adresse ni lien mailto en clair, en anglais comme en français", async (_route, _name, _card, page) => {
    for (const locale of ["fr", "en"] as const) {
      const html = await render(page, locale);
      expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(html).not.toContain("mailto:");
      expect(html).not.toContain("tel:");
    }
  });

  it("sous /en, le bouton est anglais et son nom accessible commence par le texte visible", async () => {
    const html = await render(LegalNoticePage, "en");
    expect(html).toContain(`>${enShell.protectedContact.email.label}</button>`);
    expect(html).toContain(`>${enShell.protectedContact.phone.label}</button>`);
    expect(html).toContain('aria-label="Show email address of the association"');
    expect(html).toContain('aria-label="Show phone number of the host"');
    expect(html).not.toContain("Afficher");
  });

  it.each([
    "app/conditions-utilisation/TermsOfUseEn.tsx",
    "app/mentions-legales/MentionsLegalesEn.tsx",
    "app/accessibilite/AccessibilityStatementEn.tsx",
    "lib/shared/legal-text-en.ts",
    "lib/shared/terms-of-use-en.ts",
    "lib/shared/accessibility-statement-en.ts",
  ])("%s ne contient aucune coordonnée en clair", (file) => {
    const source = readSource(file);
    expect(source).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(source).not.toContain("mailto:");
    // Ni contrat de sous-traitance de l'hébergeur de sauvegardes, ni identifiants du stockage.
    expect(source).not.toMatch(/storage ?share|customer number|numéro client|\bDPA\b/i);
  });

  it("les mentions anglaises passent chaque coordonnée par ProtectedContact", () => {
    const source = readSource("app/mentions-legales/MentionsLegalesEn.tsx");
    for (const encoded of ["ASSOCIATION_EMAIL_ENCODED", "ASSOCIATION_PHONE_ENCODED", "SITE_HOST.phoneEncoded", "DATA_CONTACT_EMAIL_ENCODED", "DATA_CONTACT_PHONE_ENCODED"]) {
      expect(source).toContain(`encoded={${encoded}}`);
    }
  });
});

describe("parité du texte : l'anglais suit le français, élément par élément", () => {
  /** Les nombres d'un texte (âges, durées, articles) : la traduction n'en perd ni n'en invente. */
  const numbers = (text: string) => (text.match(/\d+/g) ?? []).sort();
  const bold = (text: string) => (text.match(/\*\*/g) ?? []).length;

  it("mêmes sections, mêmes ancres, même ordre, mêmes liens", () => {
    expect(TERMS_SECTIONS_EN.map((section) => section.id)).toEqual(TERMS_SECTIONS.map((section) => section.id));
    TERMS_SECTIONS.forEach((section, index) => {
      const en = TERMS_SECTIONS_EN[index];
      expect([section.id, en.paragraphs.length]).toEqual([section.id, section.paragraphs.length]);
      expect(en.links?.map((link) => link.href)).toEqual(section.links?.map((link) => link.href));
    });
  });

  it("chaque paragraphe garde ses nombres et autant de passages en gras", () => {
    TERMS_SECTIONS.forEach((section, index) => {
      section.paragraphs.forEach((paragraph, paragraphIndex) => {
        const en = TERMS_SECTIONS_EN[index].paragraphs[paragraphIndex];
        expect([section.id, paragraphIndex, numbers(en)]).toEqual([section.id, paragraphIndex, numbers(paragraph)]);
        expect([section.id, paragraphIndex, bold(en)]).toEqual([section.id, paragraphIndex, bold(paragraph)]);
      });
    });
  });

  it("les phrases partagées traduites ont autant d'éléments que le français", () => {
    expect(COPYRIGHT_NOTICE_ELEMENTS_EN).toHaveLength(COPYRIGHT_NOTICE_ELEMENTS.length);
    expect(copyrightNoticeElementsTextEn().split(", ")).toHaveLength(copyrightNoticeElementsText().split(", ").length);
    expect(AUTHORITY_CONTACT_LANGUAGES_EN).toHaveLength(AUTHORITY_CONTACT_LANGUAGES.length);
    expect(WEB_ACCESS_LOG_FIELDS_EN.split(", ")).toHaveLength(WEB_ACCESS_LOG_FIELDS.split(", ").length);
    expect(numbers(NOTIFIER_FOLLOW_UP_EN)).toEqual(numbers(NOTIFIER_FOLLOW_UP));
    expect(numbers(STREAM_NOTICE_SHOWN_EN)).toEqual(numbers(STREAM_NOTICE_SHOWN));
    expect(numbers(STREAM_NOTICE_OBJECTION_EN)).toEqual(numbers(STREAM_NOTICE_OBJECTION));
  });

  it("la déclaration anglaise suit la liste des limites connues (critère, contournement)", () => {
    expect(KNOWN_ISSUES_EN).toHaveLength(KNOWN_ISSUES.length);
    KNOWN_ISSUES.forEach((issue, index) => {
      const en = KNOWN_ISSUES_EN[index];
      expect([index, en.workaround === null, en.requestByContact ?? false]).toEqual([index, issue.workaround === null, issue.requestByContact ?? false]);
      if (issue.criterion.startsWith("RGAA")) expect(en.criterion).toBe(issue.criterion);
    });
    expect(EVALUATION_METHODS_EN).toHaveLength(EVALUATION_METHODS.length);
    expect(Object.keys(CONFORMITY_LABELS_EN)).toEqual(Object.keys(CONFORMITY_LABELS));
    expect(CONFORMITY_LABELS_EN).toEqual(enShell.footer.conformity);
  });

  it("le bouton nommé par l'anglais est celui que la coquille affiche sous /en", () => {
    expect(REPORT_FORM_NAME_EN).toBe(enShell.footer.reportProblem);
  });

  it("la date d'entrée en vigueur : la même, dans chaque langue", () => {
    expect(formatTermsDateIn("fr")).toBe(formatTermsDate());
    expect(formatTermsDateIn("en", "2026-10-01")).toBe("October 1, 2026");
  });

  it("la note des fenêtres d'acceptation dit que le français fait foi", () => {
    expect(TERMS_TRANSLATION_NOTE.text).toMatch(/French text, which prevails/);
  });
});

describe("routes, métadonnées, hreflang et sitemap", () => {
  it.each(PAGES)("%s est une route traduite", (route) => {
    expect(MIGRATED_ROUTES).toContain(route);
    expect(isMigratedRoute(route)).toBe(true);
    expect(localeAlternates(route)).toEqual({ fr: route, en: `/en${route}`, "x-default": route });
  });

  it.each(PAGES)("%s : métadonnées dans chaque langue, canonique et carte d'aperçu de la langue", async (route, _name, card, _page, metadata, key) => {
    mockLocale = "fr";
    const fr = await metadata();
    expect(fr.title).toBe(frLegal.pages[key].title);
    expect(fr.description).toBe(frLegal.pages[key].description);
    expect(fr.alternates?.canonical).toBe(route);
    expect(fr.alternates?.languages).toEqual({ fr: route, en: `/en${route}`, "x-default": route });
    expect(JSON.stringify(fr.openGraph?.images)).toContain(`/og/fr/${card}.png`);
    mockLocale = "en";
    const en = await metadata();
    expect(en.title).toBe(enLegal.pages[key].title);
    expect(en.description).toBe(enLegal.pages[key].description);
    expect(en.alternates?.canonical).toBe(`/en${route}`);
    expect(JSON.stringify(en.openGraph?.images)).toContain(`/og/en/${card}.png`);
    expect(en.openGraph?.locale).toBe("en_US");
  });

  it("le français des métadonnées est celui d'avant le lot 7b", () => {
    expect(frLegal.pages.terms).toEqual({
      title: "Conditions d'utilisation",
      description:
        "Conditions générales d'utilisation de la plateforme BlueGenji Esport : compte, comportement, contenus publiés par les utilisateurs, signalement et modération.",
      shareDescription: "Ce que chacun s'engage à respecter sur BlueGenji Esport.",
    });
    expect(frLegal.pages.legalNotice.title).toBe("Mentions légales");
    expect(frLegal.pages.accessibility.title).toBe("Déclaration d'accessibilité");
  });

  it("le sitemap annonce l'adresse anglaise de chaque page, avec ses hreflang", () => {
    const entries = localizedSitemapEntries(publicSitemapRoutes());
    for (const [route] of PAGES) {
      const english = entries.find((entry) => entry.path === `/en${route}`);
      expect(english?.languages).toEqual({ fr: route, en: `/en${route}`, "x-default": route });
    }
  });
});
