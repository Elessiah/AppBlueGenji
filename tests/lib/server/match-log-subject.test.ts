import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  loadMatchLogRow,
  MATCH_LOG_COLUMNS_SQL,
  MATCH_LOG_FROM_SQL,
} from "@/lib/server/tournaments/match-log-subject";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/** Le chargeur des lignes du journal qui désignent un match, partagé avec `./bot-logs`. */

const ROW = {
  id: 42,
  bracket: "UPPER",
  round_number: 2,
  swiss_round: null,
  team1_name: "Renards",
  team2_name: "Nova",
  tournament_id: 7,
  tournament_name: "Coupe",
  participant_type: "TEAM",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("loadMatchLogRow", () => {
  it("loadMatchLogRow_existingMatch_readsSharedColumnsAndJoins", async () => {
    const execute = jest.fn<SqlQuery>(async () => [[ROW], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const row = await loadMatchLogRow(42);

    expect(row).toEqual(ROW);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(MATCH_LOG_COLUMNS_SQL);
    expect(sql).toContain(MATCH_LOG_FROM_SQL);
    expect(params).toEqual([42]);
  });

  it("loadMatchLogRow_missingMatch_returnsNull", async () => {
    const execute = jest.fn<SqlQuery>(async () => [[], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    expect(await loadMatchLogRow(42)).toBeNull();
  });
});
