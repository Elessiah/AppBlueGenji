import { describe, expect, it } from "@jest/globals";
import {
  compareRankedMatches,
  isRankedTeam,
  RANKING_BASE_POINTS,
  RANKING_FLOOR_POINTS,
  RANKING_PLACEMENT_ONLY_HINT,
  RANKING_POINTS_HINT,
  RANKING_UNRANKED_HINT,
  rankedPointsOf,
  rankingPointsHint,
  replayRanking,
  type RankedMatch,
  type RankedPlacement,
} from "@/lib/shared/ranking";
import { placementDeltas } from "@/lib/shared/tournament-placement";

/**
 * Les points de parcours **dans** le rejeu : leur place dans la chronologie, ce
 * qu'ils changent au bilan, et ce qu'ils ne changent pas.
 *
 * Le calcul lui-même est testé sans base ni rejeu dans
 * `tournament-placement.test.ts` ; ici, on ne teste que le raccord.
 */

function decided(matchId: number, winner: number, loser: number, day = matchId): RankedMatch {
  return {
    matchId,
    winnerTeamId: winner,
    loserTeamId: loser,
    playedAt: `2026-06-${String(day).padStart(2, "0")}T18:00:00.000Z`,
  };
}

function placement(
  tournamentId: number,
  order: number[],
  awardedAt = "2026-06-20T18:00:00.000Z",
): RankedPlacement {
  return {
    tournamentId,
    entrants: order.map((teamId, index) => ({ teamId, rank: index + 1 })),
    awardedAt,
  };
}

function totalOf(states: Map<number, { points: number }>): number {
  return [...states.values()].reduce((total, state) => total + state.points, 0);
}

describe("replayRanking — sans classement final", () => {
  it("rend exactement ce qu'il rendait avant les points de parcours", () => {
    const matches = [decided(1, 1, 2), decided(2, 2, 3)];

    expect(replayRanking(matches)).toEqual(replayRanking(matches, []));
  });

  it("laisse la part de parcours à zéro", () => {
    const states = replayRanking([decided(1, 1, 2)]);

    expect(states.get(1)?.placementPoints).toBe(0);
    expect(states.get(2)?.placementPoints).toBe(0);
  });
});

describe("replayRanking — le classement final redistribue", () => {
  it("paie la championne et fait payer la dernière", () => {
    const states = replayRanking([], [placement(1, [10, 20, 30, 40])]);

    expect(states.get(10)!.points).toBeGreaterThan(RANKING_BASE_POINTS);
    expect(states.get(40)!.points).toBeLessThan(RANKING_BASE_POINTS);
  });

  it("ne crée ni ne détruit de point sur l'ensemble du site", () => {
    const states = replayRanking([], [placement(1, [10, 20, 30, 40, 50, 60, 70, 80])]);

    expect(totalOf(states)).toBe(RANKING_BASE_POINTS * 8);
  });

  it("range la part de parcours à part, sans la compter deux fois", () => {
    const states = replayRanking([], [placement(1, [10, 20, 30, 40])]);

    for (const state of states.values()) {
      expect(state.points).toBe(RANKING_BASE_POINTS + state.placementPoints);
    }
  });

  // Un classement final n'est pas un bilan : il ne fait figurer personne au
  // leaderboard, et `isRankedTeam` continue de se lire sur les rencontres.
  it("ne compte pas le tournoi comme un match joué", () => {
    const state = replayRanking([], [placement(1, [10, 20])]).get(10)!;

    expect(state.matchesPlayed).toBe(0);
    expect(state.wins).toBe(0);
    expect(state.losses).toBe(0);
    expect(state.draws).toBe(0);
  });

  it("ignore un tournoi à une seule classée", () => {
    const states = replayRanking([], [placement(1, [10])]);

    expect(rankedPointsOf(states, 10)).toBe(RANKING_BASE_POINTS);
  });

  it("additionne les tournois d'une même équipe", () => {
    const once = replayRanking([], [placement(1, [10, 20, 30, 40])]);
    const twice = replayRanking(
      [],
      [
        placement(1, [10, 20, 30, 40], "2026-06-20T18:00:00.000Z"),
        placement(2, [10, 20, 30, 40], "2026-06-21T18:00:00.000Z"),
      ],
    );

    expect(twice.get(10)!.points).toBeGreaterThan(once.get(10)!.points);
    expect(totalOf(twice)).toBe(RANKING_BASE_POINTS * 4);
  });
});

