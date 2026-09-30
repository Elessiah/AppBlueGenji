import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { getDatabase } from "@/lib/server/database";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import {
  AccountSuspendedError,
  activeSuspensionSql,
  assertNotSuspended,
  getActiveSuspension,
  liftSuspension,
  listOwnSuspensions,
  purgeEndedSuspensions,
  suspendAccount,
} from "@/lib/server/account-suspensions";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

const actor = { id: 1, pseudo: "Modo" };
const input = { reason: "Propos haineux répétés pendant un match", ground: "BEHAVIOR" as const, durationDays: 7 };

function suspensionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    reason: input.reason,
    ground: "BEHAVIOR",
    starts_at: new Date("2026-10-01T10:00:00Z"),
    ends_at: new Date("2026-10-08T10:00:00Z"),
    lifted_at: null,
    ...overrides,
  };
}

/** Laisse partir les envois « jamais attendus » lancés après le commit. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadNotificationRecipients).mockResolvedValue([{ userId: 5, discord: null }]);
  jest.mocked(notifyUsers).mockResolvedValue({ discord: { sent: 0, unresolved: [], failed: [] }, pushed: 0 });
});

describe("activeSuspensionSql", () => {
  it("écrit la même règle que isSuspensionActive, sur l'alias donné", () => {
    expect(activeSuspensionSql("x")).toBe(
      "x.lifted_at IS NULL AND x.starts_at <= NOW() AND (x.ends_at IS NULL OR x.ends_at > NOW())",
    );
  });
});

describe("getActiveSuspension / assertNotSuspended", () => {
  it("rend la suspension en cours, lue avec la condition partagée", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[suspensionRow()]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(getActiveSuspension(5)).resolves.toEqual({
      id: 11,
      reason: input.reason,
      ground: "BEHAVIOR",
      startsAt: "2026-10-01T10:00:00.000Z",
      endsAt: "2026-10-08T10:00:00.000Z",
      liftedAt: null,
    });
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(activeSuspensionSql("s"));
    expect(params).toEqual([5]);
  });

  it("lève AccountSuspendedError avec l'exposé de la décision", async () => {
    jest.mocked(getDatabase).mockResolvedValue(
      fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[suspensionRow({ ends_at: null })]]) }),
    );

    const error = await assertNotSuspended(5).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AccountSuspendedError);
    expect((error as AccountSuspendedError).message).toBe("ACCOUNT_SUSPENDED");
    expect((error as AccountSuspendedError).notice).toEqual({
      reference: "S-11",
      reason: input.reason,
      ground: "BEHAVIOR",
      endsAt: null,
    });
  });

  it("laisse passer un compte sans suspension en cours", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[]]) }));
    await expect(assertNotSuspended(5)).resolves.toBeUndefined();
  });
});

describe("suspendAccount", () => {
  function transaction(existing: unknown[] = [{ is_admin: 0 }], active: unknown[] = []) {
    const connection = connectionMock();
    connection.execute
      .mockResolvedValueOnce([existing]) // verrou du compte
      .mockResolvedValueOnce([active]) // suspension en cours ?
      .mockResolvedValueOnce([{ insertId: 11 }]) // écriture
      .mockResolvedValueOnce([[suspensionRow()]]) // relecture
      .mockResolvedValueOnce([{ affectedRows: 2 }]); // sessions effacées
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ getConnection: async () => fakeConnection(connection) }));
    return connection;
  }

  it("verrouille le compte d'abord, écrit, ferme toutes ses sessions et valide", async () => {
    const connection = transaction();

    const view = await suspendAccount(5, input, actor);

    expect(view.id).toBe(11);
    const calls = connection.execute.mock.calls as [string, unknown[]][];
    expect(calls[0][0]).toMatch(/FROM bg_users WHERE id = \? AND is_deleted = 0 FOR UPDATE/);
    expect(calls[2][0]).toContain("DATE_ADD(NOW(), INTERVAL ? DAY)");
    expect(calls[2][1]).toEqual([5, input.reason, "BEHAVIOR", 7, 1]);
    expect(calls[4]).toEqual([`DELETE FROM bg_user_sessions WHERE user_id = ?`, [5]]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("écrit une échéance nulle pour une durée indéterminée", async () => {
    const connection = transaction();

    await suspendAccount(5, { ...input, durationDays: null }, actor);

    const [sql, params] = connection.execute.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain("NOW(), NULL, ?)");
    expect(params).toEqual([5, input.reason, "BEHAVIOR", 1]);
  });

  it("prévient le joueur et trace le geste sans son pseudo, après le commit", async () => {
    transaction();

    await suspendAccount(5, input, actor);
    await flush();

    expect(publishStaffAction).toHaveBeenCalledWith(expect.stringContaining("un joueur"), actor);
    expect(publishStaffAction).not.toHaveBeenCalledWith(expect.stringContaining(input.reason), actor);
    expect(loadNotificationRecipients).toHaveBeenCalledWith([5], "proven");
    const notification = jest.mocked(notifyUsers).mock.calls[0][1];
    expect(notification.topic).toBe("MODERATION");
    expect(notification.discord?.message).toContain(`Faits retenus : ${input.reason}.`);
    expect(notification.discord?.message).toContain("https://site.test/conditions-utilisation#comportement");
    expect(notification.push.url).toBe("/connexion");
    expect(notification.push.body).not.toContain(input.reason);
  });

  it("refuse son propre compte sans rien ouvrir", async () => {
    await expect(suspendAccount(1, input, actor)).rejects.toThrow("CANNOT_SUSPEND_SELF");
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it.each<[string, unknown[], unknown[], string]>([
    ["un compte inconnu ou supprimé", [], [], "USER_NOT_FOUND"],
    ["un administrateur", [{ is_admin: 1 }], [], "CANNOT_SUSPEND_ADMIN"],
    ["un compte déjà suspendu", [{ is_admin: 0 }], [suspensionRow()], "ACCOUNT_ALREADY_SUSPENDED"],
  ])("refuse %s, défait la transaction et ne prévient personne", async (_label, existing, active, code) => {
    const connection = transaction(existing, active);

    await expect(suspendAccount(5, input, actor)).rejects.toThrow(code);
    await flush();

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    const sqls = (connection.execute.mock.calls as [string][]).map(([sql]) => sql);
    expect(sqls.some((sql) => sql.startsWith("INSERT"))).toBe(false);
    expect(sqls.some((sql) => sql.includes("bg_user_sessions"))).toBe(false);
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(publishStaffAction).not.toHaveBeenCalled();
  });
});

describe("liftSuspension", () => {
  it("lève la suspension en cours, condition relue dans l'écriture, puis prévient", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[suspensionRow()]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(liftSuspension(5, actor)).resolves.toBe(11);
    await flush();

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("SET s.lifted_at = NOW(), s.lifted_by = ?");
    expect(sql).toContain(activeSuspensionSql("s"));
    expect(params).toEqual([1, 11]);
    expect(publishStaffAction).toHaveBeenCalledWith("✅ Suspension S-11 levée par le staff.", actor);
    expect(jest.mocked(notifyUsers).mock.calls[0][1].discord?.message).toContain("S-11");
  });

  it("refuse sans suspension en cours", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[]]) }));
    await expect(liftSuspension(5, actor)).rejects.toThrow("NO_ACTIVE_SUSPENSION");
  });

  it("refuse quand une levée concurrente ou l'échéance est passée avant l'écriture", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[suspensionRow()]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(liftSuspension(5, actor)).rejects.toThrow("NO_ACTIVE_SUSPENSION");
    await flush();
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe("conservation", () => {
  it("efface les suspensions terminées depuis six mois", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 3 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await purgeEndedSuspensions();

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("COALESCE(lifted_at, ends_at) < DATE_SUB(NOW(), INTERVAL ? MONTH)");
    expect(params).toEqual([6]);
  });

  it("ne lève jamais : une purge manquée ne fait pas échouer la connexion", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(purgeEndedSuspensions()).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("liste les suspensions conservées du compte pour son export", async () => {
    jest.mocked(getDatabase).mockResolvedValue(
      fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[suspensionRow({ lifted_at: new Date("2026-10-02T00:00:00Z") })]]) }),
    );
    await expect(listOwnSuspensions(5)).resolves.toEqual([
      expect.objectContaining({ id: 11, liftedAt: "2026-10-02T00:00:00.000Z" }),
    ]);
  });
});
