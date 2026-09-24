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
  focusReturnTarget,
  requestAccessibilityMenu,
  resolveMenuOpener,
  type AccessibilityMenuRequest,
} from "@/lib/shared/accessibility-menu-request";
import { readSource } from "../helpers/read-source";

const noop = () => undefined;

describe("requestAccessibilityMenu", () => {
  it("émet l'évènement d'ouverture sur la cible donnée, déclencheur joint", () => {
    const target = new EventTarget();
    const received: Array<AccessibilityMenuRequest | null> = [];
    target.addEventListener(OPEN_ACCESSIBILITY_MENU_EVENT, (event) => {
      received.push((event as CustomEvent<AccessibilityMenuRequest>).detail);
    });
    const opener = {} as HTMLElement;

    requestAccessibilityMenu(opener, target);

    expect(received).toEqual([{ opener }]);
  });

  it("sans déclencheur, la demande porte `null`", () => {
    const target = new EventTarget();
    const received: Array<AccessibilityMenuRequest | null> = [];
    target.addEventListener(OPEN_ACCESSIBILITY_MENU_EVENT, (event) => {
      received.push((event as CustomEvent<AccessibilityMenuRequest>).detail);
    });

    requestAccessibilityMenu(null, target);

    expect(received).toEqual([{ opener: null }]);
  });

  it("ne lève rien quand aucun menu n'écoute", () => {
    expect(() => requestAccessibilityMenu(null, new EventTarget())).not.toThrow();
  });
});

describe("resolveMenuOpener", () => {
  const body = "body";
  const outside = () => false;

  it("préfère le déclencheur nommé à l'élément actif", () => {
    // Safari : le bouton cliqué n'a pas le focus, l'élément actif est <body>.
    expect(resolveMenuOpener("footer", body, body, outside)).toBe("footer");
    expect(resolveMenuOpener("footer", "autre", body, outside)).toBe("footer");
  });

  it("retombe sur l'élément actif quand la demande n'en nomme aucun", () => {
    expect(resolveMenuOpener(null, "lien", body, outside)).toBe("lien");
    expect(resolveMenuOpener(undefined, "lien", body, outside)).toBe("lien");
  });

  it("ne retient ni <body> ni rien — le bouton flottant sert alors de repli", () => {
    expect(resolveMenuOpener(null, body, body, outside)).toBeNull();
    expect(resolveMenuOpener(null, null, body, outside)).toBeNull();
  });

  it("ne retient pas un élément du menu lui-même", () => {
    expect(resolveMenuOpener("case", null, body, (element) => element === "case")).toBeNull();
  });
});

describe("focusReturnTarget", () => {
  const fab = { isConnected: true, name: "fab" };

  it("rend le focus au déclencheur encore dans la page", () => {
    const opener = { isConnected: true, name: "footer" };
    expect(focusReturnTarget(opener, fab)).toBe(opener);
  });

  it("retombe sur le bouton flottant si le déclencheur a disparu ou manque", () => {
    expect(focusReturnTarget({ isConnected: false, name: "footer" }, fab)).toBe(fab);
    expect(focusReturnTarget(null, fab)).toBe(fab);
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

  it("passe par les règles pures pour choisir qui reprend le focus", () => {
    expect(source).toContain("resolveMenuOpener<HTMLElement>(");
    expect(source).toContain("focusReturnTarget(opener, buttonRef.current)?.focus()");
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

  it("dégage sa dernière ligne du bouton flottant d'accessibilité", () => {
    const css = readSource("components/cyber/landing/PublicFooter.module.css");
    // Bouton : 24 px du bord + 54 px (16 + 48 sous 720 px). Mêmes valeurs que
    // le `scroll-padding-bottom` global.
    expect(css).toMatch(/\.root \{[^}]*padding: 30px 0 92px;/);
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.root \{\s*padding-bottom: 76px;/);
  });

  it("ne descend plus sous --ink-mute pour le bandeau du bas", () => {
    const css = readSource("components/cyber/landing/PublicFooter.module.css");
    const bottom = css.match(/\.bottom \{[^}]*\}/)?.[0] ?? "";
    expect(bottom).toContain("color: var(--ink-mute)");
  });
});
