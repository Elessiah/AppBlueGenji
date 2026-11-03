import { describe, expect, it, jest } from "@jest/globals";
import {
  HAS_SCORE_INPUT_SQL,
  laterRoundHasScoreInput,
  laterRoundsHaveScoreInput,
} from "@/lib/server/tournaments/bg-survie/round-progress";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * `laterRoundsHaveScoreInput` (ERREUR.txt EF-15) : la seule lecture « une
 * manche postérieure porte une saisie » — retrait de pénalité, annulation d'un
 * abandon, correction d'arbitrage —, et le prédicat SQL aligné sur
 * `hasScoreInput` (`lib/shared/match-lock.ts`).
 */

function connectionReturning(rows: unknown[]) {
  const execute = jest.fn<SqlQuery>(async () => [rows, []]);
  return { conn: fakeConnection({ execute }), execute };
}

const flat = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();

describe("laterRoundsHaveScoreInput", () => {
  it("laterRoundsHaveScoreInput_rowFound_returnsTrue", async () => {
    const { conn } = connectionReturning([{ id: 31 }]);

    await expect(laterRoundsHaveScoreInput(conn, { tournamentId: 7, phaseId: 3, afterRound: 2 })).resolves.toBe(true);
  });

  it("laterRoundsHaveScoreInput_noRow_returnsFalse", async () => {
    const { conn } = connectionReturning([]);

    await expect(laterRoundsHaveScoreInput(conn, { tournamentId: 7, phaseId: 3, afterRound: 2 })).resolves.toBe(false);
  });

  it("laterRoundsHaveScoreInput_withoutBounds_scopesToPhaseAfterRound_unlocked", async () => {
    const { conn, execute } = connectionReturning([]);

    await laterRoundsHaveScoreInput(conn, { tournamentId: 7, phaseId: 3, afterRound: 2 });

    const [sql, params] = execute.mock.calls[0];
    expect(flat(sql)).toMatch(/^SELECT id FROM bg_matches WHERE tournament_id = \? AND phase_id = \? AND round_number > \? AND \(/);
    expect(flat(sql)).not.toContain("round_number < ?");
    expect(flat(sql)).toMatch(/LIMIT 1$/);
    expect(params).toEqual([7, 3, 2]);
  });

  it("laterRoundsHaveScoreInput_beforeRound_addsExclusiveUpperBound", async () => {
    const { conn, execute } = connectionReturning([]);

    await laterRoundsHaveScoreInput(conn, { tournamentId: 7, phaseId: 0, afterRound: 2, beforeRound: 1000 });

    const [sql, params] = execute.mock.calls[0];
    expect(flat(sql)).toContain("round_number > ? AND round_number < ?");
    expect(params).toEqual([7, 0, 2, 1000]);
  });

  it("laterRoundsHaveScoreInput_lock_endsWithForUpdateWithoutJoin", async () => {
    const { conn, execute } = connectionReturning([]);

    await laterRoundsHaveScoreInput(conn, { tournamentId: 7, phaseId: 0, afterRound: 2, lock: true });

    expect(flat(execute.mock.calls[0][0])).toMatch(/LIMIT 1 FOR UPDATE$/);
    expect(flat(execute.mock.calls[0][0])).not.toMatch(/JOIN|FOR SHARE/);
  });
});

describe("laterRoundHasScoreInput — retrait d'une pénalité", () => {
  it("laterRoundHasScoreInput_qualifiers_boundedBeforePlayoffsAndLocked", async () => {
    const { conn, execute } = connectionReturning([{ id: 4 }]);

    await expect(laterRoundHasScoreInput(conn, 7, 2)).resolves.toBe(true);

    const [sql, params] = execute.mock.calls[0];
    expect(params).toEqual([7, 0, 2, PLAYOFF_ROUND_OFFSET]);
    expect(flat(sql)).toMatch(/FOR UPDATE$/);
  });
});

describe("HAS_SCORE_INPUT_SQL", () => {
  it("HAS_SCORE_INPUT_SQL_doubleForfeit_countsOnlyOnceCompleted", () => {
    // Comme `toMatchScoreState` (admin.ts) : un double forfait ne compte que
    // sur un match clos.
    expect(flat(HAS_SCORE_INPUT_SQL)).not.toMatch(/OR double_forfeit = 1 OR/);
  });

  it("HAS_SCORE_INPUT_SQL_requiresBothEntrants_excludesAutomaticBye", () => {
    expect(flat(HAS_SCORE_INPUT_SQL)).toMatch(/^\(team1_id IS NOT NULL AND team2_id IS NOT NULL AND \(/);
  });

  it("HAS_SCORE_INPUT_SQL_pendingReport_countsAsInput", () => {
    expect(HAS_SCORE_INPUT_SQL).toContain("team1_reported_at IS NOT NULL");
    expect(HAS_SCORE_INPUT_SQL).toContain("team2_reported_at IS NOT NULL");
  });

  it("HAS_SCORE_INPUT_SQL_scoresOutcomesAndConfirmation_countAsInput", () => {
    for (const clause of [
      "team1_score IS NOT NULL",
      "team2_score IS NOT NULL",
      "winner_team_id IS NOT NULL",
      "forfeit_team_id IS NOT NULL",
      "(double_forfeit = 1 AND status = 'COMPLETED')",
      "status = 'AWAITING_CONFIRMATION'",
    ]) {
      expect(HAS_SCORE_INPUT_SQL).toContain(clause);
    }
  });
});
