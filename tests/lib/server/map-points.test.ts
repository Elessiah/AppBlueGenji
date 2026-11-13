import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  assertMapPointsUnlocked,
  loadMatchPointTarget,
  matchRoundKey,
} from "@/lib/server/tournaments/map-points";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

/**
 * Format Duel / Arcade côté serveur (`docs/features/DUEL_ARCADE.md`) : lecture
 * des points d'un match et verrou une fois un score saisi.
 */

const ROUND = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };
const BLANK_MATCH = {
  id: 1,
  team1_id: 10,
  team2_id: 20,
  is_bye: 0,
  team1_score: null,
  team2_score: null,
  team1_reported_at: null,
  team2_reported_at: null,
  lobby_opened_at: null,
  launched_at: null,
};

let connection: ReturnType<typeof connectionMock>;

/** Aiguille `execute` : chaque motif SQL rend ses lignes, le reste rien. */
function route(table: { pattern: RegExp; rows: Record<string, unknown>[] }[]) {
  connection.execute.mockImplementation(async (sql: string) => {
    const hit = table.find((entry) => entry.pattern.test(sql));
    return [hit ? hit.rows : [], []];
  });
}

beforeEach(() => {
  connection = connectionMock();
});

describe("matchRoundKey", () => {
  it("matchRoundKey_nullPhase_mapsToPhaseZero", () => {
    expect(matchRoundKey({ phase_id: null, bracket: "LOWER", round_number: 3 })).toEqual({
      phaseId: 0,
      bracket: "LOWER",
      roundNumber: 3,
    });
  });
});

describe("loadMatchPointTarget", () => {
  it("loadMatchPointTarget_formatOff_returnsNullWithoutQuery", async () => {
    const actual = await loadMatchPointTarget(fakeConnection(connection), 7, null, ROUND);

    expect(actual).toBeNull();
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadMatchPointTarget_roundOverride_returnsOverride", async () => {
    route([{ pattern: /FROM bg_tournament_round_maps/, rows: [{ map_point_target: 3 }] }]);

    const actual = await loadMatchPointTarget(fakeConnection(connection), 7, 5, ROUND);

    expect(actual).toBe(3);
    expect(connection.execute.mock.calls[0][1]).toEqual([7, 0, "UPPER", 2]);
  });

  it("loadMatchPointTarget_roundOverride_readsWithLockInShareMode", async () => {
    route([{ pattern: /FROM bg_tournament_round_maps/, rows: [{ map_point_target: 3 }] }]);

    await loadMatchPointTarget(fakeConnection(connection), 7, 5, ROUND);

    const [sql] = connection.execute.mock.calls[0];
    expect(sql).toMatch(/LIMIT 1\s+LOCK IN SHARE MODE$/);
    expect(sql).not.toMatch(/FOR SHARE/);
  });

  it("loadMatchPointTarget_noRoundRow_returnsTournamentTarget", async () => {
    route([]);

    const actual = await loadMatchPointTarget(fakeConnection(connection), 7, "5", ROUND);

    expect(actual).toBe(5);
  });
});

describe("assertMapPointsUnlocked", () => {
  it("assertMapPointsUnlocked_noMatch_passesWithoutReadingMaps", async () => {
    route([]);

    await expect(assertMapPointsUnlocked(fakeConnection(connection), 7, null)).resolves.toBeUndefined();

    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  it("assertMapPointsUnlocked_blankMatchesAndNoMaps_passes", async () => {
    route([{ pattern: /^SELECT id, team1_id/, rows: [BLANK_MATCH] }]);

    await expect(assertMapPointsUnlocked(fakeConnection(connection), 7, null)).resolves.toBeUndefined();
  });

  it("assertMapPointsUnlocked_retainedScore_throwsLocked", async () => {
    route([{ pattern: /^SELECT id, team1_id/, rows: [{ ...BLANK_MATCH, team1_score: 1 }] }]);

    await expect(assertMapPointsUnlocked(fakeConnection(connection), 7, null)).rejects.toThrow("MAP_POINTS_LOCKED");
  });

  it("assertMapPointsUnlocked_pendingReport_throwsLocked", async () => {
    route([{ pattern: /^SELECT id, team1_id/, rows: [{ ...BLANK_MATCH, team2_reported_at: new Date() }] }]);

    await expect(assertMapPointsUnlocked(fakeConnection(connection), 7, null)).rejects.toThrow("MAP_POINTS_LOCKED");
  });

  it("assertMapPointsUnlocked_savedMaps_throwsLocked", async () => {
    route([
      { pattern: /^SELECT id, team1_id/, rows: [BLANK_MATCH] },
      { pattern: /FROM bg_match_maps/, rows: [{ found: 1 }] },
    ]);

    await expect(assertMapPointsUnlocked(fakeConnection(connection), 7, null)).rejects.toThrow("MAP_POINTS_LOCKED");
  });

  it("assertMapPointsUnlocked_round_scopesAndLocksTheRoundMatchesWithoutJoin", async () => {
    route([]);

    await assertMapPointsUnlocked(fakeConnection(connection), 7, ROUND);

    const [sql, params] = connection.execute.mock.calls[0];
    expect(sql).toMatch(/AND phase_id = \? AND bracket = \? AND round_number = \? FOR UPDATE/);
    expect(sql).not.toMatch(/JOIN/);
    expect(params).toEqual([7, 0, "UPPER", 2]);
  });

  it("assertMapPointsUnlocked_byeAndGhostScored_passesWithoutReadingMaps", async () => {
    route([
      {
        pattern: /^SELECT id, team1_id/,
        rows: [
          { ...BLANK_MATCH, id: 1, team2_id: null, is_bye: 1, team1_score: 1, team2_score: 0 },
          { ...BLANK_MATCH, id: 2, team1_id: null, team2_id: null, team1_score: 0, team2_score: 0 },
        ],
      },
    ]);

    await expect(assertMapPointsUnlocked(fakeConnection(connection), 7, ROUND)).resolves.toBeUndefined();

    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  it("assertMapPointsUnlocked_lobbyOpened_throwsLocked", async () => {
    route([{ pattern: /^SELECT id, team1_id/, rows: [{ ...BLANK_MATCH, lobby_opened_at: new Date() }] }]);

    await expect(assertMapPointsUnlocked(fakeConnection(connection), 7, ROUND)).rejects.toThrow("MAP_POINTS_LOCKED");
  });

  it("assertMapPointsUnlocked_launched_throwsLocked", async () => {
    route([{ pattern: /^SELECT id, team1_id/, rows: [{ ...BLANK_MATCH, launched_at: new Date() }] }]);

    await expect(assertMapPointsUnlocked(fakeConnection(connection), 7, ROUND)).rejects.toThrow("MAP_POINTS_LOCKED");
  });

  it("assertMapPointsUnlocked_playableMatches_readsMapsByIdsWithLockInShareMode", async () => {
    route([
      { pattern: /^SELECT id, team1_id/, rows: [{ ...BLANK_MATCH, id: 4 }, { ...BLANK_MATCH, id: 9 }] },
    ]);

    await assertMapPointsUnlocked(fakeConnection(connection), 7, ROUND);

    const [sql, params] = connection.execute.mock.calls[1];
    expect(sql).toMatch(/FROM bg_match_maps WHERE match_id IN \(\?, \?\) LIMIT 1 LOCK IN SHARE MODE$/);
    expect(sql).not.toMatch(/JOIN|SELECT id FROM bg_matches/);
    expect(params).toEqual([4, 9]);
  });
});
