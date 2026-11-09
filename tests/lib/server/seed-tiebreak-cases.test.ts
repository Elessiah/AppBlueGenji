import { describe, expect, it, jest } from "@jest/globals";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { applyTiebreakCases, SEED_TIEBREAK_CASES } from "@/lib/server/seed/match-states";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Maps de départage seedées (`docs/features/ROUND_MAPS.md`) : chaque cas se
 * pose sur un tour réel, et un cas qui ne trouve aucun tour fait échouer le seed.
 */
describe("applyTiebreakCases", () => {
  it("applyTiebreakCases_allCasesFound_insertsEachWithPrefixedName", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);

    await applyTiebreakCases(fakePool({ execute }));

    expect(execute).toHaveBeenCalledTimes(SEED_TIEBREAK_CASES.length);
    expect(execute.mock.calls[0]?.[1]).toEqual(["Busan", "Test - BO3 Élimination", PLAYOFF_ROUND_OFFSET]);
    expect(execute.mock.calls[1]?.[1]).toEqual(["Ilios", "Test - BG Survie BO5 Égalités Départage", PLAYOFF_ROUND_OFFSET]);
  });

  it("applyTiebreakCases_caseNotFound_throwsSeedTiebreakCaseMissing", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);

    await expect(applyTiebreakCases(fakePool({ execute }))).rejects.toThrow(
      "SEED_TIEBREAK_CASE_MISSING: BO3 Élimination",
    );
  });
});
