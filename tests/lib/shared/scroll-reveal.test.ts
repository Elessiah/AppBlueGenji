import { describe, expect, it } from "@jest/globals";
import { revealScrollLeft, SCROLL_REVEAL_ATTRIBUTE } from "@/lib/shared/scroll-reveal";

// Zone de 324 px sur une frise de 780 px : le cas mobile de l'audit.
const base = { scrollLeft: 0, viewportWidth: 324, scrollWidth: 780 };

describe("revealScrollLeft", () => {
  it("ne bouge pas une cible déjà visible", () => {
    expect(revealScrollLeft({ ...base, targetStart: 100, targetEnd: 216 })).toBe(0);
    expect(
      revealScrollLeft({ ...base, scrollLeft: 200, targetStart: 250, targetEnd: 366 }),
    ).toBe(200);
  });

  it("amène le bord droit d'une cible hors champ à droite au bord de la zone", () => {
    // Étape courante centrée en x = 564 (116 px de large) : 506 → 622.
    expect(revealScrollLeft({ ...base, targetStart: 506, targetEnd: 622 })).toBe(622 - 324);
  });

  it("amène le bord gauche d'une cible hors champ à gauche au bord de la zone", () => {
    expect(
      revealScrollLeft({ ...base, scrollLeft: 400, targetStart: 100, targetEnd: 216 }),
    ).toBe(100);
  });

  it("garde la marge d'un dégradé de bord de chaque côté", () => {
    expect(revealScrollLeft({ ...base, targetStart: 506, targetEnd: 622, margin: 18 })).toBe(
      622 + 18 - 324,
    );
    expect(
      revealScrollLeft({ ...base, scrollLeft: 400, targetStart: 100, targetEnd: 216, margin: 18 }),
    ).toBe(82);
  });

  it("montre le début d'une cible plus large que la zone", () => {
    expect(revealScrollLeft({ ...base, targetStart: 300, targetEnd: 700 })).toBe(300);
  });

  it("reste borné au défilement possible", () => {
    // Dernière étape collée au bord droit du contenu, marge comprise.
    expect(
      revealScrollLeft({ ...base, targetStart: 664, targetEnd: 780, margin: 18 }),
    ).toBe(780 - 324);
    // Première étape, marge comprise : jamais un défilement négatif.
    expect(
      revealScrollLeft({ ...base, scrollLeft: 100, targetStart: 0, targetEnd: 116, margin: 18 }),
    ).toBe(0);
    // Contenu plus étroit que la zone : rien à défiler.
    expect(
      revealScrollLeft({ scrollLeft: 0, viewportWidth: 800, scrollWidth: 780, targetStart: 664, targetEnd: 780 }),
    ).toBe(0);
  });

  it("désigne la cible par un attribut data", () => {
    expect(SCROLL_REVEAL_ATTRIBUTE).toBe("data-scroll-reveal");
  });
});
