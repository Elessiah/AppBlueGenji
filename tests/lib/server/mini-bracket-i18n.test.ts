import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { loadMiniBracket } from "@/lib/server/tournaments/bracket-loader";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";
import { readDatabaseSource } from "../../helpers/read-source";

/** Le mini-arbre de l'accueil : une place vide ne montre jamais un libellé d'attente français sous `/en`. */
const ROWS = [
  { id: 1, team1_id: 11, team2_id: null, team1_name: "Alpha", team2_name: null, team1_placeholder: null, team2_placeholder: "Gagnant du upper bracket", team1_score: null, team2_score: null },
  { id: 2, team1_id: null, team2_id: null, team1_name: null, team2_name: null, team1_placeholder: null, team2_placeholder: null, team1_score: 1, team2_score: 0 },
];

async function mockRows(rows: object[]) {
  const { getDatabase } = await import("@/lib/server/database");
  const execute = jest.fn<SqlQuery>().mockResolvedValue([rows]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

beforeEach(async () => {
  jest.clearAllMocks();
  clearCache();
  await mockRows(ROWS);
});

describe("loadMiniBracket", () => {
  it("français : libellés d'attente traduits à la lecture, « À venir » sinon", async () => {
    expect(await loadMiniBracket(5)).toEqual([
      { a: "Alpha", b: "Vainqueur du tableau principal", sa: "—", sb: "—" },
      { a: "À venir", b: "À venir", sa: 1, sb: 0 },
    ]);
  });

  it("anglais : toute place vide se lit « TBD »", async () => {
    expect(await loadMiniBracket(5, "en")).toEqual([
      { a: "Alpha", b: "TBD", sa: "—", sb: "—" },
      { a: "TBD", b: "TBD", sa: 1, sb: 0 },
    ]);
  });

  it("lit la base une seule fois pour les deux langues : seule la place vide change", async () => {
    const execute = await mockRows(ROWS);
    await loadMiniBracket(5);
    await loadMiniBracket(5, "en");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("nom saisi : forme affichable, « #id » s'il ne garde rien de visible (page lue sans compte)", async () => {
    await mockRows([{ ...ROWS[0], team1_name: "\u202EAlpha\u200B", team2_id: 12, team2_name: "\u200B\u200B" }]);
    const [row] = await loadMiniBracket(5, "en");
    expect(row.a).toBe("Alpha");
    expect(row.b).toBe("#12");
  });

  it("une place occupée sans ligne d'équipe ne se dit pas « à venir »", async () => {
    await mockRows([{ ...ROWS[0], team1_id: 11, team1_name: null }]);
    const [row] = await loadMiniBracket(5);
    expect(row.a).toBe("#11");
  });

  it("aucun match : liste vide", async () => {
    await mockRows([]);
    expect(await loadMiniBracket(5)).toEqual([]);
  });

  it("incident de lecture : liste vide, sans mise en cache du rejet", async () => {
    const { getDatabase } = await import("@/lib/server/database");
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(new Error("down")).mockResolvedValue([ROWS]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    expect(await loadMiniBracket(5)).toEqual([]);
    expect(await loadMiniBracket(5)).toHaveLength(2);
  });
});

/**
 * Colonnes déclarées d'une table : celles de son `CREATE TABLE` et celles que
 * les migrations lui ajoutent (`ADD COLUMN`). Le test précédent simulait la base
 * et n'a jamais vu que la requête lisait des colonnes absentes de `bg_matches`.
 */
function declaredColumns(table: string): Set<string> {
  const sql = readDatabaseSource();
  const columns = new Set<string>();
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("ENGINE=", start);
  for (const match of sql.slice(start, end).matchAll(/^\s+([a-z0-9_]+)\s+[A-Z]+/gm)) {
    columns.add(match[1]);
  }
  for (const match of sql.matchAll(new RegExp(String.raw`ALTER TABLE ${table}\s+ADD COLUMN (?:IF NOT EXISTS )?([a-z0-9_]+)`, "g"))) {
    columns.add(match[1]);
  }
  return columns;
}

describe("loadMiniBracket — requête confrontée au schéma réel", () => {
  it("ne lit que des colonnes déclarées de bg_matches (m.) et bg_teams (t1., t2.)", async () => {
    const execute = await mockRows(ROWS);
    await loadMiniBracket(5);
    const query = String(execute.mock.calls[0][0]);
    const matches = declaredColumns("bg_matches");
    const teams = declaredColumns("bg_teams");
    expect(matches.has("team1_placeholder")).toBe(true);
    expect(teams.has("name")).toBe(true);
    expect(matches.has("team1_name")).toBe(false);
    const refs = [...query.matchAll(/\b(m|t1|t2)\.([a-z0-9_]+)/g)].map(([, alias, column]) => `${alias}.${column}`);
    expect(refs.length).toBeGreaterThan(0);
    const undeclared = refs.filter((ref) => {
      const [alias, column] = ref.split(".");
      return !(alias === "m" ? matches : teams).has(column);
    });
    expect(undeclared).toEqual([]);
    // Toute colonne lue est qualifiée : une colonne nue échapperait à ce contrôle.
    const selectList = query.slice(query.indexOf("SELECT") + 6, query.indexOf("FROM"));
    for (const item of selectList.split(",")) expect(item.trim()).toMatch(/^(m|t1|t2)\./);
  });
});
