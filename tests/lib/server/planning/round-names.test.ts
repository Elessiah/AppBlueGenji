import { beforeEach, describe, expect, it } from "@jest/globals";
import { clearEntryRoundCache, loadEntryRounds, ROUND_CACHE_MAX_TOURNAMENTS, ROUND_CACHE_TTL_MS } from "@/lib/server/planning/round-names";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/** Nom des tours d'un tournoi, depuis tous ses matchs (CAST_PLANNING.md). */
type Row = {
  id: number;
  tournament_id: number;
  phase_id: number;
  bracket: string;
  round_number: number;
  match_number: number;
  status: string;
  double_forfeit: number;
  format: string;
  state: string;
};

const row = (id: number, round: number, match = 1, bracket = "UPPER", phase = 0, tournament = 1, format = "SINGLE"): Row => ({
  id,
  tournament_id: tournament,
  phase_id: phase,
  bracket,
  round_number: round,
  match_number: match,
  status: "PENDING",
  double_forfeit: 0,
  format,
  state: "RUNNING",
});

function executor(format: string, matches: Row[], phases: object[] = []) {
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
    if (/FROM bg_tournament_phases/.test(sql)) return [phases, []];
    const asked = (params ?? []) as number[];
    return [matches.filter((match) => asked.includes(match.tournament_id)).map((match) => (match.tournament_id === 1 ? { ...match, format } : match)), []];
  });
  return connection;
}

const run = (connection: ReturnType<typeof executor>, ids: number[], tournaments: number[] = [], now = 0) =>
  loadEntryRounds(
    fakeConnection(connection),
    ids.map((matchId, index) => ({ tournamentId: tournaments[index] ?? 1, matchId })),
    now,
  );

