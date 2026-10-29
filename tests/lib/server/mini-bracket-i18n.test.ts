import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import {
  type MiniBracketRow,
  loadMiniBracket,
  pickMiniBracketMatches,
} from "@/lib/server/tournaments/bracket-loader";
import { clearCache } from "@/lib/server/cache";
import { invalidateLandingAggregates } from "@/lib/server/landing-cache";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";
import { readDatabaseSource } from "../../helpers/read-source";

/** Le mini-arbre de l'accueil : une place vide ne montre jamais un libellé d'attente français sous `/en`. */
const MATCH = { phase_position: 1, bracket: "UPPER", round_number: 1, status: "PENDING", is_bye: 0 };
const ROWS = [
  { ...MATCH, match_number: 1, team1_id: 11, team2_id: null, team1_name: "Alpha", team2_name: null, team1_placeholder: null, team2_placeholder: "Gagnant du upper bracket", team1_score: null, team2_score: null },
  { ...MATCH, match_number: 2, team1_id: null, team2_id: null, team1_name: null, team2_name: null, team1_placeholder: null, team2_placeholder: null, team1_score: 1, team2_score: 0 },
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

  it("nom saisi : forme affichable, « Team #id » s'il ne garde rien de visible (page lue sans compte)", async () => {
    await mockRows([{ ...ROWS[0], team1_name: "\u202EAlpha\u200B", team2_id: 12, team2_name: "\u200B\u200B" }]);
    const [row] = await loadMiniBracket(5, "en");
    expect(row.a).toBe("Alpha");
    expect(row.b).toBe("Team #12");
  });

  it("une place occupée sans ligne d'équipe ne se dit pas « à venir »", async () => {
    await mockRows([{ ...ROWS[0], team1_id: 11, team1_name: null }]);
    const [row] = await loadMiniBracket(5);
    expect(row.a).toBe("Équipe #11");
  });

  it("une entrée solo sans nom affichable se replie sur « Joueur » / « Player », jamais « Équipe #id »", async () => {
    await mockRows([{ ...ROWS[0], team1_id: 11, team1_name: "​", team1_solo: 1 }]);
    const [fr] = await loadMiniBracket(5);
    const [en] = await loadMiniBracket(5, "en");
    expect(fr.a).toBe("Joueur");
    expect(en.a).toBe("Player");
  });

  it("aucun match : liste vide", async () => {
    await mockRows([]);
    expect(await loadMiniBracket(5)).toEqual([]);
  });

  it("loadMiniBracket_byeWithoutOpponent_saysBypassNotPending", async () => {
    await mockRows([{ ...ROWS[0], status: "COMPLETED", is_bye: 1, team2_placeholder: null }]);
    expect((await loadMiniBracket(5))[0].b).toBe("Exempt");
    expect((await loadMiniBracket(5, "en"))[0].b).toBe("Bye");
  });

  it("loadMiniBracket_eliminationByeClosedWithoutFlag_saysBypass", async () => {
    // Simple / double élimination : `byes.ts` clôt l'exemption sans `is_bye`.
    await mockRows([{ ...ROWS[0], status: "COMPLETED", is_bye: 0, team2_placeholder: null }]);
    expect((await loadMiniBracket(5))[0].b).toBe("Exempt");
    expect((await loadMiniBracket(5, "en"))[0].b).toBe("Bye");
  });

  it("loadMiniBracket_pendingWithoutBye_keepsPendingLabel", async () => {
    await mockRows([{ ...ROWS[0], is_bye: 0, team2_placeholder: null }]);
    expect((await loadMiniBracket(5))[0].b).toBe("À venir");
  });

  it("loadMiniBracket_driverReturnsStrings_coercesNumbers", async () => {
    // `bigNumberStrings` : identifiants et numéros peuvent arriver en chaîne.
    await mockRows([
      { ...ROWS[0], phase_position: "1", round_number: "2", match_number: "2", team1_id: "11" },
      { ...ROWS[0], phase_position: "1", round_number: "2", match_number: "1", team1_id: "13", team1_name: "Gamma" },
    ]);
    expect((await loadMiniBracket(5)).map((row) => row.a)).toEqual(["Gamma", "Alpha"]);
  });

  it("loadMiniBracket_afterAggregatesInvalidation_readsDatabaseAgain", async () => {
    const execute = await mockRows(ROWS);
    await loadMiniBracket(5);
    invalidateLandingAggregates();
    await loadMiniBracket(5);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("loadMiniBracket_query_readsRoundColumnsWithoutFixedRound", async () => {
    const execute = await mockRows(ROWS);
    await loadMiniBracket(5);
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain("LEFT JOIN bg_tournament_phases p ON p.id = m.phase_id");
    for (const column of ["p.position AS phase_position", "m.bracket", "m.round_number", "m.match_number", "m.status", "m.is_bye"]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toMatch(/LIMIT/i);
  });

  it("incident de lecture : liste vide, sans mise en cache du rejet", async () => {
    const { getDatabase } = await import("@/lib/server/database");
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(new Error("down")).mockResolvedValue([ROWS]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    expect(await loadMiniBracket(5)).toEqual([]);
    expect(await loadMiniBracket(5)).toHaveLength(2);
  });
});

function row(overrides: Partial<MiniBracketRow>): MiniBracketRow {
  return {
    phaseOrder: 1,
    bracket: "UPPER",
    roundNumber: 1,
    matchNumber: 1,
    status: "PENDING",
    isBye: false,
    team1Id: 1,
    team2Id: 2,
    team1Name: "A",
    team2Name: "B",
    team1Placeholder: null,
    team2Placeholder: null,
    team1Score: null,
    team2Score: null,
    ...overrides,
  };
}

const key = (rows: MiniBracketRow[]) => rows.map((match) => `${match.phaseOrder}/${match.bracket}/${match.roundNumber}/${match.matchNumber}`);

describe("pickMiniBracketMatches", () => {
  it("pickMiniBracketMatches_noRows_returnsEmpty", () => {
    expect(pickMiniBracketMatches([])).toEqual([]);
  });

  it("pickMiniBracketMatches_firstRoundPlayed_showsCurrentRound", () => {
    const rows = [
      row({ roundNumber: 1, matchNumber: 1, status: "COMPLETED" }),
      row({ roundNumber: 1, matchNumber: 2, status: "COMPLETED" }),
      row({ roundNumber: 2, matchNumber: 1, status: "READY" }),
      row({ roundNumber: 3, matchNumber: 1, status: "PENDING" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["1/UPPER/2/1"]);
  });

  it("pickMiniBracketMatches_everythingPlayed_showsLastRound", () => {
    const rows = [
      row({ roundNumber: 1, status: "COMPLETED" }),
      row({ roundNumber: 4, status: "COMPLETED" }),
      row({ roundNumber: 2, status: "COMPLETED" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["1/UPPER/4/1"]);
  });

  it("pickMiniBracketMatches_firstPhaseFinished_showsNextPhase", () => {
    const rows = [
      row({ phaseOrder: 1, roundNumber: 3, status: "COMPLETED" }),
      row({ phaseOrder: 2, roundNumber: 1, status: "READY" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["2/UPPER/1/1"]);
  });

  it("pickMiniBracketMatches_allPhasesFinished_showsLastPhase", () => {
    const rows = [
      row({ phaseOrder: 2, roundNumber: 2, status: "COMPLETED" }),
      row({ phaseOrder: 1, roundNumber: 5, status: "COMPLETED" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["2/UPPER/2/1"]);
  });

  it("pickMiniBracketMatches_upperAndLower_prefersUpper", () => {
    const rows = [
      row({ bracket: "LOWER", roundNumber: 1, status: "READY" }),
      row({ bracket: "UPPER", roundNumber: 2, status: "READY" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["1/UPPER/2/1"]);
  });

  it("pickMiniBracketMatches_upperFinishedLowerOpen_showsLower", () => {
    // Double élimination à sa finale du bas : l'`UPPER` fini n'est plus le plateau.
    const rows = [
      row({ bracket: "UPPER", roundNumber: 3, status: "COMPLETED" }),
      row({ bracket: "LOWER", roundNumber: 4, status: "READY" }),
      row({ bracket: "GRAND", roundNumber: 1, status: "PENDING" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["1/LOWER/4/1"]);
  });

  it("pickMiniBracketMatches_onlyGrandFinalOpen_showsGrandFinal", () => {
    const rows = [
      row({ bracket: "UPPER", roundNumber: 3, status: "COMPLETED" }),
      row({ bracket: "LOWER", roundNumber: 4, status: "COMPLETED" }),
      row({ bracket: "GRAND", roundNumber: 1, status: "READY" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["1/GRAND/1/1"]);
  });

  it("pickMiniBracketMatches_allBracketsFinished_showsUpper", () => {
    const rows = [
      row({ bracket: "GRAND", roundNumber: 1, status: "COMPLETED" }),
      row({ bracket: "UPPER", roundNumber: 3, status: "COMPLETED" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["1/UPPER/3/1"]);
  });

  it("pickMiniBracketMatches_roundHalfPlayed_showsOpenMatchesFirst", () => {
    // Ronde suisse de 8 matchs, 1 à 4 joués : la vignette montre ceux à jouer.
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((matchNumber) =>
      row({ matchNumber, status: matchNumber <= 4 ? "COMPLETED" : "READY" }),
    );
    expect(pickMiniBracketMatches(rows).map((match) => match.matchNumber)).toEqual([5, 6, 7, 8]);
  });

  it("pickMiniBracketMatches_noUpper_takesFirstBracketInOrder", () => {
    const rows = [
      row({ bracket: "GRAND", status: "READY" }),
      row({ bracket: "LOWER", status: "READY" }),
    ];
    expect(key(pickMiniBracketMatches(rows))).toEqual(["1/LOWER/1/1"]);
  });

  it("pickMiniBracketMatches_moreThanFourMatches_keepsFourByMatchNumber", () => {
    const rows = [5, 3, 1, 4, 2, 6].map((matchNumber) => row({ matchNumber }));
    expect(pickMiniBracketMatches(rows).map((match) => match.matchNumber)).toEqual([1, 2, 3, 4]);
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
  it("ne lit que des colonnes déclarées de bg_matches (m.), bg_tournament_phases (p.) et bg_teams (t1., t2.)", async () => {
    const execute = await mockRows(ROWS);
    await loadMiniBracket(5);
    const query = String(execute.mock.calls[0][0]);
    const matches = declaredColumns("bg_matches");
    const phases = declaredColumns("bg_tournament_phases");
    const teams = declaredColumns("bg_teams");
    expect(phases.has("position")).toBe(true);
    expect(matches.has("team1_placeholder")).toBe(true);
    expect(teams.has("name")).toBe(true);
    expect(matches.has("team1_name")).toBe(false);
    const refs = [...query.matchAll(/\b(m|p|t1|t2)\.([a-z0-9_]+)/g)].map(([, alias, column]) => `${alias}.${column}`);
    expect(refs.length).toBeGreaterThan(0);
    const tables: Record<string, Set<string>> = { m: matches, p: phases, t1: teams, t2: teams };
    const undeclared = refs.filter((ref) => {
      const [alias, column] = ref.split(".");
      return !tables[alias].has(column);
    });
    expect(undeclared).toEqual([]);
    // Toute colonne lue est qualifiée : une colonne nue échapperait à ce contrôle.
    const selectList = query.slice(query.indexOf("SELECT") + 6, query.indexOf("FROM"));
    for (const item of selectList.split(",")) expect(item.trim()).toMatch(/^(\(?(m|p|t1|t2)\.)/);
  });
});
