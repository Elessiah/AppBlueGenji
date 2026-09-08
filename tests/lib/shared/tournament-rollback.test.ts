import { describe, expect, it } from "@jest/globals";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";
import {
  isRollbackSupported,
  planRoundRollback,
  rollbackRoundLabel,
  rollbackRoundLabelWithArticle,
  type RollbackMatch,
  type RollbackPlan,
} from "@/lib/shared/tournament-rollback";
import type { BracketType, TournamentFormat } from "@/lib/shared/types";

/**
 * Un match du plateau. Par défaut : deux équipes en place, rien de saisi — le
 * cas d'une rencontre créée mais pas encore jouée.
 */
function match(overrides: Partial<RollbackMatch> & { id: number }): RollbackMatch {
  return {
    roundNumber: 1,
    bracket: "UPPER" as BracketType,
    team1Id: 10,
    team2Id: 20,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    decided: false,
    hasPendingReport: false,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
    ...overrides,
  };
}

/** Le même, joué : deux scores et un vainqueur. */
function played(overrides: Partial<RollbackMatch> & { id: number }): RollbackMatch {
  return play(match(overrides));
}

/**
 * Marque une rencontre existante comme jouée.
 *
 * Distinct de {@link played}, qui part des valeurs par défaut : appliquer un
 * match complet en surcharge y réécrirait les scores avec ses `null`.
 */
function play(source: RollbackMatch): RollbackMatch {
  return { ...source, team1Score: 3, team2Score: 1, winnerTeamId: 10, decided: true };
}

/** Le plan, en refusant de continuer si le module a rendu un motif de refus. */
function plan(matches: RollbackMatch[], format: TournamentFormat): RollbackPlan {
  const result = planRoundRollback(matches, format);
  if (typeof result === "string") throw new Error(`refus inattendu : ${result}`);
  return result;
}

describe("isRollbackSupported", () => {
  it("couvre l'élimination simple et les trois formats à classement", () => {
    expect(isRollbackSupported("SINGLE")).toBe(true);
    expect(isRollbackSupported("SWISS")).toBe(true);
    expect(isRollbackSupported("SURVIVAL")).toBe(true);
    expect(isRollbackSupported("BG_SURVIE")).toBe(true);
  });

  it("laisse dehors la double élimination et le multi-phases", () => {
    // Les deux tableaux d'une double élimination se numérotent chacun de leur
    // côté, et une phase close a déjà remis ses qualifiées à la suivante.
    expect(isRollbackSupported("DOUBLE")).toBe(false);
    expect(isRollbackSupported("MULTI")).toBe(false);
  });
});

describe("planRoundRollback — refus", () => {
  it("refuse un format non couvert", () => {
    const matches = [played({ id: 1 })];
    expect(planRoundRollback(matches, "DOUBLE")).toBe("ROLLBACK_UNSUPPORTED_FORMAT");
    expect(planRoundRollback(matches, "MULTI")).toBe("ROLLBACK_UNSUPPORTED_FORMAT");
  });

  it("refuse un plateau sans la moindre saisie", () => {
    expect(planRoundRollback([match({ id: 1 }), match({ id: 2 })], "SWISS")).toBe(
      "ROLLBACK_NOTHING_TO_UNDO",
    );
  });

  it("refuse un plateau vide", () => {
    expect(planRoundRollback([], "SINGLE")).toBe("ROLLBACK_NOTHING_TO_UNDO");
  });

  it("ne compte pas un bye comme une saisie", () => {
    // Le 1-0 d'un bye est posé par le moteur, personne ne l'a saisi : une manche
    // qui n'aurait que cela n'est pas une manche jouée.
    const bye = played({ id: 1, team2Id: null, team1Score: 1, team2Score: 0 });
    expect(planRoundRollback([bye], "SURVIVAL")).toBe("ROLLBACK_NOTHING_TO_UNDO");
  });
});

