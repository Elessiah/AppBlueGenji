import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// Simulé pour toute la suite (`tests/setup-env.cjs`) : ici, le vrai.
jest.unmock("@/lib/server/tournaments/lobby-brief");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/referee-notices");
jest.mock("@/lib/server/tournaments/match-launch");

import { withConnection } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { loadMapRules, setRoundMaps, setRoundTiebreak } from "@/lib/server/tournaments/round-maps";
import { briefTiebreakMap, type LobbyBriefRow } from "@/lib/server/tournaments/lobby-brief";
import { connectionMock, fakeConnection, type SqlMock } from "../../helpers/sql-double";
import type { RowOverrides } from "../../helpers/row-overrides";

/**
 * Map de départage d'un tour de play-offs en vrai best of 3, côté serveur
 * (`docs/features/ROUND_MAPS.md`), contre une connexion simulée.
 */

type Rows = Record<string, unknown>[];

const ROUND = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };
const LOCKED = { id: 7, name: "Coupe", format: "SINGLE" };
const BO3_ROW = {
  format: "SINGLE",
  match_format_type: "BO",
  match_format_value: 3,
  match_format_max_maps: null,
  match_format_draws: 0,
  endurance_playoff_format_type: null,
  endurance_playoff_format_value: null,
};

let connection: ReturnType<typeof connectionMock>;

function route(execute: SqlMock, table: { pattern: RegExp; rows: Rows }[]) {
  execute.mockImplementation(async (sql: string) => {
    const hit = table.find((entry) => entry.pattern.test(sql));
    if (hit) return [hit.rows, []];
    return [/^\s*SELECT/.test(sql) ? [] : { affectedRows: 1 }, []];
  });
}

function writes(pattern: RegExp) {
  return connection.execute.mock.calls.filter(([sql]) => pattern.test(sql));
}

beforeEach(() => {
  jest.clearAllMocks();
  connection = connectionMock();
  connection.beginTransaction.mockResolvedValue();
  connection.commit.mockResolvedValue();
  connection.rollback.mockResolvedValue();
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection(connection)));
  jest.mocked(sendBotLog).mockResolvedValue();
});

describe("loadMapRules — maps de départage", () => {
  it("loadMapRules_rowWithTiebreakOnly_returnsTiebreakNotRound", async () => {
    route(connection.execute, [
      {
        pattern: /FROM bg_tournament_round_maps/,
        rows: [{ phase_id: 0, bracket: "UPPER", round_number: 2, slots_json: "[]", tiebreak_map: "Busan" }],
      },
    ]);

    const actual = await loadMapRules(fakeConnection(connection), 7, {
      first_ban_rule: "NON_HOST",
      next_ban_rule: "LOSER",
      next_pick_rule: "LOSER",
    });

    expect(actual.rounds).toEqual([]);
    expect(actual.tiebreaks).toEqual([{ ...ROUND, map: "Busan" }]);
  });
});

