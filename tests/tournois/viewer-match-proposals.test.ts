import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/tournaments/registration", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/registration")>("@/lib/server/tournaments/registration"),
  resolveUserEntrantTeamId: jest.fn(),
}));

import { getViewerMatchProposals } from "@/lib/server/tournaments";
import { withConnection } from "@/lib/server/database";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { resolveUserEntrantTeamId } from "@/lib/server/tournaments/registration";
import type { MatchProposalMaps, MatchScoreReport, TournamentSnapshot } from "@/lib/shared/types";
import type { ParticipantType } from "@/lib/shared/participants";
import { connectionMock, fakeConnection } from "../helpers/sql-double";
import { tournamentSnapshot } from "../helpers/tournament-detail";
import { tournamentCard } from "../helpers/tournament-card";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * `getViewerMatchProposals` (ERREUR.txt EF-15) : les propositions d'**un**
 * match, sous la règle de lecture du contexte du lecteur — les engagés qui
 * mènent le match et l'arbitrage, personne d'autre. Revue #542 : la règle se
 * juge sur l'état **relu** du match (engagés, statut, reports), en une
 * instruction avec ses maps — l'instantané en cache peut être en retard.
 */

const REPORTED_AT = "2026-11-03T18:00:00.000Z";
const report: MatchScoreReport = { team1Score: 2, team2Score: 1, reportedAt: REPORTED_AT, maps: [] };
const read: MatchProposalMaps = {
  matchId: 70,
  team1: { reportedAt: REPORTED_AT, maps: [{ mapNumber: 1, replayCode: "ABC123", team1Score: 2, team2Score: 0 }] },
  team2: null,
};

function snapshot(participantType: ParticipantType = "TEAM"): TournamentSnapshot {
  return tournamentSnapshot({
    card: tournamentCard({ id: 5, state: "RUNNING", participantType }),
    matches: [
      bracketMatch({ id: 70, tournamentId: 5, team1Id: 42, team2Id: 43, status: "AWAITING_CONFIRMATION", team1Report: report }),
      bracketMatch({ id: 71, tournamentId: 5, team1Id: 44, team2Id: 45, status: "READY", team1Report: null, team2Report: null }),
    ],
  });
}

type FreshState = {
  team1_id: number | null;
  team2_id: number | null;
  status: string;
  team1_reported_at: string | null;
  team2_reported_at: string | null;
};

type MapLine = { source: string; map_number: number; replay_code: string; team1_score: number; team2_score: number };

const TEAM1_MAP: MapLine = { source: "TEAM1", map_number: 1, replay_code: "ABC123", team1_score: 2, team2_score: 0 };

let connection: ReturnType<typeof connectionMock>;

/** État relu du match (par défaut : celui de l'instantané), une ligne par map proposée. */
function freshMatch(state: Partial<FreshState>, maps: MapLine[] = [TEAM1_MAP]) {
  const full: FreshState = {
    team1_id: 42,
    team2_id: 43,
    status: "AWAITING_CONFIRMATION",
    team1_reported_at: REPORTED_AT,
    team2_reported_at: null,
    ...state,
  };
  const team1Reported = full.team1_reported_at !== null;
  const team2Reported = full.team2_reported_at !== null;
  const head = {
    ...full,
    team1_report_score: team1Reported ? 2 : null,
    team1_report_opponent_score: team1Reported ? 1 : null,
    team2_report_score: team2Reported ? 1 : null,
    team2_report_opponent_score: team2Reported ? 2 : null,
  };
  const noMap = { source: null, map_number: null, replay_code: null, team1_score: null, team2_score: null };
  const rows = maps.length === 0 ? [{ ...head, ...noMap }] : maps.map((map) => ({ ...head, ...map }));
  connection.execute.mockResolvedValue([rows, []]);
}

beforeEach(() => {
  jest.clearAllMocks();
  connection = connectionMock();
  freshMatch({});
  jest.mocked(withConnection).mockImplementation((fn) => fn(fakeConnection(connection)));
  jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["MANAGER"] });
});

