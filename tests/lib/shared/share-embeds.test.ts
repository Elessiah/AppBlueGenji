import { describe, expect, it } from "@jest/globals";
import {
  buildTournamentShareSummary,
  embedShareImagePath,
  matchShareCardKey,
  matchShareVersion,
  parseEmbedShareCardKey,
  tournamentShareCardKey,
  tournamentShareVersion,
  tournamentShareVersionWithoutSummary,
  UNSETTLED_SHARE_VERSION_MS,
  FINISHED_SHARE_VERSION_MS,
  type ShareSummarySource,
} from "@/lib/shared/share-embeds";
import { EMPTY_MAP_RULES } from "@/lib/shared/round-maps";
import type { SwissMeta, SwissStandingRow } from "@/lib/shared/types";
import { bracketMatch } from "../../helpers/bracket-match";
import { tournamentCard } from "../../helpers/tournament-card";

/**
 * Résumé des cartes d'aperçu (`docs/features/SHARE_EMBEDS.md`) : tiré de la
 * réponse publique seule, sans pseudo (D73), codes de replay des maps jouées
 * publics (D74).
 */

function registration(teamId: number, teamName: string, finalRank: number | null = null) {
  return {
    teamId,
    teamName,
    logoUrl: `/uploads/teams/${teamId}.png`,
    seed: null,
    registeredAt: "2026-05-01T10:00:00.000Z",
    finalRank,
  };
}

function source(overrides: Partial<ShareSummarySource> = {}): ShareSummarySource {
  return {
    card: tournamentCard({ id: 4, state: "RUNNING" }),
    soloUserIds: {},
    registrations: [registration(10, "Alpha"), registration(20, "Bravo")],
    matches: [],
    swiss: null,
    survival: null,
    endurance: null,
    mapRules: EMPTY_MAP_RULES,
    ...overrides,
  };
}

const PLAYED = bracketMatch({
  id: 7,
  status: "COMPLETED",
  team1Id: 10,
  team2Id: 20,
  team1Name: "Alpha",
  team2Name: "Bravo",
  team1Score: 2,
  team2Score: 1,
  winnerTeamId: 10,
  firstMap: "Ilios",
  maps: [
    { mapNumber: 1, replayCode: "ABC123", team1Score: 2, team2Score: 0 },
    { mapNumber: 2, replayCode: "", team1Score: 0, team2Score: 2 },
  ],
});

function swissRow(teamId: number, teamName: string, rank: number): SwissStandingRow {
  return {
    teamId,
    teamName,
    logoUrl: null,
    seed: rank,
    points: 3,
    wins: 1,
    draws: 0,
    losses: 0,
    byes: 0,
    buchholz: 0,
    status: "ACTIVE",
    rank,
  };
}

function swiss(standings: SwissStandingRow[]): SwissMeta {
  return {
    totalRounds: 3,
    currentRound: 1,
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
    pointsForBye: 3,
    tiebreakers: [],
    standings,
    cancellableForfeitTeamIds: [],
  };
}

