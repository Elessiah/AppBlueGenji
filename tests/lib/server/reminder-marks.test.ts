import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  claimDatedMark,
  forgetMatchReminders,
  forgetStaffPush,
  markStaffPushed,
  releaseDatedMarks,
  releaseStaffPush,
} from "@/lib/server/tournaments/reminder-marks";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/** L'interblocage sur le verrou AUTO-INC, tel que MariaDB le rend. */
const autoIncFailure = () =>
  Object.assign(new Error("Failed to read auto-increment value from storage engine"), {
    code: "ER_AUTOINC_READ_FAILED",
    errno: 1467,
  });

describe("claimDatedMark", () => {
  const match = { id: 31, start_at: new Date("2099-01-01T18:00:00Z"), team1_id: 4, team2_id: 5 };

  it("claimDatedMark_freeMark_returnsTrue", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    expect(await claimDatedMark(match, "P1D")).toBe(true);

    expect(execute.mock.calls[0]?.[1]).toEqual([31, "P1D", 31, match.start_at, 4, 5]);
  });

  it("claimDatedMark_duplicateOrMovedSchedule_returnsFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    expect(await claimDatedMark(match, "P1D")).toBe(false);
  });

  it("claimDatedMark_autoIncFailureOnce_replaysTheStatement", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(autoIncFailure()).mockResolvedValueOnce([{ affectedRows: 1 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    expect(await claimDatedMark(match, "P1D")).toBe(true);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("claimDatedMark_otherError_throwsWithoutReplay", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("base injoignable"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(claimDatedMark(match, "P1D")).rejects.toThrow("base injoignable");

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("releaseDatedMarks", () => {
  it("ne rend que les marques prises pour cet horaire", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 2 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const start = new Date("2099-01-01T18:00:00Z");

    await releaseDatedMarks(31, ["SEEN", "P1D"], start);

    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/WHERE match_id = \? AND offset_key IN \(\?, \?\) AND start_at <=> \?$/);
    expect(params).toEqual([31, "SEEN", "P1D", start]);
  });

  it("ne lit rien sans marque à rendre", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await releaseDatedMarks(31, [], new Date());
    expect(execute).not.toHaveBeenCalled();
  });

  it("ne lève jamais, mais dit l'échec dans pm2 (sauf table absente)", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = jest.fn<SqlQuery>().mockRejectedValue(new Error("Lock wait timeout exceeded"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: failing }));
    await expect(releaseDatedMarks(31, ["SEEN"], new Date())).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);

    const missing = jest
      .fn<SqlQuery>()
      .mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: missing }));
    await releaseDatedMarks(31, ["SEEN"], new Date());
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("forgetMatchReminders", () => {
  it("efface les marques des manches données, par lots", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValue([{ affectedRows: 1 }]);
    const ids = Array.from({ length: 501 }, (_, index) => index + 1);

    await forgetMatchReminders(fakeConnection(connection), ids);

    expect(connection.execute).toHaveBeenCalledTimes(2);
    const [sql, params] = connection.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/^DELETE FROM bg_match_reminders WHERE match_id IN \(\?(, \?){499}\) AND offset_key <> \?$/);
    expect(params).toHaveLength(501);
    // L'horaire poussé aux arbitres reste : une affiche changée ne change pas ce qu'ils ont reçu.
    expect(params[500]).toBe("STAFF");
    expect((connection.execute.mock.calls[1] as unknown as [string, unknown[]])[1]).toEqual([501, "STAFF"]);
  });

  it("ne fait rien sans manche", async () => {
    const connection = connectionMock();
    await forgetMatchReminders(fakeConnection(connection), []);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("tolère une table absente", async () => {
    const connection = connectionMock();
    connection.execute.mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    await expect(forgetMatchReminders(fakeConnection(connection), [7])).resolves.toBeUndefined();
  });

  it("laisse passer toute autre erreur", async () => {
    const connection = connectionMock();
    connection.execute.mockRejectedValue(new Error("deadlock"));
    await expect(forgetMatchReminders(fakeConnection(connection), [7])).rejects.toThrow("deadlock");
  });
});

describe("marque STAFF — horaire poussé aux arbitres", () => {
  const T = "2099-01-01T18:00:00.000Z";
  const OTHER = new Date("2099-01-02T18:00:00.000Z");

  const MATCH_LOCK = "SELECT start_at FROM bg_matches WHERE id = ? LIMIT 1 LOCK IN SHARE MODE";
  const MARK_INSERT = "INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at, sent_at) VALUES (?, ?, ?, ?)";
  const MARK_LOCK = "SELECT start_at FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? LIMIT 1 FOR UPDATE";

  function transactionMock() {
    const connection = connectionMock();
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ getConnection: async () => fakeConnection(connection) }));
    return connection;
  }

  const MARK_SEEN = "SELECT start_at FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? LIMIT 1";
  const MARK_UPDATE = "UPDATE bg_match_reminders SET start_at = ?, sent_at = ? WHERE match_id = ? AND offset_key = ?";

  /**
   * Transaction de réservation : horaire de la manche, lecture simple de la
   * marque, puis son insertion (absente) ou sa lecture verrouillée (`existing`).
   */
  function staffDb(existing: { start_at: Date | null } | null, matchStart: Date | null = new Date(T)) {
    const connection = transactionMock();
    connection.execute.mockResolvedValueOnce([[{ start_at: matchStart }]]);
    if (existing) {
      connection.execute.mockResolvedValueOnce([[existing]]).mockResolvedValueOnce([[existing]]);
    } else {
      connection.execute.mockResolvedValueOnce([[]]);
    }
    connection.execute.mockResolvedValue([{ affectedRows: 1 }]);
    return connection;
  }

  const sqlsOf = (connection: ReturnType<typeof connectionMock>) => connection.execute.mock.calls.map(([sql]) => String(sql));

  it("markStaffPushed_reservation_stampTruncatedToTheSecond", async () => {
    jest.useFakeTimers({ now: new Date("2099-01-01T17:00:00.789Z") });
    try {
      staffDb(null);

      const reservation = await markStaffPushed(31, T);

      // `sent_at` est un DATETIME à la seconde : un jeton à la milliseconde ne
      // retrouverait jamais sa ligne au rendu.
      expect(reservation).toMatchObject({ stamp: new Date("2099-01-01T17:00:00.000Z") });
    } finally {
      jest.useRealTimers();
    }
  });

  it("markStaffPushed_noMarkYet_insertsWithoutLockingRead", async () => {
    const connection = staffDb(null);

    const reservation = await markStaffPushed(31, T);

    expect(reservation).toEqual({ kind: "reserved", matchId: 31, startAt: T, previous: null, stamp: expect.any(Date) });
    // La manche, une lecture simple, puis l'insertion — aucune lecture
    // verrouillante de la marque absente : elle verrouillerait l'intervalle,
    // où l'insertion attendrait la réservation des joueurs (interblocage).
    expect(sqlsOf(connection)).toEqual([MATCH_LOCK, MARK_SEEN, MARK_INSERT]);
    expect(connection.execute.mock.calls[2]).toEqual([MARK_INSERT, [31, "STAFF", new Date(T), expect.any(Date)]]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("markStaffPushed_matchMoved_returnsNullWithoutWriting", async () => {
    const connection = staffDb(null, OTHER);

    expect(await markStaffPushed(31, T)).toBeNull();

    expect(sqlsOf(connection)).toEqual([MATCH_LOCK]);
  });

  it("markStaffPushed_duplicateSameTime_returnsHeld", async () => {
    const connection = staffDb({ start_at: new Date(T) });

    expect(await markStaffPushed(31, T)).toEqual({ kind: "held" });

    // Marque (match_id, offset_key) déjà là : lue sous verrou, ni insérée ni réécrite.
    expect(sqlsOf(connection)).toEqual([MATCH_LOCK, MARK_SEEN, MARK_LOCK]);
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await releaseStaffPush({ kind: "held" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("markStaffPushed_duplicateOtherTime_redatesAndKeepsPrevious", async () => {
    const connection = staffDb({ start_at: OTHER });

    const reservation = await markStaffPushed(31, T);

    expect(reservation).toEqual({ kind: "reserved", matchId: 31, startAt: T, previous: OTHER, stamp: expect.any(Date) });
    expect(sqlsOf(connection)).toEqual([MATCH_LOCK, MARK_SEEN, MARK_LOCK, MARK_UPDATE]);
    expect(connection.execute.mock.calls[3]).toEqual([MARK_UPDATE, [new Date(T), expect.any(Date), 31, "STAFF"]]);
  });

  it("markStaffPushed_markAppearsDuringInsert_restartsAndReadsIt", async () => {
    const connection = transactionMock();
    connection.execute
      // 1re transaction : absente à la lecture simple, déjà là à l'insertion.
      .mockResolvedValueOnce([[{ start_at: new Date(T) }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      // 2e transaction : présente, redatée.
      .mockResolvedValueOnce([[{ start_at: new Date(T) }]])
      .mockResolvedValueOnce([[{ start_at: OTHER }]])
      .mockResolvedValueOnce([[{ start_at: OTHER }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const reservation = await markStaffPushed(31, T);

    expect(reservation).toEqual({ kind: "reserved", matchId: 31, startAt: T, previous: OTHER, stamp: expect.any(Date) });
    expect(sqlsOf(connection)).toEqual([MATCH_LOCK, MARK_SEEN, MARK_INSERT, MATCH_LOCK, MARK_SEEN, MARK_LOCK, MARK_UPDATE]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("markStaffPushed_markVanishesBeforeLock_restartsAndInsertsOutsideTheGapLock", async () => {
    const connection = transactionMock();
    connection.execute
      // 1re transaction : vue, puis disparue sous le verrou (retrait poussé).
      .mockResolvedValueOnce([[{ start_at: new Date(T) }]])
      .mockResolvedValueOnce([[{ start_at: OTHER }]])
      .mockResolvedValueOnce([[]])
      // 2e transaction : absente, insérée.
      .mockResolvedValueOnce([[{ start_at: new Date(T) }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const reservation = await markStaffPushed(31, T);

    expect(reservation).toEqual({ kind: "reserved", matchId: 31, startAt: T, previous: null, stamp: expect.any(Date) });
    // Jamais d'insertion dans la transaction qui a verrouillé l'intervalle.
    expect(sqlsOf(connection)).toEqual([MATCH_LOCK, MARK_SEEN, MARK_LOCK, MATCH_LOCK, MARK_SEEN, MARK_INSERT]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("markStaffPushed_markKeepsMoving_pushesUnmarkedAfterThreeTries", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = transactionMock();
    connection.execute.mockImplementation(async (sql) => {
      if (String(sql) === MATCH_LOCK) return [[{ start_at: new Date(T) }]];
      if (String(sql) === MARK_SEEN) return [[]];
      return [{ affectedRows: 0 }];
    });

    expect(await markStaffPushed(31, T)).toEqual({ kind: "unmarked" });

    expect(connection.beginTransaction).toHaveBeenCalledTimes(3);
    expect(connection.rollback).toHaveBeenCalledTimes(3);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("markStaffPushed_autoIncFailureOnce_replaysAndReserves", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = transactionMock();
    connection.execute
      .mockResolvedValueOnce([[{ start_at: new Date(T) }]])
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(autoIncFailure())
      .mockResolvedValueOnce([[{ start_at: new Date(T) }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const reservation = await markStaffPushed(31, T);

    // L'horaire poussé est retenu : la transaction défaite est rejouée entière.
    expect(reservation).toEqual({ kind: "reserved", matchId: 31, startAt: T, previous: null, stamp: expect.any(Date) });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(2);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(sqlsOf(connection)).toEqual([MATCH_LOCK, MARK_SEEN, MARK_INSERT, MATCH_LOCK, MARK_SEEN, MARK_INSERT]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("markStaffPushed_deadlockOnce_replaysWithoutLogging", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = transactionMock();
    connection.execute
      .mockResolvedValueOnce([[{ start_at: new Date(T) }]])
      .mockRejectedValueOnce(Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213 }))
      .mockResolvedValueOnce([[{ start_at: new Date(T) }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    expect(await markStaffPushed(31, T)).toEqual({ kind: "reserved", matchId: 31, startAt: T, previous: null, stamp: expect.any(Date) });

    expect(connection.beginTransaction).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("markStaffPushed_deadlockThenMarkMoved_logsMarkMovedNotDeadlock", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = transactionMock();
    const deadlock = Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    connection.execute.mockRejectedValueOnce(deadlock).mockImplementation(async (sql) => {
      if (String(sql) === MATCH_LOCK) return [[{ start_at: new Date(T) }]];
      if (String(sql) === MARK_SEEN) return [[]];
      return [{ affectedRows: 0 }];
    });

    expect(await markStaffPushed(31, T)).toEqual({ kind: "unmarked" });

    expect(connection.beginTransaction).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls[0][1];
    expect(logged).not.toBe(deadlock);
    expect((logged as Error).message).toBe("STAFF_MARK_MOVED");
    error.mockRestore();
  });

  it("markStaffPushed_rollbackFails_destroysConnectionAndPushesUnmarked", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = transactionMock();
    connection.execute.mockRejectedValue(new Error("base injoignable"));
    connection.rollback.mockRejectedValue(new Error("connexion tombée"));

    expect(await markStaffPushed(31, T)).toEqual({ kind: "unmarked" });

    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("markStaffPushed_autoIncFailureEveryTime_unmarkedAfterThreeTries", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = transactionMock();
    connection.execute.mockImplementation(async (sql) => {
      if (String(sql) === MATCH_LOCK) return [[{ start_at: new Date(T) }]];
      if (String(sql) === MARK_SEEN) return [[]];
      throw autoIncFailure();
    });

    expect(await markStaffPushed(31, T)).toEqual({ kind: "unmarked" });

    expect(connection.beginTransaction).toHaveBeenCalledTimes(3);
    expect(connection.rollback).toHaveBeenCalledTimes(3);
    // pm2 : une seule ligne, la marque non retenue (une boucle, pas deux).
    expect(error.mock.calls.map(([line]) => line)).toEqual(["[match-schedule] horaire poussé aux arbitres non retenu"]);
    error.mockRestore();
  });

  it("défait la réservation sur une erreur, et pousse quand même sans marque", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const connection = transactionMock();
    connection.execute.mockRejectedValue(new Error("base injoignable"));
    expect(await markStaffPushed(31, T)).toEqual({ kind: "unmarked" });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("releaseStaffPush_reservedMark_restoresWhatItHeld", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const stamp = new Date("2099-01-01T17:00:00.000Z");
    await releaseStaffPush({ kind: "reserved", matchId: 31, startAt: T, previous: OTHER, stamp });
    await releaseStaffPush({ kind: "reserved", matchId: 32, startAt: T, previous: null, stamp });

    // Jeton `sent_at` : une marque recréée au même horaire par une autre
    // réservation (retrait puis remise) n'est ni effacée ni ramenée.
    expect(execute.mock.calls[0]).toEqual([
      "UPDATE bg_match_reminders SET start_at = ? WHERE match_id = ? AND offset_key = ? AND start_at <=> ? AND sent_at = ?",
      [OTHER, 31, "STAFF", new Date(T), stamp],
    ]);
    expect(execute.mock.calls[1]).toEqual([
      "DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? AND start_at <=> ? AND sent_at = ?",
      [32, "STAFF", new Date(T), stamp],
    ]);
  });

  it("oublie l'horaire retiré, sauf si la manche l'a retrouvé pendant l'envoi (reposé par un autre arbitre)", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await forgetStaffPush(31, "2099-01-01T18:00:00.000Z");
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/AND NOT EXISTS \(SELECT 1 FROM bg_matches m WHERE m\.id = \? AND m\.start_at <=> \?\)$/);
    expect(params).toEqual([31, "STAFF", new Date("2099-01-01T18:00:00.000Z"), 31, new Date("2099-01-01T18:00:00.000Z")]);
  });

  it("n'échoue jamais : l'erreur va dans pm2, une table absente se tait", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = jest.fn<SqlQuery>().mockRejectedValue(new Error("base injoignable"));
    jest.mocked(getDatabase).mockResolvedValue(
      fakePool({ execute: failing, getConnection: async () => Promise.reject(new Error("base injoignable")) }),
    );
    // Marque illisible : on pousse quand même (sans marque, le retrait ne sera pas poussé).
    await expect(markStaffPushed(31, "2099-01-01T18:00:00.000Z")).resolves.toEqual({ kind: "unmarked" });
    await expect(forgetStaffPush(31, "2099-01-01T18:00:00.000Z")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);

    error.mockClear();
    const missing = jest
      .fn<SqlQuery>()
      .mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: missing, getConnection: missing }));
    await markStaffPushed(31, "2099-01-01T18:00:00.000Z");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
