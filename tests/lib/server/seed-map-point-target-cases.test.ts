import { describe, expect, it, jest } from "@jest/globals";
import { applyMapPointTargetCases, SEED_MAP_POINT_TARGET_CASES } from "@/lib/server/seed/point-targets";
import { TOURNAMENTS } from "@/lib/server/seed/cases";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Points carte par carte seedés (`docs/features/DUEL_ARCADE.md`) : le tournoi
 * Duel / Arcade seedé reçoit des N différents par carte sur son premier tour ;
 * un cas qui ne trouve pas son tournoi fait échouer le seed.
 */
describe("applyMapPointTargetCases", () => {
  it("applyMapPointTargetCases_caseFound_storesTargetsOnPrefixedTournament", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);

    await applyMapPointTargetCases(fakePool({ execute }));

    expect(execute).toHaveBeenCalledTimes(SEED_MAP_POINT_TARGET_CASES.length);
    expect(execute.mock.calls[0]?.[0]).toMatch(/ON DUPLICATE KEY UPDATE map_point_targets = VALUES\(map_point_targets\)/);
    expect(execute.mock.calls[0]?.[1]).toEqual([1, "[null,3,7]", "Test - Duel Arcade BO3 (points par carte)"]);
  });

  it("applyMapPointTargetCases_caseNotFound_throwsSeedCaseMissing", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);

    await expect(applyMapPointTargetCases(fakePool({ execute }))).rejects.toThrow(
      "SEED_MAP_POINT_TARGET_CASE_MISSING: Duel Arcade BO3 (points par carte)",
    );
  });

  it("seedCases_duelCase_isADuelTournament", () => {
    const actual = TOURNAMENTS.find((tournament) => tournament.name === "Duel Arcade BO3 (points par carte)");

    expect(actual).toMatchObject({ mapPointTarget: 5, matchFormat: { type: "BO", value: 3 } });
  });
});