describe("buildTournamentShareSummary — matchs", () => {
  it("buildTournamentShareSummary_teamMatch_keepsNamesLogosScoresAndCodes", () => {
    const summary = buildTournamentShareSummary(source({ matches: [PLAYED] }));

    expect(summary.matches.get(7)).toEqual({
      matchId: 7,
      bracket: "UPPER",
      roundNumber: 1,
      matchNumber: 1,
      status: "COMPLETED",
      team1: { teamId: 10, name: "Alpha", logoUrl: "/uploads/teams/10.png", solo: false },
      team2: { teamId: 20, name: "Bravo", logoUrl: "/uploads/teams/20.png", solo: false },
      score: { team1: 2, team2: 1 },
      winnerSide: 1,
      forfeitSide: null,
      doubleForfeit: false,
      maps: [
        { mapNumber: 1, mapName: "Ilios", team1Score: 2, team2Score: 0, replayCode: "ABC123" },
        { mapNumber: 2, mapName: null, team1Score: 0, team2Score: 2, replayCode: "" },
      ],
    });
  });

  it("buildTournamentShareSummary_soloTournament_neverCarriesNameOrAvatar", () => {
    const summary = buildTournamentShareSummary(
      source({ card: tournamentCard({ participantType: "SOLO", state: "RUNNING" }), matches: [PLAYED] }),
    );

    expect(summary.matches.get(7)?.team1).toEqual({ teamId: 10, name: null, logoUrl: null, solo: true });
    expect(summary.matches.get(7)?.team2).toEqual({ teamId: 20, name: null, logoUrl: null, solo: true });
  });

  it("buildTournamentShareSummary_soloEntryInTeamTournament_masksThatSideOnly", () => {
    const summary = buildTournamentShareSummary(source({ soloUserIds: { 20: 321 }, matches: [PLAYED] }));

    expect(summary.matches.get(7)?.team1.name).toBe("Alpha");
    expect(summary.matches.get(7)?.team2).toEqual({ teamId: 20, name: null, logoUrl: null, solo: true });
  });

  it("buildTournamentShareSummary_emptySlot_sideWithoutTeam", () => {
    const match = bracketMatch({ id: 8, team1Id: 10, team1Name: "Alpha" });

    const summary = buildTournamentShareSummary(source({ matches: [match] }));

    expect(summary.matches.get(8)?.team2).toEqual({ teamId: null, name: null, logoUrl: null, solo: false });
  });

  it("buildTournamentShareSummary_doubleForfeit_hidesScore", () => {
    const match = bracketMatch({
      id: 9,
      status: "COMPLETED",
      team1Id: 10,
      team2Id: 20,
      team1Score: 0,
      team2Score: 0,
      doubleForfeit: true,
    });

    expect(buildTournamentShareSummary(source({ matches: [match] })).matches.get(9)?.score).toBeNull();
  });

  it("buildTournamentShareSummary_singleMapDisplayScore_prefersDisplayedScore", () => {
    const match = bracketMatch({ ...PLAYED, team1Score: 1, team2Score: 0, displayScore: { team1: 5, team2: 3 } });

    expect(buildTournamentShareSummary(source({ matches: [match] })).matches.get(7)?.score).toEqual({
      team1: 5,
      team2: 3,
    });
  });

  it("buildTournamentShareSummary_forfeit_marksForfeitSide", () => {
    const match = bracketMatch({
      id: 11,
      status: "COMPLETED",
      team1Id: 10,
      team2Id: 20,
      forfeitTeamId: 20,
      winnerTeamId: 10,
    });

    expect(buildTournamentShareSummary(source({ matches: [match] })).matches.get(11)).toMatchObject({
      forfeitSide: 2,
      winnerSide: 1,
      score: null,
    });
  });
});

describe("buildTournamentShareSummary — en tête", () => {
  it("buildTournamentShareSummary_finishedSingleWinner_returnsWinner", () => {
    const summary = buildTournamentShareSummary(
      source({
        card: tournamentCard({ state: "FINISHED" }),
        registrations: [registration(10, "Alpha", 1), registration(20, "Bravo", 2)],
      }),
    );

    expect(summary.leader).toEqual({
      kind: "WINNER",
      side: { teamId: 10, name: "Alpha", logoUrl: "/uploads/teams/10.png", solo: false },
    });
  });

  it("buildTournamentShareSummary_finishedTiedWinners_returnsNull", () => {
    const summary = buildTournamentShareSummary(
      source({
        card: tournamentCard({ state: "FINISHED" }),
        registrations: [registration(10, "Alpha", 1), registration(20, "Bravo", 1)],
      }),
    );

    expect(summary.leader).toBeNull();
  });

  it("buildTournamentShareSummary_finishedSoloTournament_returnsNull", () => {
    const summary = buildTournamentShareSummary(
      source({
        card: tournamentCard({ state: "FINISHED", participantType: "SOLO" }),
        registrations: [registration(10, "Pseudo", 1)],
      }),
    );

    expect(summary.leader).toBeNull();
  });

  it("buildTournamentShareSummary_runningSwissAfterPlayedMatch_returnsLeader", () => {
    const summary = buildTournamentShareSummary(
      source({ matches: [PLAYED], swiss: swiss([swissRow(10, "Alpha", 1), swissRow(20, "Bravo", 2)]) }),
    );

    expect(summary.leader).toEqual({
      kind: "LEADER",
      side: { teamId: 10, name: "Alpha", logoUrl: "/uploads/teams/10.png", solo: false },
    });
  });

  it("buildTournamentShareSummary_runningSwissNoMatchPlayed_returnsNull", () => {
    const summary = buildTournamentShareSummary(
      source({ matches: [bracketMatch({ id: 3 })], swiss: swiss([swissRow(10, "Alpha", 1), swissRow(20, "Bravo", 2)]) }),
    );

    expect(summary.leader).toBeNull();
  });

  it("buildTournamentShareSummary_runningSwissTiedTop_returnsNull", () => {
    const summary = buildTournamentShareSummary(
      source({ matches: [PLAYED], swiss: swiss([swissRow(10, "Alpha", 1), swissRow(20, "Bravo", 1)]) }),
    );

    expect(summary.leader).toBeNull();
  });

  it("buildTournamentShareSummary_runningBracketWithoutStandings_returnsNull", () => {
    expect(buildTournamentShareSummary(source({ matches: [PLAYED] })).leader).toBeNull();
  });
});

