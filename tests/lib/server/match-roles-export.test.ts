import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listOwnMatchRoles } from "@/lib/server/users/match-roles-export";
import { type SqlMock, type SqlQuery, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

/**
 * Les matchs où le titulaire a tenu un rôle, dans son export
 * (`docs/features/RGPD_DATA_RIGHTS.md`) : inscriptions de caster, liens de
 * chaîne fournis, arbitrages désignés.
 */

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

const missingTable = () => Object.assign(new Error("Table 'bg_match_casters' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
const unknownColumn = () => Object.assign(new Error("Unknown column 's.link_user_id'"), { code: "ER_BAD_FIELD_ERROR" });

describe("listOwnMatchRoles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("listOwnMatchRoles_rowsForEachRole_mapsThemForTheExport", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[
        { match_id: 5, tournament_id: 2, stream_id: 3, ready_at: new Date("2026-10-20T18:00:00Z"), created_at: new Date("2026-10-20T17:00:00Z") },
      ]])
      .mockResolvedValueOnce([[
        { match_id: 5, tournament_id: 2, live_url: "https://twitch.tv/voix", created_at: new Date("2026-10-20T17:00:00Z") },
      ]])
      .mockResolvedValueOnce([[{ id: 6, tournament_id: 2, referee_ready_at: null }]]);
    await mockDb(execute);

    expect(await listOwnMatchRoles(12)).toEqual({
      casts: [{ matchId: 5, tournamentId: 2, streamId: 3, readyAt: "2026-10-20T18:00:00.000Z", createdAt: "2026-10-20T17:00:00.000Z" }],
      providedStreamLinks: [{ matchId: 5, tournamentId: 2, liveUrl: "https://twitch.tv/voix", createdAt: "2026-10-20T17:00:00.000Z" }],
      refereeAssignments: [{ matchId: 6, tournamentId: 2, readyAt: null }],
    });
  });

  it("listOwnMatchRoles_anyRead_bindsOnlyTheHolderId", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    await mockDb(execute);

    await listOwnMatchRoles(12);

    expect(execute.mock.calls.map(([, params]) => params)).toEqual([[12], [12], [12]]);
    expect(execute.mock.calls[0][0]).toMatch(/WHERE c\.user_id = \?/);
    expect(execute.mock.calls[1][0]).toMatch(/WHERE s\.link_user_id = \?/);
    expect(execute.mock.calls[2][0]).toMatch(/WHERE referee_user_id = \?/);
  });

  it("listOwnMatchRoles_noRole_returnsEmptyLists", async () => {
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));

    expect(await listOwnMatchRoles(12)).toEqual({ casts: [], providedStreamLinks: [], refereeAssignments: [] });
  });

  it("listOwnMatchRoles_missingTable_returnsEmptyForThatReadOnly", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockRejectedValueOnce(missingTable())
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 6, tournament_id: 2, referee_ready_at: null }]]);
    await mockDb(execute);

    const roles = await listOwnMatchRoles(12);

    expect(roles.casts).toEqual([]);
    expect(roles.refereeAssignments).toEqual([{ matchId: 6, tournamentId: 2, readyAt: null }]);
  });

  it("listOwnMatchRoles_unknownColumn_returnsEmptyForThatReadOnly", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(unknownColumn())
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    expect((await listOwnMatchRoles(12)).providedStreamLinks).toEqual([]);
  });

  it("listOwnMatchRoles_otherFailure_rethrows", async () => {
    await mockDb(jest.fn<SqlQuery>().mockRejectedValueOnce(new Error("DB_DOWN")));

    await expect(listOwnMatchRoles(12)).rejects.toThrow("DB_DOWN");
  });
});
