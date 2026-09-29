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
    ["components/client-power-badge.module.css", String.raw`:global\(${modalOpen}\) \.root`],
    ["components/match-launch/MatchLaunchCenter.module.css", String.raw`:global\(${modalOpen}\) \.fab`],
    ["app/globals.css", String.raw`${modalOpen} \.cta-float-help`],
  ])("%s", (file, selector) => {
    const css = stripComments(readSource(file));
    expect(css).toMatch(new RegExp(`${selector}\\s*\\{[^}]*visibility:\\s*hidden;`));
  });
});

describe("le menu d'accessibilité reste offert pendant une modale", () => {
  const css = stripComments(readSource("components/accessibility/AccessibilityMenu.module.css"));
  const modalOpen = String.raw`:global\(html:has\(\[aria-modal="true"\]:not\(\[hidden\]\)\)\)`;
  const block = (selector: string) =>
    css.match(new RegExp(String.raw`${modalOpen} ${selector}\s*\{([^}]*)\}`))?.[1] ?? "";

  it("n'est masqué que sous le recadrage d'image, jamais sous une modale à lire", () => {
    const hidden = [...css.matchAll(/([^{}]+)\{[^}]*visibility:\s*hidden;/g)].map((m) => m[1].trim());
    expect(hidden).toEqual([
      ':global(html:has([aria-modal="true"]:not([hidden]) [data-handle])) .root',
    ]);
    // Le repère est bien porté par les poignées du recadrage.
    expect(readSource("components/ui/image-crop-dialog.tsx")).toContain("data-handle={handle}");
  });

  it("passe au-dessus de tous les voiles, remonté dans le coin haut gauche", () => {
    const root = block(String.raw`\.root`);
    expect(root).toMatch(/top:\s*8px;/);
    expect(root).toMatch(/bottom:\s*auto;/);
    // Au-dessus du voile des changements de confidentialité, qu'on ne peut pas
    // écarter : c'est pour lui que le menu doit rester offert.
    const privacy = stripComments(readSource("components/privacy/PrivacyChangesModal.module.css"));
    const layers = [...privacy.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(Number(root.match(/z-index:\s*(\d+)/)?.[1])).toBeGreaterThan(Math.max(1250, ...layers));
  });

  it("se réduit, et son panneau s'ouvre vers le bas", () => {
    expect(block(String.raw`\.fab`)).toMatch(/width:\s*36px;/);
    expect(block(String.raw`\.panel`)).toMatch(/top:\s*calc\(100% \+ \d+px\);[^]*bottom:\s*auto;/);
  });
});

describe("le menu d'accessibilité garde son clavier au-dessus d'une modale", () => {
  it("est marqué comme couche exemptée du piège de la modale", () => {
    const menu = readSource("components/accessibility/AccessibilityMenu.tsx");
    expect(menu).toContain("a11y-always-contrast`} data-dialog-exempt>");
  });

  const hook = readSource("lib/shared/hooks/useDialogBehavior.ts");
  const escape = hook.slice(hook.indexOf('if (event.key === "Escape") {'), hook.indexOf('if (event.key !== "Tab") return;'));
  const tab = hook.slice(hook.indexOf('if (event.key !== "Tab") return;'), hook.indexOf('window.addEventListener("keydown"'));

  it("Échap referme le panneau ouvert, pas la modale — quelle que soit la cible", () => {
    // Safari ne focalise pas un bouton cliqué : la question porte sur le panneau.
    expect(escape).toMatch(
      /if \(layers\.some\(\(layer\) => layer\.querySelector\('\[aria-expanded="true"\]'\)\)\) return;/,
    );
    expect(escape).not.toContain("event.target as HTMLElement | null)?.closest");
    expect(escape.indexOf("layers.some(")).toBeLessThan(escape.indexOf("closeRef.current()"));
  });

  it("le bouton entre dans le cycle de tabulation, après la modale", () => {
    expect(hook).toContain('document.querySelectorAll("[data-dialog-exempt]")');
    expect(tab).toContain("const extra = layers.flatMap((layer) => focusablesIn(layer));");
    // Bords de la modale → la couche ; bords de la couche → la modale.
    expect(tab).toMatch(/if \(event\.shiftKey && active === start\) go\(extra\[extra\.length - 1\] \?\? end\);/);
    expect(tab).toMatch(/else if \(!event\.shiftKey && active === end\) go\(extra\[0\] \?\? start\);/);
    expect(tab).toMatch(/if \(!event\.shiftKey && active === extra\[extra\.length - 1\]\) go\(start\);/);
    expect(tab).toMatch(/else if \(event\.shiftKey && active === extra\[0\]\) go\(end\);/);
  });

  it("le menu, lui, prend Échap quand le focus est resté dans la modale", () => {
    const menu = readSource("components/accessibility/AccessibilityMenu.tsx");
    expect(menu).toContain(`const inModal = active?.closest?.('[aria-modal="true"]') != null;`);
    expect(menu).toContain("if (!inside && !inModal && active !== null && active !== document.body) return;");
  });

  it("n'offre jamais au clavier un élément masqué", () => {
    expect(hook).toContain('getComputedStyle(el).visibility !== "hidden"');
  });
});

describe("pastille « Mon match » en mobile", () => {
  it("se réduit à son libellé sous 720 px", () => {
    const css = stripComments(readSource("components/match-launch/MatchLaunchCenter.module.css"));
    expect(lastMobileBlock(css)).toMatch(/\.fabTeams\s*\{[^}]*display:\s*none;/);
  });
});