describe("setRoundTiebreak", () => {
  it("setRoundTiebreak_eligibleRound_insertsAndPublishes", async () => {
    route(connection.execute, [
      { pattern: /FOR UPDATE/, rows: [LOCKED] },
      { pattern: /SELECT format, match_format_type/, rows: [BO3_ROW] },
    ]);

    const actual = await setRoundTiebreak(7, ROUND, "  Busan ");

    expect(actual).toBe("Busan");
    const [insert] = writes(/INSERT INTO bg_tournament_round_maps/);
    expect(insert[1]).toEqual([7, 0, "UPPER", 2, "Busan"]);
    expect(insert[0]).toMatch(/ON DUPLICATE KEY UPDATE tiebreak_map = VALUES\(tiebreak_map\)/);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
    expect(writes(/INSERT INTO bg_round_maps_notices/)).toHaveLength(1);
  });

  it("setRoundTiebreak_locksTournamentFirst", async () => {
    route(connection.execute, [
      { pattern: /FOR UPDATE/, rows: [LOCKED] },
      { pattern: /SELECT format, match_format_type/, rows: [BO3_ROW] },
    ]);

    await setRoundTiebreak(7, ROUND, "Busan");

    expect(connection.execute.mock.calls[0][0]).toMatch(/FROM bg_tournaments WHERE id = \? LIMIT 1 FOR UPDATE/);
  });

  it("setRoundTiebreak_ft3Round_throwsTiebreakNotAllowed", async () => {
    route(connection.execute, [
      { pattern: /FOR UPDATE/, rows: [LOCKED] },
      { pattern: /SELECT format, match_format_type/, rows: [{ ...BO3_ROW, match_format_type: "FT" }] },
    ]);

    await expect(setRoundTiebreak(7, ROUND, "Busan")).rejects.toThrow("TIEBREAK_NOT_ALLOWED");

    expect(writes(/INSERT INTO bg_tournament_round_maps/)).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setRoundTiebreak_swissTournament_throwsTiebreakNotAllowed", async () => {
    route(connection.execute, [
      { pattern: /FOR UPDATE/, rows: [{ ...LOCKED, format: "SWISS" }] },
      { pattern: /SELECT format, match_format_type/, rows: [{ ...BO3_ROW, format: "SWISS" }] },
    ]);

    await expect(setRoundTiebreak(7, ROUND, "Busan")).rejects.toThrow("TIEBREAK_NOT_ALLOWED");
  });

  it("setRoundTiebreak_roundOfOtherPhase_throwsInvalidRound", async () => {
    route(connection.execute, [{ pattern: /FOR UPDATE/, rows: [LOCKED] }]);

    await expect(setRoundTiebreak(7, { ...ROUND, phaseId: 4 }, "Busan")).rejects.toThrow("INVALID_ROUND");
  });

  it("setRoundTiebreak_invalidName_throwsInvalidTiebreakMap", async () => {
    await expect(setRoundTiebreak(7, ROUND, 12)).rejects.toThrow("INVALID_TIEBREAK_MAP");

    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("setRoundTiebreak_missingTournament_throwsTournamentNotFound", async () => {
    route(connection.execute, []);

    await expect(setRoundTiebreak(7, ROUND, "Busan")).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("setRoundTiebreak_unchanged_noWriteNoEvent", async () => {
    route(connection.execute, [
      { pattern: /FOR UPDATE/, rows: [LOCKED] },
      { pattern: /SELECT format, match_format_type/, rows: [BO3_ROW] },
      { pattern: /SELECT tiebreak_map/, rows: [{ tiebreak_map: "Busan" }] },
    ]);

    await setRoundTiebreak(7, ROUND, "Busan");

    expect(writes(/^\s*(INSERT|UPDATE|DELETE)/)).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setRoundTiebreak_null_clearsAndDeletesEmptyRow", async () => {
    route(connection.execute, [
      { pattern: /FOR UPDATE/, rows: [LOCKED] },
      { pattern: /SELECT tiebreak_map/, rows: [{ tiebreak_map: "Busan" }] },
    ]);

    await expect(setRoundTiebreak(7, ROUND, null)).resolves.toBeNull();

    expect(writes(/UPDATE bg_tournament_round_maps SET tiebreak_map = NULL/)).toHaveLength(1);
    const [remove] = writes(/DELETE FROM bg_tournament_round_maps/);
    expect(remove[0]).toMatch(/slots_json = '\[\]'/);
    // Retirer ne relit pas le format : un réglage resté d'un format changé doit pouvoir partir.
    expect(writes(/SELECT format, match_format_type/)).toHaveLength(0);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });
});

describe("setRoundMaps — ligne qui porte une map de départage", () => {
  it("setRoundMaps_emptySlots_keepsRowWithTiebreak", async () => {
    route(connection.execute, [
      { pattern: /FROM bg_tournaments/, rows: [LOCKED] },
      { pattern: /SELECT[\s\S]*FROM bg_tournament_round_maps/, rows: [{ ...ROUND, slots_json: '[["Ilios"]]' }] },
    ]);

    await setRoundMaps(7, ROUND, []);

    const [remove] = writes(/DELETE FROM bg_tournament_round_maps/);
    expect(remove[0]).toMatch(/AND tiebreak_map IS NULL/);
    expect(writes(/UPDATE bg_tournament_round_maps SET slots_json = '\[\]'/)).toHaveLength(1);
  });
});

function briefRow(overrides: RowOverrides<LobbyBriefRow> = {}): LobbyBriefRow {
  return {
    bracket: "UPPER",
    round_number: 2,
    phase_id: 0,
    phase_format: null,
    tournament_format: "SINGLE",
    round_tiebreak_map: "Busan",
    match_format_type: "BO",
    match_format_value: 3,
    match_format_max_maps: null,
    match_format_draws: 0,
    endurance_playoff_format_type: null,
    endurance_playoff_format_value: null,
    ...overrides,
  } as LobbyBriefRow;
}

describe("briefTiebreakMap", () => {
  it("briefTiebreakMap_eligibleRow_returnsMap", () => {
    expect(briefTiebreakMap(briefRow())).toBe("Busan");
  });

  it("briefTiebreakMap_ft3Row_returnsNull", () => {
    expect(briefTiebreakMap(briefRow({ match_format_type: "FT" }))).toBeNull();
  });

  it("briefTiebreakMap_noTiebreak_returnsNull", () => {
    expect(briefTiebreakMap(briefRow({ round_tiebreak_map: null }))).toBeNull();
  });

  it("briefTiebreakMap_multiSwissPhase_returnsNull", () => {
    expect(briefTiebreakMap(briefRow({ tournament_format: "MULTI", phase_id: 5, phase_format: "SWISS" }))).toBeNull();
  });
});
