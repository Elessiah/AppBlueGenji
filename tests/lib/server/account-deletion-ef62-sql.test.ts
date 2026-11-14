import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/seeding");

import { resequenceSeeds } from "@/lib/server/tournaments/seeding";
import { withdrawRegistrationOn } from "@/lib/server/tournaments/registration-removal";
import { listNamingTournamentIds } from "@/lib/server/users/account-deletion";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/** EF-62 : le retrait d'une inscription en un seul chemin, et les tournois qui nomment un compte. */
describe("withdrawRegistrationOn", () => {
  it("withdrawRegistrationOn_entry_deletesRegistrationThenResequences", async () => {
    const order: string[] = [];
    const execute = jest.fn<SqlQuery>(async (sql) => {
      order.push(sql.replace(/\s+/g, " ").trim());
      return [{ affectedRows: 1 }, undefined];
    });
    jest.mocked(resequenceSeeds).mockImplementation(async () => {
      order.push("resequence");
    });
    const connection = fakeConnection({ execute });

    await withdrawRegistrationOn(connection, 40, 900);

    expect(order).toEqual(["DELETE FROM bg_tournament_registrations WHERE tournament_id = ? AND team_id = ?", "resequence"]);
    expect(execute.mock.calls[0][1]).toEqual([40, 900]);
    expect(jest.mocked(resequenceSeeds).mock.calls[0][1]).toBe(40);
  });
});

describe("listNamingTournamentIds", () => {
  it("listNamingTournamentIds_rows_returnsNumericIdsOfUnfinishedTournaments", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ tournament_id: "4" }, { tournament_id: 9 }], undefined]);

    const ids = await listNamingTournamentIds(fakePool({ execute }), 7);

    expect(ids).toEqual([4, 9]);
    const [sql, params] = execute.mock.calls[0];
    expect(params).toEqual([7, 7, 7, 7, 7, 7]);
    const q = sql.replace(/\s+/g, " ");
    expect(q).toContain("t.state <> 'FINISHED' AND t.finished_at IS NULL");
    expect(q).toContain("s.solo_user_id = ?");
    expect(q).toContain("tm.user_id = ?");
    expect(q).toContain("c.user_id = ?");
    expect(q).toContain("st.link_user_id = ?");
    expect(q).toContain("WHERE referee_user_id = ?");
    expect(q).toContain("WHERE live_trigger_user_id = ?");
  });
  // Revue standard cycle 1 : une équipe quittée avant le coup d'envoi ne le nomme plus.
  it("listNamingTournamentIds_sql_boundsMembershipByTournamentStart", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);

    await listNamingTournamentIds(fakePool({ execute }), 7);

    expect(execute.mock.calls[0][0].replace(/\s+/g, " ")).toContain(
      "tm.user_id = ? AND (tm.left_at IS NULL OR tm.left_at >= rt.start_at)",
    );
  });
  // Revue standard cycle 2 : l'équipe que la demande vient de quitter nomme
  // encore le compte dans ses tournois pas commencés.
  it("listNamingTournamentIds_leftTeamIds_addsRegistrationsOfLeftTeams", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ tournament_id: 9 }], undefined])
      .mockResolvedValueOnce([[{ tournament_id: 4 }, { tournament_id: 9 }], undefined])
      .mockResolvedValueOnce([[{ tournament_id: 2 }], undefined]);

    const ids = await listNamingTournamentIds(fakePool({ execute }), 7, [21, 22]);

    expect(ids).toEqual([2, 4, 9]);
    expect(execute.mock.calls[0][1]).toEqual([7, 7, 7, 7, 7, 7]);
    expect(execute.mock.calls[1][1]).toEqual([21]);
    expect(execute.mock.calls[2][1]).toEqual([22]);
  });

  // Revue sécurité cycle 1 : une instruction de forme fixe, quel que soit le nombre d'équipes.
  it("listNamingTournamentIds_leftTeamIds_sameStatementTextPerTeam", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);

    await listNamingTournamentIds(fakePool({ execute }), 7, [21, 22]);

    expect(execute.mock.calls[1][0]).toBe(execute.mock.calls[2][0]);
    expect(execute.mock.calls[1][0].replace(/\s+/g, " ")).toContain("WHERE r.team_id = ?");
    expect(execute.mock.calls[0][0]).not.toContain("IN (");
  });
});
