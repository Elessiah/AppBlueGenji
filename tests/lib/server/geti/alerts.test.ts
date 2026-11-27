import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database", () => ({ getDatabase: jest.fn(), withConnection: jest.fn() }));
jest.mock("@/lib/server/notify", () => ({ loadNotificationRecipients: jest.fn(), notifyUsers: jest.fn() }));
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import type { PoolConnection } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import {
  createGetiAlert,
  deleteGetiAlert,
  deleteGetiAlertsOfUser,
  exportGetiAlerts,
  listGetiAlerts,
  notifyGetiAlerts,
  purgeGetiAlertHits,
  scheduleGetiAlerts,
  GETI_ALERT_QUEUE_MAX,
  updateGetiAlert,
  type GetiAlertPost,
  type GetiAlertSender,
} from "@/lib/server/geti/alerts";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import {
  GETI_ALERT_COOLDOWN_MINUTES,
  GETI_ALERT_HIT_RETENTION_DAYS,
  GETI_ALERT_MAX_PER_USER,
  GETI_ALERT_NAME_MAX,
  GETI_ALERT_SCAN_MAX,
} from "@/lib/shared/geti/alerts";
import type { GetiParsedPost } from "@/lib/shared/geti";
import { GETI_FAKE_AUTHOR_ID, parsedGetiPost } from "../../../helpers/geti";
import { GETI_FAKE_MESSAGE_ID, getiPushedPost } from "../../../helpers/geti-ingest";
import { connectionMock, fakeConnection, fakePool, type SqlMock, type SqlQuery } from "../../../helpers/sql-double";

/** Alertes GETI : création sous plafond, changement, suppression, effacement, passe d'alertes. */

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const MINUTE_MS = 60_000;
const USER_ID = 42;

function missingTable(): Error {
  return Object.assign(new Error("Table 'bg_geti_alerts' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
}

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    user_id: USER_ID,
    category: "lfp",
    name: "Tank EU",
    search: "?role=tank",
    paused: 0,
    created_at: "2026-11-27 10:00:00",
    ...overrides,
  };
}

/** Double d'`execute` : `rows` pour une lecture, `affectedRows` pour une écriture. */
function executeMock(rows: unknown[] = [], affectedRows = 1): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) =>
    sql.trimStart().startsWith("SELECT") ? [rows] : [{ affectedRows, insertId: 99 }],
  );
}

function useDatabase(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

/** `withConnection` joué sur une connexion simulée dont les lectures rendent `rows`. */
function useTransaction(rows: unknown[] = []) {
  const connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  connection.execute.mockImplementation(async (sql: string) =>
    sql.includes("FROM bg_geti_alerts") ? [rows] : [{ affectedRows: 1, insertId: 99 }],
  );
  jest
    .mocked(withConnection)
    .mockImplementation(<T,>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection(connection)));
  return connection;
}

function freshPost(overrides: Partial<GetiAlertPost> = {}): GetiAlertPost {
  return {
    messageId: GETI_FAKE_MESSAGE_ID,
    category: "lfp",
    parsed: parsedGetiPost({ category: "lfp", roles: ["TANK"] }),
    postedAt: new Date(NOW - MINUTE_MS),
    editedAt: null,
    ...overrides,
  };
}

