import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Caractérisation de la génération des plateaux à élimination.
 *
 * Chaque cas rejoue la génération contre une base simulée et relève, dans
 * l'ordre, **toutes** les écritures : rencontres créées, liens de progression,
 * libellés d'attente, engagées posées, taille du plateau, résolution des
 * exemptions. L'empreinte de ce relevé est comparée à celle du code d'origine :
 * un refactor qui déplace une écriture, en change l'ordre ou un paramètre fait
 * échouer le cas. Les comptes sont gardés en clair pour lire un échec.
 */

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/phases-repository");
jest.mock("@/lib/server/tournaments/byes");

import { createBracketIfMissing } from "@/lib/server/tournaments/bracket-generator";
import { createSingleEliminationBracket } from "@/lib/server/tournaments/bracket-single";
import { createDoubleEliminationBracket } from "@/lib/server/tournaments/bracket-double";
import {
  createMatch,
  deleteAllMatches,
  deletePhaseMatches,
  hasExistingMatches,
  loadRegisteredTeamIds,
  setMatchParticipants,
  updateTournamentBracketSize,
} from "@/lib/server/tournaments/repository";
import { loadPhaseTeamIds } from "@/lib/server/tournaments/phases-repository";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { type SqlQuery, fakeConnection } from "../../helpers/sql-double";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import type { RowOverrides } from "../../helpers/row-overrides";
import { tournamentRow } from "../../helpers/tournament-rows";

let trace: string[] = [];
let nextId = 100;
let phaseRow: { c: number; bracket_size: number | null } = { c: 0, bracket_size: null };

const execute = jest.fn<SqlQuery>(async (sql, params) => {
  const text = sql.replace(/\s+/g, " ").trim();
  trace.push(`sql ${text} ${JSON.stringify(params)}`);
  if (text.startsWith("SELECT")) return [[phaseRow], []];
  return [{ affectedRows: 1 }, []];
});
const connection = fakeConnection({ execute });

function tournament(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  return tournamentRow({
    id: 9,
    format: "SINGLE",
    bracket_size: null,
    has_third_place_match: 0,
    ...overrides,
  });
}

function teams(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 1000 + index * 7);
}

beforeEach(() => {
  jest.clearAllMocks();
  trace = [];
  nextId = 100;
  phaseRow = { c: 0, bracket_size: null };
  jest.mocked(createMatch).mockImplementation(async (_c, tournamentId, bracket, round, number, phaseId) => {
    nextId += 1;
    trace.push(`create ${nextId} ${tournamentId} ${bracket} ${round} ${number} ${phaseId}`);
    return nextId;
  });
  jest.mocked(setMatchParticipants).mockImplementation(async (_c, matchId, team1, team2, status) => {
    trace.push(`participants ${matchId} ${team1} ${team2} ${status}`);
  });
  jest.mocked(updateTournamentBracketSize).mockImplementation(async (_c, tournamentId, size) => {
    trace.push(`bracketSize ${tournamentId} ${size}`);
  });
  jest.mocked(tryAutoResolveByes).mockImplementation(async (_c, tournamentId, phaseId) => {
    trace.push(`byes ${tournamentId} ${phaseId}`);
  });
  jest.mocked(hasExistingMatches).mockResolvedValue(false);
  jest.mocked(deleteAllMatches).mockImplementation(async (_c, tournamentId) => {
    trace.push(`deleteAll ${tournamentId}`);
  });
  jest.mocked(deletePhaseMatches).mockImplementation(async (_c, tournamentId, phaseId) => {
    trace.push(`deletePhase ${tournamentId} ${phaseId}`);
  });
});

function digest(): string {
  return createHash("sha256").update(trace.join("\n")).digest("hex").slice(0, 16);
}

function summary(): string {
  const creates = trace.filter((line) => line.startsWith("create")).length;
  const sql = trace.filter((line) => line.startsWith("sql")).length;
  return `${creates}/${sql}/${digest()}`;
}

const SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 32, 64];

