import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { placeOnMatch } from "@/lib/server/planning/cast-placement";
import { BOOTSTRAP_SETTING } from "@/lib/server/planning/new-entries";
import { applyPlanningCases } from "@/lib/server/seed/planning";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/planning/cast-placement", () => ({ placeOnMatch: jest.fn() }));
jest.mock("@/lib/server/planning/auto-assign", () => ({ writeAssignment: jest.fn() }));

/**
 * Le seed régénère le planning : il retire le marqueur du premier passage des
 * récapitulatifs, pour que le balayage suivant note ce planning déjà annoncé
 * (`docs/features/CAST_PLANNING.md` § Notifications).
 */
describe("applyPlanningCases", () => {
  it("applyPlanningCases_planningTournamentsMissing_stillRemovesBootstrapMarker", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    const query = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    await applyPlanningCases(fakePool({ execute, query }), new Map());

    expect(execute.mock.calls).toEqual([["DELETE FROM bg_settings WHERE setting_key = ?", [BOOTSTRAP_SETTING]]]);
  });

  describe("placement du cast", () => {
    const ids = new Map([
      ["Admin", 1],
      ["Caster", 2],
      ["CasterProd", 3],
      ["Prod", 4],
      ["CasterInvite", 5],
    ]);
    const matchRows = [101, 102, 103, 104, 105].map((id) => ({ id }));

    function seedPool() {
      const connection = connectionMock();
      connection.beginTransaction.mockResolvedValue(undefined);
      connection.commit.mockResolvedValue(undefined);
      connection.rollback.mockResolvedValue(undefined);
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1, insertId: 77 }]);
      const query = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[{ id: 10 }]])
        .mockResolvedValueOnce([[{ id: 11 }]])
        .mockResolvedValueOnce([matchRows]);
      const getConnection = jest.fn(async () => fakeConnection(connection));
      return { pool: fakePool({ execute, query, getConnection }), connection, execute };
    }

    beforeEach(() => {
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      jest.mocked(placeOnMatch).mockReset();
    });

    it("applyPlanningCases_lastMatchWithoutCast_placesPlannedCastersAndProd", async () => {
      const { pool, connection } = seedPool();
      jest.mocked(placeOnMatch).mockResolvedValue({ skip: "CAST_HELD" });

      await applyPlanningCases(pool, ids);

      expect(jest.mocked(placeOnMatch).mock.calls[0].slice(1)).toEqual([
        105,
        { key: "m:105", tournamentId: 10, matchId: 105 },
        [2, 3],
        [4],
      ]);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it("applyPlanningCases_placementFails_rollsBackAndRethrows", async () => {
      const { pool, connection } = seedPool();
      jest.mocked(placeOnMatch).mockRejectedValue(new Error("deadlock"));

      await expect(applyPlanningCases(pool, ids)).rejects.toThrow("deadlock");

      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it("applyPlanningCases_secondMatch_guestCasterSignedUpWithoutPlanningLine", async () => {
      const { pool, execute } = seedPool();
      jest.mocked(placeOnMatch).mockResolvedValue({ skip: "CAST_HELD" });

      await applyPlanningCases(pool, ids);

      expect(execute).toHaveBeenCalledWith("INSERT INTO bg_match_casters (match_id, user_id, stream_id) VALUES (?, ?, ?)", [102, 5, 77]);
    });
  });
});
