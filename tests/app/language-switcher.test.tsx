import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/shared/i18n-routes", () => ({ MIGRATED_ROUTES: ["/", "/regles", "/regles/[slug]"] }));

let mockPathname: string | null = "/regles";
let mockQuery = "";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageSwitcher, switcherHref } from "@/components/i18n/LanguageSwitcher";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { messagesFor } from "@/lib/server/i18n-messages";
import { languageSwitcherLabel } from "@/lib/server/i18n-labels";
import type { Locale } from "@/lib/shared/locales";

/** Le sélecteur tel que l'en-tête le rend : libellé traduit côté serveur, aucun fournisseur de messages. */
function renderSwitcher(locale: Locale = "fr"): string {
  const label = messagesFor(locale).common.languageSwitcher.label;
  const ui: ReactElement = <LanguageSwitcher label={label} />;
  return renderToStaticMarkup(<AppLocaleProvider locale={locale}>{ui}</AppLocaleProvider>);
}

describe("switcherHref — l'état de la page suit", () => {
  it("garde la requête et l'ancre, et rien de vide", () => {
    expect(switcherHref("/en/regles", "mode=duo&x=1", "#bo5")).toBe("/en/regles?mode=duo&x=1#bo5");
    expect(switcherHref("/en/regles", "")).toBe("/en/regles");
    expect(switcherHref("/en/regles", "", "#")).toBe("/en/regles");
    expect(switcherHref("/en/regles", "", "x")).toBe("/en/regles");
  });
});

describe("languageSwitcherLabel — traduit côté serveur", () => {
  it("lit la clé common.languageSwitcher.label dans la langue de la requête", async () => {
    await expect(languageSwitcherLabel()).resolves.toBe(messagesFor("fr").common.languageSwitcher.label);
  });
});

describe("LanguageSwitcher — même page, autre langue", () => {
  it("reporte la requête de la page", () => {
    mockPathname = "/regles";
    mockQuery = "mode=duo";
    expect(renderSwitcher()).toContain('href="/en/regles?mode=duo"');
    mockQuery = "";
  });

  it("mène d'une page française à son équivalent anglais", () => {
    mockPathname = "/regles/swiss";
    const html = renderSwitcher();
    expect(html).toContain('href="/en/regles/swiss"');
    expect(html).toContain('hrefLang="en"');
    expect(html).toContain('<span lang="en" class="full">English</span>');
    expect(html).toContain("lire cette page en anglais");
  });

  it("mène d'une page anglaise (chemin préfixé) à la française", () => {
    mockPathname = "/en/regles";
    const html = renderSwitcher("en");
    expect(html).toContain('href="/regles"');
    expect(html).toContain('<span lang="fr" class="full">Français</span>');
    expect(html).toContain("read this page in French");
  });

  it("vise l'accueil anglais depuis /", () => {
    mockPathname = "/";
    expect(renderSwitcher()).toContain('href="/en"');
  });

  it("est un lien de document, pas une navigation client", () => {
    mockPathname = "/regles";
    expect(renderSwitcher()).not.toContain("data-next-link");
  });

  it("se tait sur une route pas encore traduite", () => {
    mockPathname = "/classement";
    expect(renderSwitcher()).toBe("");
  });

  it("commence son nom accessible par le texte visible (WCAG 2.5.3)", () => {
    mockPathname = "/regles";
    const text = renderSwitcher().replaceAll(/<[^>]+>/g, "");
    expect(text.startsWith("English")).toBe(true);
  });
});
