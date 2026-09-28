import { describe, expect, it } from "@jest/globals";
import {
  isScoreEditLocked,
  lockedScoreMatchIds,
  type MatchScoreState,
} from "@/lib/shared/match-lock";
import type { PhaseFormat, TournamentFormat } from "@/lib/shared/types";

/**
 * `lockedScoreMatchIds` : la règle de `isScoreEditLocked`, calculée en une
 * passe pour tout le plateau. `isScoreEditLocked` fait foi — les deux sont
 * confrontées sur des plateaux entiers, tirés au hasard (graine fixe) pour
 * couvrir ce qu'une poignée de cas écrits à la main laisserait passer : chaînes
 * d'exemptions, doubles forfaits, liens vers une autre phase, rangs de phase
 * mêlés.
 */

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
    decided: false,
    hasPendingReport: false,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
    ...overrides,
  };
}

/** Réponse de référence : la règle match par match. */
function reference(
  all: MatchScoreState[],
  format: TournamentFormat,
  phaseFormat?: PhaseFormat,
): Set<number> {
  return new Set(
    all.filter((m) => isScoreEditLocked(m, all, format, phaseFormat)).map((m) => m.id),
  );
}

describe("lockedScoreMatchIds — cas écrits", () => {
  it("ne verrouille rien sur un plateau vierge", () => {
    const all = [match({ id: 1, nextWinnerMatchId: 2 }), match({ id: 2, roundNumber: 2 })];
    expect(lockedScoreMatchIds(all, "SINGLE")).toEqual(new Set());
  });

  it("verrouille en élimination le match dont la cible porte une saisie", () => {
    const all = [
      match({ id: 1, decided: true, winnerTeamId: 10, nextWinnerMatchId: 3 }),
      match({ id: 2, decided: true, winnerTeamId: 30, nextWinnerMatchId: 3 }),
      match({ id: 3, roundNumber: 2, team1Id: 10, team2Id: 30, team1Score: 1 }),
      match({ id: 4, decided: true, winnerTeamId: 50 }),
    ];
    expect(lockedScoreMatchIds(all, "SINGLE")).toEqual(new Set([1, 2]));
  });

  it("traverse une exemption résolue par le moteur jusqu'à la rencontre disputée", () => {
    const all = [
      match({ id: 1, decided: true, doubleForfeit: true, nextWinnerMatchId: 2 }),
      // Exemption : une seule équipe, close d'office, aucune saisie.
      match({ id: 2, roundNumber: 2, team1Id: null, decided: true, winnerTeamId: 20, nextWinnerMatchId: 3 }),
      match({ id: 3, roundNumber: 3, hasPendingReport: true }),
    ];
    // L'exemption elle-même est tranchée et mène à la saisie : verrouillée aussi.
    expect(lockedScoreMatchIds(all, "SINGLE")).toEqual(new Set([1, 2]));
    expect(reference(all, "SINGLE")).toEqual(new Set([1, 2]));
  });

  it("verrouille en format à classement tout match tranché avant la dernière manche saisie", () => {
    const all = [
      match({ id: 1, decided: true, winnerTeamId: 10 }),
      match({ id: 2, decided: true, winnerTeamId: 20, roundNumber: 2 }),
      match({ id: 3, roundNumber: 3 }),
    ];
    for (const format of ["SURVIVAL", "SWISS", "BG_SURVIE"] as const) {
      expect(lockedScoreMatchIds(all, format)).toEqual(new Set([1]));
    }
  });

  it("verrouille une phase dès qu'une phase ultérieure porte une saisie", () => {
    const all = [
      match({ id: 1, phasePosition: 1, decided: true, winnerTeamId: 10 }),
      match({ id: 2, phasePosition: 2, team1Score: 0, team2Score: 0 }),
    ];
    expect(lockedScoreMatchIds(all, "MULTI", "SWISS")).toEqual(new Set([1]));
  });

  it("ignore un lien de bracket vers une autre phase", () => {
    const all = [
      match({ id: 1, phasePosition: 2, decided: true, winnerTeamId: 10, nextWinnerMatchId: 2 }),
      match({ id: 2, phasePosition: 1, winnerTeamId: 10, decided: true }),
    ];
    expect(lockedScoreMatchIds(all, "MULTI", "SINGLE")).toEqual(reference(all, "MULTI", "SINGLE"));
    expect(lockedScoreMatchIds(all, "MULTI", "SINGLE").has(1)).toBe(false);
  });

  it("n'est pas piégé par un lien qui boucle", () => {
    const all = [
      match({ id: 1, decided: true, winnerTeamId: 10, nextWinnerMatchId: 2 }),
      match({ id: 2, team1Id: null, decided: true, winnerTeamId: 20, nextWinnerMatchId: 1 }),
    ];
    expect(lockedScoreMatchIds(all, "DOUBLE")).toEqual(reference(all, "DOUBLE"));
  });
});

