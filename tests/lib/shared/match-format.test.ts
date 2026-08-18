import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_MATCH_FORMAT,
  checkMatchScores,
  isValidMatchFormat,
  matchFormatDescription,
  matchFormatLabel,
  matchMaxMaps,
  matchScoreViolationMessage,
  matchWinsRequired,
  parseMatchFormat,
  type MatchFormat,
} from "@/lib/shared/match-format";

const BO5: MatchFormat = { type: "BO", value: 5 };
const FT3: MatchFormat = { type: "FT", value: 3 };

describe("match-format — validation d'un format", () => {
  it("accepte les Best of impairs et les First to", () => {
    expect(isValidMatchFormat("BO", 1)).toBe(true);
    expect(isValidMatchFormat("BO", 5)).toBe(true);
    expect(isValidMatchFormat("FT", 3)).toBe(true);
    expect(isValidMatchFormat("FT", 4)).toBe(true);
  });

  it("refuse un Best of pair — 2-2 ne désignerait aucun vainqueur", () => {
    expect(isValidMatchFormat("BO", 4)).toBe(false);
    expect(isValidMatchFormat("BO", 2)).toBe(false);
  });

  it("refuse les valeurs hors bornes, non entières ou d'un type inconnu", () => {
    expect(isValidMatchFormat("BO", 0)).toBe(false);
    expect(isValidMatchFormat("BO", 17)).toBe(false);
    expect(isValidMatchFormat("FT", 11)).toBe(false);
    expect(isValidMatchFormat("FT", 2.5)).toBe(false);
    expect(isValidMatchFormat("RACE", 3)).toBe(false);
  });

  it("valide le format proposé par défaut à la création", () => {
    expect(isValidMatchFormat(DEFAULT_MATCH_FORMAT.type, DEFAULT_MATCH_FORMAT.value)).toBe(true);
  });

  it("refuse ce qui n'est pas un nombre, sans le coercer", () => {
    expect(isValidMatchFormat("BO", true)).toBe(false);
    expect(isValidMatchFormat("BO", [3])).toBe(false);
    expect(isValidMatchFormat("BO", {})).toBe(false);
    expect(isValidMatchFormat("BO", "")).toBe(false);
    expect(isValidMatchFormat("BO", "  ")).toBe(false);
    // Une colonne de base peut renvoyer la valeur en chaîne : elle reste valide.
    expect(isValidMatchFormat("BO", "5")).toBe(true);
  });
});

describe("match-format — parseMatchFormat", () => {
  it("relit un couple valide", () => {
    expect(parseMatchFormat("BO", 5)).toEqual(BO5);
    expect(parseMatchFormat("FT", "3")).toEqual(FT3);
  });

  it("retombe sur la saisie libre quand une des deux colonnes manque", () => {
    expect(parseMatchFormat(null, null)).toBeNull();
    expect(parseMatchFormat("BO", null)).toBeNull();
    expect(parseMatchFormat(null, 5)).toBeNull();
    expect(parseMatchFormat(undefined, undefined)).toBeNull();
  });

  it("retombe sur la saisie libre plutôt que d'accepter un format incohérent", () => {
    expect(parseMatchFormat("BO", 4)).toBeNull();
    expect(parseMatchFormat("BO", 99)).toBeNull();
  });
});

