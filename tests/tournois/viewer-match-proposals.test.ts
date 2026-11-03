import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/tournaments/registration", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/registration")>("@/lib/server/tournaments/registration"),
  resolveUserEntrantTeamId: jest.fn(),
}));
jest.mock("@/lib/server/tournaments/match-maps", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/match-maps")>("@/lib/server/tournaments/match-maps"),
  loadViewerProposals: jest.fn(),
}));

import { getViewerMatchProposals } from "@/lib/server/tournaments";
import { withConnection } from "@/lib/server/database";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { resolveUserEntrantTeamId } from "@/lib/server/tournaments/registration";
import { loadViewerProposals } from "@/lib/server/tournaments/match-maps";
import type { MatchProposalMaps, MatchScoreReport, TournamentSnapshot } from "@/lib/shared/types";
import type { ParticipantType } from "@/lib/shared/participants";
import { connectionMock, fakeConnection } from "../helpers/sql-double";
import { tournamentSnapshot } from "../helpers/tournament-detail";
import { tournamentCard } from "../helpers/tournament-card";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * `getViewerMatchProposals` (ERREUR.txt EF-15) : les propositions d'**un**
 * match, sous la règle de lecture du contexte du lecteur — les engagés qui
 * mènent le match et l'arbitrage, personne d'autre.
 */

const report: MatchScoreReport = { team1Score: 2, team2Score: 1, reportedAt: "2026-11-03T18:00:00.000Z", maps: [] };
const read: MatchProposalMaps = {
  matchId: 70,
  team1: { reportedAt: report.reportedAt, maps: [{ mapNumber: 1, replayCode: "ABC123", team1Score: 2, team2Score: 0 }] },
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

let connection: ReturnType<typeof connectionMock>;

/** Dates de report relues en base (par défaut : celles de l'instantané). */
function freshReports(row: { team1_reported_at: string | null; team2_reported_at: string | null } | null) {
  connection.execute.mockResolvedValue([row ? [row] : [], []]);
}

beforeEach(() => {
  jest.clearAllMocks();
  connection = connectionMock();
  connection.query.mockResolvedValue([[], []]);
  freshReports({ team1_reported_at: report.reportedAt, team2_reported_at: null });
  jest.mocked(withConnection).mockImplementation((fn) => fn(fakeConnection(connection)));
  jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["MANAGER"] });
  jest.mocked(loadViewerProposals).mockResolvedValue([read]);
});

