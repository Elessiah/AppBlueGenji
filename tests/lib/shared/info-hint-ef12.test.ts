/**
 * Règles pures du « i » ajoutées par EF-12 : fermeture au toucher, focus après
 * Échap, propriété d'Échap face aux modales, langue ambiante du nom du bouton.
 */
import { describe, expect, it } from "@jest/globals";
import {
  infoHintLocale,
  infoHintOwnsEscape,
  infoHintRefocusAfterEscape,
  isInteractivePointerTarget,
  topOpenModal,
} from "@/lib/shared/info-hint";

const node = (contains: (other: unknown) => boolean = () => false) => ({ contains }) as unknown as Node;

describe("isInteractivePointerTarget", () => {
  it("rend false sans cible ou sans `closest`", () => {
    expect(isInteractivePointerTarget(null)).toBe(false);
    expect(isInteractivePointerTarget(undefined)).toBe(false);
    expect(isInteractivePointerTarget({})).toBe(false);
  });

  it("rend true quand la cible est dans un contrôle, false pour du texte", () => {
    const selectors: string[] = [];
    const inControl = {
      closest: (selector: string) => {
        selectors.push(selector);
        return {};
      },
    };
    expect(isInteractivePointerTarget(inControl)).toBe(true);
    expect(isInteractivePointerTarget({ closest: () => null })).toBe(false);
    for (const tag of ["a[href]", "button", "input", "label", "select", "textarea"]) {
      expect(selectors[0]).toContain(tag);
    }
  });
});

describe("infoHintRefocusAfterEscape", () => {
  const body = node();

  it("rend le focus quand il est sur body ou absent", () => {
    expect(infoHintRefocusAfterEscape(node(), body, body)).toBe(true);
    expect(infoHintRefocusAfterEscape(node(), null, body)).toBe(true);
  });

  it("rend le focus quand il est dans le « i » ou sur un conteneur qui le porte", () => {
    const active = node();
    expect(infoHintRefocusAfterEscape(node((other) => other === active), active, body)).toBe(true);
    const root = node();
    expect(infoHintRefocusAfterEscape(root, node((other) => other === root), body)).toBe(true);
  });

  it("laisse le focus sur un champ voisin", () => {
    expect(infoHintRefocusAfterEscape(node(), node(), body)).toBe(false);
  });

  it("rend le focus sans conteneur connu", () => {
    expect(infoHintRefocusAfterEscape(null, node(), body)).toBe(true);
  });
});

describe("infoHintOwnsEscape", () => {
  it("garde Échap sans modale ouverte", () => {
    expect(infoHintOwnsEscape(node(), null)).toBe(true);
  });

  it("garde Échap dans la modale du dessus qui le porte", () => {
    const root = node();
    expect(infoHintOwnsEscape(root, node((other) => other === root))).toBe(true);
  });

  it("laisse Échap à une modale du dessus qui ne le porte pas", () => {
    expect(infoHintOwnsEscape(node(), node())).toBe(false);
    expect(infoHintOwnsEscape(null, node())).toBe(false);
  });
});

describe("topOpenModal", () => {
  const search = (items: string[]) => ({
    querySelectorAll: () => ({
      length: items.length,
      item: (index: number) => (items[index] as unknown as Node | undefined) ?? null,
    }),
  });

  it("rend null sans modale", () => {
    expect(topOpenModal(search([]))).toBeNull();
  });

  it("rend la dernière ouverte", () => {
    expect(topOpenModal(search(["a", "b"]))).toBe("b");
  });
});

describe("infoHintLocale", () => {
  it.each([
    ["fr", "en", "fr"],
    ["en", "fr", "en"],
    ["en-US", "fr", "en"],
    ["FR", "en", "fr"],
  ] as const)("la langue ambiante %s l'emporte sur la page %s", (ambient, page, expected) => {
    expect(infoHintLocale(ambient, page)).toBe(expected);
  });

  it.each([null, undefined, "", "de", "  "])("retombe sur la langue de la page pour %p", (ambient) => {
    expect(infoHintLocale(ambient, "en")).toBe("en");
  });
});