describe("planRoundRollback — formats à classement", () => {
  it("vise la dernière manche portant une saisie", () => {
    const matches = [
      played({ id: 1, roundNumber: 1 }),
      played({ id: 2, roundNumber: 1 }),
      played({ id: 3, roundNumber: 2 }),
      // Rencontre de la même manche, encore à jouer : elle part avec sa manche.
      match({ id: 4, roundNumber: 2 }),
    ];

    const result = plan(matches, "SWISS");

    expect(result.roundNumber).toBe(2);
    expect(result.clearedMatchIds.sort()).toEqual([3, 4]);
    expect(result.laterMatchIds).toEqual([]);
    expect(result.disposal).toBe("DELETE");
  });

  it("emporte la manche déjà posée par le moteur au-delà de la manche visée", () => {
    // Cas courant : la manche 2 est complète, le moteur a posé la 3 — que le
    // retour en arrière rend caduque, ses appariements venant d'un classement
    // qu'on défait.
    const matches = [
      played({ id: 1, roundNumber: 2 }),
      match({ id: 2, roundNumber: 3 }),
      match({ id: 3, roundNumber: 3 }),
    ];

    const result = plan(matches, "SURVIVAL");

    expect(result.roundNumber).toBe(2);
    expect(result.clearedMatchIds).toEqual([1]);
    expect(result.laterMatchIds.sort()).toEqual([2, 3]);
    expect(result.disposal).toBe("DELETE");
  });

  it("compte un report en attente comme une saisie", () => {
    const matches = [
      played({ id: 1, roundNumber: 1 }),
      match({ id: 2, roundNumber: 2, hasPendingReport: true }),
    ];

    expect(plan(matches, "SWISS").roundNumber).toBe(2);
  });

  it("compte un forfait de match comme une saisie", () => {
    const matches = [
      played({ id: 1, roundNumber: 1 }),
      match({ id: 2, roundNumber: 2, forfeitTeamId: 20 }),
    ];

    expect(plan(matches, "SWISS").roundNumber).toBe(2);
  });
});

describe("planRoundRollback — élimination simple", () => {
  /** Plateau à 8 : trois manches et une petite finale, créée en manche 1. */
  function bracket(): RollbackMatch[] {
    return [
      match({ id: 1, roundNumber: 1 }),
      match({ id: 2, roundNumber: 1 }),
      match({ id: 3, roundNumber: 1 }),
      match({ id: 4, roundNumber: 1 }),
      match({ id: 5, roundNumber: 2 }),
      match({ id: 6, roundNumber: 2 }),
      match({ id: 7, roundNumber: 3 }),
      match({ id: 8, roundNumber: 1, bracket: "THIRD_PLACE" }),
    ];
  }

  it("détache ce qui descendait de la manche défaite, sans le supprimer", () => {
    const matches = bracket().map((m) => (m.roundNumber === 1 && m.id <= 4 ? play(m) : m));

    const result = plan(matches, "SINGLE");

    expect(result.roundNumber).toBe(1);
    expect(result.clearedMatchIds.sort()).toEqual([1, 2, 3, 4]);
    // Le plateau à élimination est créé en entier au lancement : on vide les
    // rencontres suivantes de leurs qualifiées, on ne détruit pas la structure.
    expect(result.disposal).toBe("DETACH");
    expect(result.laterMatchIds.sort()).toEqual([5, 6, 7, 8]);
  });

  it("laisse la petite finale hors de la manche 1 malgré son numéro", () => {
    // `bracket-single.ts` crée la petite finale en manche 1 : la ranger sur son
    // numéro effacerait la troisième place en défaisant le premier tour.
    const matches = bracket().map((m) => (m.roundNumber === 1 && m.id <= 4 ? play(m) : m));

    expect(plan(matches, "SINGLE").clearedMatchIds).not.toContain(8);
  });

  it("emporte la petite finale quand c'est la finale qu'on défait", () => {
    const matches = bracket().map(play);

    const result = plan(matches, "SINGLE");

    expect(result.roundNumber).toBe(3);
    expect(result.clearedMatchIds.sort()).toEqual([7, 8]);
    expect(result.laterMatchIds).toEqual([]);
  });

  it("ne défait pas les demi-finales quand seule la petite finale est jouée", () => {
    // La petite finale se joue au stade de la finale : elle ne peut pas ramener
    // le tournoi à un stade antérieur.
    const matches = bracket().map((m) => (m.id === 8 ? play(m) : m));

    expect(plan(matches, "SINGLE").roundNumber).toBe(3);
  });
});