/** Générateur congruentiel : des plateaux aléatoires, mais reproductibles. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomBoard(random: () => number, size: number, withPhases: boolean): MatchScoreState[] {
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const board: MatchScoreState[] = [];
  for (let id = 1; id <= size; id += 1) {
    const team1Id = random() < 0.15 ? null : 10 + id;
    const team2Id = random() < 0.15 ? null : 500 + id;
    const kind = pick(["blank", "score", "winner", "forfeit", "double", "pending", "draw"] as const);
    board.push(
      match({
        id,
        roundNumber: 1 + Math.floor(random() * 5),
        team1Id,
        team2Id,
        team1Score: kind === "score" || kind === "draw" ? 1 : null,
        team2Score: kind === "score" ? 0 : kind === "draw" ? 1 : null,
        winnerTeamId: kind === "winner" ? team1Id : null,
        forfeitTeamId: kind === "forfeit" ? team2Id : null,
        doubleForfeit: kind === "double",
        decided: kind !== "blank" && kind !== "pending" && kind !== "score" ? true : random() < 0.2,
        hasPendingReport: kind === "pending",
        // Liens vers n'importe quel match, cycles et identifiants absents compris.
        nextWinnerMatchId: random() < 0.6 ? 1 + Math.floor(random() * (size + 2)) : null,
        nextLoserMatchId: random() < 0.3 ? 1 + Math.floor(random() * (size + 2)) : null,
        phaseId: withPhases ? 1 + Math.floor(random() * 3) : undefined,
        phasePosition: withPhases && random() < 0.5 ? 1 + Math.floor(random() * 3) : undefined,
      }),
    );
  }
  return board;
}

describe("lockedScoreMatchIds — équivalence avec isScoreEditLocked", () => {
  const cases: Array<[TournamentFormat, PhaseFormat | undefined]> = [
    ["SINGLE", undefined],
    ["DOUBLE", undefined],
    ["SWISS", undefined],
    ["SURVIVAL", undefined],
    ["BG_SURVIE", undefined],
    ["MULTI", undefined],
    ["MULTI", "SINGLE"],
    ["MULTI", "DOUBLE"],
    ["MULTI", "SWISS"],
    ["MULTI", "SURVIVAL"],
  ];

  it.each(cases)("rend exactement la règle match par match — %s / %s", (format, phaseFormat) => {
    const random = lcg(format.length * 7919 + (phaseFormat?.length ?? 0));
    for (let trial = 0; trial < 150; trial += 1) {
      const board = randomBoard(random, 2 + Math.floor(random() * 30), random() < 0.5);
      expect(lockedScoreMatchIds(board, format, phaseFormat)).toEqual(
        reference(board, format, phaseFormat),
      );
    }
  });

  it("reste linéaire sur un grand plateau (512 matchs chaînés)", () => {
    const board: MatchScoreState[] = [];
    for (let id = 1; id <= 512; id += 1) {
      board.push(
        match({
          id,
          roundNumber: id,
          decided: true,
          winnerTeamId: 10,
          nextWinnerMatchId: id < 512 ? id + 1 : null,
        }),
      );
    }
    expect(lockedScoreMatchIds(board, "SINGLE")).toEqual(reference(board, "SINGLE"));
    expect(lockedScoreMatchIds(board, "SINGLE").size).toBe(511);
  });
});
