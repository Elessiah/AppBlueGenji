import { describe, expect, it, jest } from "@jest/globals";
import { activeMemberSql, loadMatchPlayerIds, playsMatchSql } from "@/lib/server/tournaments/match-players";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/** Règle « qui joue ce match » partagée par le verrou, l'instantané et la fenêtre « Arbitrage » (EF-31). */
describe("match-players", () => {
  it("activeMemberSql_alias_filtersMembersStillInTeam", () => {
    expect(activeMemberSql("tm")).toBe("tm.left_at IS NULL");
  });

  it("playsMatchSql_customPrefix_aliasesBothSubqueries", () => {
    const sql = playsMatchSql("m.referee_user_id", "m.team1_id", "m.team2_id", "r");

    expect(sql).toContain("FROM bg_team_members rtm");
    expect(sql).toContain("rtm.left_at IS NULL");
    expect(sql).toContain("FROM bg_teams rst");
    expect(sql).toContain("rst.solo_user_id = m.referee_user_id");
  });

  it("loadMatchPlayerIds_twoEntrants_returnsMembersAndSoloUnion", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ user_id: 3 }, { user_id: 4 }, { user_id: 3 }], []]);

    const players = await loadMatchPlayerIds(fakeConnection({ execute }), { team1_id: 10, team2_id: 20 });

    expect([...players]).toEqual([3, 4]);
    expect(execute.mock.calls[0][1]).toEqual([10, 20, 10, 20]);
    expect(execute.mock.calls[0][0]).toContain("tm.left_at IS NULL");
  });

  it("loadMatchPlayerIds_oneEntrantKnown_readsOnlyIt", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await loadMatchPlayerIds(fakeConnection({ execute }), { team1_id: 10, team2_id: null });

    expect(execute.mock.calls[0][1]).toEqual([10, 10]);
  });

  it("loadMatchPlayerIds_noEntrant_readsNothing", async () => {
    const execute = jest.fn<SqlQuery>();

    await expect(loadMatchPlayerIds(fakeConnection({ execute }), { team1_id: null, team2_id: null })).resolves.toEqual(new Set());

    expect(execute).not.toHaveBeenCalled();
  });
});
