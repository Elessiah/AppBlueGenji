import { describe, expect, it } from "@jest/globals";
import {
  ANONYMOUS_PSEUDOS,
  isLegacyDeletedPseudo,
  pickAnonymousPseudo,
} from "@/lib/shared/anonymous-pseudos";
import { PSEUDO_MAX_LENGTH, pseudoLength } from "@/lib/shared/pseudo";

/**
 * Les pseudos d'emprunt d'un compte supprimé : un faux nom tiré d'une liste,
 * libre au moment du tirage, et qui tient dans la colonne.
 */

/** Un aléa figé, pour que le tirage se lise dans le test. */
const fixed = (value: number) => () => value;

describe("ANONYMOUS_PSEUDOS — la liste", () => {
  it("compte les mille pseudos de la liste d'origine", () => {
    expect(ANONYMOUS_PSEUDOS).toHaveLength(1000);
    expect(ANONYMOUS_PSEUDOS[0]).toBe("AlphaFX");
  });

  it("n'a aucun doublon, même sans casse — la colonne est unique sans casse", () => {
    const lower = ANONYMOUS_PSEUDOS.map((pseudo) => pseudo.toLowerCase());
    expect(new Set(lower).size).toBe(ANONYMOUS_PSEUDOS.length);
  });

  it("ne contient que des pseudos que la colonne accepte, suffixe compris", () => {
    for (const pseudo of ANONYMOUS_PSEUDOS) {
      expect(pseudo).toMatch(/^[A-Za-z0-9_]+$/);
      // La marge garde la place d'un suffixe quand la liste est épuisée.
      expect(pseudoLength(pseudo) + 5).toBeLessThanOrEqual(PSEUDO_MAX_LENGTH);
    }
  });

  it("ne ressemble jamais à l'ancien pseudo de compte supprimé", () => {
    expect(ANONYMOUS_PSEUDOS.some(isLegacyDeletedPseudo)).toBe(false);
  });
});

describe("pickAnonymousPseudo", () => {
  it("tire dans la liste quand rien n'est pris", () => {
    expect(pickAnonymousPseudo([], fixed(0))).toBe(ANONYMOUS_PSEUDOS[0]);
    expect(pickAnonymousPseudo([], fixed(0.9999))).toBe(ANONYMOUS_PSEUDOS[999]);
  });

  it("tient la borne haute même si l'aléa rend 1", () => {
    expect(pickAnonymousPseudo([], fixed(1))).toBe(ANONYMOUS_PSEUDOS[999]);
  });

  it("passe à côté d'un pseudo déjà porté", () => {
    expect(pickAnonymousPseudo([ANONYMOUS_PSEUDOS[0]], fixed(0))).toBe(ANONYMOUS_PSEUDOS[1]);
  });

  it("compare sans casse : `alphafx` bloque `AlphaFX`", () => {
    expect(pickAnonymousPseudo(["alphafx"], fixed(0))).toBe(ANONYMOUS_PSEUDOS[1]);
  });

  it("ne rend jamais un pseudo pris, quel que soit l'aléa", () => {
    const taken = ANONYMOUS_PSEUDOS.filter((_, index) => index % 3 !== 0);
    const takenSet = new Set(taken);
    for (let i = 0; i < 200; i += 1) {
      const picked = pickAnonymousPseudo(taken, fixed(i / 200));
      expect(takenSet.has(picked)).toBe(false);
      expect(ANONYMOUS_PSEUDOS).toContain(picked);
    }
  });

  it("suffixe un pseudo de la liste quand elle est épuisée", () => {
    const picked = pickAnonymousPseudo(ANONYMOUS_PSEUDOS, fixed(0));
    expect(picked).toMatch(/^AlphaFX\d+$/);
    expect(ANONYMOUS_PSEUDOS).not.toContain(picked);
    expect(pseudoLength(picked)).toBeLessThanOrEqual(PSEUDO_MAX_LENGTH);
  });

  it("trouve encore un nom libre quand les suffixes tirés sont pris aussi", () => {
    // Aléa figé : le suffixe tiré est toujours `AlphaFX100`. Pris, le compteur
    // prend le relais plutôt que de tourner en rond.
    const picked = pickAnonymousPseudo([...ANONYMOUS_PSEUDOS, "AlphaFX100", "AlphaFX10000"], fixed(0));
    expect(picked).toBe("AlphaFX10001");
  });

  it("accepte n'importe quel itérable de pseudos pris", () => {
    expect(pickAnonymousPseudo(new Set([ANONYMOUS_PSEUDOS[0]]), fixed(0))).toBe(ANONYMOUS_PSEUDOS[1]);
  });
});

describe("isLegacyDeletedPseudo", () => {
  it.each<[string, boolean]>([
    ["compte_supprime_412", true],
    ["compte_supprime_1", true],
    ["compte_supprime_", false],
    ["compte_supprime_12a", false],
    ["Xcompte_supprime_12", false],
    ["AlphaFX", false],
  ])("%s → %s", (pseudo, expected) => {
    expect(isLegacyDeletedPseudo(pseudo)).toBe(expected);
  });
});
