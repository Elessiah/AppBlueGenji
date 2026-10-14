import { describe, expect, it, jest } from "@jest/globals";
import { getDatabase } from "@/lib/server/database";
import { listOwnLiveAnnouncements } from "@/lib/server/users/live-announcement-export";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

describe("listOwnLiveAnnouncements (export RGPD, T16)", () => {
  it("rend les annonces #live des entrées individuelles du titulaire, sans rien d'autre", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ match_id: "12", tournament_id: 3, sent_at: new Date("2026-10-20T18:00:00.000Z") }]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(listOwnLiveAnnouncements(7)).resolves.toEqual([
      { matchId: 12, tournamentId: 3, sentAt: "2026-10-20T18:00:00.000Z" },
    ]);
    const [sql, params] = execute.mock.calls[0];
    // Seules les entrées dont il est le titulaire, retrouvées dans la paire annoncée.
    expect(sql).toMatch(/st\.solo_user_id = \?/);
    expect(sql).toMatch(/FIND_IN_SET\(st\.id, REPLACE\(a\.pairing, ':', ','\)\)/);
    expect(params).toEqual([7]);
  });

  it("rend une liste vide sans annonce", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await expect(listOwnLiveAnnouncements(7)).resolves.toEqual([]);
  });
});
