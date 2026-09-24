import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { SkipLink, focusMainContent } from "@/components/accessibility/SkipLink";
import { readSource } from "../helpers/read-source";

/**
 * Un élément du DOM réduit à ce que le lien d'évitement touche : attributs,
 * écouteur `blur`, focus. Assez pour rejouer le parcours sans navigateur.
 */
class FakeElement {
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  focused = false;
  textContent = "contenu";
  /** Faux quand une feuille de style masque l'élément : `focus()` n'y fait rien. */
  focusable = true;
  readonly ownerDocument: { activeElement: FakeElement | null } = { activeElement: null };

  constructor(
    readonly tagName: string,
    readonly children: FakeElement[] = [],
  ) {}

  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  removeEventListener(type: string, listener: () => void) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  focus() {
    if (!this.focusable) return;
    this.focused = true;
    this.ownerDocument.activeElement = this;
  }
  blur() {
    this.focused = false;
    this.ownerDocument.activeElement = null;
    const listener = this.listeners.get("blur");
    this.listeners.delete("blur");
    listener?.();
  }
}

const fakeDocument = (main: FakeElement | null) => ({
  querySelector: () => main as unknown as HTMLElement | null,
});

describe("focusMainContent", () => {
  it("pose le focus sur le contenu, en sautant l'en-tête rendu dans <main>", () => {
    const hero = new FakeElement("SECTION");
    const main = new FakeElement("MAIN", [new FakeElement("HEADER"), hero]);

    expect(focusMainContent(fakeDocument(main))).toBe(true);
    expect(hero.focused).toBe(true);
    expect(main.focused).toBe(false);
  });

  it("rend la cible focalisable le temps du focus seulement", () => {
    const page = new FakeElement("DIV");
    focusMainContent(fakeDocument(new FakeElement("MAIN", [page])));
    expect(page.getAttribute("tabindex")).toBe("-1");
    expect(page.hasAttribute("data-skip-target")).toBe(true);

    page.blur();
    expect(page.hasAttribute("tabindex")).toBe(false);
    expect(page.hasAttribute("data-skip-target")).toBe(false);
  });

  it("ne touche pas au `tabindex` d'une cible déjà focalisable, mais la marque", () => {
    const page = new FakeElement("DIV");
    page.setAttribute("tabindex", "0");
    focusMainContent(fakeDocument(new FakeElement("MAIN", [page])));

    expect(page.focused).toBe(true);
    expect(page.getAttribute("tabindex")).toBe("0");
    // Le marqueur porte la marge de défilement sous l'en-tête collant.
    expect(page.hasAttribute("data-skip-target")).toBe(true);
    page.blur();
    expect(page.getAttribute("tabindex")).toBe("0");
    expect(page.hasAttribute("data-skip-target")).toBe(false);
  });

  it("n'éteint l'anneau que sur une cible rendue focalisable par le lien", () => {
    const css = readSource("app/globals.css");
    expect(css).toContain('[data-skip-target][tabindex="-1"]:focus {\n  outline: none;');
    expect(css).not.toMatch(/\[data-skip-target\]:focus \{/);
    expect(css).toMatch(/\[data-skip-target\] \{\s*scroll-margin-top:/);
  });

  it("défait tout et rend `false` quand la cible refuse le focus", () => {
    const page = new FakeElement("DIV");
    page.focusable = false;

    expect(focusMainContent(fakeDocument(new FakeElement("MAIN", [page])))).toBe(false);
    expect(page.hasAttribute("tabindex")).toBe(false);
    expect(page.hasAttribute("data-skip-target")).toBe(false);
    expect(page.listeners.size).toBe(0);
  });

  it("rend `false` sur une page sans <main>, pour laisser le navigateur suivre l'ancre", () => {
    expect(focusMainContent(fakeDocument(null))).toBe(false);
  });
});

describe("SkipLink — rendu serveur", () => {
  it("rend un vrai lien, nommé par son texte visible et habillé par `.skip-link`", () => {
    const html = renderToStaticMarkup(<SkipLink />);
    expect(html).toBe('<a href="#contenu" class="skip-link">Aller au contenu</a>');
  });
});

describe("SkipLink — câblage", () => {
  it("est rendu par la mise en page racine juste après le bouton d'accessibilité", () => {
    const layout = readSource("app/layout.tsx");
    const menu = layout.indexOf("<AccessibilityMenu");
    const skip = layout.indexOf("<SkipLink />");
    expect(menu).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(menu);
    // Aucun autre composant rendu entre les deux : le lien est le 2ᵉ arrêt.
    const between = layout.slice(layout.indexOf("/>", menu) + 2, skip);
    expect(between).not.toMatch(/<[A-Z]/);
  });

  it("reste dans l'ordre de tabulation et ne paraît qu'au focus", () => {
    const css = readSource("app/globals.css");
    const rule = css.slice(css.indexOf(".skip-link {"), css.indexOf("}", css.indexOf(".skip-link {")));
    expect(rule).toContain("transform:");
    // `display: none` ou `visibility: hidden` le retireraient de la tabulation.
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(css).toMatch(/\.skip-link:focus \{[^}]*transform: none/);
  });
});
