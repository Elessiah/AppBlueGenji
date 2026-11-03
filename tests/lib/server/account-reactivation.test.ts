import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import crypto from "node:crypto";
import { getDatabase } from "@/lib/server/database";
import {
  createReactivationTicket,
  peekReactivationTicket,
  reactivateAccount,
  readPendingDeletion,
} from "@/lib/server/users/account-reactivation";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/*
 * Réactivation d'un compte en attente de suppression (E4) : ticket haché,
 * quinze minutes, servi une fois ; fenêtre de trente jours relue sous verrou.
 */

const TOKEN = "a".repeat(64);
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");
const RECENT = new Date(Date.now() - 2 * 24 * 3600 * 1000);
const EXPIRED = new Date(Date.now() - 31 * 24 * 3600 * 1000);

function poolExecute(rows: unknown[]) {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([rows, []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

/** Connexion de transaction : ticket, ligne verrouillée, résultat de l'UPDATE. */
function transaction(options: { ticket?: object; locked?: object; affectedRows?: number; failOn?: string }) {
  const connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  connection.execute.mockImplementation(async (sql: string) => {
    if (options.failOn && sql.includes(options.failOn)) throw new Error("DB_DOWN");
    if (sql.includes("SELECT user_id, login_event")) return [options.ticket ? [options.ticket] : [], []];
    if (sql.includes("FOR UPDATE")) return [options.locked ? [options.locked] : [], []];
    if (sql.startsWith("UPDATE bg_users")) return [{ affectedRows: options.affectedRows ?? 1 }, []];
    return [{ affectedRows: 1 }, []];
  });
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ getConnection: jest.fn(async () => fakeConnection(connection)) }),
  );
  return connection;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("readPendingDeletion", () => {
  it("readPendingDeletion_pendingRecent_windowOpen", async () => {
    poolExecute([{ is_deleted: 1, deletion_requested_at: RECENT }]);

    expect(await readPendingDeletion(7)).toEqual({ requestedAt: RECENT.toISOString(), windowOpen: true });
  });

  it("readPendingDeletion_pendingOld_windowClosed", async () => {
    poolExecute([{ is_deleted: 1, deletion_requested_at: EXPIRED }]);

    expect((await readPendingDeletion(7))?.windowOpen).toBe(false);
  });

  it("readPendingDeletion_aliveAccount_null", async () => {
    poolExecute([{ is_deleted: 0, deletion_requested_at: null }]);

    expect(await readPendingDeletion(7)).toBeNull();
  });

  it("readPendingDeletion_deletedWithoutRequestDate_null", async () => {
    // Compte déjà anonymisé : supprimé pour de bon, rien à réactiver.
    poolExecute([{ is_deleted: 1, deletion_requested_at: null }]);

    expect(await readPendingDeletion(7)).toBeNull();
  });
});

describe("createReactivationTicket", () => {
  it("createReactivationTicket_storesHashOnly_returnsToken", async () => {
    const execute = poolExecute([]);

    const token = await createReactivationTicket(7, "LOGIN_GOOGLE");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const insert = execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO bg_account_reactivation_tickets"));
    const params = insert?.[1] as unknown[];
    expect(params[0]).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(params).not.toContain(token);
    expect(params.slice(1)).toEqual([7, "LOGIN_GOOGLE", 15]);
  });
});

describe("peekReactivationTicket", () => {
  it("peekReactivationTicket_malformedToken_nullWithoutQuery", async () => {
    const execute = poolExecute([]);

    expect(await peekReactivationTicket("pas-un-jeton")).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("peekReactivationTicket_valid_returnsUserAndFinalAt", async () => {
    const execute = poolExecute([{ user_id: 7, deletion_requested_at: RECENT }]);

    const actual = await peekReactivationTicket(TOKEN);

    expect(actual).toEqual({
      userId: 7,
      finalAt: new Date(RECENT.getTime() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    expect(execute.mock.calls[0][1]).toEqual([TOKEN_HASH]);
  });

  it("peekReactivationTicket_windowClosed_null", async () => {
    poolExecute([{ user_id: 7, deletion_requested_at: EXPIRED }]);

    expect(await peekReactivationTicket(TOKEN)).toBeNull();
  });
});

describe("reactivateAccount", () => {
  it("reactivateAccount_unknownTicket_nullAndCommitted", async () => {
    const connection = transaction({});

    expect(await reactivateAccount(TOKEN)).toBeNull();
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE bg_users"))).toBe(false);
  });

  it("reactivateAccount_valid_consumesTicketAndClearsPending", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT },
    });

    expect(await reactivateAccount(TOKEN)).toEqual({ userId: 7, event: "LOGIN_DISCORD" });
    const sqls = connection.execute.mock.calls.map(([sql]) => sql);
    expect(sqls.some((sql) => sql.startsWith("DELETE FROM bg_account_reactivation_tickets"))).toBe(true);
    expect(sqls.find((sql) => sql.startsWith("UPDATE bg_users"))).toContain("is_deleted = 0, deletion_requested_at = NULL");
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("reactivateAccount_windowClosedUnderLock_nullNoUpdate", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: EXPIRED },
    });

    expect(await reactivateAccount(TOKEN)).toBeNull();
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE bg_users"))).toBe(false);
  });

  it("reactivateAccount_alreadyReactivated_null", async () => {
    transaction({ ticket: { user_id: 7, login_event: "LOGIN_DISCORD" }, locked: { is_deleted: 0, deletion_requested_at: null } });

    expect(await reactivateAccount(TOKEN)).toBeNull();
  });

  it("reactivateAccount_raceAffectedRows0_null", async () => {
    transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT },
      affectedRows: 0,
    });

    expect(await reactivateAccount(TOKEN)).toBeNull();
  });

  it("reactivateAccount_error_rollsBackAndReleases", async () => {
    const connection = transaction({ failOn: "SELECT user_id, login_event" });

    await expect(reactivateAccount(TOKEN)).rejects.toThrow("DB_DOWN");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("reactivateAccount_malformedToken_nullWithoutConnection", async () => {
    const getConnection = jest.fn(async () => fakeConnection(connectionMock()));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ getConnection }));

    expect(await reactivateAccount(undefined)).toBeNull();
    expect(getConnection).not.toHaveBeenCalled();
  });
});
