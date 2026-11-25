import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/solo-entries-service");

import { withdrawOwnRegistration } from "@/lib/server/tournaments/registration-removal";
import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { findSoloEntry } from "@/lib/server/solo-entries-service";
import { connectionMock, fakePool, type SqlQuery } from "../../helpers/sql-double";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import type { RowOverrides } from "../../helpers/row-overrides";
import { tournamentRow } from "../../helpers/tournament-rows";
import type { TeamRole } from "@/lib/shared/types";

/**
 * `withdrawOwnRegistration` — la désinscription par le joueur lui-même
 * (`docs/features/SELF_WITHDRAWAL.md`) : même fenêtre et même effacement que le
 * retrait par le staff, avec en plus le droit d'agir au nom de l'engagé, relu
 * sous le verrou de l'équipe.
 */

const HOUR = 3_600_000;
const USER_ID = 42;

function registrationRow(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  const now = Date.now();
  return tournamentRow({
    id: 7,
    name: "BlueGenji Open",
    state: "REGISTRATION",
    max_teams: 16,
    participant_type: "TEAM",
    finished_at: null,
    registration_open_at: new Date(now - 48 * HOUR),
    registration_close_at: new Date(now + HOUR),
    start_at: new Date(now + 2 * HOUR),
    ...overrides,
  });
}

function activeTeam(teamId: number, roles: TeamRole[]) {
  return { teamId, teamName: `Team ${teamId}`, roles };
}

/**
 * Connexion factice : `participantType` répond à la lecture verrouillante du
 * type de tournoi, `entrantName` à la lecture de la ligne d'inscription
 * (`null` : non inscrit), `remaining` aux inscrites après effacement.
 */
function mockConnection(
  row: TournamentRow | null,
  options: { participantType?: string; entrantName?: string | null; remaining?: number[] } = {},
) {
  const { participantType = "TEAM", entrantName = "Team Nova", remaining = [101, 103] } = options;
  const sqls: string[] = [];
  const connection = connectionMock();

  connection.execute.mockImplementation(async (sql: string) => {
    sqls.push(sql.replace(/\s+/g, " ").trim());
    if (/SELECT participant_type FROM bg_tournaments/.test(sql)) {
      return [[{ participant_type: participantType }]];
    }
    if (/FOR UPDATE/.test(sql)) return [[{ id: 7 }]];
    if (/ORDER BY COALESCE/.test(sql)) {
      return [
        remaining.map((teamId, index) => ({
          team_id: teamId,
          team_name: `Team ${teamId}`,
          seed: index + 1,
          registered_at: new Date(),
        })),
      ];
    }
    if (/JOIN bg_teams/.test(sql)) return [entrantName === null ? [] : [{ team_name: entrantName }]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ c: remaining.length }]];
    return [{ affectedRows: 1 }];
  });

  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute: jest.fn<SqlQuery>(),
    getConnection: jest.fn(async () => connection),
  }));
  jest.mocked(syncTournamentState).mockResolvedValue({
    row,
    stateChanged: false,
    contentChanged: false,
    launchesChanged: false,
  });

  return { connection, sqls };
}

function deletes(sqls: string[]): string[] {
  return sqls.filter((sql) => sql.startsWith("DELETE"));
}