describe("getViewerMatchProposals", () => {
  it("getViewerMatchProposals_teamManager_readsOwnMatchOnly", async () => {
    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toEqual(read);

    const [, matches, scope] = jest.mocked(loadViewerProposals).mock.calls[0];
    expect(matches.map((match) => match.id)).toEqual([70]);
    expect(scope).toEqual({ all: false, teamIds: [42] });
  });

  it("getViewerMatchProposals_unknownMatch_returnsNullWithoutReading", async () => {
    await expect(getViewerMatchProposals(snapshot(), 7, false, 999)).resolves.toBeNull();

    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(loadViewerProposals).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_matchWithoutReport_returnsNullWithoutConnection", async () => {
    await expect(getViewerMatchProposals(snapshot(), 7, true, 71)).resolves.toBeNull();

    expect(withConnection).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_otherTeamsMatch_returnsNull", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 99, teamName: "Autre", roles: ["OWNER"] });

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();

    expect(loadViewerProposals).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_playerWithoutLeadRole_returnsNull", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["DPS"] });

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();

    expect(loadViewerProposals).not.toHaveBeenCalled();
  });

  it("getViewerMatchProposals_staff_readsAllWithoutResolvingEntrant", async () => {
    await expect(getViewerMatchProposals(snapshot(), 7, true, 70)).resolves.toEqual(read);

    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(jest.mocked(loadViewerProposals).mock.calls[0][2]).toEqual({ all: true, teamIds: [] });
  });

  it("getViewerMatchProposals_soloEntrant_resolvesOwnEntryAndReads", async () => {
    jest.mocked(resolveUserEntrantTeamId).mockResolvedValue(43);

    await expect(getViewerMatchProposals(snapshot("SOLO"), 7, false, 70)).resolves.toEqual(read);

    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(jest.mocked(loadViewerProposals).mock.calls[0][2]).toEqual({ all: false, teamIds: [43] });
  });

  it("getViewerMatchProposals_nothingLoaded_returnsNull", async () => {
    jest.mocked(loadViewerProposals).mockResolvedValue([]);

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();
  });

  // Revue #542 : la date du report part avec ses maps, lues dans la même image.
  it("getViewerMatchProposals_nominal_readsReportDatesAndMapsInOneReadOnlyTransaction", async () => {
    await getViewerMatchProposals(snapshot(), 7, false, 70);

    expect(connection.query.mock.calls.map(([sql]) => sql)).toEqual(["START TRANSACTION READ ONLY", "COMMIT"]);
    expect(connection.execute.mock.calls[0]).toEqual([
      "SELECT team1_reported_at, team2_reported_at FROM bg_matches WHERE id = ? LIMIT 1",
      [70],
    ]);
    expect(connection.query.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(loadViewerProposals).mock.invocationCallOrder[0],
    );
    expect(connection.query.mock.invocationCallOrder[1]).toBeGreaterThan(
      jest.mocked(loadViewerProposals).mock.invocationCallOrder[0],
    );
  });

  it("getViewerMatchProposals_staleSnapshot_passesFreshReportDate", async () => {
    freshReports({ team1_reported_at: "2026-11-03T18:05:00.000Z", team2_reported_at: null });

    await getViewerMatchProposals(snapshot(), 7, false, 70);

    const [, [match]] = jest.mocked(loadViewerProposals).mock.calls[0];
    expect(match.team1Report).toEqual({ ...report, reportedAt: "2026-11-03T18:05:00.000Z" });
    expect(match.team2Report).toBeNull();
  });

  it("getViewerMatchProposals_reportWithdrawnSinceSnapshot_dropsIt", async () => {
    freshReports({ team1_reported_at: null, team2_reported_at: null });

    await getViewerMatchProposals(snapshot(), 7, false, 70);

    const [, [match]] = jest.mocked(loadViewerProposals).mock.calls[0];
    expect(match.team1Report).toBeNull();
  });

  it("getViewerMatchProposals_matchRowGone_returnsNullAndCommits", async () => {
    freshReports(null);

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).resolves.toBeNull();

    expect(loadViewerProposals).not.toHaveBeenCalled();
    expect(connection.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("getViewerMatchProposals_readFails_rollsBackAndRethrowsOriginalError", async () => {
    jest.mocked(loadViewerProposals).mockRejectedValue(new Error("Connection lost"));

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).rejects.toThrow("Connection lost");

    expect(connection.query.mock.calls.map(([sql]) => sql)).toEqual(["START TRANSACTION READ ONLY", "ROLLBACK"]);
  });

  // Revue #542 : la fin de transaction ratée (connexion tombée) ne masque pas
  // l'erreur d'origine.
  it("getViewerMatchProposals_readAndRollbackFail_surfacesReadError", async () => {
    jest.mocked(loadViewerProposals).mockRejectedValue(new Error("Connection lost"));
    connection.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("Cannot enqueue Query after fatal error");
      return [[], []];
    });

    await expect(getViewerMatchProposals(snapshot(), 7, false, 70)).rejects.toThrow("Connection lost");
  });

  // Revue #542 : en individuel, une seule place du pool par relecture.
  it("getViewerMatchProposals_soloEntrant_usesOneConnectionForEntryAndRead", async () => {
    jest.mocked(resolveUserEntrantTeamId).mockResolvedValue(43);

    await getViewerMatchProposals(snapshot("SOLO"), 7, false, 70);

    expect(withConnection).toHaveBeenCalledTimes(1);
    expect(jest.mocked(resolveUserEntrantTeamId).mock.calls[0][0]).toBe(fakeConnection(connection));
    expect(jest.mocked(loadViewerProposals).mock.calls[0][0]).toBe(fakeConnection(connection));
  });

  it("getViewerMatchProposals_soloNotEntrant_returnsNullWithoutStartingTransaction", async () => {
    jest.mocked(resolveUserEntrantTeamId).mockResolvedValue(null);

    await expect(getViewerMatchProposals(snapshot("SOLO"), 7, false, 70)).resolves.toBeNull();

    expect(connection.query).not.toHaveBeenCalled();
    expect(loadViewerProposals).not.toHaveBeenCalled();
  });
});
