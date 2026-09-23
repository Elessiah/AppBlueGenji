import { describe, expect, it } from "@jest/globals";
import {
  appendSequentialRanks,
  multiTournamentRanks,
  podiumRanks,
  type PodiumMatch,
} from "@/lib/shared/double-forfeit";
import { isMatchDoubleForfeit, isMatchDrawn } from "@/lib/shared/match-outcome";
import {
  dependentMatches,
  hasScoreInput,
  isScoreEditLocked,
  type MatchScoreState,
} from "@/lib/shared/match-lock";
import { placementShares } from "@/lib/shared/tournament-placement";

function played(winner: number, loser: number): PodiumMatch {
  return { team1Id: winner, team2Id: loser, winnerTeamId: winner, loserTeamId: loser, doubleForfeit: false };
}

function doubleForfeit(team1: number, team2: number): PodiumMatch {
  return { team1Id: team1, team2Id: team2, winnerTeamId: null, loserTeamId: null, doubleForfeit: true };
}

describe("podiumRanks — rangs d'un podium", () => {
  it("attribue 1 et 2 à une finale jouée, comme avant le double forfait", () => {
    expect(podiumRanks([played(7, 8)])).toEqual({
      entries: [
        { teamId: 7, rank: 1 },
        { teamId: 8, rank: 2 },
      ],
      nextRank: 3,
    });
  });

  it("ne fait pas de championne sur une finale close en double forfait", () => {
    const podium = podiumRanks([doubleForfeit(7, 8)]);
    expect(podium.entries).toEqual([
      { teamId: 7, rank: 2 },
      { teamId: 8, rank: 2 },
    ]);
    expect(podium.entries.some((entry) => entry.rank === 1)).toBe(false);
    // Les deux places sont consommées : la suivante est 3ᵉ.
    expect(podium.nextRank).toBe(3);
  });

  it("laisse la 3ᵉ place vacante sur une petite finale en double forfait", () => {
    const podium = podiumRanks([played(1, 2), doubleForfeit(3, 4)]);
    expect(podium.entries).toEqual([
      { teamId: 1, rank: 1 },
      { teamId: 2, rank: 2 },
      { teamId: 3, rank: 4 },
      { teamId: 4, rank: 4 },
    ]);
    expect(podium.nextRank).toBe(5);
  });

  it("ignore une rencontre absente ou sans résultat", () => {
    expect(podiumRanks([null, undefined])).toEqual({ entries: [], nextRank: 1 });
    expect(
      podiumRanks([
        { team1Id: null, team2Id: null, winnerTeamId: null, loserTeamId: null, doubleForfeit: false },
      ]),
    ).toEqual({ entries: [], nextRank: 1 });
  });

  const byeFinal: PodiumMatch = {
    team1Id: 5,
    team2Id: null,
    winnerTeamId: 5,
    loserTeamId: null,
    doubleForfeit: false,
  };

  it("laisse la 2ᵉ place vacante derrière une finale gagnée par exemption", () => {
    // L'autre demi-finale a été close en double forfait : la finale est une
    // exemption, et la gagnante de la petite finale reste 3ᵉ.
    const podium = podiumRanks(
      [
        byeFinal,
        { team1Id: 6, team2Id: null, winnerTeamId: 6, loserTeamId: null, doubleForfeit: false },
      ],
      { byeLeavesVacancy: true },
    );
    expect(podium).toEqual({
      entries: [
        { teamId: 5, rank: 1 },
        { teamId: 6, rank: 3 },
      ],
      nextRank: 5,
    });
  });

  it("garde la numérotation d'avant pour une exemption structurelle", () => {
    // La « finale » d'une phase tronquée peut être une exemption, sans aucun
    // double forfait : pas de trou dans les rangs.
    expect(podiumRanks([byeFinal])).toEqual({
      entries: [{ teamId: 5, rank: 1 }],
      nextRank: 2,
    });
  });

  it("n'attribue rien à un double forfait sans engagée", () => {
    expect(podiumRanks([doubleForfeit(null as unknown as number, null as unknown as number)]))
      .toEqual({ entries: [], nextRank: 1 });
  });

  it("donne aux finalistes d'un double forfait la part des deux premières places", () => {
    // Le calcul des points de parcours ne lit que l'ordre : 2, 2, 3 se lit comme
    // un ex æquo aux deux premières places, puis une 3ᵉ.
    const ranks = appendSequentialRanks(podiumRanks([doubleForfeit(1, 2)]), [3]).map(
      (entry) => entry.rank,
    );
    const shares = placementShares(ranks);
    expect(shares[0]).toBeCloseTo(shares[1]);
    expect(shares[0]).toBeGreaterThan(shares[2]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });
});

describe("appendSequentialRanks", () => {
  it("numérote le reste à partir de la première place libre, sans doublon", () => {
    expect(appendSequentialRanks(podiumRanks([doubleForfeit(1, 2)]), [2, 3, 4, 3])).toEqual([
      { teamId: 1, rank: 2 },
      { teamId: 2, rank: 2 },
      { teamId: 3, rank: 3 },
      { teamId: 4, rank: 4 },
    ]);
  });
});

describe("multiTournamentRanks — rangs d'un tournoi multi-phases", () => {
  it("numérote à la suite un ordre sans ex æquo", () => {
    expect(
      multiTournamentRanks([
        { phaseReached: 2, phaseRank: 1 },
        { phaseReached: 2, phaseRank: 2 },
        { phaseReached: 1, phaseRank: 3 },
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("garde la place vacante et l'ex æquo d'une finale en double forfait", () => {
    expect(
      multiTournamentRanks([
        { phaseReached: 2, phaseRank: 2 },
        { phaseReached: 2, phaseRank: 2 },
        { phaseReached: 2, phaseRank: 3 },
        { phaseReached: 1, phaseRank: 1 },
        { phaseReached: 1, phaseRank: 2 },
      ]),
    ).toEqual([2, 2, 3, 4, 5]);
  });

  it("garde un ex æquo dans une phase antérieure", () => {
    expect(
      multiTournamentRanks([
        { phaseReached: 2, phaseRank: 1 },
        { phaseReached: 1, phaseRank: 2 },
        { phaseReached: 1, phaseRank: 2 },
        { phaseReached: 1, phaseRank: 3 },
      ]),
    ).toEqual([1, 2, 2, 4]);
  });

  it("ne reprend pas un rang manquant (999) tel quel", () => {
    expect(
      multiTournamentRanks([
        { phaseReached: 1, phaseRank: 999 },
        { phaseReached: 1, phaseRank: 1000 },
      ]),
    ).toEqual([1, 2]);
  });

  it("rend une liste vide pour un tournoi sans engagée", () => {
    expect(multiTournamentRanks([])).toEqual([]);
  });
});

const BASE = {
  status: "COMPLETED" as const,
  winnerTeamId: null,
  forfeitTeamId: null,
  team1Id: 1,
  team2Id: 2,
};

describe("isMatchDoubleForfeit / isMatchDrawn", () => {
  it("reconnaît un double forfait tranché", () => {
    expect(isMatchDoubleForfeit({ ...BASE, doubleForfeit: true })).toBe(true);
  });

  it("n'annonce rien sur une ligne rouverte qui garderait le drapeau", () => {
    expect(isMatchDoubleForfeit({ ...BASE, status: "READY", doubleForfeit: true })).toBe(false);
  });

  it("ne lit jamais un double forfait comme un match nul", () => {
    expect(isMatchDrawn({ ...BASE, doubleForfeit: true })).toBe(false);
    expect(isMatchDrawn({ ...BASE, doubleForfeit: false })).toBe(true);
    // Vue sans le champ : lecture d'avant le double forfait.
    expect(isMatchDrawn(BASE)).toBe(true);
  });
});

function state(overrides: Partial<MatchScoreState> & { id: number }): MatchScoreState {
  return {
    roundNumber: 1,
    team1Id: 1,
    team2Id: 2,
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

describe("verrou — le double forfait est une saisie", () => {
  it("compte comme une saisie, sans score ni vainqueur", () => {
    expect(hasScoreInput(state({ id: 1, decided: true, doubleForfeit: true }))).toBe(true);
    expect(hasScoreInput(state({ id: 1, decided: true }))).toBe(false);
  });

  it("verrouille la manche amont d'une ronde suisse", () => {
    const upstream = state({ id: 1, decided: true, winnerTeamId: 1 });
    const downstream = state({ id: 2, roundNumber: 2, decided: true, doubleForfeit: true });
    expect(isScoreEditLocked(upstream, [upstream, downstream], "SWISS")).toBe(true);
  });
});

describe("verrou — cascade à travers les exemptions d'un tableau", () => {
  // A (double forfait) → M, exemption close d'office pour X (team2 vide)
  // → N, que X dispute contre Y.
  const a = state({ id: 1, decided: true, doubleForfeit: true, nextWinnerMatchId: 2 });
  const byeMatch = state({
    id: 2,
    roundNumber: 2,
    team1Id: 10,
    team2Id: null,
    team1Score: 1,
    team2Score: 0,
    winnerTeamId: 10,
    decided: true,
    nextWinnerMatchId: 3,
  });

  it("traverse l'exemption jusqu'à la rencontre suivante", () => {
    const next = state({ id: 3, roundNumber: 3, team1Id: 10, team2Id: 20 });
    expect(dependentMatches(a, [a, byeMatch, next], "SINGLE").map((m) => m.id)).toEqual([2, 3]);
  });

  it("verrouille quand la rencontre au bout de la chaîne a été jouée", () => {
    const next = state({
      id: 3,
      roundNumber: 3,
      team1Id: 10,
      team2Id: 20,
      team1Score: 2,
      team2Score: 0,
      winnerTeamId: 10,
      decided: true,
    });
    expect(isScoreEditLocked(a, [a, byeMatch, next], "SINGLE")).toBe(true);
  });

  it("laisse corriger tant que rien n'a été disputé derrière l'exemption", () => {
    const next = state({ id: 3, roundNumber: 3, team1Id: 10, team2Id: null });
    expect(isScoreEditLocked(a, [a, byeMatch, next], "SINGLE")).toBe(false);
  });

  it("traverse un match fantôme (deux créneaux vides) de la même façon", () => {
    const ghost = state({
      id: 2,
      roundNumber: 2,
      team1Id: null,
      team2Id: null,
      team1Score: 0,
      team2Score: 0,
      decided: true,
      nextWinnerMatchId: 3,
    });
    const next = state({ id: 3, roundNumber: 3, team1Id: 30, team2Id: 40, hasPendingReport: true });
    expect(isScoreEditLocked(a, [a, ghost, next], "SINGLE")).toBe(true);
  });

  it("s'arrête à une rencontre disputée, sans aller plus loin", () => {
    const played = state({ id: 2, roundNumber: 2, decided: false, nextWinnerMatchId: 3 });
    const far = state({ id: 3, roundNumber: 3, decided: true, winnerTeamId: 1 });
    expect(dependentMatches(a, [a, played, far], "SINGLE").map((m) => m.id)).toEqual([2]);
  });

  it("ne boucle pas sur un lien circulaire", () => {
    const loopA = state({ id: 1, decided: true, nextWinnerMatchId: 2 });
    const loopB = state({ id: 2, team2Id: null, decided: true, nextWinnerMatchId: 1 });
    expect(dependentMatches(loopA, [loopA, loopB], "SINGLE").map((m) => m.id)).toEqual([2]);
  });
});