function sqlOf(execute: SqlMock): string[] {
  return execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("listGetiAlerts", () => {
  it("listGetiAlerts_storedAlerts_returnsThemAsShown", async () => {
    const execute = executeMock([alertRow({ paused: 1, name: null })]);

    const alerts = await listGetiAlerts(USER_ID, fakePool({ execute }));

    expect(alerts).toEqual([
      { id: 7, category: "lfp", name: null, search: "?role=tank", paused: true, createdAt: expect.any(String) },
    ]);
  });

  it("listGetiAlerts_missingTable_returnsEmptyList", async () => {
    const execute = jest.fn<SqlQuery>(async () => {
      throw missingTable();
    });

    await expect(listGetiAlerts(USER_ID, fakePool({ execute }))).resolves.toEqual([]);
  });
});

describe("createGetiAlert", () => {
  it("createGetiAlert_validInput_locksTheAccountRowFirstThenInserts", async () => {
    const connection = useTransaction();

    const result = await createGetiAlert(USER_ID, { category: "lfp", search: "?reg=eu&role=tank&p=3", name: " Tank EU " });

    expect(result).toMatchObject({ id: 99, category: "lfp", name: "Tank EU", search: "?role=tank&reg=eu", paused: false });
    expect(connection.execute.mock.calls[0]).toEqual(["SELECT id FROM bg_users WHERE id = ? FOR UPDATE", [USER_ID]]);
    expect(connection.execute).toHaveBeenLastCalledWith(expect.stringContaining("INSERT INTO bg_geti_alerts"), [
      USER_ID,
      "lfp",
      "Tank EU",
      "?role=tank&reg=eu",
    ]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("createGetiAlert_unknownCategory_returnsInvalidWithoutTransaction", async () => {
    const result = await createGetiAlert(USER_ID, { category: "lfx", search: "" });

    expect(result).toBe("GETI_ALERT_INVALID");
    expect(withConnection).not.toHaveBeenCalled();
  });

  it("createGetiAlert_searchNotAString_returnsInvalid", async () => {
    const result = await createGetiAlert(USER_ID, { category: "lfp", search: 12 });

    expect(result).toBe("GETI_ALERT_INVALID");
  });

  it("createGetiAlert_nameOverMaxLength_returnsNameTooLong", async () => {
    const result = await createGetiAlert(USER_ID, { category: "lfp", search: "", name: "a".repeat(GETI_ALERT_NAME_MAX + 1) });

    expect(result).toBe("GETI_ALERT_NAME_TOO_LONG");
  });

  it("createGetiAlert_accountAlreadyAtTheLimit_returnsLimitWithoutInsert", async () => {
    const rows = Array.from({ length: GETI_ALERT_MAX_PER_USER }, (_, index) => alertRow({ id: index + 1, search: `?p=${index}` }));
    const connection = useTransaction(rows);

    const result = await createGetiAlert(USER_ID, { category: "lfp", search: "?role=tank" });

    expect(result).toBe("GETI_ALERT_LIMIT");
    expect(sqlOf(connection.execute).some((sql) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("createGetiAlert_oneBelowTheLimit_inserts", async () => {
    const rows = Array.from({ length: GETI_ALERT_MAX_PER_USER - 1 }, (_, index) => alertRow({ id: index + 1, category: "lft" }));
    useTransaction(rows);

    const result = await createGetiAlert(USER_ID, { category: "lfp", search: "?role=tank" });

    expect(result).toMatchObject({ id: 99 });
  });

  it("createGetiAlert_sameCategoryAndSearchInAnotherOrder_returnsDuplicate", async () => {
    useTransaction([alertRow({ search: "?role=tank&reg=eu" })]);

    const result = await createGetiAlert(USER_ID, { category: "lfp", search: "?reg=eu&role=tank" });

    expect(result).toBe("GETI_ALERT_DUPLICATE");
  });

  it("createGetiAlert_insertFails_rollsBackAndThrows", async () => {
    const connection = useTransaction();
    connection.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT")) throw new Error("écriture refusée");
      return [[]];
    });

    await expect(createGetiAlert(USER_ID, { category: "lfp", search: "" })).rejects.toThrow("écriture refusée");
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("updateGetiAlert", () => {
  it("updateGetiAlert_pause_writesOnlyTheOwnersRowAndReturnsIt", async () => {
    const execute = executeMock([alertRow({ paused: 1 })]);
    useDatabase(execute);

    const result = await updateGetiAlert(USER_ID, 7, { paused: true });

    expect(result).toMatchObject({ id: 7, paused: true });
    expect(execute.mock.calls[0]).toEqual(["UPDATE bg_geti_alerts SET paused = ? WHERE id = ? AND user_id = ?", [1, 7, USER_ID]]);
  });

  it("updateGetiAlert_rename_writesTheCleanedName", async () => {
    const execute = executeMock([alertRow({ name: "Nouveau" })]);
    useDatabase(execute);

    await updateGetiAlert(USER_ID, 7, { name: "  Nouveau  " });

    expect(execute.mock.calls[0]).toEqual(["UPDATE bg_geti_alerts SET name = ? WHERE id = ? AND user_id = ?", ["Nouveau", 7, USER_ID]]);
  });

  it("updateGetiAlert_emptyPatch_returnsInvalid", async () => {
    await expect(updateGetiAlert(USER_ID, 7, {})).resolves.toBe("GETI_ALERT_INVALID");
  });

  it("updateGetiAlert_pausedNotABoolean_returnsInvalid", async () => {
    await expect(updateGetiAlert(USER_ID, 7, { paused: "oui" })).resolves.toBe("GETI_ALERT_INVALID");
  });

  it("updateGetiAlert_nameOverMaxLength_returnsNameTooLong", async () => {
    const result = await updateGetiAlert(USER_ID, 7, { name: "a".repeat(GETI_ALERT_NAME_MAX + 1) });

    expect(result).toBe("GETI_ALERT_NAME_TOO_LONG");
  });

  it("updateGetiAlert_alertOfAnotherAccount_returnsNotFound", async () => {
    useDatabase(executeMock([]));

    await expect(updateGetiAlert(USER_ID, 7, { paused: true })).resolves.toBe("GETI_ALERT_NOT_FOUND");
  });
});

describe("deleteGetiAlert", () => {
  it("deleteGetiAlert_ownedAlert_deletesItInOneStatementTheHitsCascade", async () => {
    const execute = executeMock([], 1);
    useDatabase(execute);

    await expect(deleteGetiAlert(USER_ID, 7)).resolves.toBe(true);
    expect(execute.mock.calls).toEqual([["DELETE FROM bg_geti_alerts WHERE id = ? AND user_id = ?", [7, USER_ID]]]);
  });

  it("deleteGetiAlert_alertOfAnotherAccount_returnsFalseAndKeepsHits", async () => {
    const execute = executeMock([], 0);
    useDatabase(execute);

    await expect(deleteGetiAlert(USER_ID, 7)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("deleteGetiAlertsOfUser", () => {
  it("deleteGetiAlertsOfUser_accountErased_deletesHitsThenAlerts", async () => {
    const execute = executeMock();

    await deleteGetiAlertsOfUser(fakePool({ execute }), USER_ID);

    expect(sqlOf(execute)).toEqual([
      "DELETE FROM bg_geti_alert_hits WHERE alert_id IN (SELECT id FROM bg_geti_alerts WHERE user_id = ?)",
      "DELETE FROM bg_geti_alerts WHERE user_id = ?",
    ]);
  });

  it("deleteGetiAlertsOfUser_missingTable_resolves", async () => {
    const execute = jest.fn<SqlQuery>(async () => {
      throw missingTable();
    });

    await expect(deleteGetiAlertsOfUser(fakePool({ execute }), USER_ID)).resolves.toBeUndefined();
  });

  it("deleteGetiAlertsOfUser_hitsTableMissing_stillDeletesTheAlerts", async () => {
    const execute = jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.startsWith("DELETE FROM bg_geti_alert_hits")) throw missingTable();
      return [{ affectedRows: 1 }];
    });

    await deleteGetiAlertsOfUser(fakePool({ execute }), USER_ID);

    expect(execute).toHaveBeenLastCalledWith("DELETE FROM bg_geti_alerts WHERE user_id = ?", [USER_ID]);
  });

  it("deleteGetiAlertsOfUser_otherFailure_throws", async () => {
    const execute = jest.fn<SqlQuery>(async () => {
      throw new Error("base injoignable");
    });

    await expect(deleteGetiAlertsOfUser(fakePool({ execute }), USER_ID)).rejects.toThrow("base injoignable");
  });
});

describe("exportGetiAlerts", () => {
  it("exportGetiAlerts_alertsWithHits_returnsLastNotificationAndReportedPosts", async () => {
    const execute = jest.fn<SqlQuery>(async (sql: string) =>
      sql.includes("FROM bg_geti_alert_hits")
        ? [[{ alert_id: 7, message_id: GETI_FAKE_MESSAGE_ID, created_at: new Date("2026-11-27T11:00:00.000Z") }]]
        : [[alertRow({ last_notified_at: new Date("2026-11-27T11:00:00.000Z") }), alertRow({ id: 8, last_notified_at: null })]],
    );

    const exported = await exportGetiAlerts(USER_ID, fakePool({ execute }));

    expect(exported).toEqual([
      expect.objectContaining({
        lastNotifiedAt: "2026-11-27T11:00:00.000Z",
        reportedPosts: [{ messageId: GETI_FAKE_MESSAGE_ID, createdAt: "2026-11-27T11:00:00.000Z" }],
      }),
      expect.objectContaining({ lastNotifiedAt: null, reportedPosts: [] }),
    ]);
    expect(exported[0]).toMatchObject({ category: "lfp", name: "Tank EU", search: "?role=tank", paused: false });
  });

  it("exportGetiAlerts_noAlert_returnsEmptyWithoutReadingHits", async () => {
    const execute = executeMock([]);

    await expect(exportGetiAlerts(USER_ID, fakePool({ execute }))).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("exportGetiAlerts_hitsTableMissing_returnsAlertsWithoutReportedPosts", async () => {
    const execute = jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("FROM bg_geti_alert_hits")) throw missingTable();
      return [[alertRow({ last_notified_at: null })]];
    });

    const exported = await exportGetiAlerts(USER_ID, fakePool({ execute }));

    expect(exported).toHaveLength(1);
    expect(exported[0].reportedPosts).toEqual([]);
  });

  it("exportGetiAlerts_alertsTableMissing_returnsEmpty", async () => {
    const execute = jest.fn<SqlQuery>(async () => {
      throw missingTable();
    });

    await expect(exportGetiAlerts(USER_ID, fakePool({ execute }))).resolves.toEqual([]);
  });
});

describe("purgeGetiAlertHits", () => {
  it("purgeGetiAlertHits_called_deletesHitsOlderThanTheirRetention", async () => {
    const execute = executeMock([], 3);

    const removed = await purgeGetiAlertHits(fakePool({ execute }), NOW);

    expect(removed).toBe(3);
    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_alert_hits WHERE created_at < ? LIMIT 5000", [
      new Date(NOW - GETI_ALERT_HIT_RETENTION_DAYS * 24 * 60 * MINUTE_MS),
    ]);
  });

  it("purgeGetiAlertHits_fullBatch_runsAnotherPassUntilShort", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([{ affectedRows: 5000 }])
      .mockResolvedValueOnce([{ affectedRows: 5000 }])
      .mockResolvedValueOnce([{ affectedRows: 12 }]);

    const removed = await purgeGetiAlertHits(fakePool({ execute }), NOW);

    expect(removed).toBe(10012);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("purgeGetiAlertHits_tableMissingMidway_returnsRemovedSoFar", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([{ affectedRows: 5000 }])
      .mockRejectedValueOnce(missingTable());

    await expect(purgeGetiAlertHits(fakePool({ execute }), NOW)).resolves.toBe(5000);
  });

  it("purgeGetiAlertHits_otherFailure_throws", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("boom"));

    await expect(purgeGetiAlertHits(fakePool({ execute }), NOW)).rejects.toThrow("boom");
  });

  it("purgeGetiAlertHits_missingTable_returnsZero", async () => {
    const execute = jest.fn<SqlQuery>(async () => {
      throw missingTable();
    });

    await expect(purgeGetiAlertHits(fakePool({ execute }), NOW)).resolves.toBe(0);
  });
});

describe("notifyGetiAlerts", () => {
  const send = jest.fn<GetiAlertSender>();

  /** Ligne gardée d'une annonce : par défaut, la même version que `freshPost`. */
  function storedRow(messageId: string, parsed: GetiParsedPost = parsedGetiPost({ category: "lfp", roles: ["TANK"] })) {
    return {
      message_id: messageId,
      channel_id: "100000000000000800",
      category: parsed.category,
      source: "direct",
      parsed_json: JSON.stringify(parsed),
      stale_raw_json: null,
      posted_at: new Date(NOW - MINUTE_MS),
      edited_at: null,
    };
  }

  function activeAlertRow(overrides: Record<string, unknown> = {}) {
    return alertRow({ last_notified_at: null, discord_id: null, ...overrides });
  }

  /**
   * Base simulée : version gardée de chaque annonce relue, alertes actives
   * lues, traces déjà là, trace posée ou non, délai réservé ou non.
   */
  function alertsDatabase(
    options: {
      alerts?: unknown[];
      stored?: (messageId: string) => unknown;
      seen?: number[];
      newHit?: boolean;
      /** Traces réellement posées par l'insertion (recouvrement partiel), et celles relues comme posées par cette passe. */
      inserted?: number;
      mine?: number[];
      reserved?: boolean;
    } = {},
  ): SqlMock {
    const { alerts = [activeAlertRow()], stored = (id: string) => storedRow(id), seen = [], newHit = true, inserted, mine = [], reserved = true } = options;
    return jest.fn<SqlQuery>(async (sql: string, params?: unknown) => {
      const values = (params ?? []) as unknown[];
      if (sql.includes("FROM bg_geti_posts")) {
        return [values.map((id) => stored(String(id))).filter((row) => row !== null)];
      }
      if (sql.includes("SELECT alert_id FROM bg_geti_alert_hits") && sql.includes("created_at = ?")) {
        return [mine.map((id) => ({ alert_id: id }))];
      }
      if (sql.includes("SELECT alert_id FROM bg_geti_alert_hits")) return [seen.map((id) => ({ alert_id: id }))];
      if (sql.includes("SELECT")) return [alerts];
      if (sql.includes("INSERT IGNORE")) return [{ affectedRows: inserted ?? (newHit ? values.length / 3 : 0) }];
      if (sql.startsWith("UPDATE") && sql.includes("paused = 0")) return [{ affectedRows: reserved ? 1 : 0 }];
      return [{ affectedRows: 1 }];
    });
  }

  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue(true);
  });

  it("notifyGetiAlerts_freshPostMatchingAnAlert_recordsTheHitReservesTheCooldownAndSends", async () => {
    const execute = alertsDatabase();

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 1, notified: 1 });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("INSERT IGNORE INTO bg_geti_alert_hits"), [
      7,
      GETI_FAKE_MESSAGE_ID,
      new Date(NOW),
    ]);
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining("last_notified_at IS NULL OR last_notified_at <= ?"), [
      new Date(NOW),
      7,
      new Date(NOW - GETI_ALERT_COOLDOWN_MINUTES * MINUTE_MS),
    ]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 7, userId: USER_ID }), expect.objectContaining({ messageId: GETI_FAKE_MESSAGE_ID }));
  });

  it("notifyGetiAlerts_stalePostFromTheBotBackfill_readsNothing", async () => {
    const execute = alertsDatabase();
    const stale = freshPost({ postedAt: new Date(NOW - 3 * 60 * MINUTE_MS) });

    const outcome = await notifyGetiAlerts([stale], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_closedPost_readsNothing", async () => {
    const execute = alertsDatabase();
    const closed = freshPost({ parsed: parsedGetiPost({ category: "lfp", roles: ["TANK"], closed: true }) });

    await notifyGetiAlerts([closed], NOW, fakePool({ execute }), send);

    expect(execute).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_postNotMatchingTheAlert_recordsNoHit", async () => {
    const support = freshPost({ parsed: parsedGetiPost({ category: "lfp", roles: ["SUPPORT"] }) });
    const execute = alertsDatabase({ stored: (id) => storedRow(id, support.parsed) });

    const outcome = await notifyGetiAlerts([support], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(sqlOf(execute).some((sql) => sql.includes("bg_geti_alert_hits"))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_noActiveAlert_sendsNothing", async () => {
    const execute = alertsDatabase({ alerts: [] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_readsOnlyActiveAlertsOfThePostCategories", async () => {
    const lfs = freshPost({ messageId: "100000000000000902", category: "lfs", parsed: parsedGetiPost({ category: "lfs" }) });
    const execute = alertsDatabase({
      alerts: [],
      stored: (id) => (id === lfs.messageId ? storedRow(id, lfs.parsed) : storedRow(id)),
    });

    await notifyGetiAlerts([freshPost(), lfs], NOW, fakePool({ execute }), send);

    const reads = execute.mock.calls.filter(([sql]) => sql.includes("FROM bg_geti_alerts a"));
    expect(reads.map(([sql]) => sql)).toEqual([
      expect.stringContaining("WHERE a.paused = 0 AND a.category = ?"),
      expect.stringContaining("WHERE a.paused = 0 AND a.category = ?"),
    ]);
    expect(reads.map(([, params]) => params)).toEqual([["lfp"], ["lfs"]]);
  });

  it("notifyGetiAlerts_postAlreadySeenByTheAlert_doesNotNotifyAgain", async () => {
    const execute = alertsDatabase({ seen: [7] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(sqlOf(execute).some((sql) => sql.startsWith("INSERT IGNORE"))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_concurrentPassAlreadyInsertedTheHits_doesNotNotify", async () => {
    const execute = alertsDatabase({ newHit: false });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_olderVersionArrivesAfterClosingEdit_judgesTheStoredClosedVersion", async () => {
    const closed = parsedGetiPost({ category: "lfp", roles: ["TANK"], closed: true });
    const execute = alertsDatabase({ stored: (id) => storedRow(id, closed) });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_postDeletedBeforeThePass_sendsNothing", async () => {
    const execute = alertsDatabase({ stored: () => null });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("notifyGetiAlerts_storedRowUnreadable_isSkipped", async () => {
    const execute = alertsDatabase({ stored: (id) => ({ ...storedRow(id), parsed_json: "{pas du json" }) });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_postWrittenByTheAlertOwner_doesNotNotifyThem", async () => {
    const execute = alertsDatabase({ alerts: [activeAlertRow({ discord_id: GETI_FAKE_AUTHOR_ID })] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_ownerWithoutDiscordAndPostWithoutAuthor_stillNotifies", async () => {
    const anonymous = parsedGetiPost({ category: "lfp", roles: ["TANK"], authorId: null });
    const execute = alertsDatabase({ stored: (id) => storedRow(id, anonymous) });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 1, notified: 1 });
  });

  it("notifyGetiAlerts_severalAlertsMatchOnePost_writesTheirHitsInOneInstruction", async () => {
    const execute = alertsDatabase({ alerts: [activeAlertRow({ id: 7, user_id: 1 }), activeAlertRow({ id: 8, user_id: 2 })] });

    await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    const inserts = sqlOf(execute).filter((sql) => sql.startsWith("INSERT IGNORE"));
    expect(inserts).toEqual([
      "INSERT IGNORE INTO bg_geti_alert_hits (alert_id, message_id, created_at) VALUES (?, ?, ?), (?, ?, ?)",
    ]);
  });

  it("notifyGetiAlerts_accountNotReachable_releasesTheCooldownAndTheHit", async () => {
    const previous = new Date(NOW - 60 * MINUTE_MS);
    const execute = alertsDatabase({ alerts: [activeAlertRow({ last_notified_at: previous })] });
    send.mockResolvedValue(false);

    await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(execute).toHaveBeenCalledWith("UPDATE bg_geti_alerts SET last_notified_at = ? WHERE id = ? AND last_notified_at = ?", [
      previous,
      7,
      new Date(NOW),
    ]);
    expect(execute).toHaveBeenLastCalledWith("DELETE FROM bg_geti_alert_hits WHERE alert_id = ? AND message_id IN (?)", [
      7,
      GETI_FAKE_MESSAGE_ID,
    ]);
  });

  it("notifyGetiAlerts_sendThrowsForAnAlert_letsAnotherAlertOfTheSameAccountTry", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const execute = alertsDatabase({ alerts: [activeAlertRow({ id: 7 }), activeAlertRow({ id: 8, search: "" })] });
    send.mockRejectedValueOnce(new Error("bot injoignable"));

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 2, notified: 1 });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ id: 8 }), expect.anything());
    logged.mockRestore();
  });

  it("notifyGetiAlerts_exactlyTheScanCap_doesNotWarn", async () => {
    const warned = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const capped = Array.from({ length: GETI_ALERT_SCAN_MAX }, (_, index) => activeAlertRow({ id: index + 1, search: "?role=support" }));
    const execute = alertsDatabase({ alerts: capped });

    await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });

  it("notifyGetiAlerts_oneMoreThanTheScanCap_warnsWithACountOnlyAndIgnoresTheExtraRow", async () => {
    const warned = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const capped = Array.from({ length: GETI_ALERT_SCAN_MAX }, (_, index) => activeAlertRow({ id: index + 1, search: "?role=support" }));
    const extra = activeAlertRow({ id: GETI_ALERT_SCAN_MAX + 1 });
    const execute = alertsDatabase({ alerts: [...capped, extra] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(warned).toHaveBeenCalledWith("[geti] borne des alertes lues atteinte:", GETI_ALERT_SCAN_MAX);
    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(execute.mock.calls[1][0]).toContain(`LIMIT ${GETI_ALERT_SCAN_MAX + 1}`);
    warned.mockRestore();
  });

  it("notifyGetiAlerts_storedRowAtAnOlderAnalysisClosedSince_isJudgedOnItsReanalysis", async () => {
    const { closed, ...older } = parsedGetiPost({ category: "lfp", roles: ["TANK"] });
    const raw = getiPushedPost({ content: "~~LFP tank~~" }).raw;
    const execute = alertsDatabase({
      stored: (id) => ({ ...storedRow(id), parsed_json: JSON.stringify(older), stale_raw_json: JSON.stringify(raw) }),
    });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(closed).toBe(false);
    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_partialOverlapWithAConcurrentPass_notifiesOnlyTheHitsItInserted", async () => {
    const execute = alertsDatabase({
      alerts: [activeAlertRow({ id: 7, user_id: 1 }), activeAlertRow({ id: 8, user_id: 2 })],
      inserted: 1,
      mine: [8],
    });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 1, notified: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }), expect.anything());
  });

  it("notifyGetiAlerts_nowWithMilliseconds_writesAndRereadsTheHitAtTheSecond", async () => {
    const execute = alertsDatabase({
      alerts: [activeAlertRow({ id: 7, user_id: 1 }), activeAlertRow({ id: 8, user_id: 2 })],
      inserted: 1,
      mine: [8],
    });

    await notifyGetiAlerts([freshPost()], NOW + 789, fakePool({ execute }), send);

    const insert = execute.mock.calls.find(([sql]) => sql.startsWith("INSERT IGNORE"));
    const reread = execute.mock.calls.find(([sql]) => sql.includes("created_at = ?"));
    expect(insert?.[1]).toEqual([7, GETI_FAKE_MESSAGE_ID, new Date(NOW), 8, GETI_FAKE_MESSAGE_ID, new Date(NOW)]);
    expect(reread?.[1]).toEqual([GETI_FAKE_MESSAGE_ID, new Date(NOW), 7, 8]);
  });

  it("notifyGetiAlerts_sendFailsAfterTwoPostsMatchedTheAlert_releasesBothTraces", async () => {
    const second = freshPost({ messageId: "100000000000000902" });
    const execute = alertsDatabase();
    send.mockResolvedValue(false);

    await notifyGetiAlerts([freshPost(), second], NOW, fakePool({ execute }), send);

    expect(execute).toHaveBeenLastCalledWith("DELETE FROM bg_geti_alert_hits WHERE alert_id = ? AND message_id IN (?, ?)", [
      7,
      GETI_FAKE_MESSAGE_ID,
      second.messageId,
    ]);
  });

  it("notifyGetiAlerts_cooldownNotElapsed_keepsTheHitButDoesNotSend", async () => {
    const execute = alertsDatabase({ reserved: false });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 1, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_alertAlreadyInItsDelay_writesNothingAndDoesNotSend", async () => {
    const execute = alertsDatabase({ alerts: [activeAlertRow({ last_notified_at: new Date(NOW - MINUTE_MS) })] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 1, notified: 0 });
    expect(sqlOf(execute).some((sql) => sql.startsWith("UPDATE"))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_delayElapsedAtReading_reservesAndSends", async () => {
    const past = new Date(NOW - (GETI_ALERT_COOLDOWN_MINUTES + 1) * MINUTE_MS);
    const execute = alertsDatabase({ alerts: [activeAlertRow({ last_notified_at: past })] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome.notified).toBe(1);
  });

  it("notifyGetiAlerts_twoAlertsOfTheSameAccount_sendsOneNotification", async () => {
    const execute = alertsDatabase({ alerts: [activeAlertRow({ id: 7 }), activeAlertRow({ id: 8, search: "" })] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 2, notified: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("notifyGetiAlerts_twoMatchingPostsForOneAlert_sendsOneNotificationForTheFirst", async () => {
    const execute = alertsDatabase();
    const second = freshPost({ messageId: "100000000000000902" });

    const outcome = await notifyGetiAlerts([freshPost(), second], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 2, notified: 1 });
    expect(send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ messageId: GETI_FAKE_MESSAGE_ID }));
  });

  it("notifyGetiAlerts_sendFailsForOneAccount_stillNotifiesTheNextOne", async () => {
    const execute = alertsDatabase({ alerts: [activeAlertRow({ id: 7, user_id: 1 }), activeAlertRow({ id: 8, user_id: 2 })] });
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    send.mockRejectedValueOnce(new Error("bot injoignable"));

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 2, notified: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it("notifyGetiAlerts_accountNotReachable_isNotCounted", async () => {
    const execute = alertsDatabase();
    send.mockResolvedValue(false);

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 1, notified: 0 });
  });

  it("notifyGetiAlerts_missingTable_resolvesWithoutLogging", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const execute = jest.fn<SqlQuery>(async () => {
      throw missingTable();
    });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("notifyGetiAlerts_databaseFailure_resolvesAndLogs", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const execute = jest.fn<SqlQuery>(async () => {
      throw new Error("base injoignable");
    });

    await expect(notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send)).resolves.toEqual({ matched: 0, notified: 0 });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("notifyGetiAlerts_defaultSender_notifiesTheCertifiedAccountOnTheAlertTopic", async () => {
    const recipient = { userId: USER_ID, discord: { discordId: "1", handle: "tag", label: "Joueur" } };
    jest.mocked(loadNotificationRecipients).mockResolvedValue([recipient]);
    jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [USER_ID], pushed: 0 });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute: alertsDatabase() }));

    expect(outcome.notified).toBe(1);
    expect(loadNotificationRecipients).toHaveBeenCalledWith([USER_ID], "certified", { excludeSuspended: true });
    const [recipients, notification] = jest.mocked(notifyUsers).mock.calls[0];
    expect(recipients).toEqual([recipient]);
    expect(notification).toMatchObject({ topic: "GETI_ALERT", dmFollowsTopic: true, discord: { context: "geti-alert" } });
    expect(notification.push("fr").url).toBe(`/geti-info/lfp?role=tank#post-${GETI_FAKE_MESSAGE_ID}`);
    expect(notification.discord?.message("fr")).toContain(`https://site.test/geti-info/lfp?role=tank#post-${GETI_FAKE_MESSAGE_ID}`);
  });

  it("notifyGetiAlerts_defaultSenderTwoAccounts_readsTheRecipientsOnce", async () => {
    jest.mocked(loadNotificationRecipients).mockResolvedValue([
      { userId: USER_ID, discord: null },
      { userId: 43, discord: null },
    ]);
    jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
    const execute = alertsDatabase({ alerts: [activeAlertRow({ id: 7 }), activeAlertRow({ id: 8, user_id: 43 })] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }));

    expect(outcome).toEqual({ matched: 2, notified: 2 });
    expect(loadNotificationRecipients).toHaveBeenCalledTimes(1);
    expect(loadNotificationRecipients).toHaveBeenCalledWith([USER_ID, 43], "certified", { excludeSuspended: true });
    expect(notifyUsers).toHaveBeenCalledTimes(2);
  });

  it("notifyGetiAlerts_defaultSenderEveryAlertCooling_readsNoRecipient", async () => {
    const execute = alertsDatabase({ alerts: [activeAlertRow({ last_notified_at: new Date(NOW - MINUTE_MS) })] });

    await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }));

    expect(loadNotificationRecipients).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_defaultSenderRecipientsUnreadable_releasesTheReservation", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadNotificationRecipients).mockRejectedValue(new Error("base"));
    const execute = alertsDatabase();

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }));

    expect(outcome).toEqual({ matched: 1, notified: 0 });
    expect(sqlOf(execute).some((sql) => sql.startsWith("DELETE FROM bg_geti_alert_hits"))).toBe(true);
    logged.mockRestore();
  });

  it("notifyGetiAlerts_defaultSenderWithErasedOrSuspendedAccount_sendsNothing", async () => {
    jest.mocked(loadNotificationRecipients).mockResolvedValue([]);

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute: alertsDatabase() }));

    expect(outcome).toEqual({ matched: 1, notified: 0 });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_defaultSenderWithNotifyFailure_resolves", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadNotificationRecipients).mockResolvedValue([{ userId: USER_ID, discord: null }]);
    jest.mocked(notifyUsers).mockRejectedValue(new Error("push refusé"));

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute: alertsDatabase() }));

    expect(outcome).toEqual({ matched: 1, notified: 0 });
    logged.mockRestore();
  });
});

