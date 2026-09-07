import { describe, expect, it } from "@jest/globals";
import {
  checkMatchScores,
  isValidMatchMaxMaps,
  matchAllowsDraw,
  matchFormatDescription,
  matchFormatLabel,
  matchMaxMaps,
  matchWinnerSide,
  naturalMaxMaps,
  parseMatchFormat,
  withoutDraws,
  type MatchFormat,
} from "@/lib/shared/match-format";
import {
  enduranceMatchFormat,
  PLAYOFF_ROUND_OFFSET,
  isEndurancePlayoffRound,
  tournamentMatchFormat,
} from "@/lib/shared/bg-survie";

const FT3: MatchFormat = { type: "FT", value: 3 };
const BO5: MatchFormat = { type: "BO", value: 5 };
/** Le format du règlement : premier à 3, cinq maps décisives, égalité possible. */
const QUALIF: MatchFormat = { type: "FT", value: 3, drawsAllowed: true };

describe("plafond de maps décisives", () => {
  it("vaut le plafond naturel quand rien n'est réglé", () => {
    expect(naturalMaxMaps(FT3)).toBe(5);
    expect(matchMaxMaps(FT3)).toBe(5);
    expect(matchMaxMaps({ ...FT3, maxMaps: null })).toBe(5);
  });

  it("se règle entre l'objectif et le plafond naturel", () => {
    expect(isValidMatchMaxMaps(FT3, 3)).toBe(true);
    expect(isValidMatchMaxMaps(FT3, 4)).toBe(true);
    expect(isValidMatchMaxMaps(FT3, 5)).toBe(true);
    // Sous l'objectif, personne ne peut l'atteindre : le match n'aurait jamais
    // de vainqueur.
    expect(isValidMatchMaxMaps(FT3, 2)).toBe(false);
    // Au-delà, la valeur ne décrit plus rien : la course est déjà finie.
    expect(isValidMatchMaxMaps(FT3, 6)).toBe(false);
  });

  it("refuse une valeur qui n'est pas un entier", () => {
    expect(isValidMatchMaxMaps(FT3, 3.5)).toBe(false);
    expect(isValidMatchMaxMaps(FT3, "quatre")).toBe(false);
    expect(isValidMatchMaxMaps(FT3, true)).toBe(false);
    expect(isValidMatchMaxMaps(FT3, "")).toBe(false);
  });

  it("laisse passer l'absence de plafond : ce n'est pas un réglage manquant", () => {
    expect(isValidMatchMaxMaps(FT3, null)).toBe(true);
    expect(isValidMatchMaxMaps(FT3, undefined)).toBe(true);
  });

  it("ramène un plafond aberrant dans l'intervalle plutôt que de rendre le tournoi injouable", () => {
    // Une ligne écrite à la main en base, ou avant la règle de validation.
    expect(matchMaxMaps({ ...FT3, maxMaps: 99 })).toBe(5);
    expect(matchMaxMaps({ ...FT3, maxMaps: 0 })).toBe(3);
    expect(matchMaxMaps({ ...FT3, maxMaps: -4 })).toBe(3);
  });

  it("borne la somme des deux scores, et elle seule", () => {
    const capped: MatchFormat = { ...FT3, maxMaps: 4 };

    // 2-2 tient dans quatre maps décisives.
    expect(checkMatchScores(capped, 2, 2, { decisive: false })).toBeNull();
    // 3-2 en ferait cinq.
    expect(checkMatchScores(capped, 3, 2, { decisive: false })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    // L'objectif, lui, ne bouge pas : 3-1 reste un résultat légitime.
    expect(checkMatchScores(capped, 3, 1, { decisive: true })).toBeNull();
  });

  it("apparaît dans l'étiquette dès qu'il n'est plus le plafond naturel", () => {
    expect(matchFormatLabel(FT3)).toBe("FT3");
    expect(matchFormatLabel({ ...FT3, maxMaps: 5 })).toBe("FT3");
    expect(matchFormatLabel({ ...FT3, maxMaps: 4 })).toBe("FT3 · 4 maps");
  });
});

describe("égalités autorisées", () => {
  it("n'est vraie que sur un `true` franc", () => {
    expect(matchAllowsDraw(QUALIF)).toBe(true);
    expect(matchAllowsDraw(FT3)).toBe(false);
    expect(matchAllowsDraw(null)).toBe(false);
    expect(matchAllowsDraw(undefined)).toBe(false);
  });

  it("accepte n'importe quel score tenant dans le plafond, l'égalité comprise", () => {
    for (const [a, b] of [
      [2, 2],
      [2, 1],
      [1, 1],
      [0, 0],
      [3, 0],
    ] as const) {
      expect(checkMatchScores(QUALIF, a, b, { decisive: true })).toBeNull();
    }
  });

  it("garde le plafond : les égalités n'ouvrent pas la porte à un score impossible", () => {
    expect(checkMatchScores(QUALIF, 4, 0, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(QUALIF, 3, 3, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
  });

  it("laisse le refus d'un score incomplet là où l'égalité est fermée", () => {
    // Le message renvoie au bon geste — saisir le vrai score — plutôt qu'à une
    // règle abstraite : un 2-2 en FT3 est d'abord un score incomplet.
    expect(checkMatchScores(FT3, 2, 2, { decisive: true })).toBe("SCORE_BELOW_MATCH_FORMAT");
    expect(checkMatchScores(BO5, 2, 1, { decisive: true })).toBe("SCORE_BELOW_MATCH_FORMAT");
  });

  it("refuse l'égalité en saisie libre, seul cas sans objectif à opposer", () => {
    expect(checkMatchScores(null, 2, 2, { decisive: true })).toBe("DRAW_NOT_ALLOWED");
    expect(checkMatchScores(null, 7, 2, { decisive: true })).toBeNull();
    // Une sauvegarde intermédiaire n'a rien à trancher : le 0-0 y reste permis.
    expect(checkMatchScores(null, 0, 0, { decisive: false })).toBeNull();
  });

  it("se lit dans la phrase d'aide", () => {
    expect(matchFormatDescription(FT3)).not.toContain("sans vainqueur");
    expect(matchFormatDescription(QUALIF)).toContain("sans vainqueur");
  });
});

describe("withoutDraws", () => {
  it("ferme l'égalité en gardant le reste du format", () => {
    const closed = withoutDraws({ ...QUALIF, maxMaps: 4 });

    expect(matchAllowsDraw(closed)).toBe(false);
    expect(closed).toEqual({ type: "FT", value: 3, maxMaps: 4 });
  });

  it("rend le format tel quel quand il n'y a rien à fermer", () => {
    expect(withoutDraws(FT3)).toBe(FT3);
    expect(withoutDraws(null)).toBeNull();
  });
});

describe("matchWinnerSide", () => {
  it("désigne le side du plus haut score", () => {
    expect(matchWinnerSide(FT3, 3, 1)).toBe(1);
    expect(matchWinnerSide(FT3, 1, 3)).toBe(2);
  });

  it("rend `null` sur une égalité que le format autorise", () => {
    expect(matchWinnerSide(QUALIF, 2, 2)).toBeNull();
    expect(matchWinnerSide(QUALIF, 0, 0)).toBeNull();
  });

  it("retombe sur le side 1 quand l'égalité n'est pas censée exister", () => {
    // Filet, pas règle : `checkMatchScores` refuse ce score en amont, mais une
    // ligne écrite avant cette règle ne doit pas laisser un plateau sans
    // qualifiée.
    expect(matchWinnerSide(FT3, 2, 2)).toBe(1);
    expect(matchWinnerSide(null, 2, 2)).toBe(1);
  });
});

describe("parseMatchFormat — réglages facultatifs", () => {
  it("lit un plafond valide et ignore un plafond aberrant", () => {
    expect(parseMatchFormat("FT", 3, 4, 0)).toEqual({ type: "FT", value: 3, maxMaps: 4 });
    expect(parseMatchFormat("FT", 3, 9, 0)).toEqual({ type: "FT", value: 3 });
    expect(parseMatchFormat("FT", 3, null, 0)).toEqual({ type: "FT", value: 3 });
  });

  it("n'ouvre les égalités que sur une valeur franche", () => {
    // Les trois formes que peut prendre un `TINYINT(1)` selon le pilote.
    expect(parseMatchFormat("FT", 3, null, 1)?.drawsAllowed).toBe(true);
    expect(parseMatchFormat("FT", 3, null, true)?.drawsAllowed).toBe(true);
    expect(parseMatchFormat("FT", 3, null, "1")?.drawsAllowed).toBe(true);

    expect(parseMatchFormat("FT", 3, null, 0)?.drawsAllowed).toBeUndefined();
    expect(parseMatchFormat("FT", 3, null, null)?.drawsAllowed).toBeUndefined();
    expect(parseMatchFormat("FT", 3, null, "oui")?.drawsAllowed).toBeUndefined();
  });

  it("reste `null` sur un format à moitié renseigné, réglages ou non", () => {
    expect(parseMatchFormat("FT", null, 4, 1)).toBeNull();
    expect(parseMatchFormat(null, 3, 4, 1)).toBeNull();
  });
});

describe("tournamentMatchFormat — quel format pour quelle manche", () => {
  const PLAYOFF: MatchFormat = { type: "FT", value: 3 };

  it("sépare qualification et arbre final en BlueGenji Survie", () => {
    expect(tournamentMatchFormat("BG_SURVIE", QUALIF, PLAYOFF, 3)).toBe(QUALIF);
    expect(tournamentMatchFormat("BG_SURVIE", QUALIF, PLAYOFF, PLAYOFF_ROUND_OFFSET)).toBe(PLAYOFF);
  });

  it("ferme les égalités de l'arbre final quand il n'a pas son propre format", () => {
    const resolved = tournamentMatchFormat("BG_SURVIE", QUALIF, null, PLAYOFF_ROUND_OFFSET + 1);

    // Un match nul en élimination directe laisserait un demi-finaliste
    // indéterminé : le repli garde la course, pas l'égalité.
    expect(matchAllowsDraw(resolved)).toBe(false);
    expect(resolved).toEqual({ type: "FT", value: 3, maxMaps: null });
  });

  it("rend le format de la qualification quand aucune manche n'est visée", () => {
    expect(tournamentMatchFormat("BG_SURVIE", QUALIF, PLAYOFF)).toBe(QUALIF);
    expect(tournamentMatchFormat("BG_SURVIE", QUALIF, PLAYOFF, null)).toBe(QUALIF);
  });

  it("ferme les égalités partout ailleurs, quelle que soit la manche", () => {
    for (const format of ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "MULTI"]) {
      expect(matchAllowsDraw(tournamentMatchFormat(format, QUALIF, null, 2))).toBe(false);
      expect(matchAllowsDraw(tournamentMatchFormat(format, QUALIF, null, 1500))).toBe(false);
    }
  });

  it("laisse la saisie libre intacte", () => {
    expect(tournamentMatchFormat("SINGLE", null, null, 1)).toBeNull();
    expect(tournamentMatchFormat("BG_SURVIE", null, null, 1)).toBeNull();
  });
});

describe("frontière des manches d'arbre final", () => {
  it("sépare les deux phases au palier", () => {
    expect(isEndurancePlayoffRound(PLAYOFF_ROUND_OFFSET - 1)).toBe(false);
    expect(isEndurancePlayoffRound(PLAYOFF_ROUND_OFFSET)).toBe(true);
    expect(isEndurancePlayoffRound(PLAYOFF_ROUND_OFFSET + 2)).toBe(true);
  });

  it("est bien celle qu'applique la résolution du format", () => {
    const playoff: MatchFormat = { type: "BO", value: 7 };

    expect(enduranceMatchFormat(QUALIF, playoff, PLAYOFF_ROUND_OFFSET - 1)).toBe(QUALIF);
    expect(enduranceMatchFormat(QUALIF, playoff, PLAYOFF_ROUND_OFFSET)).toBe(playoff);
  });
});
