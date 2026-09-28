import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database", () => ({ getDatabase: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { listMyActiveTournamentIds } from "@/lib/server/tournaments/my-tournaments";

const execute = jest.fn<SqlQuery>();

beforeEach(() => {
  execute.mockReset();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
});

describe("listMyActiveTournamentIds", () => {
  it("rend les identifiants numériques des tournois trouvés", async () => {
    execute.mockResolvedValue([[{ tournament_id: 4 }, { tournament_id: "9" }]]);
    await expect(listMyActiveTournamentIds(12)).resolves.toEqual([4, 9]);
  });

  it("ne lit que les tournois publiés et non terminés", async () => {
    execute.mockResolvedValue([[]]);
    await listMyActiveTournamentIds(12);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("t.start_visibility_at <= ?");
    expect(sql).toContain("t.state <> 'FINISHED'");
    expect((params as unknown[])[0]).toBeInstanceOf(Date);
  });

  it("couvre l'équipe dont le joueur est membre aujourd'hui et son entrée solo", async () => {
    execute.mockResolvedValue([[]]);
    await listMyActiveTournamentIds(12);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("e.solo_user_id = ?");
    expect(sql).toMatch(/tm\.user_id = \?\s+AND tm\.left_at IS NULL/);
    expect((params as unknown[]).slice(1)).toEqual([12, 12]);
  });

  it("dédoublonne en SQL (un tournoi, une ligne)", async () => {
    execute.mockResolvedValue([[]]);
    await listMyActiveTournamentIds(12);
    expect(execute.mock.calls[0][0]).toContain("SELECT DISTINCT r.tournament_id");
  });
});