describe("loadEntryRounds", () => {
  beforeEach(() => clearEntryRoundCache());

  it("loadEntryRounds_noMatchRequested_runsNoQuery", async () => {
    const connection = executor("SINGLE", []);

    expect((await run(connection, [])).size).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadEntryRounds_singleElimination_namesFromLastRoundEvenWhenOnlyOneRequested", async () => {
    const connection = executor("SINGLE", [row(1, 1, 1), row(2, 1, 2), row(3, 2, 1)]);

    const rounds = await run(connection, [3]);

    expect([...rounds.keys()]).toEqual([3]);
    expect(rounds.get(3)).toEqual({ round: { kind: "stage", stage: "final", lower: false, round: 2 }, matchNumber: 1 });
  });

  it("loadEntryRounds_nonMulti_runsSingleJoinedQuery", async () => {
    const connection = executor("SINGLE", [row(1, 1, 1)]);

    await run(connection, [1]);

    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(String(connection.execute.mock.calls[0][0])).toMatch(/JOIN bg_tournaments/);
  });

  it("loadEntryRounds_doubleLower_marksLowerBracket", async () => {
    const connection = executor("DOUBLE", [row(1, 1, 1, "UPPER"), row(2, 1, 1, "LOWER")]);

    expect((await run(connection, [2])).get(2)?.round).toMatchObject({ kind: "stage", lower: true });
  });

  it("loadEntryRounds_doubleGrand_namesGrandFinal", async () => {
    const connection = executor("DOUBLE", [row(1, 1, 1, "UPPER"), row(2, 1, 1, "LOWER"), row(3, 1, 1, "GRAND")]);

    expect((await run(connection, [3])).get(3)?.round).toMatchObject({ kind: "stage", stage: "grandFinal" });
  });

  it("loadEntryRounds_thirdPlace_namesThirdPlace", async () => {
    const connection = executor("SINGLE", [row(1, 1, 1), row(2, 1, 2), row(3, 2, 1), row(4, 2, 1, "THIRD_PLACE")]);

    expect((await run(connection, [4])).get(4)?.round).toMatchObject({ kind: "stage", stage: "thirdPlace" });
  });

  it("loadEntryRounds_swiss_returnsNumberedRound", async () => {
    const connection = executor("SWISS", [row(1, 3, 2)]);

    expect((await run(connection, [1])).get(1)).toEqual({ round: { kind: "numbered", noun: "swiss", number: 3 }, matchNumber: 2 });
  });

  it("loadEntryRounds_survival_returnsNumberedRound", async () => {
    const connection = executor("SURVIVAL", [row(1, 4, 1)]);

    expect((await run(connection, [1])).get(1)?.round).toMatchObject({ kind: "numbered", number: 4 });
  });

  it("loadEntryRounds_multiUsesPhaseFormat_swissPhaseNumbered", async () => {
    const connection = executor("MULTI", [row(1, 2, 1, "UPPER", 7)], [{ id: 7, tournament_id: 1, format: "SWISS" }]);

    expect((await run(connection, [1])).get(1)?.round).toEqual({ kind: "numbered", noun: "swiss", number: 2 });
  });

  it("loadEntryRounds_multi_readsPhasesOfMultiTournamentsOnly", async () => {
    const connection = executor("MULTI", [row(1, 2, 1, "UPPER", 7), row(5, 1, 1, "UPPER", 0, 2, "SINGLE")], []);

    await run(connection, [1, 5], [1, 2]);

    const phaseCall = connection.execute.mock.calls.find(([sql]) => /bg_tournament_phases/.test(String(sql)));
    expect(phaseCall?.[1]).toEqual([1]);
  });

  it("loadEntryRounds_twoTournaments_namesEachFromItsOwnMatchesAndKeepsOnlyRequested", async () => {
    const connection = executor("SINGLE", [row(1, 1, 1), row(2, 1, 2), row(3, 2, 1), row(10, 1, 1, "UPPER", 0, 2, "SWISS"), row(11, 1, 2, "UPPER", 0, 2, "SWISS")]);

    const rounds = await run(connection, [3, 11], [1, 2]);

    expect([...rounds.keys()].sort((a, b) => a - b)).toEqual([3, 11]);
    expect(rounds.get(3)?.round).toMatchObject({ kind: "stage", stage: "final" });
    expect(rounds.get(11)).toEqual({ round: { kind: "numbered", noun: "swiss", number: 1 }, matchNumber: 2 });
  });

  it("loadEntryRounds_playoffTree_neverExposesRawEngineNumber", async () => {
    const connection = executor("BG_SURVIE", [row(1, 1000, 1), row(2, 1001, 1)]);

    const round = (await run(connection, [1])).get(1)?.round;

    expect(round).toMatchObject({ kind: "stage", round: 1 });
  });

  describe("short-lived cache", () => {
    it("loadEntryRounds_secondReadWithinTtl_runsNoQuery", async () => {
      const connection = executor("SINGLE", [row(1, 1, 1), row(2, 1, 2), row(3, 2, 1)]);

      const first = await run(connection, [3], [], 1000);
      const second = await run(connection, [1, 3], [], 1000 + ROUND_CACHE_TTL_MS - 1);

      expect(connection.execute).toHaveBeenCalledTimes(1);
      expect(second.get(3)).toEqual(first.get(3));
      expect(second.get(1)?.round).toMatchObject({ kind: "stage", stage: "semis" });
    });

    it("loadEntryRounds_afterTtl_readsAgain", async () => {
      const connection = executor("SINGLE", [row(1, 1, 1)]);

      await run(connection, [1], [], 0);
      await run(connection, [1], [], ROUND_CACHE_TTL_MS);

      expect(connection.execute).toHaveBeenCalledTimes(2);
    });

    it("loadEntryRounds_matchUnknownToCache_readsTournamentAgain", async () => {
      const connection = executor("SINGLE", [row(1, 1, 1)]);
      await run(connection, [1], [], 0);
      connection.execute.mockImplementation(async () => [[row(1, 1, 1), row(2, 2, 1)], []]);

      const rounds = await run(connection, [2], [], 5);

      expect(connection.execute).toHaveBeenCalledTimes(2);
      expect(rounds.get(2)?.round).toMatchObject({ kind: "stage", stage: "final" });
    });

    it("loadEntryRounds_mixOfCachedAndNewTournaments_readsOnlyTheNewOnes", async () => {
      const connection = executor("SINGLE", [row(1, 1, 1), row(10, 1, 1, "UPPER", 0, 2, "SWISS")]);
      await run(connection, [1], [1], 0);

      await run(connection, [1, 10], [1, 2], 1);

      const second = connection.execute.mock.calls[1];
      expect(second[1]).toEqual([2]);
    });

    it("loadEntryRounds_manyTournaments_keepsOnlyTheMostRecent", async () => {
      const total = ROUND_CACHE_MAX_TOURNAMENTS + 1;
      const rows = Array.from({ length: total }, (_, index) => row(index + 1, 1, 1, "UPPER", 0, index + 1));
      const connection = executor("SINGLE", rows);
      const ids = rows.map((r) => r.id);
      await run(connection, ids, ids, 0);
      connection.execute.mockClear();

      await run(connection, [1], [1], 1);
      expect(connection.execute).toHaveBeenCalledTimes(1);
      connection.execute.mockClear();
      await run(connection, [total], [total], 1);
      expect(connection.execute).not.toHaveBeenCalled();
    });
  });
});
