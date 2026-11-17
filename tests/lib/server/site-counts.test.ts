import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import { readSiteCounts } from "@/lib/server/site-counts";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/** Compteurs publics partagés par l'accueil et `/frequentation` (`docs/features/STATS_PAGE.md`). */

beforeEach(() => {
  jest.clearAllMocks();
});

describe("readSiteCounts", () => {
  it("readSiteCounts_row_returnsNumericCounts", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ players: "90", teams: 12, tournaments: 9 }]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    expect(await readSiteCounts()).toEqual({ players: 90, teams: 12, tournaments: 9 });
  });

  it("readSiteCounts_query_noPlayedTournamentsSubquery", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ players: 0, teams: 0, tournaments: 0 }]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await readSiteCounts();

    expect(execute.mock.calls[0][0]).not.toContain("tournaments_played");
  });
});
