import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import { getDatabase } from "@/lib/server/database";
import { flushBotLogBatch, sendBotLog } from "@/lib/server/bot-integration";
import {
  dispatchDueRoundMapsNotices,
  flushRoundMapsNotice,
  queueRoundMapsNotice,
  resetRoundMapsNoticeState,
  roundMapsFingerprint,
  roundPointsFingerprint,
  scheduleRoundMapsNotice,
} from "@/lib/server/tournaments/round-maps-notice";
import { formatRoundMapsSummaryLog } from "@/lib/shared/bot-logs";
import { ROUND_MAPS_NOTICE_WINDOW_SECONDS } from "@/lib/shared/round-maps";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Annonce unique des cartes de manche (`docs/features/ROUND_MAPS.md`) : mise en
 * attente dans la transaction, envoi quand la fenêtre est échue ou à la demande.
 */

const R2 = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };
const R3 = { phaseId: 0, bracket: "UPPER", roundNumber: 3 };
const dueRow = (rounds: unknown, changes = 1, format = "SINGLE") => ({
  tournament_id: 7,
  rounds_json: JSON.stringify(rounds),
  changes,
  name: "Coupe",
  format,
});

let execute: jest.Mock<SqlQuery>;

function pool(select: unknown[], claimed = 1, phases: unknown[] = []) {
  execute = jest.fn<SqlQuery>(async (sql) => {
    if (/bg_tournament_phases/.test(sql)) return [phases, []];
    return /^\s*SELECT/.test(sql) ? [select, []] : [{ affectedRows: claimed }, []];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRoundMapsNoticeState();
  jest.mocked(sendBotLog).mockReturnValue(undefined);
  jest.mocked(flushBotLogBatch).mockResolvedValue();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetRoundMapsNoticeState();
  jest.restoreAllMocks();
});

describe("queueRoundMapsNotice", () => {
  function queueWith(existing: unknown[]) {
    const connection = connectionMock();
    connection.execute.mockImplementation(async (sql) => (/^\s*SELECT/.test(sql) ? [existing, []] : [{}, []]));
    return connection;
  }

  it("queueRoundMapsNotice_noChangedRound_writesNothing", async () => {
    const connection = queueWith([]);
    await queueRoundMapsNotice(fakeConnection(connection), 7, []);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  /** Ce que la mise en attente écrit dans `rounds_json` (dernière instruction). */
  function storedRounds(connection: ReturnType<typeof queueWith>): unknown {
    const [sql, params] = connection.execute.mock.calls[2];
    expect(sql).toMatch(/UPDATE bg_round_maps_notices SET rounds_json = \?/);
    return JSON.parse(String((params as unknown[])[0]));
  }

  it("queueRoundMapsNotice_firstSave_takesTheRowAndRestartsWindowBeforeReadingIt", async () => {
    const connection = queueWith([]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [R2]);

    // La ligne est prise (verrou) avant d'être lue : un balayage ne la revendique plus entre les deux.
    const [sql, params] = connection.execute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO bg_round_maps_notices[\s\S]*changes = changes \+ 1/);
    expect(params).toEqual([7, 60]);
    expect(connection.execute.mock.calls[1][0]).toMatch(/^\s*SELECT rounds_json/);
    expect(connection.execute.mock.calls[1][0]).not.toMatch(/FOR UPDATE/);
  });

  it("queueRoundMapsNotice_firstSave_storesTheRounds", async () => {
    const connection = queueWith([{ rounds_json: "[]" }]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [R2]);

    expect(storedRounds(connection)).toEqual([R2]);
  });

  it("queueRoundMapsNotice_secondSave_mergesRoundsWithoutDuplicates", async () => {
    const connection = queueWith([{ rounds_json: JSON.stringify([R2, R3]) }]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [R3, { ...R2, roundNumber: 4 }]);

    expect(storedRounds(connection)).toEqual([R2, R3, { ...R2, roundNumber: 4 }]);
  });

  it("queueRoundMapsNotice_corruptPendingJson_startsFromTheNewRounds", async () => {
    const connection = queueWith([{ rounds_json: "{pas du json" }]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [R2]);

    expect(storedRounds(connection)).toEqual([R2]);
  });

  it("queueRoundMapsNotice_capReached_countsNewRoundsInsteadOfStoringThem", async () => {
    const full = Array.from({ length: 200 }, (_, index) => ({ ...R2, roundNumber: index + 1 }));
    const connection = queueWith([{ rounds_json: JSON.stringify(full) }]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [
      { ...R2, roundNumber: 201 },
      { ...R2, roundNumber: 202 },
    ]);

    expect(storedRounds(connection)).toEqual([...full, { more: 2 }]);
  });

  it("queueRoundMapsNotice_capReached_roundAlreadyStoredIsNotCounted", async () => {
    const full = Array.from({ length: 200 }, (_, index) => ({ ...R2, roundNumber: index + 1 }));
    const connection = queueWith([{ rounds_json: JSON.stringify([...full, { more: 3 }]) }]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [{ ...R2, roundNumber: 5 }]);

    expect(storedRounds(connection)).toEqual([...full, { more: 3 }]);
  });

  it("queueRoundMapsNotice_pointsOnly_flaggedAndKeptApartFromMapsAndTiebreak", async () => {
    const connection = queueWith([{ rounds_json: JSON.stringify([R2, { ...R2, tiebreak: true }]) }]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [R2], { points: true });

    expect(storedRounds(connection)).toEqual([R2, { ...R2, tiebreak: true }, { ...R2, points: true }]);
  });

  it("queueRoundMapsNotice_tiebreakOnly_flaggedAndKeptApartFromTheRoundMaps", async () => {
    const connection = queueWith([{ rounds_json: JSON.stringify([R2]) }]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [R2], { tiebreak: true });

    expect(storedRounds(connection)).toEqual([R2, { ...R2, tiebreak: true }]);
  });
});

describe("dispatchDueRoundMapsNotices", () => {
  it("dispatchDueRoundMapsNotices_fiveRoundsQueued_sendsOneMessageNamingThemAll", async () => {
    pool([dueRow([1, 2, 3, 4, 5].map((n) => ({ ...R2, roundNumber: n })))]);
    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(1);
    expect(sendBotLog).toHaveBeenCalledTimes(1);
    const message = jest.mocked(sendBotLog).mock.calls[0][0];
    expect(message).toContain("Cartes de manche modifiées");
    expect(message).toContain("(5 manches)");
    expect(message).toContain("par le staff");
  });

  it("dispatchDueRoundMapsNotices_dueRow_flushesTheMapsBatchAtOnce", async () => {
    pool([dueRow([R2])]);
    await dispatchDueRoundMapsNotices();
    expect(jest.mocked(sendBotLog).mock.calls[0][1]).toEqual({ tournamentId: 7, category: "maps" });
    expect(flushBotLogBatch).toHaveBeenCalledWith({ tournamentId: 7, category: "maps" });
  });

  it("dispatchDueRoundMapsNotices_severalBrackets_listsUpperThenLowerThenGrandThenThirdPlace", async () => {
    pool([
      dueRow([
        { phaseId: 0, bracket: "THIRD_PLACE", roundNumber: 1 },
        { phaseId: 0, bracket: "GRAND", roundNumber: 1 },
        { phaseId: 0, bracket: "LOWER", roundNumber: 1 },
        { phaseId: 0, bracket: "UPPER", roundNumber: 1 },
      ]),
    ]);

    await dispatchDueRoundMapsNotices();

    // Le tableau principal d'abord : trié par nom, il passait après la grande finale et les perdants.
    expect(String(jest.mocked(sendBotLog).mock.calls[0][0])).toContain(
      "Manche 1, Tableau perdants · manche 1, Grande finale, Petite finale (4 manches)",
    );
  });

  it("dispatchDueRoundMapsNotices_tiebreakOnlyChange_saysTiebreakMap", async () => {
    pool([dueRow([{ ...R2, tiebreak: true }])]);

    await dispatchDueRoundMapsNotices();

    expect(String(jest.mocked(sendBotLog).mock.calls[0][0])).toContain("(map de départage)");
  });

  it("dispatchDueRoundMapsNotices_mapsAndTiebreakOfSameRound_listedAndCountedOnce", async () => {
    pool([dueRow([R2, { ...R2, tiebreak: true }])]);

    await dispatchDueRoundMapsNotices();

    const line = String(jest.mocked(sendBotLog).mock.calls[0][0]);
    expect(line).toContain("(1 manche)");
    expect(line).not.toContain("(map de départage)");
  });

  it("dispatchDueRoundMapsNotices_tiebreakOfAnotherRound_keptApart", async () => {
    pool([dueRow([R2, { ...R3, tiebreak: true }])]);

    await dispatchDueRoundMapsNotices();

    const line = String(jest.mocked(sendBotLog).mock.calls[0][0]);
    expect(line).toContain("(2 manches)");
    expect(line).toContain("(map de départage)");
  });

  it("dispatchDueRoundMapsNotices_pointsOnlyChange_saysPointsPerMap", async () => {
    pool([dueRow([{ ...R2, points: true }])]);

    await dispatchDueRoundMapsNotices();

    expect(String(jest.mocked(sendBotLog).mock.calls[0][0])).toContain("(points par carte)");
  });

  it("dispatchDueRoundMapsNotices_mapsAndPointsOfSameRound_bothListed", async () => {
    pool([dueRow([R2, { ...R2, points: true }])]);

    await dispatchDueRoundMapsNotices();

    const line = String(jest.mocked(sendBotLog).mock.calls[0][0]);
    expect(line).toContain("(2 manches)");
    expect(line).toContain("(points par carte)");
  });

  it("dispatchDueRoundMapsNotices_storedOverflow_countedInTheSummary", async () => {
    pool([dueRow([R2, R3, { more: 4 }])]);

    await dispatchDueRoundMapsNotices();

    expect(String(jest.mocked(sendBotLog).mock.calls[0][0])).toContain("(6 manches)");
  });

  it("dispatchDueRoundMapsNotices_rerunAskedWhileSweepInFlight_sweepsAgainAfterIt", async () => {
    pool([]);
    const first = dispatchDueRoundMapsNotices();

    await dispatchDueRoundMapsNotices(true);
    await first;
    await new Promise((resolve) => setImmediate(resolve));

    const sweeps = execute.mock.calls.filter(([sql]) => /send_after <= NOW\(\)/.test(sql));
    expect(sweeps).toHaveLength(2);
  });

  it("dispatchDueRoundMapsNotices_plainCallWhileSweepInFlight_doesNotSweepAgain", async () => {
    pool([]);
    const first = dispatchDueRoundMapsNotices();

    await dispatchDueRoundMapsNotices();
    await first;
    await new Promise((resolve) => setImmediate(resolve));

    expect(execute.mock.calls.filter(([sql]) => /send_after <= NOW\(\)/.test(sql))).toHaveLength(1);
  });

  it("dispatchDueRoundMapsNotices_windowNotElapsed_sendsNothing", async () => {
    pool([]);
    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(0);
    expect(execute.mock.calls[0][0]).toMatch(/send_after <= NOW\(\)/);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("dispatchDueRoundMapsNotices_changeAfterWindow_sendsASecondMessage", async () => {
    pool([dueRow([R2])]);
    await dispatchDueRoundMapsNotices();
    resetRoundMapsNoticeState(); // l'étranglement de 15 s écoulé
    pool([dueRow([R3])]);
    await dispatchDueRoundMapsNotices();
    expect(sendBotLog).toHaveBeenCalledTimes(2);
  });

  it("dispatchDueRoundMapsNotices_rowClaimedElsewhere_sendsNothing", async () => {
    pool([dueRow([R2])], 0);
    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(0);
    expect(execute.mock.calls[1][0]).toMatch(/DELETE FROM bg_round_maps_notices[\s\S]*changes = \?/);
    expect(execute.mock.calls[1][1]).toEqual([7, 1]);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("dispatchDueRoundMapsNotices_oneClaimRefused_otherTournamentsStillAnnounced", async () => {
    let claims = 0;
    execute = jest.fn<SqlQuery>(async (sql) => {
      if (/^\s*SELECT/.test(sql)) return [[dueRow([R2]), { ...dueRow([R3]), tournament_id: 8 }], []];
      claims += 1;
      if (claims === 1) throw new Error("Record has changed since last read");
      return [{ affectedRows: 1 }, []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(1);

    expect(jest.mocked(sendBotLog).mock.calls[0][1]).toEqual({ tournamentId: 8, category: "maps" });
  });

  it("dispatchDueRoundMapsNotices_calledTwiceWithinThrottle_queriesOnce", async () => {
    pool([]);
    await dispatchDueRoundMapsNotices();
    await dispatchDueRoundMapsNotices();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("dispatchDueRoundMapsNotices_databaseDown_resolvesZeroWithoutThrowing", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(0);
  });

  it("dispatchDueRoundMapsNotices_unreadablePendingRounds_sendsNothing", async () => {
    pool([{ ...dueRow([]), rounds_json: "oups" }]);
    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(0);
    expect(sendBotLog).not.toHaveBeenCalled();
  });
});

describe("flushRoundMapsNotice", () => {
  it("flushRoundMapsNotice_pendingRow_sendsWithoutWaitingForTheWindow", async () => {
    pool([dueRow([R2])]);
    await expect(flushRoundMapsNotice(7)).resolves.toBe(true);
    expect(execute.mock.calls[0][0]).not.toMatch(/send_after/);
    expect(execute.mock.calls[0][1]).toEqual([7]);
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("flushRoundMapsNotice_nothingPending_returnsFalse", async () => {
    pool([]);
    await expect(flushRoundMapsNotice(7)).resolves.toBe(false);
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(flushBotLogBatch).not.toHaveBeenCalled();
  });

  it("flushRoundMapsNotice_summarySent_flushesTheTournamentLogBatchAtOnce", async () => {
    pool([dueRow([R2])]);
    await flushRoundMapsNotice(7);
    expect(jest.mocked(sendBotLog).mock.calls[0][1]).toEqual({ tournamentId: 7, category: "maps" });
    expect(flushBotLogBatch).toHaveBeenCalledWith({ tournamentId: 7, category: "maps" });
  });

  it("flushRoundMapsNotice_summarySent_alsoFlushesTheRefereesBatch", async () => {
    pool([dueRow([R2])]);
    await flushRoundMapsNotice(7);
    expect(flushBotLogBatch).toHaveBeenCalledWith({ tournamentId: 7, category: "referees" });
  });

  it("flushRoundMapsNotice_logBatchFlushNeverEnds_stillResolves", async () => {
    pool([dueRow([R2])]);
    jest.mocked(flushBotLogBatch).mockReturnValue(new Promise<void>(() => undefined));
    await expect(flushRoundMapsNotice(7)).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_ownRoundsCoverAllPending_sends", async () => {
    pool([dueRow([R2, R3])]);

    await expect(flushRoundMapsNotice(7, ["0:UPPER:2", "0:UPPER:3"])).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_ownRoundsButOverflowPending_leavesItToTheWindow", async () => {
    // Des manches seulement comptées peuvent être celles d'un autre membre du staff.
    pool([dueRow([R2, { more: 3 }])]);

    await expect(flushRoundMapsNotice(7, ["0:UPPER:2"])).resolves.toBe(false);

    expect(sendBotLog).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([sql]) => /^\s*DELETE/.test(sql))).toBe(false);
  });

  it("flushRoundMapsNotice_sweepAlreadyClaimedIt_returnsFalse", async () => {
    pool([dueRow([R2])], 0);
    await expect(flushRoundMapsNotice(7)).resolves.toBe(false);
  });
});

describe("dispatchDueRoundMapsNotices — phases", () => {
  it("dispatchDueRoundMapsNotices_singlePhaseRounds_skipsThePhaseQuery", async () => {
    pool([dueRow([R2])]);
    await dispatchDueRoundMapsNotices();
    expect(execute.mock.calls.some(([sql]) => /bg_tournament_phases/.test(sql))).toBe(false);
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).not.toContain("Phase");
  });

  it("dispatchDueRoundMapsNotices_twoPhasesSameRoundNumber_prefixesEachPhase", async () => {
    const rounds = [
      { phaseId: 11, bracket: "UPPER", roundNumber: 1 },
      { phaseId: 12, bracket: "UPPER", roundNumber: 1 },
    ];
    const phases = [
      { id: 11, position: 2, format: "SINGLE" },
      { id: 12, position: 1, format: "SINGLE" },
    ];
    pool([dueRow(rounds, 1, "MULTI")], 1, phases);
    await dispatchDueRoundMapsNotices();
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("Phase 1 · Manche 1, Phase 2 · Manche 1 (2 manches)");
  });

  it("dispatchDueRoundMapsNotices_swissPhaseInMultiTournament_usesSwissLabel", async () => {
    pool([dueRow([{ phaseId: 11, bracket: "UPPER", roundNumber: 2 }], 1, "MULTI")], 1, [
      { id: 11, position: 1, format: "SWISS" },
    ]);
    await dispatchDueRoundMapsNotices();
    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("Phase 1 · Ronde 2 (1 manche)");
  });

  it("dispatchDueRoundMapsNotices_unknownPhaseId_fallsBackToTournamentFormat", async () => {
    pool([dueRow([{ phaseId: 99, bracket: "UPPER", roundNumber: 2 }], 1, "SWISS")], 1, []);
    await dispatchDueRoundMapsNotices();
    const message = jest.mocked(sendBotLog).mock.calls[0][0];
    expect(message).toContain(": Ronde 2 (1 manche)");
    expect(message).not.toContain("Phase");
  });
});

describe("flushRoundMapsNotice — cap per tournament", () => {
  it("flushRoundMapsNotice_secondFlushWithinWindow_sendsNothing", async () => {
    pool([dueRow([R2])]);
    await flushRoundMapsNotice(7);
    execute.mockClear();
    await expect(flushRoundMapsNotice(7)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("flushRoundMapsNotice_flushAfterWindow_sendsAgain", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    pool([dueRow([R2])]);
    await flushRoundMapsNotice(7);
    now.mockReturnValue(1_060_000);
    await expect(flushRoundMapsNotice(7)).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_oneMillisecondBeforeWindowEnds_sendsNothing", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    pool([dueRow([R2])]);
    await flushRoundMapsNotice(7);
    now.mockReturnValue(1_059_999);
    await expect(flushRoundMapsNotice(7)).resolves.toBe(false);
  });

  it("flushRoundMapsNotice_twoConcurrentFlushes_onlyOneQueries", async () => {
    pool([dueRow([R2])]);
    const results = await Promise.all([flushRoundMapsNotice(7), flushRoundMapsNotice(7)]);
    expect(results).toEqual([true, false]);
    expect(execute.mock.calls.filter(([sql]) => /^\s*SELECT/.test(sql))).toHaveLength(1);
  });

  it("flushRoundMapsNotice_databaseFails_releasesTheCap", async () => {
    jest.mocked(getDatabase).mockRejectedValueOnce(new Error("down"));
    await expect(flushRoundMapsNotice(7)).rejects.toThrow("down");
    pool([dueRow([R2])]);
    await expect(flushRoundMapsNotice(7)).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_otherTournament_notCapped", async () => {
    pool([dueRow([R2])]);
    await flushRoundMapsNotice(7);
    pool([{ ...dueRow([R2]), tournament_id: 8 }]);
    await expect(flushRoundMapsNotice(8)).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_previousFlushSentNothing_doesNotCap", async () => {
    pool([]);
    await flushRoundMapsNotice(7);
    pool([dueRow([R2])]);
    await expect(flushRoundMapsNotice(7)).resolves.toBe(true);
  });

  it("flushRoundMapsNotice_afterReset_capCleared", async () => {
    pool([dueRow([R2])]);
    await flushRoundMapsNotice(7);
    resetRoundMapsNoticeState();
    await expect(flushRoundMapsNotice(7)).resolves.toBe(true);
  });
});

describe("formatRoundMapsSummaryLog", () => {
  const tournament = { id: 7, name: "Coupe" };

  it("formatRoundMapsSummaryLog_oneRound_singular", () => {
    expect(formatRoundMapsSummaryLog({ tournament, roundLabels: ["Manche 2"], listed: 8 })).toContain(
      "Manche 2 (1 manche), par le staff",
    );
  });

  it("formatRoundMapsSummaryLog_roundsBeyondTheStoredCap_countedInRestAndTotal", () => {
    const log = formatRoundMapsSummaryLog({ tournament, roundLabels: ["M1", "M2"], listed: 8, more: 3 });

    expect(log).toContain("M1, M2 et 3 autres (5 manches)");
  });

  it("formatRoundMapsSummaryLog_noListedRoundOnlyOverflow_countOnly", () => {
    const log = formatRoundMapsSummaryLog({ tournament, roundLabels: [], listed: 8, more: 3 });

    expect(log).toContain("Cartes de manche modifiées");
    expect(log).toContain(" : 3 manches, par le staff");
    expect(log).not.toContain(" et ");
  });

  it("formatRoundMapsSummaryLog_moreThanListed_countsTheRest", () => {
    const labels = Array.from({ length: 10 }, (_, index) => `M${index + 1}`);
    const log = formatRoundMapsSummaryLog({ tournament, roundLabels: labels, listed: 8 });
    expect(log).toContain("M8 et 2 autres (10 manches)");
    expect(log).not.toContain("M9,");
  });
});

describe("queueRoundMapsNotice — point de sauvegarde", () => {
  const sqlError = (code: string, errno: number) => Object.assign(new Error(code), { code, errno });

  it("queueRoundMapsNotice_firstSave_opensASavepointBeforeWriting", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValue([[], []]);
    connection.query.mockResolvedValue([[], []]);

    await queueRoundMapsNotice(fakeConnection(connection), 7, [R2]);

    expect(connection.query.mock.calls[0][0]).toBe("SAVEPOINT round_maps_notice");
  });

  it("queueRoundMapsNotice_lockWaitTimeout_rollsBackToTheSavepointAndResolves", async () => {
    const connection = connectionMock();
    connection.execute.mockRejectedValue(sqlError("ER_LOCK_WAIT_TIMEOUT", 1205));
    connection.query.mockResolvedValue([[], []]);

    await expect(queueRoundMapsNotice(fakeConnection(connection), 7, [R2])).resolves.toBeUndefined();

    expect(connection.query.mock.calls.map(([sql]) => sql)).toEqual([
      "SAVEPOINT round_maps_notice",
      "ROLLBACK TO SAVEPOINT round_maps_notice",
    ]);
    expect(console.error).toHaveBeenCalled();
  });

  it("queueRoundMapsNotice_deadlock_rethrowsForTheReplay", async () => {
    const connection = connectionMock();
    const deadlock = sqlError("ER_LOCK_DEADLOCK", 1213);
    connection.execute.mockRejectedValue(deadlock);
    connection.query.mockResolvedValue([[], []]);

    await expect(queueRoundMapsNotice(fakeConnection(connection), 7, [R2])).rejects.toBe(deadlock);

    expect(connection.query).toHaveBeenCalledTimes(1);
  });

  it("queueRoundMapsNotice_rollbackFails_rethrowsTheOriginalError", async () => {
    const connection = connectionMock();
    const timeout = sqlError("ER_LOCK_WAIT_TIMEOUT", 1205);
    connection.execute.mockRejectedValue(timeout);
    connection.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error("SAVEPOINT does not exist"));

    await expect(queueRoundMapsNotice(fakeConnection(connection), 7, [R2])).rejects.toBe(timeout);
  });

  it("queueRoundMapsNotice_roundAlreadyPending_keepsItsFirstFingerprint", async () => {
    const connection = connectionMock();
    connection.query.mockResolvedValue([[], []]);
    connection.execute.mockImplementation(async (sql) =>
      /^\s*SELECT/.test(sql) ? [[{ rounds_json: JSON.stringify([{ ...R2, before: "aaaaaaaaaaaa" }]) }], []] : [{}, []],
    );

    await queueRoundMapsNotice(fakeConnection(connection), 7, [{ ...R2, before: "bbbbbbbbbbbb" }]);

    const [, params] = connection.execute.mock.calls[2];
    expect(JSON.parse(String((params as unknown[])[0]))).toEqual([{ ...R2, before: "aaaaaaaaaaaa" }]);
  });
});

describe("dispatchDueRoundMapsNotices — tours revenus à l'identique", () => {
  const MAPS = [["Ilios"]];

  function poolWithMaps(select: unknown[], maps: unknown[] | Error) {
    execute = jest.fn<SqlQuery>(async (sql) => {
      if (/FROM bg_tournament_round_maps/.test(sql)) {
        if (maps instanceof Error) throw maps;
        return [maps, []];
      }
      return /^\s*SELECT/.test(sql) ? [select, []] : [{ affectedRows: 1 }, []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  }

  const mapsRow = (slots: unknown, tiebreak: string | null = null) => ({
    phase_id: 0,
    bracket: "UPPER",
    round_number: 2,
    slots_json: JSON.stringify(slots),
    tiebreak_map: tiebreak,
  });

  it("dispatchDueRoundMapsNotices_roundBackToItsBeforeState_sendsNothing", async () => {
    poolWithMaps([dueRow([{ ...R2, before: roundMapsFingerprint(MAPS) }])], [mapsRow(MAPS)]);

    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(0);

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("dispatchDueRoundMapsNotices_roundStillChanged_sendsIt", async () => {
    poolWithMaps([dueRow([{ ...R2, before: roundMapsFingerprint([]) }])], [mapsRow(MAPS)]);

    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(1);

    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("dispatchDueRoundMapsNotices_tiebreakBackToNone_sendsNothing", async () => {
    poolWithMaps([dueRow([{ ...R2, tiebreak: true, before: roundMapsFingerprint(null) }])], []);

    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(0);

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("dispatchDueRoundMapsNotices_pointsBackToTheirBeforeValue_sendsNothing", async () => {
    poolWithMaps([dueRow([{ ...R2, points: true, before: roundMapsFingerprint(5) }])], [{ ...mapsRow([]), map_point_target: 5 }]);

    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(0);

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("dispatchDueRoundMapsNotices_pointsStillChanged_sendsIt", async () => {
    poolWithMaps([dueRow([{ ...R2, points: true, before: roundMapsFingerprint(null) }])], [{ ...mapsRow([]), map_point_target: 7 }]);

    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(1);
  });

  it("dispatchDueRoundMapsNotices_roundMapsUnreadable_sendsEveryRound", async () => {
    poolWithMaps([dueRow([{ ...R2, before: roundMapsFingerprint(MAPS) }])], new Error("boom"));

    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(1);
  });

  it("dispatchDueRoundMapsNotices_missingTable_logsNothing", async () => {
    execute = jest.fn<SqlQuery>(async () => {
      throw Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(0);

    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("scheduleRoundMapsNotice", () => {
  const sweeps = () => execute.mock.calls.filter(([sql]) => /send_after <= NOW\(\)/.test(sql)).length;

  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
    pool([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("scheduleRoundMapsNotice_otherTournamentSavedLater_firstDeadlineStillFires", async () => {
    scheduleRoundMapsNotice();
    await jest.advanceTimersByTimeAsync(30_000);
    scheduleRoundMapsNotice();

    await jest.advanceTimersByTimeAsync(32_000);

    expect(sweeps()).toBe(1);
  });

  it("scheduleRoundMapsNotice_twoDeadlines_sweepsAtEach", async () => {
    scheduleRoundMapsNotice();
    await jest.advanceTimersByTimeAsync(30_000);
    scheduleRoundMapsNotice();

    await jest.advanceTimersByTimeAsync(62_000);

    expect(sweeps()).toBe(2);
  });

  it("scheduleRoundMapsNotice_deadlineFiresSlightlyEarly_doesNotRearmAtZero", async () => {
    const windowMs = (ROUND_MAPS_NOTICE_WINDOW_SECONDS + 2) * 1000;
    scheduleRoundMapsNotice(Date.now() - windowMs + 20);

    await jest.advanceTimersByTimeAsync(40);
    await jest.advanceTimersByTimeAsync(200);

    expect(sweeps()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("roundPointsFingerprint", () => {
  it("roundPointsFingerprint_noMapTargets_equalsRoundTargetFingerprint", () => {
    expect(roundPointsFingerprint(3, [])).toBe(roundMapsFingerprint(3));
  });

  it("roundPointsFingerprint_mapTargets_differsFromRoundOnly", () => {
    expect(roundPointsFingerprint(3, [null, 4])).not.toBe(roundMapsFingerprint(3));
  });

  it("roundPointsFingerprint_differentMapTargets_differ", () => {
    expect(roundPointsFingerprint(3, [4])).not.toBe(roundPointsFingerprint(3, [5]));
  });
});
