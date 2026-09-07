import { describe, expect, it } from "@jest/globals";
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_SPEED,
  autoScrollVelocity,
  dropIndexAt,
  moveToIndex,
} from "@/lib/shared/drag-reorder";

/**
 * Mécanique du glisser-déposer — la part qui décide du confort du geste.
 *
 * Tout est arithmétique sur des nombres relevés dans le navigateur : la
 * géométrie des emplacements et l'ordonnée du pointeur. Ce qui se teste ici
 * n'est donc pas un rendu mais les trois réponses dont dépend le geste : où la
 * ligne atterrit, ce que devient la liste, et quand la page défile toute seule.
 */

/** Cinq emplacements de 40 px de haut, le premier commençant à 100. */
const MIDPOINTS = [120, 160, 200, 240, 280];

describe("dropIndexAt", () => {
  it("place en tête un pointeur au-dessus du premier milieu", () => {
    expect(dropIndexAt(MIDPOINTS, 0)).toBe(0);
    expect(dropIndexAt(MIDPOINTS, 119)).toBe(0);
  });

  it("place en queue un pointeur au-delà du dernier milieu", () => {
    expect(dropIndexAt(MIDPOINTS, 281)).toBe(4);
    expect(dropIndexAt(MIDPOINTS, 100_000)).toBe(4);
  });

  it("bascule d'un rang au franchissement de chaque milieu", () => {
    expect(dropIndexAt(MIDPOINTS, 159)).toBe(1);
    expect(dropIndexAt(MIDPOINTS, 161)).toBe(2);
  });

  it("range le pointeur posé pile sur un milieu du côté du rang le plus haut", () => {
    // Départage arbitraire mais nécessaire : sans lui, la cible clignoterait
    // entre deux rangs quand le pointeur s'immobilise sur la frontière.
    expect(dropIndexAt(MIDPOINTS, 160)).toBe(1);
  });

  it("rend 0 sur une liste vide plutôt qu'un index négatif", () => {
    expect(dropIndexAt([], 42)).toBe(0);
  });
});

describe("moveToIndex", () => {
  const order = [10, 20, 30, 40];

  it("remonte un élément en décalant les autres, sans les échanger", () => {
    // Le 40 monte en tête : 10, 20 et 30 descendent d'un cran chacun. Un
    // échange aurait expédié le 10 en dernière position.
    expect(moveToIndex(order, 40, 0)).toEqual([40, 10, 20, 30]);
  });

  it("descend un élément à la place visée", () => {
    expect(moveToIndex(order, 10, 3)).toEqual([20, 30, 40, 10]);
  });

  it("déplace au milieu", () => {
    expect(moveToIndex(order, 10, 2)).toEqual([20, 30, 10, 40]);
  });

  it("rend l'ordre inchangé quand la place visée est déjà la sienne", () => {
    expect(moveToIndex(order, 30, 2)).toEqual(order);
  });

  it.each([
    ["un index négatif", -1],
    ["un index au-delà de la liste", 4],
  ])("rend l'ordre inchangé pour %s", (_label, target) => {
    expect(moveToIndex(order, 10, target)).toEqual(order);
  });

  it("rend l'ordre inchangé pour un élément absent", () => {
    expect(moveToIndex(order, 99, 0)).toEqual(order);
  });

  it("ne mute jamais le tableau d'origine", () => {
    const source = [1, 2, 3];
    moveToIndex(source, 3, 0);
    expect(source).toEqual([1, 2, 3]);
  });
});

describe("autoScrollVelocity", () => {
  const HEIGHT = 800;

  it("ne défile pas au milieu de la fenêtre", () => {
    expect(autoScrollVelocity(400, HEIGHT)).toBe(0);
  });

  it("défile vers le haut dans la bande haute, vers le bas dans la basse", () => {
    expect(autoScrollVelocity(10, HEIGHT)).toBeLessThan(0);
    expect(autoScrollVelocity(HEIGHT - 10, HEIGHT)).toBeGreaterThan(0);
  });

  it("accélère à mesure que le pointeur s'enfonce dans la bande", () => {
    const effleure = Math.abs(autoScrollVelocity(AUTO_SCROLL_EDGE_PX - 5, HEIGHT));
    const colle = Math.abs(autoScrollVelocity(2, HEIGHT));
    expect(colle).toBeGreaterThan(effleure);
  });

  it("plafonne à la vitesse maximale, pointeur hors de la fenêtre compris", () => {
    expect(autoScrollVelocity(0, HEIGHT)).toBe(-AUTO_SCROLL_MAX_SPEED);
    expect(autoScrollVelocity(-500, HEIGHT)).toBe(-AUTO_SCROLL_MAX_SPEED);
    expect(autoScrollVelocity(HEIGHT + 500, HEIGHT)).toBe(AUTO_SCROLL_MAX_SPEED);
  });

  it("est continue à l'entrée de la bande : aucun saut de vitesse", () => {
    expect(autoScrollVelocity(AUTO_SCROLL_EDGE_PX, HEIGHT)).toBe(0);
    expect(Math.abs(autoScrollVelocity(AUTO_SCROLL_EDGE_PX - 1, HEIGHT))).toBeLessThan(20);
  });

  it("ne défile pas dans une fenêtre trop courte pour ses deux bandes", () => {
    // Bandes chevauchantes : la page partirait vers le haut et vers le bas à la
    // fois selon l'ordre des tests. Mieux vaut ne rien faire.
    const petite = AUTO_SCROLL_EDGE_PX;
    expect(autoScrollVelocity(5, petite)).toBe(0);
    expect(autoScrollVelocity(petite - 5, petite)).toBe(0);
  });

  it("ne défile pas avec une bande nulle ou une fenêtre de hauteur nulle", () => {
    expect(autoScrollVelocity(10, HEIGHT, 0)).toBe(0);
    expect(autoScrollVelocity(10, 0)).toBe(0);
  });
});
