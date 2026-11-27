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
  listGetiAlerts,
  notifyGetiAlerts,
  purgeGetiAlertHits,
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
} from "@/lib/shared/geti/alerts";
import { parsedGetiPost } from "../../../helpers/geti";
import { GETI_FAKE_MESSAGE_ID } from "../../../helpers/geti-ingest";
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
  it("deleteGetiAlert_ownedAlert_deletesItAndItsHits", async () => {
    const execute = executeMock([], 1);
    useDatabase(execute);

    await expect(deleteGetiAlert(USER_ID, 7)).resolves.toBe(true);
    expect(execute.mock.calls).toEqual([
      ["DELETE FROM bg_geti_alerts WHERE id = ? AND user_id = ?", [7, USER_ID]],
      ["DELETE FROM bg_geti_alert_hits WHERE alert_id = ?", [7]],
    ]);
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

  it("deleteGetiAlertsOfUser_otherFailure_throws", async () => {
    const execute = jest.fn<SqlQuery>(async () => {
      throw new Error("base injoignable");
    });

    await expect(deleteGetiAlertsOfUser(fakePool({ execute }), USER_ID)).rejects.toThrow("base injoignable");
  });
});

describe("purgeGetiAlertHits", () => {
  it("purgeGetiAlertHits_called_deletesHitsOlderThanTheirRetention", async () => {
    const execute = executeMock([], 3);

    const removed = await purgeGetiAlertHits(fakePool({ execute }), NOW);

    expect(removed).toBe(3);
    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_alert_hits WHERE created_at < ?", [
      new Date(NOW - GETI_ALERT_HIT_RETENTION_DAYS * 24 * 60 * MINUTE_MS),
    ]);
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

  /** Base simulée : alertes actives lues, trace posée ou déjà là, délai réservé ou non. */
  function alertsDatabase(options: { alerts?: unknown[]; newHit?: boolean; reserved?: boolean } = {}): SqlMock {
    const { alerts = [alertRow()], newHit = true, reserved = true } = options;
    return jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("SELECT")) return [alerts];
      if (sql.includes("INSERT IGNORE")) return [{ affectedRows: newHit ? 1 : 0 }];
      return [{ affectedRows: reserved ? 1 : 0 }];
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
    const execute = alertsDatabase();
    const support = freshPost({ parsed: parsedGetiPost({ category: "lfp", roles: ["SUPPORT"] }) });

    const outcome = await notifyGetiAlerts([support], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_noActiveAlert_sendsNothing", async () => {
    const execute = alertsDatabase({ alerts: [] });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_readsOnlyActiveAlertsOfThePostCategories", async () => {
    const execute = alertsDatabase({ alerts: [] });

    await notifyGetiAlerts([freshPost(), freshPost({ category: "lfs" })], NOW, fakePool({ execute }), send);

    expect(execute.mock.calls[0][0]).toContain("WHERE paused = 0 AND category IN (?, ?)");
    expect(execute.mock.calls[0][1]).toEqual(["lfp", "lfs"]);
  });

  it("notifyGetiAlerts_postAlreadySeenByTheAlert_doesNotNotifyAgain", async () => {
    const execute = alertsDatabase({ newHit: false });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 0, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_cooldownNotElapsed_keepsTheHitButDoesNotSend", async () => {
    const execute = alertsDatabase({ reserved: false });

    const outcome = await notifyGetiAlerts([freshPost()], NOW, fakePool({ execute }), send);

    expect(outcome).toEqual({ matched: 1, notified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("notifyGetiAlerts_twoAlertsOfTheSameAccount_sendsOneNotification", async () => {
    const execute = alertsDatabase({ alerts: [alertRow({ id: 7 }), alertRow({ id: 8, search: "" })] });

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
    const execute = alertsDatabase({ alerts: [alertRow({ id: 7, user_id: 1 }), alertRow({ id: 8, user_id: 2 })] });
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