describe("clés et adresses des images", () => {
  it("parseEmbedShareCardKey_tournamentKey_returnsTournamentTarget", () => {
    expect(parseEmbedShareCardKey(tournamentShareCardKey(42))).toEqual({ kind: "tournament", tournamentId: 42 });
  });

  it("parseEmbedShareCardKey_matchKey_returnsMatchTarget", () => {
    expect(parseEmbedShareCardKey(matchShareCardKey(42, 9))).toEqual({ kind: "match", tournamentId: 42, matchId: 9 });
  });

  it.each([
    "tournament-0",
    "tournament-07",
    "match-4-9",
    "tournament-4-match-",
    "tournament-12345678901",
    "team-4",
    "tournament-4.png",
    "",
  ])("parseEmbedShareCardKey_malformed_%s_returnsNull", (key) => {
    expect(parseEmbedShareCardKey(key)).toBeNull();
  });

  it("embedShareImagePath_anyKey_buildsVersionedPngUrl", () => {
    expect(embedShareImagePath("tournament-4", "en", "abc")).toBe("/og/en/tournament-4.png?v=abc");
  });
});

describe("empreintes", () => {
  const card = tournamentCard({ id: 4 });
  const match = buildTournamentShareSummary(source({ matches: [PLAYED] })).matches.get(7)!;

  it("tournamentShareVersion_sameContent_sameVersion", () => {
    expect(tournamentShareVersion(card, null)).toBe(tournamentShareVersion(tournamentCard({ id: 4 }), null));
  });

  it("tournamentShareVersion_entrantCountChanges_newVersion", () => {
    expect(tournamentShareVersion({ ...card, registeredTeams: 3 }, null)).not.toBe(tournamentShareVersion(card, null));
  });

  it("matchShareVersion_mapScoreChanges_newVersion", () => {
    const changed = { ...match, maps: [{ ...match.maps[0], team1Score: 3 }, match.maps[1]] };

    expect(matchShareVersion(card, changed)).not.toBe(matchShareVersion(card, match));
  });

  it("matchShareVersion_replayCodeAdded_newVersion", () => {
    const changed = { ...match, maps: [match.maps[0], { ...match.maps[1], replayCode: "XYZ" }] };

    expect(matchShareVersion(card, changed)).not.toBe(matchShareVersion(card, match));
  });
});

describe("tournamentShareVersionWithoutSummary", () => {
  const NOW = Date.parse("2026-05-13T10:00:00.000Z");

  it("tournamentShareVersionWithoutSummary_upcoming_exactVersion", () => {
    const card = tournamentCard({ state: "REGISTRATION" });

    expect(tournamentShareVersionWithoutSummary(card, NOW)).toBe(tournamentShareVersion(card, null));
  });

  it("tournamentShareVersionWithoutSummary_soloRunning_exactVersion", () => {
    const card = tournamentCard({ state: "RUNNING", participantType: "SOLO" });

    expect(tournamentShareVersionWithoutSummary(card, NOW)).toBe(tournamentShareVersion(card, null));
  });

  it("tournamentShareVersionWithoutSummary_teamRunning_changesWithTheWindow", () => {
    const card = tournamentCard({ state: "RUNNING", participantType: "TEAM" });

    const first = tournamentShareVersionWithoutSummary(card, NOW);
    const sameWindow = tournamentShareVersionWithoutSummary(card, NOW + 1_000);
    const nextWindow = tournamentShareVersionWithoutSummary(card, NOW + UNSETTLED_SHARE_VERSION_MS);

    expect(sameWindow).toBe(first);
    expect(nextWindow).not.toBe(first);
  });

  it("tournamentShareVersionWithoutSummary_teamFinished_stableForADay", () => {
    const card = tournamentCard({ state: "FINISHED", participantType: "TEAM" });
    const dayStart = Math.floor(NOW / FINISHED_SHARE_VERSION_MS) * FINISHED_SHARE_VERSION_MS;

    const first = tournamentShareVersionWithoutSummary(card, dayStart);
    const laterSameDay = tournamentShareVersionWithoutSummary(card, dayStart + 6 * UNSETTLED_SHARE_VERSION_MS);
    const nextDay = tournamentShareVersionWithoutSummary(card, dayStart + FINISHED_SHARE_VERSION_MS);

    expect(laterSameDay).toBe(first);
    expect(nextDay).not.toBe(first);
    expect(first.startsWith(`${tournamentShareVersion(card, null)}.`)).toBe(true);
  });

  it("tournamentShareVersionWithoutSummary_soloFinished_exactVersion", () => {
    const card = tournamentCard({ state: "FINISHED", participantType: "SOLO" });

    expect(tournamentShareVersionWithoutSummary(card, NOW)).toBe(tournamentShareVersion(card, null));
  });
});
