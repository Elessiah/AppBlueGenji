import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/shared/i18n-routes", () => ({ MIGRATED_ROUTES: ["/", "/regles", "/regles/[slug]"] }));

let mockPathname: string | null = "/regles";
let mockQuery = "";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { LanguageSwitcher, switcherHref } from "@/components/i18n/LanguageSwitcher";
import { renderIntl } from "../helpers/intl";

describe("switcherHref — l'état de la page suit", () => {
  it("garde la requête et l'ancre, et rien de vide", () => {
    expect(switcherHref("/en/regles", "mode=duo&x=1", "#bo5")).toBe("/en/regles?mode=duo&x=1#bo5");
    expect(switcherHref("/en/regles", "")).toBe("/en/regles");
    expect(switcherHref("/en/regles", "", "#")).toBe("/en/regles");
    expect(switcherHref("/en/regles", "", "x")).toBe("/en/regles");
  });
});

describe("LanguageSwitcher — même page, autre langue", () => {
  it("reporte la requête de la page", () => {
    mockPathname = "/regles";
    mockQuery = "mode=duo";
    expect(renderIntl(<LanguageSwitcher />)).toContain('href="/en/regles?mode=duo"');
    mockQuery = "";
  });

  it("mène d'une page française à son équivalent anglais", () => {
    mockPathname = "/regles/swiss";
    const html = renderIntl(<LanguageSwitcher />);
    expect(html).toContain('href="/en/regles/swiss"');
    expect(html).toContain('hrefLang="en"');
    expect(html).toContain('<span lang="en">English</span>');
    expect(html).toContain("lire cette page en anglais");
  });

  it("mène d'une page anglaise (chemin préfixé) à la française", () => {
    mockPathname = "/en/regles";
    const html = renderIntl(<LanguageSwitcher />, { locale: "en" });
    expect(html).toContain('href="/regles"');
    expect(html).toContain('<span lang="fr">Français</span>');
    expect(html).toContain("read this page in French");
  });

  it("vise l'accueil anglais depuis /", () => {
    mockPathname = "/";
    expect(renderIntl(<LanguageSwitcher />)).toContain('href="/en"');
  });

  it("est un lien de document, pas une navigation client", () => {
    mockPathname = "/regles";
    expect(renderIntl(<LanguageSwitcher />)).not.toContain("data-next-link");
  });

  it("se tait sur une route pas encore traduite — même sans fournisseur de messages", () => {
    mockPathname = "/classement";
    expect(renderToStaticMarkup(<LanguageSwitcher />)).toBe("");
  });

  it("commence son nom accessible par le texte visible (WCAG 2.5.3)", () => {
    mockPathname = "/regles";
    const text = renderIntl(<LanguageSwitcher />).replaceAll(/<[^>]+>/g, "");
    expect(text.startsWith("English")).toBe(true);
  });
});
