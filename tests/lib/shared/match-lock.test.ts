import { describe, expect, it } from "@jest/globals";
import {
  dependentMatches,
  fromBracketMatch,
  hasScoreInput,
  isScoreEditLocked,
  type MatchScoreState,
} from "@/lib/shared/match-lock";
import type { BracketMatch } from "@/lib/shared/types";

function match(overrides: Partial<MatchScoreState> = {}): MatchScoreState {
  return {
    id: 1,
    roundNumber: 1,
    team1Id: 10,
    team2Id: 20,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    hasPendingReport: false,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
    ...overrides,
  };
}

describe("match-lock — détection d'une saisie de score", () => {
  it("ne voit aucune saisie sur un match vierge", () => {
    expect(hasScoreInput(match())).toBe(false);
  });

  it("compte un score, même partiel, même nul", () => {
    expect(hasScoreInput(match({ team1Score: 2, team2Score: 1 }))).toBe(true);
    expect(hasScoreInput(match({ team1Score: 0, team2Score: 0 }))).toBe(true);
    expect(hasScoreInput(match({ team1Score: 1 }))).toBe(true);
    expect(hasScoreInput(match({ team2Score: 3 }))).toBe(true);
  });

  it("compte un vainqueur, un forfait et un report en attente", () => {
    expect(hasScoreInput(match({ winnerTeamId: 10 }))).toBe(true);
    expect(hasScoreInput(match({ forfeitTeamId: 20 }))).toBe(true);
    expect(hasScoreInput(match({ hasPendingReport: true }))).toBe(true);
  });

  it("ignore les byes et les matchs fantômes, dont le score est posé par le moteur", () => {
    // Bye : une seule équipe, victoire d'office 1-0
    expect(hasScoreInput(match({ team2Id: null, team1Score: 1, team2Score: 0, winnerTeamId: 10 }))).toBe(
      false,
    );
    // Match fantôme : aucune équipe, 0-0
    expect(
      hasScoreInput(match({ team1Id: null, team2Id: null, team1Score: 0, team2Score: 0 })),
    ).toBe(false);
  });
});

describe("match-lock — matchs dépendants", () => {
  const upstream = match({ id: 1, nextWinnerMatchId: 5, nextLoserMatchId: 6 });
  const all = [upstream, match({ id: 5, roundNumber: 2 }), match({ id: 6, roundNumber: 2 }), match({ id: 7, roundNumber: 2 })];

  it("suit les liens de bracket en élimination simple et double", () => {
    for (const format of ["SINGLE", "DOUBLE"] as const) {
      const ids = dependentMatches(upstream, all, format).map((m) => m.id);
      expect(ids.sort()).toEqual([5, 6]);
    }
  });

  it("ne dépend de rien quand le match n'a pas de suite (finale)", () => {
    const final = match({ id: 9, roundNumber: 4 });
    expect(dependentMatches(final, all, "SINGLE")).toEqual([]);
  });

  it("prend tous les rounds ultérieurs en survie et en ronde suisse", () => {
    for (const format of ["SURVIVAL", "SWISS"] as const) {
      const ids = dependentMatches(match({ id: 1, roundNumber: 1 }), all, format).map((m) => m.id);
      expect(ids.sort()).toEqual([5, 6, 7]);
    }
  });

  it("ne considère pas les matchs du même round comme dépendants", () => {
    const sameRound = [match({ id: 1, roundNumber: 2 }), match({ id: 2, roundNumber: 2, team1Score: 2 })];
    expect(dependentMatches(sameRound[0], sameRound, "SURVIVAL")).toEqual([]);
  });
});

