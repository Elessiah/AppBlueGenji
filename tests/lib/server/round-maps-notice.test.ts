import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import {
  dispatchDueRoundMapsNotices,
  flushRoundMapsNotice,
  queueRoundMapsNotice,
  resetRoundMapsNoticeState,
} from "@/lib/server/tournaments/round-maps-notice";
import { formatRoundMapsSummaryLog } from "@/lib/shared/bot-logs";
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

function pool(select: unknown[], claimed = 1) {
  execute = jest.fn<SqlQuery>(async (sql) => (/^\s*SELECT/.test(sql) ? [select, []] : [{ affectedRows: claimed }, []]));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRoundMapsNoticeState();
  jest.mocked(sendBotLog).mockResolvedValue();
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

  it("queueRoundMapsNotice_firstSave_insertsRoundsAndRestartsWindow", async () => {
    const connection = queueWith([]);
    await queueRoundMapsNotice(fakeConnection(connection), 7, [R2]);
    const [sql, params] = connection.execute.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO bg_round_maps_notices[\s\S]*changes = changes \+ 1/);
    expect(params).toEqual([7, JSON.stringify([R2]), 60]);
  });

  it("queueRoundMapsNotice_secondSave_mergesRoundsWithoutDuplicates", async () => {
    const connection = queueWith([{ rounds_json: JSON.stringify([R2, R3]) }]);
    await queueRoundMapsNotice(fakeConnection(connection), 7, [R3, { ...R2, roundNumber: 4 }]);
    const params = connection.execute.mock.calls[1][1] as unknown[];
    expect(JSON.parse(String(params[1]))).toEqual([R2, R3, { ...R2, roundNumber: 4 }]);
  });

  it("queueRoundMapsNotice_corruptPendingJson_startsFromTheNewRounds", async () => {
    const connection = queueWith([{ rounds_json: "{pas du json" }]);
    await queueRoundMapsNotice(fakeConnection(connection), 7, [R2]);
    expect((connection.execute.mock.calls[1][1] as unknown[])[1]).toBe(JSON.stringify([R2]));
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

  it("dispatchDueRoundMapsNotices_botFails_stillResolves", async () => {
    pool([dueRow([R2])]);
    jest.mocked(sendBotLog).mockRejectedValue(new Error("bot"));
    await expect(dispatchDueRoundMapsNotices()).resolves.toBe(1);
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
  });

  it("flushRoundMapsNotice_sweepAlreadyClaimedIt_returnsFalse", async () => {
    pool([dueRow([R2])], 0);
    await expect(flushRoundMapsNotice(7)).resolves.toBe(false);
  });
});

describe("formatRoundMapsSummaryLog", () => {
  const tournament = { id: 7, name: "Coupe" };

  it("formatRoundMapsSummaryLog_oneRound_singular", () => {
    expect(formatRoundMapsSummaryLog({ tournament, roundLabels: ["Manche 2"], listed: 8 })).toContain(
      "Manche 2 (1 manche), par le staff",
    );
  });

  it("formatRoundMapsSummaryLog_moreThanListed_countsTheRest", () => {
    const labels = Array.from({ length: 10 }, (_, index) => `M${index + 1}`);
    const log = formatRoundMapsSummaryLog({ tournament, roundLabels: labels, listed: 8 });
    expect(log).toContain("M8 et 2 autres (10 manches)");
    expect(log).not.toContain("M9,");
  });
});
