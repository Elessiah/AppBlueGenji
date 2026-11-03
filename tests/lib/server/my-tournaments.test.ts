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

  it("ne lit que les tournois publiés et non terminés, dans chacune des deux branches", async () => {
    execute.mockResolvedValue([[]]);
    await listMyActiveTournamentIds(12);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql).match(/t\.start_visibility_at <= \?/g)).toHaveLength(2);
    expect(String(sql).match(/t\.state <> 'FINISHED'/g)).toHaveLength(2);
    // Un seul instant, partagé par les deux branches.
    const [, firstNow, , secondNow] = params as unknown[];
    expect(firstNow).toBeInstanceOf(Date);
    expect(secondNow).toBe(firstNow);
  });

  it("couvre l'entrée solo du joueur et l'équipe dont il est membre aujourd'hui, chacune partant de ses lignes", async () => {
    execute.mockResolvedValue([[]]);
    await listMyActiveTournamentIds(12);
    const [sql, params] = execute.mock.calls[0];
    const [solo, member] = String(sql).split("UNION");
    expect(solo).toContain("FROM bg_teams e");
    expect(solo).toContain("e.solo_user_id = ?");
    expect(member).toContain("FROM bg_team_members tm");
    expect(member).toMatch(/tm\.user_id = \?\s+AND tm\.left_at IS NULL/);
    expect((params as unknown[])[0]).toBe(12);
    expect((params as unknown[])[2]).toBe(12);
  });

  it("dédoublonne par UNION et ne parcourt plus toutes les inscriptions (plus d'OR EXISTS)", async () => {
    execute.mockResolvedValue([[]]);
    await listMyActiveTournamentIds(12);
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/\bUNION\b(?! ALL)/);
    expect(sql).not.toContain("EXISTS");
    expect(sql).not.toContain("DISTINCT");
  });

  it("ne rend aucun identifiant pour un joueur sans engagement", async () => {
    execute.mockResolvedValue([[]]);
    await expect(listMyActiveTournamentIds(12)).resolves.toEqual([]);
  });
});