describe("match-lock — verrouillage de l'édition", () => {
  it("laisse modifiable un match encore indécis (première saisie)", () => {
    const undecided = match({ id: 1, nextWinnerMatchId: 5 });
    const all = [undecided, match({ id: 5, roundNumber: 2, team1Score: 2, team2Score: 1, winnerTeamId: 10 })];
    expect(isScoreEditLocked(undecided, all, "SINGLE")).toBe(false);
  });

  it("laisse modifiable tant que la manche suivante n'a aucune saisie", () => {
    const decided = match({ id: 1, winnerTeamId: 10, team1Score: 2, team2Score: 1, nextWinnerMatchId: 5 });
    const all = [decided, match({ id: 5, roundNumber: 2 })];
    expect(isScoreEditLocked(decided, all, "SINGLE")).toBe(false);
  });

  it("verrouille dès qu'un match suivant porte une saisie", () => {
    const decided = match({ id: 1, winnerTeamId: 10, team1Score: 2, team2Score: 1, nextWinnerMatchId: 5 });

    for (const dependent of [
      match({ id: 5, roundNumber: 2, team1Score: 1 }),
      match({ id: 5, roundNumber: 2, team1Score: 0, team2Score: 0 }),
      match({ id: 5, roundNumber: 2, winnerTeamId: 10 }),
      match({ id: 5, roundNumber: 2, forfeitTeamId: 20 }),
      match({ id: 5, roundNumber: 2, hasPendingReport: true }),
    ]) {
      expect(isScoreEditLocked(decided, [decided, dependent], "SINGLE")).toBe(true);
    }
  });

  it("verrouille aussi via le tableau des perdants en double élimination", () => {
    const decided = match({ id: 1, winnerTeamId: 10, nextWinnerMatchId: 5, nextLoserMatchId: 6 });
    const all = [
      decided,
      match({ id: 5, roundNumber: 2 }),
      match({ id: 6, roundNumber: 2, team1Score: 2, team2Score: 0 }),
    ];
    expect(isScoreEditLocked(decided, all, "DOUBLE")).toBe(true);
  });

  it("verrouille un round de survie dès que le round suivant a un score", () => {
    const barrage = match({ id: 1, roundNumber: 1, winnerTeamId: 10 });
    const nextRound = [
      match({ id: 2, roundNumber: 2 }),
      match({ id: 3, roundNumber: 2, team1Score: 2, team2Score: 1, winnerTeamId: 10 }),
    ];
    expect(isScoreEditLocked(barrage, [barrage, ...nextRound], "SURVIVAL")).toBe(true);
    // Round 2 encore vierge : la correction du barrage reste possible
    expect(isScoreEditLocked(barrage, [barrage, nextRound[0]], "SURVIVAL")).toBe(false);
  });

  it("ne verrouille pas sur un bye du round suivant", () => {
    const decided = match({ id: 1, roundNumber: 1, winnerTeamId: 10 });
    const bye = match({ id: 2, roundNumber: 2, team2Id: null, team1Score: 1, team2Score: 0, winnerTeamId: 10 });
    expect(isScoreEditLocked(decided, [decided, bye], "SURVIVAL")).toBe(false);
  });
});

describe("match-lock — adaptation depuis BracketMatch", () => {
  const base: BracketMatch = {
    id: 3,
    tournamentId: 1,
    bracket: "UPPER",
    roundNumber: 2,
    matchNumber: 1,
    status: "READY",
    team1Id: 10,
    team2Id: 20,
    team1Name: "A",
    team2Name: "B",
    team1Placeholder: null,
    team2Placeholder: null,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    loserTeamId: null,
    forfeitTeamId: null,
    nextWinnerMatchId: 9,
    nextWinnerSlot: 1,
    nextLoserMatchId: null,
    nextLoserSlot: null,
    scoreDeadlineAt: null,
    updatedAt: "2026-08-16T10:00:00.000Z",
  };

  it("reporte les identifiants et les liens", () => {
    const state = fromBracketMatch(base);
    expect(state.id).toBe(3);
    expect(state.roundNumber).toBe(2);
    expect(state.nextWinnerMatchId).toBe(9);
    expect(state.hasPendingReport).toBe(false);
  });

  it("traduit AWAITING_CONFIRMATION en report en attente", () => {
    expect(fromBracketMatch({ ...base, status: "AWAITING_CONFIRMATION" }).hasPendingReport).toBe(true);
    expect(hasScoreInput(fromBracketMatch({ ...base, status: "AWAITING_CONFIRMATION" }))).toBe(true);
  });
});
