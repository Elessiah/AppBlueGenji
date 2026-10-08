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
import { readSource } from "../helpers/read-source";
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
    expect(html).toContain('<span lang="en">EN</span>');
    expect(html).toContain("lire cette page en anglais");
  });

  it("mène d'une page anglaise (chemin préfixé) à la française", () => {
    mockPathname = "/en/regles";
    const html = renderSwitcher("en");
    expect(html).toContain('href="/regles"');
    expect(html).toContain('<span lang="fr">FR</span>');
    expect(html).toContain("read this page in French");
  });

  it("montre le globe décoratif et le code seul, nom accessible en tête", () => {
    mockPathname = "/regles";
    const label = messagesFor("fr").common.languageSwitcher.label;
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="fr">
        <LanguageSwitcher label={label} className="extra" />
      </AppLocaleProvider>,
    );
    expect(html).toContain('class="link extra"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).not.toContain("English");
    expect(html).toContain('<span lang="en">EN</span><span class="sr-only"> — lire cette page en anglais</span>');
  });

  it("a le style de bouton-outil : cible de 44 px, survol réservé aux pointeurs fins", () => {
    const css = readSource("components/i18n/LanguageSwitcher.module.css");
    expect(css).toMatch(/\.link\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;[^}]*border: 1px solid transparent;/);
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.link:hover/);
    expect(css).toMatch(/\.link:focus-visible\s*\{\s*outline: 2px solid var\(--blue-500\);/);
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
    expect(text.startsWith("EN")).toBe(true);
  });
});
