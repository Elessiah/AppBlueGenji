import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");

import { writePlayoffRound } from "@/lib/server/tournaments/bg-survie/playoff-rounds";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Un tour d'arbre final réécrit sur place remet le résultat à zéro : son
 * détail map par map retenu (`FINAL`) part avec lui. Sans quoi l'instantané,
 * qui ne filtre plus le détail sur le score (`MAP_SCORES.md`), montrerait les
 * maps et codes de l'ancien appariement sous les nouvelles engagées.
 */
function playoffConnection(hasFinalMaps: boolean) {
  const execute = jest.fn<SqlQuery>(async (sql: string) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT 1 FROM bg_match_maps")) return [hasFinalMaps ? [{ found: 1 }] : [], []];
    return [{ affectedRows: 1 }, []];
  });
  return { conn: fakeConnection({ execute }), execute };
}

const existing = [
  {
    id: 41,
    bracket: "UPPER",
    status: "COMPLETED",
    teamAId: 1,
    teamBId: 2,
    winnerTeamId: 1,
    loserTeamId: 2,
    doubleForfeit: false,
    hasScoreInput: true,
  },
  {
    id: 42,
    bracket: "UPPER",
    status: "COMPLETED",
    teamAId: 3,
    teamBId: 4,
    winnerTeamId: 3,
    loserTeamId: 4,
    doubleForfeit: false,
    hasScoreInput: true,
  },
];

const plan = [
  { bracket: "UPPER" as const, pairing: { teamAId: 1, teamBId: 4 } },
  { bracket: "UPPER" as const, pairing: { teamAId: 3, teamBId: 2 } },
];

function mapStatements(execute: jest.Mock<SqlQuery>) {
  return execute.mock.calls
    .map(([sql, params]) => ({ sql: sql.replace(/\s+/g, " ").trim(), params }))
    .filter(({ sql }) => sql.includes("bg_match_maps"));
}

describe("BG Survie — tour d'arbre final réécrit", () => {
  it("efface le détail retenu des rencontres réutilisées", async () => {
    const { conn, execute } = playoffConnection(true);
    await writePlayoffRound(conn, 7, 101, plan, existing);
    const deletes = mapStatements(execute).filter(({ sql }) => sql.startsWith("DELETE"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].sql).toBe("DELETE FROM bg_match_maps WHERE match_id IN (?, ?) AND source IN (?)");
    expect(deletes[0].params).toEqual([41, 42, "FINAL"]);
  });

  it("ne touche pas aux propositions d'équipe, seulement au résultat retenu", async () => {
    const { conn, execute } = playoffConnection(true);
    await writePlayoffRound(conn, 7, 101, plan, existing);
    for (const { params } of mapStatements(execute)) {
      expect(params).not.toContain("TEAM1");
      expect(params).not.toContain("TEAM2");
    }
  });

  it("n'efface rien quand aucun détail n'existe", async () => {
    const { conn, execute } = playoffConnection(false);
    await writePlayoffRound(conn, 7, 101, plan, existing);
    expect(mapStatements(execute).filter(({ sql }) => sql.startsWith("DELETE"))).toHaveLength(0);
  });

  it("un tour refait à neuf n'a aucune rencontre réutilisée à nettoyer", async () => {
    const { conn, execute } = playoffConnection(true);
    await writePlayoffRound(conn, 7, 101, [plan[0]], existing);
    expect(mapStatements(execute)).toHaveLength(0);
  });
});
