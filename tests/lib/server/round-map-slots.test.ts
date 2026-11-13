import { describe, expect, it } from "@jest/globals";
import { purgeUnbuiltRoundSettings } from "@/lib/server/tournaments/round-map-slots";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

/**
 * Réglages par tour des tours qu'un arbre d'élimination n'aura jamais
 * (`lib/server/tournaments/round-map-slots.ts`, `docs/features/ROUND_MAPS.md`).
 */
describe("purgeUnbuiltRoundSettings", () => {
  it("purgeUnbuiltRoundSettings_phase_deletesRoundsBeyondEachBracketsBuiltMax", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValue([{ affectedRows: 2 }, []]);

    await purgeUnbuiltRoundSettings(fakeConnection(connection), 7, 12);

    expect(connection.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = connection.execute.mock.calls[0];
    expect(sql).toMatch(/DELETE r FROM bg_tournament_round_maps r/);
    expect(sql).toMatch(/MAX\(round_number\) AS max_round FROM bg_matches[\s\S]*GROUP BY bracket\) b ON b\.bracket = r\.bracket/);
    expect(sql).toMatch(/r\.round_number > b\.max_round/);
    expect(params).toEqual([7, 12, 7, 12]);
  });
});