describe("scheduleGetiAlerts", () => {
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  it("scheduleGetiAlerts_onlyBackfilledPosts_startsNoPass", async () => {
    scheduleGetiAlerts([freshPost({ postedAt: new Date(NOW - 5 * 24 * 60 * MINUTE_MS) })], NOW);
    await flush();

    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("scheduleGetiAlerts_twoBatches_runTheSecondPassOnlyAfterTheFirstEnds", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("FROM bg_geti_posts")) await gate;
      return [[]];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const recent = freshPost({ postedAt: new Date() });

    scheduleGetiAlerts([recent]);
    scheduleGetiAlerts([recent]);
    await flush();

    expect(execute).toHaveBeenCalledTimes(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("scheduleGetiAlerts_queueFull_dropsTheBatchAndWarns", async () => {
    const warned = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const gate = new Promise<void>(() => undefined);
    const execute = jest.fn<SqlQuery>(async () => {
      await gate;
      return [[]];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const recent = freshPost({ postedAt: new Date() });

    for (let i = 0; i < GETI_ALERT_QUEUE_MAX; i += 1) scheduleGetiAlerts([recent]);
    scheduleGetiAlerts([recent]);

    expect(warned).toHaveBeenCalledWith("[geti] file des alertes pleine:", GETI_ALERT_QUEUE_MAX);
    warned.mockRestore();
  });
});
