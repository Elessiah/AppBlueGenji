import { describe, expect, it } from "@jest/globals";
import {
  ANONYMOUS_PSEUDOS,
  ANONYMOUS_SUFFIX_LENGTH,
  anonymousPseudoSuffix,
  cryptoRandom,
  isLegacyDeletedPseudo,
  pickAnonymousPseudo,
  SUFFIXED_ANONYMOUS_PSEUDO,
} from "@/lib/shared/anonymous-pseudos";
import { PSEUDO_MAX_LENGTH, pseudoLength } from "@/lib/shared/pseudo";

/**
 * Les pseudos d'emprunt d'un compte supprimé : un nom tiré d'une liste suivi
 * d'un suffixe aléatoire (D99), libre au moment du tirage, et qui tient dans
 * la colonne.
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
      expect(pseudo).toMatch(/^\w+$/);
      // La marge garde la place du suffixe aléatoire « -xxxxxx ».
      expect(pseudoLength(pseudo) + 7).toBeLessThanOrEqual(PSEUDO_MAX_LENGTH);
    }
  });

  it("ne ressemble jamais à l'ancien pseudo de compte supprimé", () => {
    expect(ANONYMOUS_PSEUDOS.some(isLegacyDeletedPseudo)).toBe(false);
  });
});

/** Un aléa qui rend tour à tour les valeurs données, puis la dernière. */
const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

describe("pickAnonymousPseudo", () => {
  it("pickAnonymousPseudo_freshDraw_returnsListNameDashSixBase36", () => {
    expect(pickAnonymousPseudo([], fixed(0))).toBe("AlphaFX-000000");
    expect(pickAnonymousPseudo([], fixed(0.9999))).toBe(`${ANONYMOUS_PSEUDOS[999]}-zzzzzz`);
  });

  it("pickAnonymousPseudo_randomReturnsOne_keepsUpperBound", () => {
    expect(pickAnonymousPseudo([], fixed(1))).toBe(`${ANONYMOUS_PSEUDOS[999]}-zzzzzz`);
  });

  it("pickAnonymousPseudo_candidateTaken_drawsAnotherSuffix", () => {
    // Nom : 0 ; premier suffixe : six fois 0 ; second : 1/36 → « 1 » partout.
    const random = sequence(0, 0, 0, 0, 0, 0, 0, 1 / 36);

    expect(pickAnonymousPseudo(["AlphaFX-000000"], random)).toBe("AlphaFX-111111");
  });

  it("pickAnonymousPseudo_takenCaseInsensitive_skipsCandidate", () => {
    const random = sequence(0, 0, 0, 0, 0, 0, 0, 1 / 36);

    expect(pickAnonymousPseudo(["alphafx-000000"], random)).toBe("AlphaFX-111111");
  });

  it("pickAnonymousPseudo_allDrawsTaken_fallsBackToCounter", () => {
    // Aléa figé : chaque tirage rend « AlphaFX-000000 ». Pris, le compteur
    // prend le relais plutôt que de tourner en rond.
    expect(pickAnonymousPseudo(new Set(["AlphaFX-000000"]), fixed(0))).toBe("AlphaFX-000001");
  });

  it("pickAnonymousPseudo_defaultRandom_matchesSuffixedPatternAndFitsColumn", () => {
    const picked = pickAnonymousPseudo();

    expect(picked).toMatch(SUFFIXED_ANONYMOUS_PSEUDO);
    expect(ANONYMOUS_PSEUDOS).toContain(picked.slice(0, -7));
    expect(pseudoLength(picked)).toBeLessThanOrEqual(PSEUDO_MAX_LENGTH);
  });

  it("pickAnonymousPseudo_longestListName_fitsColumn", () => {
    const longest = Math.max(...ANONYMOUS_PSEUDOS.map(pseudoLength));

    expect(longest + 1 + ANONYMOUS_SUFFIX_LENGTH).toBeLessThanOrEqual(PSEUDO_MAX_LENGTH);
  });

  it("pickAnonymousPseudo_defaultRandom_twoDrawsDiffer", () => {
    expect(pickAnonymousPseudo()).not.toBe(pickAnonymousPseudo());
  });
});

describe("anonymousPseudoSuffix", () => {
  it("anonymousPseudoSuffix_defaultRandom_returnsSixBase36Chars", () => {
    expect(anonymousPseudoSuffix()).toMatch(/^[0-9a-z]{6}$/);
  });

  it("anonymousPseudoSuffix_fixedRandom_mapsToAlphabet", () => {
    expect(anonymousPseudoSuffix(fixed(10 / 36))).toBe("aaaaaa");
  });
});

describe("cryptoRandom", () => {
  it("cryptoRandom_called_returnsValueInUnitInterval", () => {
    const value = cryptoRandom();

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });
});

describe("SUFFIXED_ANONYMOUS_PSEUDO", () => {
  it.each<[string, boolean]>([
    ["AlphaFX-7f3k2q", true],
    ["AlphaFX", false],
    ["AlphaFX-7f3k2", false],
    ["AlphaFX10001", false],
  ])("%s → %s", (pseudo, expected) => {
    expect(SUFFIXED_ANONYMOUS_PSEUDO.test(pseudo)).toBe(expected);
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
