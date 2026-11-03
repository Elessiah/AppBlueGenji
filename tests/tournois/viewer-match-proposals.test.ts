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
import { fakeConnection } from "../helpers/sql-double";
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(withConnection).mockImplementation((fn) => fn(fakeConnection({})));
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
});
