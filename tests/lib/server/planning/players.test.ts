import { describe, expect, it, jest } from "@jest/globals";
import { loadEntryPlayers, playersDuring } from "@/lib/server/planning/players";
import { HOUR_MS, loadedEntry, MONDAY } from "../../../helpers/planning";
import { fakeConnection, type SqlQuery } from "../../../helpers/sql-double";

/**
 * Qui joue pendant une entrée du planning (`CAST_PLANNING.md` § Refus) :
 * joueurs d'un match, d'un tournoi entier, et des entrées qui chevauchent.
 */

describe("loadEntryPlayers", () => {
  it("loadEntryPlayers_matchAndTournamentEntries_mapsPlayersPerEntry", async () => {
    const execute = jest.fn<SqlQuery>();
    execute
      .mockResolvedValueOnce([[{ tournament_id: 20, team_id: 300 }, { tournament_id: 20, team_id: 400 }]])
      .mockResolvedValueOnce([
        [
          { team_id: 100, user_id: 1 },
          { team_id: 200, user_id: 2 },
          { team_id: 300, user_id: 3 },
          { team_id: 400, user_id: 4 },
        ],
      ]);
    const match = loadedEntry();
    const event = loadedEntry({ key: "t:20", kind: "TOURNAMENT", tournamentId: 20, matchId: null, team1: null, team2: null });

    const players = await loadEntryPlayers(fakeConnection({ execute }), [match, event]);

    expect(players).toEqual(
      new Map([
        ["m:1", new Set([1, 2])],
        ["t:20", new Set([3, 4])],
      ]),
    );
    expect(execute.mock.calls[0][1]).toEqual([20]);
    expect(execute.mock.calls[1][1]).toEqual([100, 200, 300, 400, 100, 200, 300, 400]);
  });

  it("loadEntryPlayers_noTeams_noQuery", async () => {
    const execute = jest.fn<SqlQuery>();
    const match = loadedEntry({ team1: null, team2: null });

    const players = await loadEntryPlayers(fakeConnection({ execute }), [match]);

    expect(players).toEqual(new Map([["m:1", new Set()]]));
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("playersDuring", () => {
  const target = loadedEntry();
  const players = new Map([
    ["m:1", new Set([1])],
    ["m:2", new Set([2])],
    ["m:3", new Set([3])],
  ]);

  it("playersDuring_overlappingEntry_includesItsPlayers", () => {
    const overlapping = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });

    expect(playersDuring(target, [target, overlapping], players)).toEqual(new Set([1, 2]));
  });

  it("playersDuring_consecutiveEntry_excluded", () => {
    const consecutive = loadedEntry({ key: "m:3", matchId: 3, startAt: MONDAY + HOUR_MS, endAt: MONDAY + 2 * HOUR_MS });

    expect(playersDuring(target, [target, consecutive], players)).toEqual(new Set([1]));
  });
});