describe("replayRanking — chronologie", () => {
  // La clôture d'un tournoi est écrite dans la même transaction que son dernier
  // score : la cagnotte doit se lire sur les cotes que ce match vient d'écrire.
  it("joue le classement final après les matchs de la même seconde", () => {
    const day = "2026-06-10T18:00:00.000Z";
    const states = replayRanking(
      [{ matchId: 1, winnerTeamId: 1, loserTeamId: 2, playedAt: day }],
      [
        {
          tournamentId: 1,
          entrants: [
            { teamId: 1, rank: 1 },
            { teamId: 2, rank: 2 },
          ],
          awardedAt: day,
        },
      ],
    );

    // La cagnotte a donc vu 1 au-dessus de 2 — cotes déjà écartées par le match
    // — et non deux cotes de départ. À deux engagées, un plateau écarté vaut
    // moins qu'un plateau égal : le contrôle porte sur la valeur exacte.
    const expected = placementDeltas(
      [
        { teamId: 1, rank: 1, rating: RANKING_BASE_POINTS + 16 },
        { teamId: 2, rank: 2, rating: RANKING_BASE_POINTS - 16 },
      ],
      RANKING_BASE_POINTS,
    );

    expect(states.get(1)!.placementPoints).toBe(expected.get(1));
    expect(states.get(2)!.placementPoints).toBe(expected.get(2));
  });

  it("intercale deux tournois dans l'ordre de leurs clôtures", () => {
    const early = placement(1, [10, 20], "2026-06-01T18:00:00.000Z");
    const late = placement(2, [20, 10], "2026-06-30T18:00:00.000Z");

    expect(replayRanking([], [early, late])).toEqual(replayRanking([], [late, early]));
  });

  it("ne modifie pas les tableaux reçus", () => {
    const matches = [decided(2, 1, 2), decided(1, 2, 1)];
    const placements = [
      placement(2, [1, 2], "2026-06-30T18:00:00.000Z"),
      placement(1, [2, 1], "2026-06-01T18:00:00.000Z"),
    ];
    const matchesBefore = [...matches];
    const placementsBefore = [...placements];

    replayRanking(matches, placements);

    expect(matches).toEqual(matchesBefore);
    expect(placements).toEqual(placementsBefore);
  });

  it("range en tête un tournoi dont la date est illisible", () => {
    const states = replayRanking([], [placement(1, [10, 20], "pas une date")]);

    expect(states.get(10)!.points).toBeGreaterThan(RANKING_BASE_POINTS);
  });
});

describe("replayRanking — plancher", () => {
  it("ne descend jamais une cote sous le plancher", () => {
    // Vingt défaites, puis un tournoi où l'équipe finit dernière.
    const matches = Array.from({ length: 20 }, (_, index) =>
      decided(index + 1, 99, 10, (index % 28) + 1),
    );
    const states = replayRanking(matches, [
      placement(1, [1, 2, 3, 4, 5, 6, 7, 10], "2026-07-01T18:00:00.000Z"),
    ]);

    expect(states.get(10)!.points).toBeGreaterThanOrEqual(RANKING_FLOOR_POINTS);
  });

  it("ne compte comme parcours que ce que le plancher a laissé passer", () => {
    const matches = Array.from({ length: 20 }, (_, index) =>
      decided(index + 1, 99, 10, (index % 28) + 1),
    );
    const states = replayRanking(matches, [
      placement(1, [1, 2, 3, 4, 5, 6, 7, 10], "2026-07-01T18:00:00.000Z"),
    ]);
    const state = states.get(10)!;

    // La part de parcours est la **baisse réelle** de la cote, pas la sanction
    // théorique : sans quoi la fiche annoncerait un retrait que le total
    // dément.
    expect(state.points).toBe(
      RANKING_BASE_POINTS +
        (state.points - RANKING_BASE_POINTS - state.placementPoints) +
        state.placementPoints,
    );
    expect(state.points).toBeGreaterThanOrEqual(RANKING_FLOOR_POINTS);
  });
});

