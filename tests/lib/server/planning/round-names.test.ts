import { describe, expect, it } from "@jest/globals";
import { loadEntryRounds } from "@/lib/server/planning/round-names";
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
};

const row = (id: number, round: number, match = 1, bracket = "UPPER", phase = 0): Row => ({
  id,
  tournament_id: 1,
  phase_id: phase,
  bracket,
  round_number: round,
  match_number: match,
  status: "PENDING",
  double_forfeit: 0,
});

function executor(format: string, matches: Row[], phases: object[] = []) {
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql: string) => {
    if (/FROM bg_tournaments/.test(sql)) return [[{ id: 1, format, state: "RUNNING" }], []];
    if (/FROM bg_tournament_phases/.test(sql)) return [phases, []];
    return [matches, []];
  });
  return connection;
}

const run = (connection: ReturnType<typeof executor>, ids: number[]) =>
  loadEntryRounds(fakeConnection(connection), [1, 1], new Set(ids));

describe("loadEntryRounds", () => {
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

  it("loadEntryRounds_doubleLower_marksLowerBracket", async () => {
    const connection = executor("DOUBLE", [row(1, 1, 1, "UPPER"), row(2, 1, 1, "LOWER")]);

    expect((await run(connection, [2])).get(2)?.round).toMatchObject({ kind: "stage", lower: true });
  });

  it("loadEntryRounds_swiss_returnsNumberedRound", async () => {
    const connection = executor("SWISS", [row(1, 3, 2)]);

    expect((await run(connection, [1])).get(1)).toEqual({ round: { kind: "numbered", noun: "swiss", number: 3 }, matchNumber: 2 });
  });

  it("loadEntryRounds_multiUsesPhaseFormat_swissPhaseNumbered", async () => {
    const connection = executor("MULTI", [row(1, 2, 1, "UPPER", 7)], [{ id: 7, tournament_id: 1, format: "SWISS" }]);

    expect((await run(connection, [1])).get(1)?.round).toEqual({ kind: "numbered", noun: "swiss", number: 2 });
  });

  it("loadEntryRounds_playoffTree_neverExposesRawEngineNumber", async () => {
    const connection = executor("BG_SURVIE", [row(1, 1000, 1), row(2, 1001, 1)]);

    const round = (await run(connection, [1])).get(1)?.round;

    expect(round).toMatchObject({ kind: "stage", round: 1 });
  });
});