const SINGLE_GOLDEN: Record<number, string> = {
  2: "1/0/9186a56925697d2c",
  3: "3/2/62ebdba7f5cf5d37",
  4: "3/2/ba0052870858f89f",
  5: "7/6/29126c95f05cd668",
  6: "7/6/71678fc90285ffa6",
  7: "7/6/b0a9b514b7254627",
  8: "7/6/7d9dcdfbef350efc",
  9: "15/14/4a0ab44d79447a89",
  10: "15/14/1ff70b28244bcc83",
  11: "15/14/4f2344f5f18c4d30",
  12: "15/14/f971be80c134417b",
  13: "15/14/3af1e8364858f3ac",
  14: "15/14/b6832ed288e28d09",
  15: "15/14/5ebf49ab3f0f3aa6",
  16: "15/14/81920cbb1dd03841",
  17: "31/30/db338dcfe3ccec89",
  32: "31/30/509cca15a5768a31",
  64: "63/62/0e7552bf10f161e3",
};
const SINGLE_THIRD_GOLDEN: Record<number, string> = {
  2: "1/0/9186a56925697d2c",
  3: "4/6/b23bd4b2ea6efa50",
  4: "4/6/cdfa488fac473da6",
  5: "8/10/3caf5c1627496366",
  6: "8/10/f2fb3345105b4764",
  7: "8/10/038a300692ba26a3",
  8: "8/10/20c3d05541bd5d08",
  9: "16/18/982aace09fda4fd7",
  10: "16/18/3876c01cb878068e",
  11: "16/18/00ee3e23bc5b3d7f",
  12: "16/18/232b102adae32424",
  13: "16/18/d36ee78d49dbc9ce",
  14: "16/18/c9378062bff67389",
  15: "16/18/07e1e39a82f60207",
  16: "16/18/09d28a4513abe532",
  17: "32/34/3bc8658af362e34f",
  32: "32/34/66a042129c67aff7",
  64: "64/66/1048896bc5702a89",
};
const DOUBLE_GOLDEN: Record<number, string> = {
  2: "1/0/9186a56925697d2c",
  3: "6/14/c87aa6ce0282ac41",
  4: "6/14/65a0a6462cc89f27",
  5: "14/34/51da270e3f0983d0",
  6: "14/34/00b7c0a316689948",
  7: "14/34/a718ae0eb42e71ab",
  8: "14/34/a7a5957e6a399e39",
  9: "30/74/bf0aa82cff4c5c74",
  10: "30/74/93f52a318e9edfec",
  11: "30/74/3d9ab9a6e37c5c6b",
  12: "30/74/05b88e9add0c206a",
  13: "30/74/d5159735aabdac9f",
  14: "30/74/7875dc9d51e69c22",
  15: "30/74/a006368107796275",
  16: "30/74/839ce153493619cc",
  17: "62/154/347d0589963ada53",
  32: "62/154/bf185c0273bca0d9",
  64: "126/314/5d6ddc2ab34b3d5a",
};

describe("élimination simple — relevé exact des écritures", () => {
  it.each(SIZES)("%i engagées, sans petite finale", async (size) => {
    await createSingleEliminationBracket(connection, tournament(), teams(size));
    expect(summary()).toBe(SINGLE_GOLDEN[size]);
  });

  it.each(SIZES)("%i engagées, avec petite finale", async (size) => {
    await createSingleEliminationBracket(
      connection,
      tournament({ has_third_place_match: 1 }),
      teams(size),
    );
    expect(summary()).toBe(SINGLE_THIRD_GOLDEN[size]);
  });

  it.each<[number, number]>([
    [16, 2],
    [17, 3],
    [8, 1],
    [64, 4],
  ])("phase tronquée : %i engagées, %i tours", async (size, maxRounds) => {
    await createSingleEliminationBracket(
      connection,
      tournament({ has_third_place_match: 1 }),
      teams(size),
      { phaseId: 4, maxRounds },
    );
    expect(summary()).toBe(SINGLE_TRUNCATED_GOLDEN[`${size}/${maxRounds}`]);
  });
});

const SINGLE_TRUNCATED_GOLDEN: Record<string, string> = {
  "16/2": "12/9/5be63d52908f4914",
  "17/3": "28/25/4421b6dde4080160",
  "8/1": "4/1/46124f498da5c802",
  "64/4": "60/57/b58b18fea3fc071a",
};

describe("double élimination — relevé exact des écritures", () => {
  it.each(SIZES)("%i engagées", async (size) => {
    await createDoubleEliminationBracket(connection, tournament({ format: "DOUBLE" }), teams(size));
    expect(summary()).toBe(DOUBLE_GOLDEN[size]);
  });

  it.each([2, 5, 16])("%i engagées dans une phase", async (size) => {
    await createDoubleEliminationBracket(connection, tournament({ format: "MULTI" }), teams(size), {
      phaseId: 6,
    });
    expect(summary()).toBe(DOUBLE_PHASE_GOLDEN[size]);
  });
});

const DOUBLE_PHASE_GOLDEN: Record<number, string> = {
  2: "1/1/5d45a1f844ced58a",
  5: "14/35/05aacc672e333641",
  16: "30/75/e7dea5567d1bfd3b",
};