describe("planRoundRollback — BlueGenji Survie", () => {
  it("refuse de défaire une manche qualificative une fois l'arbre tiré", () => {
    const matches = [
      played({ id: 1, roundNumber: 4 }),
      match({ id: 2, roundNumber: PLAYOFF_ROUND_OFFSET }),
      match({ id: 3, roundNumber: PLAYOFF_ROUND_OFFSET }),
    ];

    expect(planRoundRollback(matches, "BG_SURVIE")).toBe("ROLLBACK_PLAYOFFS_STARTED");
  });

  it("défait un tour de l'arbre final", () => {
    const matches = [
      played({ id: 1, roundNumber: 4 }),
      played({ id: 2, roundNumber: PLAYOFF_ROUND_OFFSET }),
      played({ id: 3, roundNumber: PLAYOFF_ROUND_OFFSET }),
      match({ id: 4, roundNumber: PLAYOFF_ROUND_OFFSET + 1 }),
    ];

    const result = plan(matches, "BG_SURVIE");

    expect(result.roundNumber).toBe(PLAYOFF_ROUND_OFFSET);
    expect(result.clearedMatchIds.sort()).toEqual([2, 3]);
    expect(result.laterMatchIds).toEqual([4]);
    expect(result.disposal).toBe("DELETE");
  });

  it("défait la finale et sa petite finale ensemble", () => {
    // Le mode range déjà les deux dans la même manche : le repère de la petite
    // finale ne change alors rien.
    const finalRound = PLAYOFF_ROUND_OFFSET + 2;
    const matches = [
      played({ id: 1, roundNumber: PLAYOFF_ROUND_OFFSET }),
      played({ id: 2, roundNumber: finalRound }),
      played({ id: 3, roundNumber: finalRound, bracket: "THIRD_PLACE" }),
    ];

    const result = plan(matches, "BG_SURVIE");

    expect(result.roundNumber).toBe(finalRound);
    expect(result.clearedMatchIds.sort()).toEqual([2, 3]);
  });

  it("défait normalement une manche qualificative tant que l'arbre n'est pas tiré", () => {
    const matches = [played({ id: 1, roundNumber: 3 }), played({ id: 2, roundNumber: 3 })];

    expect(plan(matches, "BG_SURVIE").roundNumber).toBe(3);
  });
});

describe("rollbackRoundLabel", () => {
  it("nomme une manche qualificative par son numéro", () => {
    expect(rollbackRoundLabel(4)).toBe("manche 4");
  });

  it("ramène les tours de l'arbre final à leur rang", () => {
    // Sans cela, le premier tour s'annoncerait « manche 1000 ».
    expect(rollbackRoundLabel(PLAYOFF_ROUND_OFFSET)).toBe("tour 1 des play-offs");
    expect(rollbackRoundLabel(PLAYOFF_ROUND_OFFSET + 2)).toBe("tour 3 des play-offs");
  });

  it("accorde l'article au genre du libellé", () => {
    // Une manche est féminine, un tour masculin : une seule forme se tromperait
    // une fois sur deux, sur un texte affiché à l'arbitre juste avant le geste.
    expect(rollbackRoundLabelWithArticle(4)).toBe("la manche 4");
    expect(rollbackRoundLabelWithArticle(PLAYOFF_ROUND_OFFSET)).toBe("le tour 1 des play-offs");
  });
});