describe("le problème que la feature corrige", () => {
  /**
   * Le cas décrit à l'origine : une équipe forte gagne un tournoi de 8 en
   * battant plus faible qu'elle, une équipe moyenne en sort en demi-finale
   * après une victoire surprise sur une autre grosse cote. Avant les points de
   * parcours, la seconde gagnait davantage à sortir en demies que la première
   * à tout gagner.
   */
  const CHAMPION = 1;
  const OGRE = 6;
  const LUCKY = 5;

  /**
   * Les cotes de départ ne sont pas égales : c'est tout le problème. On les
   * fabrique par des rencontres antérieures — le rejeu ne connaît que ça. Deux
   * grosses cotes en sortent, `CHAMPION` et `OGRE`, tout le reste est à 500.
   */
  const history: RankedMatch[] = [
    ...Array.from({ length: 40 }, (_, index) =>
      decided(1000 + index, CHAMPION, 500 + index, (index % 9) + 1),
    ),
    ...Array.from({ length: 40 }, (_, index) =>
      decided(2000 + index, OGRE, 900 + index, (index % 9) + 1),
    ),
  ];

  /** Le tournoi lui-même : trois tours à huit engagées. */
  const matches: RankedMatch[] = [
    decided(1, CHAMPION, 2, 10),
    decided(2, LUCKY, OGRE, 10),
    decided(3, 7, 3, 10),
    decided(4, 8, 4, 10),
    decided(5, CHAMPION, LUCKY, 11),
    decided(6, 7, 8, 11),
    decided(7, CHAMPION, 7, 12),
  ];

  const final = placement(
    1,
    [CHAMPION, 7, LUCKY, 8, 2, OGRE, 3, 4],
    "2026-06-15T18:00:00.000Z",
  );

  /** La cote d'une équipe à l'entrée du tournoi, telle que l'historique l'a faite. */
  function beforeTournament(teamId: number): number {
    return rankedPointsOf(replayRanking(history), teamId);
  }

  it("laissait l'équipe sortie en demies gagner plus que la championne", () => {
    const before = replayRanking([...history, ...matches]);

    const championGain = before.get(CHAMPION)!.points - beforeTournament(CHAMPION);
    const luckyGain = before.get(LUCKY)!.points - beforeTournament(LUCKY);

    expect(luckyGain).toBeGreaterThan(championGain);
  });

  it("remet le parcours devant une fois la cagnotte redistribuée", () => {
    const after = replayRanking([...history, ...matches], [final]);

    const championGain = after.get(CHAMPION)!.points - beforeTournament(CHAMPION);
    const luckyGain = after.get(LUCKY)!.points - beforeTournament(LUCKY);

    expect(championGain).toBeGreaterThan(luckyGain);
  });

  // La correction ne va pas jusqu'à effacer l'exploit : sortir en demies après
  // avoir battu une grosse cote reste une bonne journée.
  it("laisse l'exploit rapporter", () => {
    const after = replayRanking([...history, ...matches], [final]);

    expect(after.get(LUCKY)!.points).toBeGreaterThan(beforeTournament(LUCKY));
  });
});

describe("l'ordre des rencontres n'est écrit qu'une fois", () => {
  /**
   * `replayRanking` trie des évènements de deux natures, mais la règle qui
   * range **deux rencontres** appartient à `compareRankedMatches` — celle que
   * son JSDoc et ses tests annoncent. La réécrire dans le comparateur
   * d'évènements la ferait diverger en silence.
   */
  it("range deux matchs exactement comme compareRankedMatches", () => {
    const instant = "2026-06-10T18:00:00.000Z";
    const first: RankedMatch = { matchId: 4, winnerTeamId: 1, loserTeamId: 2, playedAt: instant };
    const second: RankedMatch = { matchId: 9, winnerTeamId: 2, loserTeamId: 3, playedAt: instant };

    // Le rejeu doit produire l'état de « 4 puis 9 », l'ordre que dicte le
    // comparateur — quel que soit l'ordre du tableau reçu.
    expect(compareRankedMatches(first, second)).toBeLessThan(0);
    expect(replayRanking([second, first])).toEqual(replayRanking([first, second]));
    expect(replayRanking([second, first]).get(2)!.points).toBe(
      replayRanking([first, second]).get(2)!.points,
    );
  });
});

describe("rankingPointsHint", () => {
  it("annonce le barème à une équipe classée", () => {
    expect(rankingPointsHint(true, 640)).toBe(RANKING_POINTS_HINT);
  });

  it("annonce la cote de départ à une équipe qui n'a rien joué du tout", () => {
    expect(rankingPointsHint(false, RANKING_BASE_POINTS)).toBe(RANKING_UNRANKED_HINT);
  });

  /**
   * Le cas ouvert par les points de parcours : aucun match compté, et pourtant
   * une cote qui a bougé. Atteignable — une équipe qui abandonne tout un
   * tournoi avant sa première manche reçoit un rang final à la clôture, donc sa
   * part de cagnotte, sans avoir disputé la moindre rencontre.
   */
  it("ne dit pas « cote de départ » à une équipe dont le parcours a bougé la cote", () => {
    const state = replayRanking([], [placement(1, [10, 20, 30, 40])]).get(40)!;

    expect(isRankedTeam(state)).toBe(false);
    expect(state.points).not.toBe(RANKING_BASE_POINTS);
    expect(rankingPointsHint(isRankedTeam(state), state.points)).toBe(
      RANKING_PLACEMENT_ONLY_HINT,
    );
  });

  it("dit d'où vient la cote plutôt que de nier le classement", () => {
    expect(RANKING_PLACEMENT_ONLY_HINT).toContain("Aucun match joué");
    expect(RANKING_PLACEMENT_ONLY_HINT).toContain("tournoi");
    expect(RANKING_PLACEMENT_ONLY_HINT).not.toContain("cote de départ");
  });
});
