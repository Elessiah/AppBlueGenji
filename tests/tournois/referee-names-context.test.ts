import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/tournaments/preview-cache");
jest.mock("@/lib/server/tournaments/registration-eligibility");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/tournaments/referee-names", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/referee-names")>(
    "@/lib/server/tournaments/referee-names",
  ),
  loadRefereeNames: jest.fn(),
}));

import { getTournamentViewerContext } from "@/lib/server/tournaments";
import { withConnection } from "@/lib/server/database";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { getTournamentPreview } from "@/lib/server/tournaments/preview-cache";
import { loadRefereeNames } from "@/lib/server/tournaments/referee-names";
import { findSoloEntry } from "@/lib/server/solo-entries-service";
import { fakeConnection } from "../helpers/sql-double";
import { tournamentSnapshot } from "../helpers/tournament-detail";
import { tournamentCard } from "../helpers/tournament-card";

/**
 * Pseudos des arbitres désignés dans le contexte du lecteur
 * (`docs/features/MATCH_REFEREE.md`) : une simple étiquette, dont la lecture en
 * panne ne fait échouer ni le flux ni la lecture REST.
 */

const snapshot = tournamentSnapshot({ card: tournamentCard({ id: 5, state: "RUNNING" }) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(withConnection).mockImplementation((fn) => fn(fakeConnection({})));
  jest.mocked(getTournamentPreview).mockResolvedValue(null);
  jest.mocked(findSoloEntry).mockResolvedValue(null);
  jest.mocked(getUserActiveTeam).mockResolvedValue(null);
});

describe("refereeNames du contexte du lecteur", () => {
  it("getTournamentViewerContext_refereeNamesRead_namesServed", async () => {
    jest.mocked(loadRefereeNames).mockResolvedValue({
      names: [{ matchId: 40, refereeKey: "k", pseudo: "Arbitre" }],
      designations: [{ matchId: 40, refereeKey: "k", pseudo: "Arbitre", refereeUserId: 3 }],
    });

    const context = await getTournamentViewerContext(snapshot, 7);

    expect(context.refereeNames).toMatchObject([{ matchId: 40, pseudo: "Arbitre" }]);
  });

  it("getTournamentViewerContext_refereeNamesUnreadable_contextServedWithoutNames", async () => {
    jest.mocked(loadRefereeNames).mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const context = await getTournamentViewerContext(snapshot, 7);

    expect(context.refereeNames).toEqual([]);
    expect(context.viewerUserId).toBe(7);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("getTournamentViewerContext_namesRead_startsBeforeViewerReads", async () => {
    let namesStartedFirst = false;
    jest.mocked(loadRefereeNames).mockResolvedValue({ names: [], designations: [] });
    jest.mocked(withConnection).mockImplementation((fn) => {
      namesStartedFirst ||= jest.mocked(loadRefereeNames).mock.calls.length > 0;
      return fn(fakeConnection({ execute: async () => [[], []] }));
    });

    // Un porteur de `tournaments` : engagé et identité lus sur une connexion.
    await getTournamentViewerContext(snapshot, 7, { canManage: true });

    expect(withConnection).toHaveBeenCalled();
    expect(namesStartedFirst).toBe(true);
  });

  it("getTournamentViewerContext_memberWithoutRightsInTeamTournament_reservesNoConnection", async () => {
    jest.mocked(loadRefereeNames).mockResolvedValue({ names: [], designations: [] });

    const context = await getTournamentViewerContext(snapshot, 7);

    expect(withConnection).not.toHaveBeenCalled();
    expect(context.castBlock).toBe("NOT_CASTER");
  });

  const DESIGNATED = {
    names: [],
    designations: [{ matchId: 40, refereeKey: "k", pseudo: "", refereeUserId: 7 }],
  };

  it("getTournamentViewerContext_designatedViewerWithoutTournamentsPermission_notMarkedMine", async () => {
    jest.mocked(loadRefereeNames).mockResolvedValue(DESIGNATED);

    const context = await getTournamentViewerContext(snapshot, 7);

    expect(context.refereeNames).toEqual([]);
  });

  it("getTournamentViewerContext_designatedEligibleViewer_marksMine", async () => {
    jest.mocked(loadRefereeNames).mockResolvedValue(DESIGNATED);
    const identity = {
      discord_verified_at: new Date("2026-01-01T00:00:00Z"),
      discord_pseudo: "arbitre",
      blizzard_sub: "sub",
      overwatch_battletag: "Arbitre#1",
      overwatch_battletag_typed: 0,
      is_deleted: 0,
    };
    jest.mocked(withConnection).mockImplementation((fn) =>
      fn(fakeConnection({ execute: async () => [[identity], []], query: async () => [[], []] })),
    );

    const context = await getTournamentViewerContext(snapshot, 7, { canManage: true });

    expect(context.refereeNames).toEqual([{ matchId: 40, refereeKey: "k", pseudo: "", mine: true }]);
  });
});
