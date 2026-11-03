import { describe, expect, it, jest } from "@jest/globals";
import {
  REPORTED_MAP_SOURCES,
  clearMapSets,
  loadMapsByMatch,
  loadFreshMatchProposals,
  loadMatchMaps,
  loadStoredMapSet,
  promoteReportedMaps,
  replaceMatchMaps,
  rewriteMapSet,
  type StoredMap,
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
  it("remplace un jeu : efface l'existant puis insère une ligne par map, numérotées depuis 1", async () => {
    const { execute, connection } = conn([[[{ found: 1 }], []]]);
    await replaceMatchMaps(connection, 10, "TEAM2", [
      { replayCode: "AAA111", team1Score: 2, team2Score: 1 },
      { replayCode: "BBB222", team1Score: 0, team2Score: 0 },
    ], 7);

    expect(flat(execute.mock.calls[0][0])).toBe("SELECT 1 FROM bg_match_maps WHERE match_id = ? AND source = ? LIMIT 1 FOR UPDATE");
    expect(flat(execute.mock.calls[1][0])).toBe("DELETE FROM bg_match_maps WHERE match_id = ? AND source = ?");
    expect(execute.mock.calls[1][1]).toEqual([10, "TEAM2"]);
    expect(flat(execute.mock.calls[2][0])).toMatch(/^INSERT INTO bg_match_maps .* VALUES \(\?, \?, \?, \?, \?, \?, \?\), \(\?, \?, \?, \?, \?, \?, \?\) ON DUPLICATE KEY UPDATE /);
    expect(execute.mock.calls[2][1]).toEqual([
      10, "TEAM2", 1, "AAA111", 2, 1, 7,
      10, "TEAM2", 2, "BBB222", 0, 0, 7,
    ]);
  });

  it("premier report (jeu connu vide) : insertion seule, sans lecture verrouillante d'un intervalle vide", async () => {
    const { execute, connection } = conn();
    await replaceMatchMaps(connection, 10, "TEAM1", [{ replayCode: "AAA111", team1Score: 1, team2Score: 0 }], 7, {
      knownEmpty: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(flat(execute.mock.calls[0][0])).toMatch(/^INSERT INTO bg_match_maps .* ON DUPLICATE KEY UPDATE /);
    expect(execute.mock.calls.some(([sql]) => /FOR UPDATE/.test(String(sql)))).toBe(false);
  });

  it("une liste vide efface seulement", async () => {
    const { execute, connection } = conn([[[{ found: 1 }], []]]);
    await replaceMatchMaps(connection, 10, "FINAL", [], null);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("n'efface rien quand il n'y a rien : pas de verrou d'intervalle, pas d'interblocage", async () => {
    const { execute, connection } = conn();
    await replaceMatchMaps(connection, 10, "TEAM1", [{ replayCode: "AAA111", team1Score: 1, team2Score: 0 }], 7);
    const sqls = execute.mock.calls.map((c) => flat(c[0]));
    expect(sqls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
    expect(sqls.at(-1)).toMatch(/^INSERT INTO bg_match_maps/);
  });

  it("promeut la proposition retenue en résultat, par la clé unique (les propositions partent à la clôture)", async () => {
    const at = new Date("2026-10-05T20:00:00Z");
    const proposal = [
      { match_id: 10, source: "TEAM1", map_number: 1, replay_code: "AAA111", team1_score: 2, team2_score: 0, submitted_by_user_id: 7, submitted_at: at },
      { match_id: 10, source: "TEAM1", map_number: 2, replay_code: "BBB222", team1_score: 1, team2_score: 1, submitted_by_user_id: 7, submitted_at: at },
    ];
    const { execute, connection } = conn([[proposal, []], [{ affectedRows: 2 }, []], [[{ found: 1 }], []]]);
    await promoteReportedMaps(connection, 10, "TEAM1");
    const sqls = execute.mock.calls.map((c) => flat(c[0]));
    expect(sqls[0]).toMatch(/^SELECT .* FROM bg_match_maps WHERE match_id = \? AND source = \? ORDER BY map_number FOR UPDATE$/);
    // Réécrite par VALUES, jamais par INSERT … SELECT sur la table elle-même.
    expect(sqls[1]).toMatch(/INSERT INTO bg_match_maps .* VALUES \(\?, 'FINAL', .* ON DUPLICATE KEY UPDATE replay_code = VALUES\(replay_code\)/);
    expect(sqls[1]).not.toMatch(/SELECT/);
    expect(execute.mock.calls[1][1]).toEqual([10, 1, "AAA111", 2, 0, 7, at, 10, 2, "BBB222", 1, 1, 7, at]);
    // Un FINAL plus long que la proposition perd ses maps en trop.
    expect(sqls[3]).toBe("DELETE FROM bg_match_maps WHERE match_id = ? AND source = 'FINAL' AND map_number > ?");
    expect(execute.mock.calls[3][1]).toEqual([10, 2]);
  });

  it("ne touche à rien quand la proposition a déjà été promue (clôture concurrente)", async () => {
    const { execute, connection } = conn();
    await promoteReportedMaps(connection, 10, "TEAM2");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("efface des jeux sur plusieurs matchs, et seulement s'il y en a", async () => {
    const present = conn([[[{ found: 1 }], []]]);
    await clearMapSets(present.connection, [10, 11], REPORTED_MAP_SOURCES);
    expect(flat(present.execute.mock.calls[1][0])).toBe(
      "DELETE FROM bg_match_maps WHERE match_id IN (?, ?) AND source IN (?, ?)",
    );
    expect(present.execute.mock.calls[1][1]).toEqual([10, 11, "TEAM1", "TEAM2"]);

    const absent = conn();
    await clearMapSets(absent.connection, [10], ["FINAL"]);
    expect(absent.execute).toHaveBeenCalledTimes(1);

    const none = conn();
    await clearMapSets(none.connection, [], ["FINAL"]);
    expect(none.execute).not.toHaveBeenCalled();
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
    const byMatch = await loadMapsByMatch(connection, [10, 11], ["FINAL", "TEAM1", "TEAM2"]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toEqual([10, 11, "FINAL", "TEAM1", "TEAM2"]);
    // Par défaut, le seul détail retenu — celui que porte l'instantané.
    await loadMapsByMatch(connection, [10]);
    expect(execute.mock.calls[1][1]).toEqual([10, "FINAL"]);
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

describe("loadStoredMapSet", () => {
  it("loadStoredMapSet_rowsFound_returnsMapsWithPrimaryKeyInPlayedOrder", async () => {
    const { execute, connection } = conn([
      [[
        { id: 81, map_number: 1, replay_code: "AAA111", team1_score: 2, team2_score: 1 },
        { id: 82, map_number: 2, replay_code: "BBB222", team1_score: 0, team2_score: 2 },
      ], []],
    ]);

    const stored = await loadStoredMapSet(connection, 70, "FINAL");

    expect(stored).toEqual([
      { id: 81, mapNumber: 1, replayCode: "AAA111", team1Score: 2, team2Score: 1 },
      { id: 82, mapNumber: 2, replayCode: "BBB222", team1Score: 0, team2Score: 2 },
    ]);
    expect(flat(execute.mock.calls[0][0])).toBe(
      "SELECT id, map_number, replay_code, team1_score, team2_score FROM bg_match_maps WHERE match_id = ? AND source = ? ORDER BY map_number",
    );
    expect(execute.mock.calls[0][1]).toEqual([70, "FINAL"]);
  });

  it("loadStoredMapSet_noRow_returnsEmptyList", async () => {
    const { connection } = conn([[[], []]]);

    await expect(loadStoredMapSet(connection, 70, "FINAL")).resolves.toEqual([]);
  });

  // Un résultat inattendu ne passe pas pour un jeu vide (l'écriture
  // insérerait par-dessus des maps existantes).
  it("loadStoredMapSet_malformedResult_throwsInsteadOfReportingEmpty", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue(undefined);

    await expect(loadStoredMapSet(fakeConnection({ execute }), 70, "FINAL")).rejects.toThrow(TypeError);
  });
});

/**
 * Revue perf #542 : le jeu FINAL se réécrit par clé primaire — ni parcours de
 * la clé unique, ni mise à jour par doublon.
 */
describe("rewriteMapSet", () => {
  const first: StoredMap = { id: 81, mapNumber: 1, replayCode: "AAA111", team1Score: 2, team2Score: 1 };
  const second: StoredMap = { id: 82, mapNumber: 2, replayCode: "BBB222", team1Score: 0, team2Score: 2 };
  const third = { replayCode: "CCC333", team1Score: 2, team2Score: 0 };
  const sameAs = (map: StoredMap) => ({ replayCode: map.replayCode, team1Score: map.team1Score, team2Score: map.team2Score });

  it("rewriteMapSet_unchangedMaps_runsNoStatement", async () => {
    const { execute, connection } = conn();

    await rewriteMapSet(connection, 10, "FINAL", [first, second], [sameAs(first), sameAs(second)], 7);

    expect(execute).not.toHaveBeenCalled();
  });

  it("rewriteMapSet_growing_insertsOnlyNewMapNumberedAfterStored", async () => {
    const { execute, connection } = conn();

    await rewriteMapSet(connection, 10, "FINAL", [first, second], [sameAs(first), sameAs(second), third], 7);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(flat(execute.mock.calls[0][0])).toMatch(/^INSERT INTO bg_match_maps /);
    expect(execute.mock.calls[0][1]).toEqual([10, "FINAL", 3, "CCC333", 2, 0, 7]);
  });

  it("rewriteMapSet_changedMap_updatesByPrimaryKeyOnly", async () => {
    const { execute, connection } = conn();

    await rewriteMapSet(connection, 10, "FINAL", [first, second], [sameAs(first), { ...sameAs(second), team1Score: 1 }], 7);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(flat(execute.mock.calls[0][0])).toBe(
      "UPDATE bg_match_maps SET map_number = ?, replay_code = ?, team1_score = ?, team2_score = ?, submitted_by_user_id = ?, submitted_at = CURRENT_TIMESTAMP WHERE id = ?",
    );
    expect(execute.mock.calls[0][1]).toEqual([2, "BBB222", 1, 2, 7, 82]);
  });

  it("rewriteMapSet_shrinking_deletesExtraMapsByPrimaryKey", async () => {
    const { execute, connection } = conn();

    await rewriteMapSet(connection, 10, "FINAL", [first, second], [sameAs(first)], 7);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(flat(execute.mock.calls[0][0])).toBe("DELETE FROM bg_match_maps WHERE id IN (?)");
    expect(execute.mock.calls[0][1]).toEqual([82]);
  });

  it("rewriteMapSet_emptyList_deletesEveryStoredMapWithoutInsert", async () => {
    const { execute, connection } = conn();

    await rewriteMapSet(connection, 10, "FINAL", [first, second], [], 7);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(flat(execute.mock.calls[0][0])).toBe("DELETE FROM bg_match_maps WHERE id IN (?, ?)");
    expect(execute.mock.calls[0][1]).toEqual([81, 82]);
  });

  it("rewriteMapSet_emptyStoredSet_insertsFromMapOne", async () => {
    const { execute, connection } = conn();

    await rewriteMapSet(connection, 10, "FINAL", [], [third], 7);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toEqual([10, "FINAL", 1, "CCC333", 2, 0, 7]);
  });

  // Revue sécurité #542 (cycle 4) : un jeu stocké troué se renumérote 1..n —
  // sinon la nouvelle map reprendrait un numéro gardé (doublon de la clé
  // unique) et « Map 1 » manquerait.
  it("rewriteMapSet_gappedStoredSet_renumbersKeptRowThenInsertsAfter", async () => {
    const { execute, connection } = conn();
    const thirdStored: StoredMap = { ...second, id: 83, mapNumber: 3 };

    await rewriteMapSet(connection, 10, "FINAL", [first, thirdStored], [sameAs(first), sameAs(thirdStored), third], 7);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(flat(execute.mock.calls[0][0])).toMatch(/^UPDATE bg_match_maps SET map_number = \?/);
    expect(execute.mock.calls[0][1]).toEqual([2, "BBB222", 0, 2, 7, 83]);
    expect(execute.mock.calls[1][1]).toEqual([10, "FINAL", 3, "CCC333", 2, 0, 7]);
  });

  it("rewriteMapSet_setStartingAtTwo_renumbersFromOne", async () => {
    const { execute, connection } = conn();
    const atTwo: StoredMap = { ...first, id: 82, mapNumber: 2 };
    const atThree: StoredMap = { ...second, id: 83, mapNumber: 3 };

    await rewriteMapSet(connection, 10, "FINAL", [atTwo, atThree], [sameAs(atTwo), sameAs(atThree)], 7);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toEqual([1, "AAA111", 2, 1, 7, 82]);
    expect(execute.mock.calls[1][1]).toEqual([2, "BBB222", 0, 2, 7, 83]);
  });
});

/**
 * Revue perf #542 : les maps ne se joignent que pour un lecteur engagé dans
 * le match — un lecteur étranger ne fait remonter que la ligne du match.
 */
describe("loadFreshMatchProposals — jointure des maps", () => {
  const target = { tournamentId: 5, matchId: 70 };
  const noReport = () => null;
  const head = { team1_id: 42, team2_id: 43, status: "AWAITING_CONFIRMATION", source: null };

  it("loadFreshMatchProposals_allScope_joinsMapsWithoutReaderFilter", async () => {
    const { execute, connection } = conn([[[head], []]]);

    await loadFreshMatchProposals(connection, target, { all: true, teamIds: [42] }, noReport);

    expect(flat(execute.mock.calls[0][0])).toContain("ON mm.match_id = m.id AND mm.source IN (?, ?) WHERE");
    expect(execute.mock.calls[0][1]).toEqual(["TEAM1", "TEAM2", 70, 5]);
  });

  it("loadFreshMatchProposals_readerTeams_joinsMapsOnlyForMatchesOfThoseTeams", async () => {
    const { execute, connection } = conn([[[head], []]]);

    await loadFreshMatchProposals(connection, target, { all: false, teamIds: [42, 99] }, noReport);

    expect(flat(execute.mock.calls[0][0])).toContain(
      "AND mm.source IN (?, ?) AND (m.team1_id IN (?, ?) OR m.team2_id IN (?, ?)) WHERE",
    );
    expect(execute.mock.calls[0][1]).toEqual(["TEAM1", "TEAM2", 42, 99, 42, 99, 70, 5]);
  });

  it("loadFreshMatchProposals_noReaderTeam_joinsNoMapAndReturnsNull", async () => {
    const { execute, connection } = conn([[[head], []]]);

    const result = await loadFreshMatchProposals(connection, target, { all: false, teamIds: [] }, noReport);

    expect(flat(execute.mock.calls[0][0])).toContain("AND mm.source IN (?, ?) AND FALSE WHERE");
    expect(execute.mock.calls[0][1]).toEqual(["TEAM1", "TEAM2", 70, 5]);
    expect(result).toBeNull();
  });
});

describe("attachMatchMaps — détail posé sur l'instantané (flux et REST de secours)", () => {
  const map = (code: string, t1: number, t2: number, n: number) => ({ mapNumber: n, replayCode: code, team1Score: t1, team2Score: t2 });

  it("pose le résultat retenu, jamais le détail des propositions", () => {
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
    // Jamais le détail d'une proposition dans l'instantané diffusé : il ne
    // voyage que dans le contexte des deux engagés et de l'arbitrage.
    expect(out.team1Report?.maps).toEqual([]);
    expect(out.team2Report).toBeNull();
  });

  it("pose le détail retenu tel quel, sans le confronter au score : tout score en est dérivé", () => {
    // Plus de score à la main : aucun filtre de cohérence ne tait le détail.
    const final = [map("F1", 2, 1, 1), map("", 0, 2, 2)];
    const match = bracketMatch({ id: 10, team1Score: 3, team2Score: 0 });
    const [out] = attachMatchMaps([match], new Map([[10, { final, team1: [], team2: [] }]]));
    expect(out.maps).toEqual(final);
  });

  it("tait le détail d'un forfait, quel que soit le chemin qui l'a posé", () => {
    const sets = new Map([[10, { final: [map("F1", 2, 0, 1), map("F2", 2, 0, 2)], team1: [], team2: [] }]]);
    const forfeit = bracketMatch({ id: 10, team1Score: 2, team2Score: 0, forfeitTeamId: 2 });
    expect(attachMatchMaps([forfeit], sets)[0].maps).toEqual([]);
    const doubleForfeit = bracketMatch({ id: 10, team1Score: 2, team2Score: 0, doubleForfeit: true });
    expect(attachMatchMaps([doubleForfeit], sets)[0].maps).toEqual([]);
  });

  it("laisse un match sans ligne exactement comme avant", () => {
    const match = bracketMatch({ id: 12, team1Score: 2, team2Score: 1 });
    expect(attachMatchMaps([match], new Map())).toEqual([match]);
  });
});
