import { describe, expect, it, jest } from "@jest/globals";
import { BOOTSTRAP_SETTING } from "@/lib/server/planning/new-entries";
import { applyPlanningCases } from "@/lib/server/seed/planning";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

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
});