describe("withdrawOwnRegistration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("withdrawOwnRegistration_teamManagerRegistered_deletesRegistrationAndReturnsEntrant", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(activeTeam(102, ["MANAGER"]));
    const { connection, sqls } = mockConnection(registrationRow());

    const removed = await withdrawOwnRegistration(7, USER_ID);

    expect(removed).toEqual({
      tournamentId: 7,
      tournamentName: "BlueGenji Open",
      teamId: 102,
      entrantName: "Team Nova",
      registeredTeams: 2,
      maxTeams: 16,
      participantType: "TEAM",
    });
    expect(deletes(sqls)).toEqual([
      "DELETE FROM bg_tournament_registrations WHERE tournament_id = ? AND team_id = ?",
    ]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("withdrawOwnRegistration_teamTournament_locksTournamentThenTeamBeforeAnyPlainRead", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(activeTeam(102, ["OWNER"]));
    const { connection, sqls } = mockConnection(registrationRow());

    await withdrawOwnRegistration(7, USER_ID);

    expect(sqls.slice(0, 3)).toEqual([
      "SELECT id FROM bg_tournaments WHERE id = ? FOR UPDATE",
      "SELECT participant_type FROM bg_tournaments WHERE id = ? FOR UPDATE",
      "SELECT id FROM bg_teams WHERE id = ? FOR UPDATE",
    ]);
    expect(connection.execute.mock.calls[2][1]).toEqual([102]);
  });

  it("withdrawOwnRegistration_soloTournament_withdrawsSoloEntryWithoutTeamLock", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(null);
    jest.mocked(findSoloEntry).mockResolvedValue(900);
    const { connection, sqls } = mockConnection(registrationRow({ participant_type: "SOLO" }), {
      participantType: "SOLO",
      entrantName: "Solo 900",
    });

    const removed = await withdrawOwnRegistration(7, USER_ID);

    expect(removed.teamId).toBe(900);
    expect(removed.participantType).toBe("SOLO");
    expect(sqls.some((sql) => /bg_teams WHERE id = \? FOR UPDATE/.test(sql))).toBe(false);
    const deleteCall = connection.execute.mock.calls.find(([sql]) => sql.startsWith("DELETE"));
    expect(deleteCall?.[1]).toEqual([7, 900]);
  });

  it("withdrawOwnRegistration_rosterMemberWithoutManagement_throwsNotTeamManager", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(activeTeam(102, ["DPS"]));
    const { connection, sqls } = mockConnection(registrationRow());

    await expect(withdrawOwnRegistration(7, USER_ID)).rejects.toThrow("NOT_TEAM_MANAGER");

    expect(deletes(sqls)).toEqual([]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("withdrawOwnRegistration_noActiveTeam_throwsNoActiveTeam", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(null);
    const { connection, sqls } = mockConnection(registrationRow());

    await expect(withdrawOwnRegistration(7, USER_ID)).rejects.toThrow("NO_ACTIVE_TEAM");

    expect(sqls.some((sql) => /bg_teams WHERE id = \? FOR UPDATE/.test(sql))).toBe(false);
    expect(deletes(sqls)).toEqual([]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("withdrawOwnRegistration_activeTeamChangedWhileWaitingForLock_throwsNoActiveTeam", async () => {
    jest.mocked(getUserActiveTeam)
      .mockResolvedValueOnce(activeTeam(102, ["MANAGER"]))
      .mockResolvedValueOnce(activeTeam(103, ["MANAGER"]));
    const { sqls } = mockConnection(registrationRow());

    await expect(withdrawOwnRegistration(7, USER_ID)).rejects.toThrow("NO_ACTIVE_TEAM");

    expect(deletes(sqls)).toEqual([]);
  });

  it("withdrawOwnRegistration_entrantNotRegistered_throwsTeamNotInTournament", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(activeTeam(102, ["MANAGER"]));
    const { sqls } = mockConnection(registrationRow(), { entrantName: null });

    await expect(withdrawOwnRegistration(7, USER_ID)).rejects.toThrow("TEAM_NOT_IN_TOURNAMENT");

    expect(deletes(sqls)).toEqual([]);
  });

  it("withdrawOwnRegistration_tournamentStarted_throwsStartedBeforeCheckingRights", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(activeTeam(102, ["DPS"]));
    mockConnection(registrationRow({ state: "RUNNING" }));

    await expect(withdrawOwnRegistration(7, USER_ID)).rejects.toThrow("ENTRANT_REMOVAL_TOURNAMENT_STARTED");

    // Lue une seule fois, sur le pool : la relecture des droits n'a pas eu lieu.
    expect(getUserActiveTeam).toHaveBeenCalledTimes(1);
  });

  it("withdrawOwnRegistration_unknownTournament_throwsTournamentNotFound", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(activeTeam(102, ["MANAGER"]));
    const { connection } = mockConnection(null);

    await expect(withdrawOwnRegistration(7, USER_ID)).rejects.toThrow("TOURNAMENT_NOT_FOUND");

    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
