import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";
import { readSource } from "../helpers/read-source";

/**
 * Verrous de score du plateau, calculés une fois par instantané : chaque carte
 * de match pose la question, toutes avec la même liste `detail.matches`.
 */

jest.mock("@/lib/shared/match-lock", () => {
  const actual = jest.requireActual<typeof import("@/lib/shared/match-lock")>("@/lib/shared/match-lock");
  return { ...actual, lockedScoreMatchIds: jest.fn(actual.lockedScoreMatchIds) };
});

import { lockedScoreMatchIds } from "@/lib/shared/match-lock";
import { isMatchScoreLocked } from "@/app/(secured)/tournois/[id]/_lib/score-lock";

const computeSpy = jest.mocked(lockedScoreMatchIds);

function board(): BracketMatch[] {
  return [
    bracketMatch({ id: 1, team1Id: 1, team2Id: 2, status: "COMPLETED", winnerTeamId: 1, nextWinnerMatchId: 3 }),
    bracketMatch({ id: 2, team1Id: 3, team2Id: 4, status: "COMPLETED", winnerTeamId: 3, nextWinnerMatchId: 3 }),
    bracketMatch({ id: 3, roundNumber: 2, team1Id: 1, team2Id: 3, status: "AWAITING_CONFIRMATION" }),
  ];
}

describe("isMatchScoreLocked", () => {
  beforeEach(() => {
    computeSpy.mockClear();
  });

  it("dit si le score d'un match est verrouillé", () => {
    const matches = board();
    expect(isMatchScoreLocked(1, matches, "SINGLE")).toBe(true);
    expect(isMatchScoreLocked(2, matches, "SINGLE")).toBe(true);
    expect(isMatchScoreLocked(3, matches, "SINGLE")).toBe(false);
    expect(isMatchScoreLocked(99, matches, "SINGLE")).toBe(false);
  });

  it("ne calcule qu'une fois pour toutes les cartes d'un même instantané", () => {
    const matches = board();
    for (const m of matches) isMatchScoreLocked(m.id, matches, "SINGLE");
    expect(computeSpy).toHaveBeenCalledTimes(1);
  });

  it("recalcule pour un nouvel instantané — une liste neuve", () => {
    const first = board();
    isMatchScoreLocked(1, first, "SINGLE");
    const next = board().map((m) => (m.id === 3 ? { ...m, status: "PENDING" as const } : m));
    expect(isMatchScoreLocked(1, next, "SINGLE")).toBe(false);
    expect(computeSpy).toHaveBeenCalledTimes(2);
  });

  it("distingue les formats lus sur une même liste", () => {
    const matches = board();
    // En format à classement, aucun lien : la manche 2 verrouille la 1 aussi.
    expect(isMatchScoreLocked(1, matches, "SWISS")).toBe(true);
    expect(isMatchScoreLocked(1, matches, "SINGLE")).toBe(true);
    isMatchScoreLocked(2, matches, "SWISS");
    expect(computeSpy).toHaveBeenCalledTimes(2);
  });
});

describe("câblage dans les vues du plateau", () => {
  const row = readSource("app/(secured)/tournois/[id]/_components/MatchRow.tsx");
  const views = [
    ["BracketTree.tsx", "format"],
    ["EnduranceRoundPanels.tsx", "format"],
    ["SurvivalView.tsx", '"SURVIVAL"'],
    ["SwissView.tsx", '"SWISS"'],
  ] as const;

  it("lit le verrou mutualisé au lieu de convertir tout le plateau par carte", () => {
    for (const [file, format] of views) {
      const source = readSource(`app/(secured)/tournois/[id]/_components/${file}`);
      expect(source).toContain(
        `scoreLocked={isMatchScoreLocked(match.id, allTournamentMatches, ${format})}`,
      );
      expect(source).not.toMatch(/allMatches=/);
    }
    expect(row).not.toMatch(/allMatches/);
    expect(row).not.toMatch(/isScoreEditLocked\(/);
  });

  it("ne passe à la carte qu'un booléen, pour qu'elle reste mémorisable", () => {
    // Le plateau entier en prop change à chaque instantané : toutes les cartes
    // se redessinaient pour un score qui n'en concernait qu'une.
    expect(row).toContain("scoreLocked: boolean;");
    expect(row).toMatch(/export const MatchRow = memo\(function MatchRow/);
  });
});
