import { describe, expect, it, jest } from "@jest/globals";
import { loadFrozenRankingSeeds } from "@/lib/server/tournaments/frozen-seeds";
import type { TournamentFormat } from "@/lib/shared/types";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

function connectionReturning(rows: unknown[]) {
  const query = jest.fn<SqlQuery>().mockResolvedValue([rows]);
  return { conn: fakeConnection({ execute: query }), query };
}

describe("loadFrozenRankingSeeds", () => {
  it.each<[TournamentFormat, string]>([
    ["SWISS", "bg_swiss_standings"],
    ["SURVIVAL", "bg_survival_standings"],
    ["BG_SURVIE", "bg_endurance_standings"],
  ])("relit en %s le rang écrit au coup d'envoi dans %s", async (format, table) => {
    const { conn, query } = connectionReturning([
      { team_id: 4, seed: 1 },
      { team_id: "9", seed: "2" },
    ]);

    const seeds = await loadFrozenRankingSeeds(conn, 7, format);

    expect([...seeds]).toEqual([
      [4, 1],
      [9, 2],
    ]);
    expect(String(query.mock.calls[0][0])).toContain(table);
    expect(query.mock.calls[0][1]).toEqual([7]);
  });

  it("lit en multi-phases la première phase peuplée", async () => {
    const { conn, query } = connectionReturning([{ team_id: 3, seed: 1 }]);

    const seeds = await loadFrozenRankingSeeds(conn, 7, "MULTI");

    expect(seeds.get(3)).toBe(1);
    expect(String(query.mock.calls[0][0])).toContain("bg_tournament_phase_teams");
    expect(String(query.mock.calls[0][0])).toContain("MIN(p2.position)");
    expect(query.mock.calls[0][1]).toEqual([7, 7]);
  });

  it("ignore un seed nul, valeur par défaut de colonne", async () => {
    const { conn } = connectionReturning([
      { team_id: 1, seed: 0 },
      { team_id: 2, seed: 3 },
    ]);

    const seeds = await loadFrozenRankingSeeds(conn, 7, "SWISS");

    expect([...seeds]).toEqual([[2, 3]]);
  });

  it("ne lit rien pour un format à élimination", async () => {
    const { conn, query } = connectionReturning([]);

    expect((await loadFrozenRankingSeeds(conn, 7, "SINGLE")).size).toBe(0);
    expect((await loadFrozenRankingSeeds(conn, 7, "DOUBLE")).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
