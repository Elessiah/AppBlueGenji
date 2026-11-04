import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { applyEndurancePenalty } from "@/lib/server/tournaments/bg-survie/penalties";
import { penalizeEnduranceTeams } from "@/lib/server/seed/simulation";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

jest.mock("@/lib/server/tournaments/bg-survie/penalties");

// Pénalités de fin de simulation du seed (BlueGenji Survie) : le seed est le
// seul contrôle réel du SQL, une erreur inattendue ne doit pas s'y taire.

const TOURNAMENT_ID = 42;
const penalty = jest.mocked(applyEndurancePenalty);

function standings(...teamIds: number[]) {
  const connection = connectionMock();
  connection.execute.mockResolvedValue([teamIds.map((team_id) => ({ team_id })), []]);
  return connection;
}

describe("penalizeEnduranceTeams", () => {
  beforeEach(() => {
    penalty.mockReset();
    penalty.mockResolvedValue({ reason: "Test_ retard au check-in" });
  });

  it("penalizeEnduranceTeams_countZero_returnsZeroWithoutQuery", async () => {
    const connection = standings(1, 2, 3);

    const penalized = await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 0);

    expect(penalized).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("penalizeEnduranceTeams_countNaN_returnsZeroWithoutQuery", async () => {
    const connection = standings(1, 2, 3);

    const penalized = await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, Number.NaN);

    expect(penalized).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("penalizeEnduranceTeams_countInfinity_returnsZeroWithoutQuery", async () => {
    const connection = standings(1, 2, 3);

    const penalized = await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, Infinity);

    expect(penalized).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("penalizeEnduranceTeams_countOne_penalizesTopTeamOnly", async () => {
    const connection = standings(7, 8, 9);

    const penalized = await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 1);

    expect(penalized).toBe(1);
    expect(penalty).toHaveBeenCalledTimes(1);
    expect(penalty.mock.calls[0][1]).toBe(7);
  });

  it("penalizeEnduranceTeams_fractionalCount_floorsIt", async () => {
    const connection = standings(7, 8, 9);

    const penalized = await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 2.7);

    expect(penalized).toBe(2);
    expect(penalty).toHaveBeenCalledTimes(2);
  });

  it("penalizeEnduranceTeams_query_hasNoLimitAndBindsTournamentId", async () => {
    const connection = standings(7, 8);

    await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 2);

    const [sql, params] = connection.execute.mock.calls[0];
    expect(sql).not.toMatch(/LIMIT/i);
    expect(params).toEqual([TOURNAMENT_ID]);
  });

  it("penalizeEnduranceTeams_playoffsStarted_stopsAndReturnsCount", async () => {
    const connection = standings(7, 8, 9);
    penalty.mockResolvedValueOnce({ reason: "Test_ retard au check-in" }).mockRejectedValueOnce(new Error("ENDURANCE_PLAYOFFS_STARTED"));

    const penalized = await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 3);

    expect(penalized).toBe(1);
    expect(penalty).toHaveBeenCalledTimes(2);
  });

  it("penalizeEnduranceTeams_teamAlreadyOut_skipsToNextActiveTeam", async () => {
    const connection = standings(7, 8, 9);
    penalty
      .mockResolvedValueOnce({ reason: "Test_ retard au check-in" })
      .mockRejectedValueOnce(new Error("TEAM_ALREADY_OUT"));

    const penalized = await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 2);

    expect(penalized).toBe(2);
    expect(penalty.mock.calls.map((call) => call[1])).toEqual([7, 8, 9]);
  });

  it("penalizeEnduranceTeams_limitReached_stopsBeforeRemainingRows", async () => {
    const connection = standings(7, 8, 9);

    await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 2);

    expect(penalty.mock.calls.map((call) => call[1])).toEqual([7, 8]);
  });

  it("penalizeEnduranceTeams_tournamentNotRunning_stopsAndReturnsCount", async () => {
    const connection = standings(7, 8);
    penalty.mockRejectedValueOnce(new Error("TOURNAMENT_NOT_RUNNING"));

    const penalized = await penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 2);

    expect(penalized).toBe(0);
    expect(penalty).toHaveBeenCalledTimes(1);
  });

  it("penalizeEnduranceTeams_penaltiesUnavailable_rethrows", async () => {
    const connection = standings(7, 8);
    const missingTable = new Error("PENALTIES_UNAVAILABLE");
    penalty.mockRejectedValueOnce(missingTable);

    await expect(penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 2)).rejects.toBe(missingTable);
  });

  it("penalizeEnduranceTeams_unexpectedError_rethrows", async () => {
    const connection = standings(7, 8);
    const sqlError = Object.assign(new Error("You have an error in your SQL syntax"), { code: "ER_PARSE_ERROR" });
    penalty.mockRejectedValueOnce(sqlError);

    await expect(penalizeEnduranceTeams(fakeConnection(connection), TOURNAMENT_ID, 2)).rejects.toBe(sqlError);
  });
});
