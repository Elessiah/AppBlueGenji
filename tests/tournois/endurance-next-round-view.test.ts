import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  enduranceNextRoundInput,
  nextRoundEmptyLabel,
  nextRoundPendingLabel,
  nextRoundSummary,
  nextRoundTitle,
} from "@/app/(secured)/tournois/[id]/_lib/endurance-next-round";
import { DEFAULT_ENDURANCE_CONFIG, PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";
import {
  previewEnduranceNextRound,
  type EnduranceNextRoundPreview,
} from "@/lib/shared/endurance-next-round";
import type { EnduranceMeta, EnduranceStandingRow } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

function standingRow(teamId: number, overrides: Partial<EnduranceStandingRow> = {}): EnduranceStandingRow {
  return {
    teamId,
    teamName: `Équipe ${teamId}`,
    logoUrl: null,
    seed: teamId,
    points: 9,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: teamId,
    rounds: [],
    penaltyPoints: 0,
    ...overrides,
  };
}

function meta(overrides: Partial<EnduranceMeta> = {}): EnduranceMeta {
  return {
    startPoints: 9,
    winDelta: 1,
    lossDelta: 1,
    forfeitMaps: 3,
    playoffSize: 4,
    maxRounds: null,
    currentRound: 1,
    playoffsStarted: false,
    rounds: [1],
    penalties: [],
    standings: Array.from({ length: 8 }, (_, index) => standingRow(index + 1)),
    ...overrides,
  };
}

function preview(overrides: Partial<EnduranceNextRoundPreview> = {}): EnduranceNextRoundPreview {
  return {
    stage: "QUALIFICATION",
    round: 3,
    stageCertain: true,
    freeScore: false,
    pendingMatches: 2,
    expectedMatches: 4,
    decisiveSlots: null,
    matches: [],
    ...overrides,
  };
}

describe("enduranceNextRoundInput", () => {
  it("relit l'instantané comme le moteur relit la base", () => {
    const input = enduranceNextRoundInput(
      meta({
        maxRounds: 5,
        standings: [
          standingRow(1),
          standingRow(2, { status: "FORFEIT", eliminatedRound: 2 }),
          standingRow(3, { status: "FORFEIT", eliminatedRound: null }),
        ],
        penalties: [
          {
            id: 7,
            teamId: 1,
            teamName: "Équipe 1",
            round: 1,
            points: 2,
            reason: "Retard",
            authorPseudo: null,
            createdAt: null,
            removable: true,
          },
        ],
      }),
      [
        bracketMatch({
          id: 10,
          roundNumber: 1,
          matchNumber: 2,
          status: "COMPLETED",
          team1Id: 1,
          team2Id: 3,
          team1Score: 3,
          team2Score: 1,
          winnerTeamId: 1,
          loserTeamId: 3,
        }),
        // Un match d'une phase (tournoi multi-phases) n'appartient pas au mode.
        bracketMatch({ id: 11, phaseId: 4, roundNumber: 1 }),
      ],
      { type: "FT", value: 3 },
    );

    expect(input.config).toEqual({ ...DEFAULT_ENDURANCE_CONFIG, playoffSize: 4, maxRounds: 5 });
    expect(input.teams).toEqual([
      { teamId: 1, seed: 1 },
      { teamId: 2, seed: 2 },
      { teamId: 3, seed: 3 },
    ]);
    // Manche de sortie manquante : 1, comme `loadForfeits`.
    expect(input.forfeits).toEqual([
      { teamId: 2, round: 2 },
      { teamId: 3, round: 1 },
    ]);
    expect(input.penalties).toEqual([{ teamId: 1, round: 1, points: 2 }]);
    expect(input.matches).toEqual([
      {
        round: 1,
        matchNumber: 2,
        bracket: "UPPER",
        status: "COMPLETED",
        team1Id: 1,
        team2Id: 3,
        team1Score: 3,
        team2Score: 1,
        winnerTeamId: 1,
        loserTeamId: 3,
        forfeitTeamId: null,
        doubleForfeit: false,
      },
    ]);
  });

  it("alimente le calcul de bout en bout", () => {
    const matches = [
      [1, 2, 3, 0],
      [3, 4, 3, 0],
      [5, 6, 3, 2],
    ].map(([team1Id, team2Id, team1Score, team2Score], index) =>
      bracketMatch({
        id: index + 1,
        roundNumber: 1,
        matchNumber: index + 1,
        status: "COMPLETED",
        team1Id,
        team2Id,
        team1Score,
        team2Score,
        winnerTeamId: team1Id,
        loserTeamId: team2Id,
      }),
    );
    matches.push(
      bracketMatch({ id: 4, roundNumber: 1, matchNumber: 4, status: "READY", team1Id: 7, team2Id: 8 }),
    );

    const result = previewEnduranceNextRound(
      enduranceNextRoundInput(meta(), matches, { type: "FT", value: 3 }),
    );
    expect(result?.matches).toEqual([{ teamAId: 1, teamBId: 3, sidesKnown: true, bracket: "UPPER" }]);
  });
});

describe("libellés de l'aperçu", () => {
  it("nomme la manche, avec son total sous plafond", () => {
    expect(nextRoundTitle(preview({ round: 3 }), null)).toBe("Manche 3");
    expect(nextRoundTitle(preview({ round: 3 }), 6)).toBe("Manche 3/6");
  });

  it("nomme le tour d'arbre d'après ses rencontres décisives", () => {
    const playoffs = (decisiveSlots: number | null) =>
      nextRoundTitle(preview({ stage: "PLAYOFFS", round: PLAYOFF_ROUND_OFFSET, decisiveSlots }), 6);
    expect(playoffs(1)).toBe("Finale");
    expect(playoffs(2)).toBe("Demi-finales");
    expect(playoffs(4)).toBe("Quarts de finale");
    expect(playoffs(3)).toBe("Quarts de finale");
    expect(playoffs(8)).toBe("8èmes de finale");
    expect(playoffs(null)).toBe("Play-offs");
  });

  it("compte les rencontres acquises sans les exemptions", () => {
    const matches = [
      { teamAId: 1, teamBId: 2, sidesKnown: true, bracket: "UPPER" as const },
      { teamAId: 5, teamBId: null, sidesKnown: true, bracket: "UPPER" as const },
    ];
    expect(nextRoundSummary(preview({ matches }))).toBe("1 rencontre acquise sur 4");
    expect(nextRoundSummary(preview({ matches, expectedMatches: null }))).toBe("1 rencontre acquise");
    expect(nextRoundSummary(preview({ matches: [...matches, { ...matches[0], teamAId: 3, teamBId: 4 }] }))).toBe(
      "2 rencontres acquises sur 4",
    );
  });

  it("dit ce qui reste à jouer", () => {
    expect(nextRoundPendingLabel(preview({ pendingMatches: 1 }))).toBe("1 match reste à jouer");
    expect(nextRoundPendingLabel(preview({ pendingMatches: 3 }))).toBe("3 matchs restent à jouer");
  });

  it("explique une liste vide selon sa cause", () => {
    expect(nextRoundEmptyLabel(preview({ freeScore: true }))).toMatch(/Score libre/);
    expect(nextRoundEmptyLabel(preview({ stage: "PLAYOFFS", expectedMatches: 0 }))).toMatch(
      /sans arbre final/,
    );
    expect(nextRoundEmptyLabel(preview())).toMatch(/Aucune rencontre n'est encore acquise/);
  });
});

describe("aperçu — câblage", () => {
  const ROOT = join(__dirname, "..", "..");
  const DIR = join(ROOT, "app", "(secured)", "tournois", "[id]");
  const PAGE = readFileSync(join(DIR, "page.tsx"), "utf8");
  const VIEW = readFileSync(join(DIR, "_components", "EnduranceView.tsx"), "utf8");

  it("n'est ouvert qu'à l'arbitrage, sur un tournoi en cours", () => {
    // `isAdmin` vaut la permission `tournaments` : administrateurs et arbitres.
    expect(PAGE).toContain('showNextRound={detail.isAdmin && detail.card.state === "RUNNING" && !frozen}');
    expect(PAGE).toContain("qualificationFormat={detail.card.matchFormat}");
  });

  it("ne calcule rien pour qui ne le voit pas", () => {
    expect(VIEW).toMatch(/showNextRound\s*\?\s*previewEnduranceNextRound/);
    expect(VIEW).toContain("<EnduranceNextRoundPanel");
  });
});
