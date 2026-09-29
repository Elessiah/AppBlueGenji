import { describe, expect, it } from "@jest/globals";
import { FLOATING_BUTTON_SETTLE_MS, PAGE_SCROLLING_ATTRIBUTE } from "@/lib/shared/floating-button-scroll";
import { readSource } from "../../helpers/read-source";

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Partie de la feuille qui suit le dernier point de rupture mobile. */
const lastMobileBlock = (css: string) => css.slice(css.lastIndexOf("@media (max-width: 720px)"));

describe("floating-button-scroll", () => {
  it("revient vite, une fois la page immobile", () => {
    expect(FLOATING_BUTTON_SETTLE_MS).toBeGreaterThan(0);
    expect(FLOATING_BUTTON_SETTLE_MS).toBeLessThanOrEqual(600);
  });

  it("nomme un attribut de données", () => {
    expect(PAGE_SCROLLING_ATTRIBUTE).toBe("data-page-scrolling");
  });
});

describe("FloatingScrollWatcher — un seul écouteur pour tous les flottants", () => {
  const source = readSource("components/floating-scroll-watcher.tsx");
  const layout = readSource("app/layout.tsx");

  it("écoute le défilement sans le bloquer et pose l'attribut sur <html>", () => {
    expect(source).toMatch(/addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
    expect(source).toContain("document.documentElement");
    expect(source).toContain("setAttribute(PAGE_SCROLLING_ATTRIBUTE");
    expect(source).toContain("removeAttribute(PAGE_SCROLLING_ATTRIBUTE)");
    expect(source).toContain("FLOATING_BUTTON_SETTLE_MS");
  });

  it("nettoie derrière lui (écouteur, minuterie, attribut)", () => {
    expect(source).toContain('removeEventListener("scroll", onScroll)');
    expect(source).toContain("clearTimeout(timer)");
  });

  it("est monté par la mise en page racine", () => {
    expect(layout).toContain("<FloatingScrollWatcher />");
  });

  it("le menu d'accessibilité n'a plus son propre écouteur", () => {
    const menu = readSource("components/accessibility/AccessibilityMenu.tsx");
    expect(menu).not.toContain('addEventListener("scroll"');
    expect(menu).not.toContain("dataset.scrolling");
  });
});

describe("les quatre flottants s'estompent au défilement, en mobile seulement", () => {
  const cases: Array<[string, string, RegExp]> = [
    [
      "bouton d'accessibilité",
      "components/accessibility/AccessibilityMenu.module.css",
      /:global\(html\[data-page-scrolling\]\) \.root:not\(:focus-within\):not\(:has\(\[aria-expanded="true"\]\)\) \.fab\s*\{[^}]*opacity:\s*0\.\d+;[^}]*pointer-events:\s*none;/,
    ],
    [
      "témoin du régime de charge",
      "components/client-power-badge.module.css",
      /:global\(html\[data-page-scrolling\]\) \.root:not\(:focus-within\):not\(:has\(\[aria-expanded="true"\]\)\) \.pill\s*\{[^}]*opacity:\s*0\.\d+;[^}]*pointer-events:\s*none;/,
    ],
    [
      "pastille « Mon match »",
      "components/match-launch/MatchLaunchCenter.module.css",
      /:global\(html\[data-page-scrolling\]\) \.fab:not\(:focus\)\s*\{[^}]*opacity:\s*0\.\d+;[^}]*pointer-events:\s*none;/,
    ],
  ];

  it.each(cases)("%s", (_name, file, rule) => {
    const css = stripComments(readSource(file));
    expect(lastMobileBlock(css)).toMatch(rule);
    // Hors mobile, aucun estompage : la souris ne recouvre pas le texte.
    const beforeMobile = css.slice(0, css.indexOf("@media (max-width: 720px)"));
    expect(beforeMobile).not.toContain("data-page-scrolling");
  });

  it("bouton « ? » des règles", () => {
    const css = stripComments(readSource("app/globals.css"));
    const block = css.slice(css.lastIndexOf(".cta-float-help {"));
    expect(block).toMatch(
      /html\[data-page-scrolling\] \.cta-float-help:not\(:focus\)\s*\{[^}]*opacity:\s*0\.\d+;[^}]*pointer-events:\s*none;/,
    );
  });
});

describe("les flottants passent sous le voile d'une modale ouverte", () => {
  const modalOpen = String.raw`html:has\(\[aria-modal="true"\]:not\(\[hidden\]\)\)`;

  it.each([
    ["components/accessibility/AccessibilityMenu.module.css", String.raw`:global\(${modalOpen}\) \.root`],
    ["components/client-power-badge.module.css", String.raw`:global\(${modalOpen}\) \.root`],
    ["components/match-launch/MatchLaunchCenter.module.css", String.raw`:global\(${modalOpen}\) \.fab`],
    ["app/globals.css", String.raw`${modalOpen} \.cta-float-help`],
  ])("%s", (file, selector) => {
    const css = stripComments(readSource(file));
    expect(css).toMatch(new RegExp(`${selector}\\s*\\{[^}]*visibility:\\s*hidden;`));
  });
});

describe("pastille « Mon match » en mobile", () => {
  it("se réduit à son libellé sous 720 px", () => {
    const css = stripComments(readSource("components/match-launch/MatchLaunchCenter.module.css"));
    expect(lastMobileBlock(css)).toMatch(/\.fabTeams\s*\{[^}]*display:\s*none;/);
  });
});