describe("getViewerMatchProposals", () => {
  it("getViewerMatchProposals_teamManager_readsOwnMatch", async () => {
    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toEqual(read);
  });

  it("getViewerMatchProposals_nominal_oneStatementWithMapsNoTransaction", async () => {
    await getViewerMatchProposals(snapshot(), 7, false, 70);

    expect(connection.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = connection.execute.mock.calls[0];
    expect(String(sql).replace(/\s+/g, " ")).toContain("FROM bg_matches m LEFT JOIN bg_match_maps mm");
    expect(params).toEqual(["TEAM1", "TEAM2", 70]);
    expect(connection.query).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_unknownMatch_returnsNullWithoutReading", async () => {
    await expect(getViewerMatchProposals(snapshot(), 7, false, 999)).resolves.toBeNull();

    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(withConnection).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_viewerWithoutTeam_returnsNullWithoutConnection", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(null);

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();

    expect(withConnection).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_matchWithoutReport_returnsNull", async () => {
    freshMatch({ team1_id: 44, team2_id: 45, status: "READY", team1_reported_at: null }, []);

    await expect(getViewerMatchProposals(snapshot(), 7, true, 71)).resolves.toBeNull();
  });

  it("getViewerMatchProposals_otherTeamsMatch_returnsNull", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 99, teamName: "Autre", roles: ["OWNER"] });

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();
  });

  it("getViewerMatchProposals_playerWithoutLeadRole_returnsNullWithoutConnection", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["DPS"] });

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();

    expect(withConnection).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_staff_readsAllWithoutResolvingEntrant", async () => {
    await expect(getViewerMatchProposals(snapshot(), 7, true, 70)).resolves.toEqual(read);

    expect(getUserActiveTeam).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_soloEntrant_resolvesOwnEntryOnTheReadConnection", async () => {
    jest.mocked(resolveUserEntrantTeamId).mockResolvedValue(43);

    await expect(getViewerMatchProposals(snapshot("SOLO"), 7, false, 70)).resolves.toEqual(read);

    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(withConnection).toHaveBeenCalledTimes(1);
    expect(jest.mocked(resolveUserEntrantTeamId).mock.calls[0][0]).toBe(fakeConnection(connection));
  });

  it("getViewerMatchProposals_soloNotEntrant_returnsNullWithoutReading", async () => {
    jest.mocked(resolveUserEntrantTeamId).mockResolvedValue(null);

    await expect(getViewerMatchProposals(snapshot("SOLO"), 7, false, 70)).resolves.toBeNull();

    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_matchRowGone_returnsNull", async () => {
    connection.execute.mockResolvedValue([[], []]);

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();
  });

  // Revue #542 : une équipe sortie du match (correction d'arbitrage) n'en lit
  // plus les propositions, même si l'instantané en cache la place encore.
  it("getViewerMatchProposals_entrantReplacedSinceSnapshot_returnsNull", async () => {
    freshMatch({ team1_id: 50 });

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();
  });

  it("getViewerMatchProposals_staleSnapshot_servesFreshReportDate", async () => {
    freshMatch({ team1_reported_at: "2026-11-03T18:05:00.000Z" });

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toEqual({
      ...read,
      team1: { reportedAt: "2026-11-03T18:05:00.000Z", maps: read.team1?.maps },
    });
  });

  // Revue #542 : un report déposé après l'instantané est servi.
  it("getViewerMatchProposals_reportFiledAfterSnapshot_servesIt", async () => {
    freshMatch({ team2_reported_at: "2026-11-03T18:06:00.000Z" }, [
      TEAM1_MAP,
      { source: "TEAM2", map_number: 1, replay_code: "XYZ789", team1_score: 0, team2_score: 2 },
    ]);

    const proposals = await getViewerMatchProposals(snapshot(), 7, false, 70);

    expect(proposals?.team2).toEqual({
      reportedAt: "2026-11-03T18:06:00.000Z",
      maps: [{ mapNumber: 1, replayCode: "XYZ789", team1Score: 0, team2Score: 2 }],
    });
  });

  it("getViewerMatchProposals_reportWithdrawnSinceSnapshot_returnsNull", async () => {
    freshMatch({ team1_reported_at: null }, []);

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();
  });

  it("getViewerMatchProposals_matchClosedSinceSnapshot_returnsNull", async () => {
    freshMatch({ status: "COMPLETED" });

    await expect(getViewerMatchProposals(snapshot(), 7, true, 70)).resolves.toBeNull();
  });
});