describe("match-format — grandeurs dérivées", () => {
  it("BO5 et FT3 décrivent la même course : 3 manches à gagner, 5 au maximum", () => {
    expect(matchWinsRequired(BO5)).toBe(3);
    expect(matchWinsRequired(FT3)).toBe(3);
    expect(matchMaxMaps(BO5)).toBe(5);
    expect(matchMaxMaps(FT3)).toBe(5);
  });

  it("calcule l'objectif des autres cadences", () => {
    expect(matchWinsRequired({ type: "BO", value: 1 })).toBe(1);
    expect(matchWinsRequired({ type: "BO", value: 3 })).toBe(2);
    expect(matchWinsRequired({ type: "BO", value: 7 })).toBe(4);
    expect(matchWinsRequired({ type: "FT", value: 2 })).toBe(2);
    expect(matchMaxMaps({ type: "BO", value: 7 })).toBe(7);
    expect(matchMaxMaps({ type: "FT", value: 2 })).toBe(3);
  });

  it("étiquette les formats et la saisie libre", () => {
    expect(matchFormatLabel(BO5)).toBe("BO5");
    expect(matchFormatLabel(FT3)).toBe("FT3");
    expect(matchFormatLabel(null)).toBe("Score libre");
  });

  it("décrit la course sans répéter la notation — identique en BO5 et FT3", () => {
    expect(matchFormatDescription(BO5)).toContain("3 manches");
    expect(matchFormatDescription(BO5)).toContain("5 au maximum");
    expect(matchFormatDescription(FT3)).toBe(matchFormatDescription(BO5));
    expect(matchFormatDescription({ type: "BO", value: 1 })).toContain("1 manche gagnée");
    expect(matchFormatDescription(null)).toBe("Aucune limite de score.");
  });
});

describe("match-format — contrôle des scores", () => {
  it("laisse tout passer quand le tournoi est en saisie libre", () => {
    expect(checkMatchScores(null, 42, 7, { decisive: true })).toBeNull();
  });

  it("accepte un score complet en BO5", () => {
    for (const [a, b] of [
      [3, 0],
      [3, 1],
      [3, 2],
      [0, 3],
      [2, 3],
    ]) {
      expect(checkMatchScores(BO5, a, b, { decisive: true })).toBeNull();
    }
  });

  it("refuse un score au-dessus de l'objectif", () => {
    expect(checkMatchScores(BO5, 4, 1, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(BO5, 1, 5, { decisive: false })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(FT3, 4, 0, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
  });

  it("refuse deux vainqueurs (3-3 en BO5 : 6 manches pour 5 jouables)", () => {
    expect(checkMatchScores(BO5, 3, 3, { decisive: false })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(FT3, 3, 3, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
  });

  it("refuse un score qui ne désigne personne quand il doit trancher", () => {
    expect(checkMatchScores(BO5, 2, 1, { decisive: true })).toBe("SCORE_BELOW_MATCH_FORMAT");
    expect(checkMatchScores(FT3, 0, 0, { decisive: true })).toBe("SCORE_BELOW_MATCH_FORMAT");
  });

  it("accepte un score partiel tant qu'il ne tranche pas — l'arbitrage note un match en cours", () => {
    expect(checkMatchScores(BO5, 2, 1, { decisive: false })).toBeNull();
    expect(checkMatchScores(BO5, 0, 0, { decisive: false })).toBeNull();
  });

  it("traite le BO1 comme une manche unique", () => {
    const bo1: MatchFormat = { type: "BO", value: 1 };
    expect(checkMatchScores(bo1, 1, 0, { decisive: true })).toBeNull();
    expect(checkMatchScores(bo1, 1, 1, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(bo1, 0, 0, { decisive: true })).toBe("SCORE_BELOW_MATCH_FORMAT");
  });
});

describe("match-format — message d'erreur", () => {
  it("chiffre le plafond et l'objectif du tournoi", () => {
    expect(matchScoreViolationMessage(BO5, "SCORE_EXCEEDS_MATCH_FORMAT")).toContain("BO5");
    expect(matchScoreViolationMessage(BO5, "SCORE_BELOW_MATCH_FORMAT")).toContain("3 manches");
    expect(matchScoreViolationMessage(FT3, "SCORE_BELOW_MATCH_FORMAT")).toContain("FT3");
  });

  it("reste générique en saisie libre", () => {
    expect(matchScoreViolationMessage(null, "SCORE_EXCEEDS_MATCH_FORMAT")).toBe("Score invalide.");
  });
});