describe("createBracketIfMissing — relevé exact des écritures", () => {
  type Case = {
    name: string;
    tournament: RowOverrides<TournamentRow>;
    registered: number;
    existing?: boolean;
    phase?: { teams: number; row: { c: number; bracket_size: number | null } };
    options?: Parameters<typeof createBracketIfMissing>[2];
  };
  const CASES: Case[] = [
    { name: "simple neuf", tournament: {}, registered: 6 },
    { name: "double neuf", tournament: { format: "DOUBLE" }, registered: 6 },
    { name: "déjà là", tournament: { bracket_size: 8 }, registered: 6, existing: true },
    { name: "taille périmée", tournament: { bracket_size: 4 }, registered: 6, existing: true },
    { name: "une seule inscrite", tournament: {}, registered: 1 },
    { name: "aucune inscrite", tournament: {}, registered: 0 },
    { name: "une inscrite, taille périmée", tournament: { bracket_size: 4 }, registered: 1, existing: true },
    {
      name: "phase neuve en double",
      tournament: { format: "MULTI" },
      registered: 0,
      phase: { teams: 5, row: { c: 0, bracket_size: null } },
      options: { phaseId: 3, format: "DOUBLE" },
    },
    {
      name: "phase déjà là",
      tournament: { format: "MULTI" },
      registered: 0,
      phase: { teams: 5, row: { c: 7, bracket_size: 8 } },
      options: { phaseId: 3, format: "SINGLE" },
    },
    {
      name: "phase périmée, petite finale imposée",
      tournament: { format: "MULTI" },
      registered: 0,
      phase: { teams: 5, row: { c: 3, bracket_size: 4 } },
      options: { phaseId: 3, format: "SINGLE", hasThirdPlaceMatch: true, maxRounds: null },
    },
    {
      name: "phase sans petite finale sur un tournoi qui en a",
      tournament: { format: "MULTI", has_third_place_match: 1 },
      registered: 0,
      phase: { teams: 4, row: { c: 0, bracket_size: null } },
      options: { phaseId: 3, format: "SINGLE", hasThirdPlaceMatch: false },
    },
    {
      name: "phase réduite à une qualifiée, plateau périmé",
      tournament: { format: "MULTI" },
      registered: 0,
      phase: { teams: 1, row: { c: 2, bracket_size: 2 } },
      options: { phaseId: 3, format: "SINGLE" },
    },
  ];

  it.each(CASES)("$name", async (testCase) => {
    jest.mocked(loadRegisteredTeamIds).mockResolvedValue(teams(testCase.registered));
    jest.mocked(hasExistingMatches).mockResolvedValue(testCase.existing ?? false);
    if (testCase.phase) {
      jest.mocked(loadPhaseTeamIds).mockResolvedValue(teams(testCase.phase.teams));
      phaseRow = testCase.phase.row;
    }

    const result = await createBracketIfMissing(
      connection,
      tournament(testCase.tournament),
      testCase.options,
    );

    expect(`${JSON.stringify(result)} ${summary()}`).toBe(GENERATOR_GOLDEN[testCase.name]);
  });
});

const GENERATOR_GOLDEN: Record<string, string> = {
  "simple neuf": '{"finished":false,"created":true} 7/6/71678fc90285ffa6',
  "double neuf": '{"finished":false,"created":true} 14/34/00b7c0a316689948',
  "déjà là": '{"finished":false,"created":false} 0/0/e3b0c44298fc1c14',
  "taille périmée": '{"finished":false,"created":true} 7/6/2ca17a10ea129d59',
  "une seule inscrite": '{"finished":true,"created":false} 0/2/bd0dd5dd9e266542',
  "aucune inscrite": '{"finished":true,"created":false} 0/1/6ec4105d9fbbd52d',
  "une inscrite, taille périmée": '{"finished":true,"created":false} 0/2/18166d2a111ed142',
  "phase neuve en double": '{"finished":false,"created":true} 14/36/7457bb37f68f0780',
  "phase déjà là": '{"finished":false,"created":false} 0/1/6e3da75b312bfcdb',
  "phase périmée, petite finale imposée": '{"finished":false,"created":true} 8/12/918eb6dca89085ef',
  "phase sans petite finale sur un tournoi qui en a": '{"finished":false,"created":true} 3/4/5c112c3f3462c616',
  "phase réduite à une qualifiée, plateau périmé": '{"finished":false,"created":false} 0/1/7e00b4623a7e7289',
};
