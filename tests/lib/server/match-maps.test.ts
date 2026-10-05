import { describe, expect, it, jest } from "@jest/globals";
import {
  loadMapsByMatch,
  loadMatchMaps,
  promoteReportedMaps,
  replaceMatchMaps,
} from "@/lib/server/tournaments/match-maps";
import { attachMatchMaps } from "@/lib/server/tournaments/_internal";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";
import { bracketMatch } from "../../helpers/bracket-match";

function conn(results: unknown[] = []) {
  const execute = jest.fn<SqlQuery>();
  for (const result of results) execute.mockResolvedValueOnce(result);
  execute.mockResolvedValue([[], []]);
  return { execute, connection: fakeConnection({ execute }) };
}

const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("stockage map par map (bg_match_maps)", () => {
  it("remplace un jeu : efface puis insère une ligne par map, numérotées depuis 1", async () => {
    const { execute, connection } = conn();
    await replaceMatchMaps(connection, 10, "TEAM2", [
      { replayCode: "AAA111", team1Score: 2, team2Score: 1 },
      { replayCode: "BBB222", team1Score: 0, team2Score: 0 },
    ], 7);

    expect(flat(execute.mock.calls[0][0])).toBe("DELETE FROM bg_match_maps WHERE match_id = ? AND source = ?");
    expect(execute.mock.calls[0][1]).toEqual([10, "TEAM2"]);
    expect(flat(execute.mock.calls[1][0])).toMatch(/^INSERT INTO bg_match_maps .* VALUES \(\?, \?, \?, \?, \?, \?, \?\), \(\?, \?, \?, \?, \?, \?, \?\)$/);
    expect(execute.mock.calls[1][1]).toEqual([
      10, "TEAM2", 1, "AAA111", 2, 1, 7,
      10, "TEAM2", 2, "BBB222", 0, 0, 7,
    ]);
  });

  it("une liste vide efface seulement", async () => {
    const { execute, connection } = conn();
    await replaceMatchMaps(connection, 10, "FINAL", [], null);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("promeut la proposition retenue en résultat, puis efface les propositions", async () => {
    const { execute, connection } = conn();
    await promoteReportedMaps(connection, 10, "TEAM1");
    const sqls = execute.mock.calls.map((c) => flat(c[0]));
    expect(sqls[0]).toBe("DELETE FROM bg_match_maps WHERE match_id = ? AND source = 'FINAL'");
    expect(sqls[1]).toMatch(/INSERT INTO bg_match_maps .* SELECT match_id, 'FINAL'.* WHERE match_id = \? AND source = \?$/);
    expect(execute.mock.calls[1][1]).toEqual([10, "TEAM1"]);
    expect(sqls[2]).toBe("DELETE FROM bg_match_maps WHERE match_id = ? AND source IN ('TEAM1', 'TEAM2')");
  });

  it("lit un jeu dans l'ordre joué, et rien sur une réponse inattendue", async () => {
    const row = { match_id: 10, source: "FINAL", map_number: 1, replay_code: "AAA111", team1_score: 2, team2_score: 1 };
    expect(await loadMatchMaps(conn([[[row], []]]).connection, 10, "FINAL")).toEqual([
      { mapNumber: 1, replayCode: "AAA111", team1Score: 2, team2Score: 1 },
    ]);
    expect(await loadMatchMaps(conn([[{ affectedRows: 0 }, []]]).connection, 10, "FINAL")).toEqual([]);
  });

  it("lit tout le plateau en une requête, rangé par match et par jeu", async () => {
    const rows = [
      { match_id: 10, source: "FINAL", map_number: 1, replay_code: "F1", team1_score: 1, team2_score: 0 },
      { match_id: 10, source: "TEAM2", map_number: 1, replay_code: "T2", team1_score: 0, team2_score: 1 },
      { match_id: 11, source: "TEAM1", map_number: 1, replay_code: "T1", team1_score: 1, team2_score: 0 },
    ];
    const { execute, connection } = conn([[rows, []]]);
    const byMatch = await loadMapsByMatch(connection, [10, 11]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toEqual([10, 11]);
    expect(byMatch.get(10)?.final.map((m) => m.replayCode)).toEqual(["F1"]);
    expect(byMatch.get(10)?.team2.map((m) => m.replayCode)).toEqual(["T2"]);
    expect(byMatch.get(11)?.team1.map((m) => m.replayCode)).toEqual(["T1"]);
  });

  it("aucun match, aucune requête", async () => {
    const { execute, connection } = conn();
    expect((await loadMapsByMatch(connection, [])).size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("attachMatchMaps — détail posé sur l'instantané (flux et REST de secours)", () => {
  const map = (code: string, t1: number, t2: number, n: number) => ({ mapNumber: n, replayCode: code, team1Score: t1, team2Score: t2 });

  it("pose le résultat retenu et les propositions qui expliquent leur score", () => {
    const match = bracketMatch({
      id: 10,
      team1Score: 1,
      team2Score: 0,
      team1Report: { team1Score: 1, team2Score: 0, reportedAt: "", maps: [] },
    });
    const [out] = attachMatchMaps([match], new Map([[10, {
      final: [map("F1", 2, 1, 1), map("F2", 1, 1, 2)],
      team1: [map("T1", 3, 0, 1)],
      team2: [],
    }]]));
    expect(out.maps.map((m) => m.replayCode)).toEqual(["F1", "F2"]);
    expect(out.team1Report?.maps.map((m) => m.replayCode)).toEqual(["T1"]);
    expect(out.team2Report).toBeNull();
  });

  it("tait un détail qui contredit le score (score corrigé à la main, match d'avant les maps)", () => {
    const match = bracketMatch({ id: 10, team1Score: 3, team2Score: 0 });
    const [out] = attachMatchMaps([match], new Map([[10, { final: [map("F1", 2, 1, 1)], team1: [], team2: [] }]]));
    expect(out.maps).toEqual([]);
  });

  it("laisse un match sans ligne exactement comme avant", () => {
    const match = bracketMatch({ id: 12, team1Score: 2, team2Score: 1 });
    expect(attachMatchMaps([match], new Map())).toEqual([match]);
  });
});
