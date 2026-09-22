import { describe, expect, it } from "@jest/globals";
import {
  botPayloadLabel,
  botPayloadNumber,
  botPayloadText,
} from "@/lib/shared/bot-payload";

/**
 * `lib/server/bot-integration.ts` rend chacune de ses charges par un simple
 * `as` sur du JSON reçu : le type est une intention, pas une garantie. Ces
 * trois fonctions sont le seul garde-fou, et `/bot` étant rendue par des
 * composants serveur, ce qu'elles écartent n'est pas une case vide mais une
 * page servie en 500.
 */
describe("botPayloadNumber", () => {
  it("laisse passer un nombre fini, négatif ou nul compris", () => {
    expect(botPayloadNumber(0)).toBe(0);
    expect(botPayloadNumber(-4)).toBe(-4);
    expect(botPayloadNumber(12_345)).toBe(12_345);
    expect(botPayloadNumber(1.5)).toBe(1.5);
  });

  it("écarte tout ce qui n'est pas un nombre", () => {
    for (const value of ["12345", null, undefined, {}, [], true, () => 1]) {
      expect(botPayloadNumber(value)).toBeNull();
    }
  });

  it("écarte `NaN` et les infinis — ils ne lèvent pas, ils se propagent", () => {
    // Un `NaN` traverse `Math.max`, puis `width: NaN%`, que le navigateur
    // laisse tomber sans rien dire. C'est la panne muette, pas l'erreur.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(botPayloadNumber(value)).toBeNull();
    }
  });
});

describe("botPayloadText", () => {
  it("rend une chaîne non vide telle quelle", () => {
    expect(botPayloadText("2.4.1")).toBe("2.4.1");
  });

  it("rend un nombre en texte", () => {
    expect(botPayloadText(42)).toBe("42");
    expect(botPayloadText(0)).toBe("0");
  });

  it("ne rend jamais une chaîne vide — ce serait une case muette", () => {
    expect(botPayloadText("")).toBeNull();
  });

  it("écarte ce qui n'est ni texte ni nombre", () => {
    for (const value of [null, undefined, {}, [], true, Number.NaN]) {
      expect(botPayloadText(value)).toBeNull();
    }
  });
});

describe("botPayloadLabel", () => {
  it("rend le texte quand il y en a un", () => {
    expect(botPayloadLabel("Nova Esports")).toBe("Nova Esports");
    expect(botPayloadLabel(7)).toBe("7");
  });

  it("rend une chaîne vide sur ce qui ferait lever React", () => {
    // « Objects are not valid as a React child » pendant le rendu d'un
    // composant serveur, c'est la page entière en 500 : le repli est la chaîne
    // vide, pas `null`, parce qu'il ne doit rester aucune décision à prendre.
    for (const value of [{ fr: "Nova" }, ["N", "V"], null, undefined, Number.NaN]) {
      expect(botPayloadLabel(value)).toBe("");
    }
  });
});
