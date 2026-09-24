import { describe, expect, it, jest } from "@jest/globals";

// Le pied de page lit la session et la base : seules sa structure et ses
// classes intéressent ces tests.
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/contact-service", () => ({
  getContactInfo: jest.fn(async () => ({ email: "", discordTag: "", discordUrl: "" })),
}));
jest.mock("@/components/cyber/landing/FooterContact", () => ({
  FooterContact: () => <ul />,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { AccessibilityFooterLink } from "@/components/accessibility/AccessibilityFooterLink";
import { AccessibilityPanel } from "@/components/accessibility/AccessibilityMenu";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import {
  OPEN_ACCESSIBILITY_MENU_EVENT,
  requestAccessibilityMenu,
} from "@/lib/shared/accessibility-menu-request";
import { readSource } from "../helpers/read-source";

const noop = () => undefined;

describe("requestAccessibilityMenu", () => {
  it("émet l'évènement d'ouverture sur la cible donnée", () => {
    const target = new EventTarget();
    const listener = jest.fn();
    target.addEventListener(OPEN_ACCESSIBILITY_MENU_EVENT, listener);

    requestAccessibilityMenu(target);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ne lève rien quand aucun menu n'écoute", () => {
    expect(() => requestAccessibilityMenu(new EventTarget())).not.toThrow();
  });
});

describe("AccessibilityFooterLink", () => {
  it("est un bouton — il ouvre un panneau, il n'emmène nulle part", () => {
    const html = renderToStaticMarkup(<AccessibilityFooterLink className="x" />);
    expect(html).toBe('<button type="button" class="x">Accessibilité</button>');
  });
});

describe("AccessibilityMenu — ouverture à la demande", () => {
  const source = readSource("components/accessibility/AccessibilityMenu.tsx");

  it("écoute la demande d'ouverture sur la fenêtre et s'en désabonne", () => {
    expect(source).toContain("window.addEventListener(OPEN_ACCESSIBILITY_MENU_EVENT");
    expect(source).toContain("window.removeEventListener(OPEN_ACCESSIBILITY_MENU_EVENT");
  });

  it("rend le focus à qui a ouvert le menu, le bouton flottant à défaut", () => {
    expect(source).toMatch(/opener\?\.isConnected\) opener\.focus\(\);\s*else buttonRef\.current\?\.focus\(\);/);
  });

  it("le panneau peut recevoir le focus sans devenir un arrêt de tabulation", () => {
    const html = renderToStaticMarkup(
      <AccessibilityPanel
        id="p"
        titleId="t"
        settings={[]}
        onToggle={noop}
        onReset={noop}
        onClose={noop}
      />,
    );
    expect(html).toMatch(/^<div id="p"[^>]*tabindex="-1"/);
  });
});

describe("PublicFooter — accessibilité", () => {
  const render = async () => renderToStaticMarkup(await PublicFooter());

  it("porte une entrée « Accessibilité » qui ouvre le menu", async () => {
    const html = await render();
    expect(html).toMatch(/<li><button type="button" class="[^"]*linkButton[^"]*">Accessibilité<\/button><\/li>/);
  });

  it("se lit toujours en contraste renforcé", async () => {
    const html = await render();
    expect(html).toMatch(/^<footer class="[^"]*\ba11y-always-contrast\b[^"]*">/);
  });

  it("pose son propre fond opaque et souligne ses liens", () => {
    const css = readSource("components/cyber/landing/PublicFooter.module.css");
    expect(css).toMatch(/\.root \{[^}]*background: var\(--cyber-bg\);/);
    expect(css).toMatch(/\.columns a,\s*\.linkButton \{[^}]*text-decoration: underline;/);
  });

  it("ne descend plus sous --ink-mute pour le bandeau du bas", () => {
    const css = readSource("components/cyber/landing/PublicFooter.module.css");
    const bottom = css.match(/\.bottom \{[^}]*\}/)?.[0] ?? "";
    expect(bottom).toContain("color: var(--ink-mute)");
  });
});
