import { describe, expect, it } from "@jest/globals";
import {
  FLOATING_BUTTON_SETTLE_MS,
  shouldFadeFloatingButton,
} from "@/lib/shared/floating-button-scroll";
import { readSource } from "../../helpers/read-source";

describe("shouldFadeFloatingButton", () => {
  it("estompe un bouton que personne n'utilise", () => {
    expect(shouldFadeFloatingButton({ menuOpen: false, focusWithin: false })).toBe(true);
  });

  it("n'estompe jamais le menu ouvert", () => {
    expect(shouldFadeFloatingButton({ menuOpen: true, focusWithin: false })).toBe(false);
    expect(shouldFadeFloatingButton({ menuOpen: true, focusWithin: true })).toBe(false);
  });

  it("n'estompe pas le bouton qui a le focus clavier", () => {
    // Flèches et Espace font défiler la page sans déplacer le focus.
    expect(shouldFadeFloatingButton({ menuOpen: false, focusWithin: true })).toBe(false);
  });

  it("revient vite, une fois la page immobile", () => {
    expect(FLOATING_BUTTON_SETTLE_MS).toBeGreaterThan(0);
    expect(FLOATING_BUTTON_SETTLE_MS).toBeLessThanOrEqual(600);
  });
});

describe("AccessibilityMenu — estompage au défilement", () => {
  const source = readSource("components/accessibility/AccessibilityMenu.tsx");
  const css = readSource("components/accessibility/AccessibilityMenu.module.css");

  it("écoute le défilement sans le bloquer, et passe par la règle partagée", () => {
    expect(source).toMatch(/addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
    expect(source).toContain("shouldFadeFloatingButton(");
    expect(source).toContain("FLOATING_BUTTON_SETTLE_MS");
  });

  it("pose un attribut sur le DOM plutôt qu'un état React", () => {
    expect(source).toContain('root.dataset.scrolling = "true"');
    expect(source).toContain("delete root.dataset.scrolling");
  });

  it("n'estompe qu'en mobile, et laisse alors passer le toucher", () => {
    const mobile = css.slice(css.lastIndexOf("@media (max-width: 720px)"));
    expect(mobile).toMatch(/\.root\[data-scrolling="true"\] \.fab\s*\{[^}]*opacity:\s*0\.\d+;[^}]*pointer-events:\s*none;/);
    const before = css.slice(0, css.lastIndexOf("@media (max-width: 720px)"));
    expect(before).not.toContain("data-scrolling");
  });
});
