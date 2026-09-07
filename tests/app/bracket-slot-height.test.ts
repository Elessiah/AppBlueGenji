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

describe("slotUnitHeight", () => {
  it("garde le plancher tant que les cartes y tiennent, air comprise", () => {
    // Une carte ordinaire (deux équipes, aucune action) est bien plus courte que
    // le plancher : l'arbre garde exactement l'allure qu'il avait avant la mesure.
    expect(slotUnitHeight([90, 110, 118])).toBe(MIN_SLOT_HEIGHT);
  });

  it("écarte aussi les cartes qui *tenaient* de justesse dans l'ancienne constante", () => {
    // 137 px de contenu dans 140 px de créneau : trois pixels entre deux cartes,
    // et le libellé de la seconde collé sous la première.
    expect(slotUnitHeight([137])).toBe(137 + SLOT_BREATHING_ROOM);
  });

  it("grandit avec la carte la plus haute, air comprise", () => {
    // Le cas observé : 158 px de contenu dans un créneau de 140.
    expect(slotUnitHeight([137, 158, 121])).toBe(158 + SLOT_BREATHING_ROOM);
  });

  it("laisse toujours de l'air entre la carte la plus haute et sa voisine", () => {
    for (const tallest of [141, 158, 200, 340]) {
      expect(slotUnitHeight([tallest])).toBeGreaterThanOrEqual(tallest + SLOT_BREATHING_ROOM);
    }
  });

  it("arrondit au pixel supérieur — un créneau plus court d'un demi-pixel rogne la carte", () => {
    expect(slotUnitHeight([158.2])).toBe(159 + SLOT_BREATHING_ROOM);
  });

  it("retombe sur le plancher quand rien n'est encore mesuré", () => {
    // Rendu serveur, jsdom, premier rendu : `getBoundingClientRect` rend 0.
    expect(slotUnitHeight([])).toBe(MIN_SLOT_HEIGHT);
    expect(slotUnitHeight([0, 0, 0])).toBe(MIN_SLOT_HEIGHT);
  });

  it("ignore une mesure absurde plutôt que d'en faire la hauteur de tout l'arbre", () => {
    expect(slotUnitHeight([Number.NaN, Number.POSITIVE_INFINITY, -40, 100])).toBe(MIN_SLOT_HEIGHT);
    expect(slotUnitHeight([Number.NaN, 158])).toBe(158 + SLOT_BREATHING_ROOM);
  });

  it("accepte un plancher et une air explicites", () => {
    expect(slotUnitHeight([80], 100, 0)).toBe(100);
    expect(slotUnitHeight([120], 100, 10)).toBe(130);
  });

  it("accepte n'importe quel itérable — les mesures arrivent d'une Map de nœuds", () => {
    const nodes = new Map([
      [1, 137],
      [2, 158],
    ]);
    expect(slotUnitHeight(nodes.values())).toBe(158 + SLOT_BREATHING_ROOM);
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
    const wrapper = source.indexOf("ref={measureSlot(match.id)}");
    const label = source.indexOf("{(label || isTarget) && (");
    const card = source.indexOf("<MatchRow");
    expect(wrapper).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(wrapper);
    expect(card).toBeGreaterThan(label);
  });
});
