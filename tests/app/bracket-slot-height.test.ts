import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_SLOT_HEIGHT,
  SLOT_BREATHING_ROOM,
  slotUnitHeight,
} from "@/app/(secured)/tournois/[id]/_lib/bracket-layout";

/**
 * La hauteur d'un créneau de l'arbre à élimination.
 *
 * Le symptôme : le libellé d'un match (« Quart de finale 2 ») venait se poser
 * sur le bas de la carte du créneau précédent dès que celle-ci portait plusieurs
 * rangées d'action (horaire, caster, éditer le score, signaler, score
 * verrouillé). La hauteur de créneau était une constante de 140 px, alors que la
 * carte grandit d'une rangée par action offerte au lecteur — mesuré sur le jeu
 * de test, un quart de finale daté, casté et arbitrable fait 158 px, soit
 * 18 px de chevauchement avec son voisin.
 *
 * La hauteur doit rester **uniforme** : toute la géométrie de `BracketTree` en
 * descend (un trait est posé à `(index + 0.5) × hauteur`, et deux rounds voisins
 * ne s'alignent que parce que leurs créneaux couvrent la même hauteur totale).
 * C'est donc la plus haute carte qui donne la hauteur de toutes.
 */

/** Raccourci de lecture : un round de `matchCount` matchs, plus haute carte `tallest`. */
function round(matchCount: number, tallest: number) {
  return { matchCount, tallestContent: tallest };
}

describe("slotUnitHeight", () => {
  it("garde le plancher tant que les cartes y tiennent, air comprise", () => {
    // Une carte ordinaire (deux équipes, aucune action) est bien plus courte que
    // le plancher : l'arbre garde exactement l'allure qu'il avait avant la mesure.
    expect(slotUnitHeight([round(4, 118), round(2, 110), round(1, 90)])).toBe(MIN_SLOT_HEIGHT);
  });

  it("écarte les cartes qui *tenaient* de justesse dans l'ancienne constante", () => {
    // 137 px de contenu dans 140 px de créneau : trois pixels entre deux cartes,
    // et le libellé de la seconde collé sous la première.
    expect(slotUnitHeight([round(4, 137)])).toBe(137 + SLOT_BREATHING_ROOM);
  });

  it("grandit avec la carte la plus haute du round le plus large", () => {
    // Le cas observé : 158 px de contenu dans un créneau de 140.
    expect(slotUnitHeight([round(4, 158), round(2, 121)])).toBe(158 + SLOT_BREATHING_ROOM);
  });

  it("ne fait pas payer aux premiers tours la carte haute d'une finale", () => {
    // Un round de 2 reçoit le double de l'unité, un round de 1 le quadruple :
    // sa carte de 200 px est déjà largement logée.
    expect(slotUnitHeight([round(4, 118), round(2, 200), round(1, 200)])).toBe(MIN_SLOT_HEIGHT);
  });

  it("agrandit tout de même l'unité si un round étroit ne tient plus", () => {
    // Round de 2 dans un tableau de 4 : son créneau vaut 2 × l'unité, il faut
    // donc 400 / 2 = 200 d'unité pour loger 380 px de carte.
    expect(slotUnitHeight([round(4, 100), round(2, 380)], 140, 20)).toBe(200);
  });

  it("laisse toujours de l'air entre la carte la plus haute et sa voisine", () => {
    for (const tallest of [141, 158, 200, 340]) {
      expect(slotUnitHeight([round(8, tallest)])).toBeGreaterThanOrEqual(
        tallest + SLOT_BREATHING_ROOM,
      );
    }
  });

  it("arrondit au pixel supérieur — un créneau plus court d'un demi-pixel rogne la carte", () => {
    expect(slotUnitHeight([round(4, 158.2)])).toBe(159 + SLOT_BREATHING_ROOM);
  });

  it("retombe sur le plancher quand rien n'est encore mesuré", () => {
    // Rendu serveur, jsdom, premier rendu : `getBoundingClientRect` rend 0.
    expect(slotUnitHeight([])).toBe(MIN_SLOT_HEIGHT);
    expect(slotUnitHeight([round(4, 0), round(2, 0)])).toBe(MIN_SLOT_HEIGHT);
  });

  it("ignore une mesure absurde plutôt que d'en faire la hauteur de tout l'arbre", () => {
    expect(
      slotUnitHeight([round(4, Number.NaN), round(2, Number.POSITIVE_INFINITY), round(1, -40)]),
    ).toBe(MIN_SLOT_HEIGHT);
    expect(slotUnitHeight([round(4, Number.NaN), round(4, 158)])).toBe(158 + SLOT_BREATHING_ROOM);
  });

  it("ignore un round sans match plutôt que de diviser par zéro", () => {
    expect(slotUnitHeight([round(0, 300), round(4, 118)])).toBe(MIN_SLOT_HEIGHT);
    expect(Number.isFinite(slotUnitHeight([round(0, 300)]))).toBe(true);
  });

  it("accepte un plancher et une air explicites", () => {
    expect(slotUnitHeight([round(1, 80)], 100, 0)).toBe(100);
    expect(slotUnitHeight([round(1, 120)], 100, 10)).toBe(130);
  });

  it("accepte n'importe quel itérable — les mesures arrivent d'une Map de rounds", () => {
    const rounds = new Map([
      [1, round(4, 137)],
      [2, round(2, 158)],
    ]);
    expect(slotUnitHeight(rounds.values())).toBe(137 + SLOT_BREATHING_ROOM);
  });
});

describe("câblage dans BracketTree", () => {
  // La géométrie de l'arbre s'observe dans un navigateur, pas ici : ce qui est
  // vérifié est que le composant ne retient plus de hauteur figée.
  const source = readFileSync(
    join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "_components", "BracketTree.tsx"),
    "utf8",
  );

  it("dérive la hauteur totale de la mesure, pas d'une constante", () => {
    expect(source).toMatch(/const \{ slotHeight, measureSlot \} = useSlotHeight\(\)/);
    expect(source).toMatch(/const totalH = maxMatchCount \* slotHeight/);
    expect(source).not.toMatch(/SLOT_H\b/);
  });

  it("mesure le contenu du créneau — libellé compris, c'est lui qui chevauchait", () => {
    // Le `ref` est posé sur l'enveloppe qui porte le libellé *et* la carte : ne
    // mesurer que la carte laisserait le libellé déborder du créneau.
    const wrapper = source.indexOf("ref={measureSlot(roundNum, match.id)}");
    const label = source.indexOf("{(label || isTarget) && (");
    const card = source.indexOf("<MatchRow");
    expect(wrapper).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(wrapper);
    expect(card).toBeGreaterThan(label);
  });
});
