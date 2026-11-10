import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/account-deletion-journal");
jest.mock("@/lib/server/users/account-deletion-hold");
jest.mock("@/lib/server/ranking-cache");
jest.mock("@/lib/server/stats-cache");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/users/account-deletion", () => ({ listSoloRegistrationTournamentIds: jest.fn() }));
jest.mock("@/lib/server/bot-integration", () => ({ sendBotLog: jest.fn() }));

import crypto from "node:crypto";
import { getDatabase } from "@/lib/server/database";
import { recordAccountReactivation } from "@/lib/server/account-deletion-journal";
import { restoreAccountIdentity } from "@/lib/server/users/account-deletion-hold";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { invalidateStats } from "@/lib/server/stats-cache";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { listSoloRegistrationTournamentIds } from "@/lib/server/users/account-deletion";
import { sendBotLog } from "@/lib/server/bot-integration";
import {
  createReactivationTicket,
  discardReactivationTicket,
  peekReactivationTicket,
  reactivateAccount,
  readPendingDeletion,
  replayAccountReactivation,
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
function transaction(options: {
  ticket?: object;
  locked?: object;
  affectedRows?: number;
  /** Lignes retirées par le `DELETE` du ticket : 0 = une autre requête l'a servi. */
  ticketDeleted?: number;
  failOn?: string;
  /** Erreurs levées, une par passage, au verrou du compte (interblocages). */
  lockErrors?: Error[];
}) {
  const connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  connection.execute.mockImplementation(async (sql: string) => {
    if (options.failOn && sql.includes(options.failOn)) throw new Error("DB_DOWN");
    if (sql.includes("SELECT user_id, login_event")) return [options.ticket ? [options.ticket] : [], []];
    if (sql.includes("FOR UPDATE")) {
      const failure = options.lockErrors?.shift();
      if (failure) throw failure;
      return [options.locked ? [options.locked] : [], []];
    }
    if (sql.startsWith("UPDATE bg_users")) return [{ affectedRows: options.affectedRows ?? 1 }, []];
    if (sql.startsWith("DELETE FROM bg_account_reactivation_tickets")) return [{ affectedRows: options.ticketDeleted ?? 1 }, []];
    return [{ affectedRows: 1 }, []];
  });
  // Le ticket se lit sur le pool, hors transaction : même journal de requêtes.
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ execute: connection.execute, getConnection: jest.fn(async () => fakeConnection(connection)) }),
  );
  return connection;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(restoreAccountIdentity).mockResolvedValue("RESTORED");
  jest.mocked(recordAccountReactivation).mockResolvedValue(undefined);
  jest.mocked(listSoloRegistrationTournamentIds).mockResolvedValue([]);
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

  // ERREUR.txt (revue sécurité #546) : colonne absente (migration en échec),
  // la connexion n'est pas bloquée.
  it("readPendingDeletion_unknownColumn_null", async () => {
    const execute = poolExecute([]);
    execute.mockRejectedValueOnce(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }));

    expect(await readPendingDeletion(7)).toBeNull();
  });

  it("readPendingDeletion_otherError_rethrows", async () => {
    const execute = poolExecute([]);
    execute.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "ECONNRESET" }));

    await expect(readPendingDeletion(7)).rejects.toThrow("down");
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

  // Une seconde connexion (autre appareil) ne périme pas l'écran déjà ouvert.
  it("createReactivationTicket_secondLogin_purgesOnlyExpiredTickets", async () => {
    const execute = poolExecute([]);

    await createReactivationTicket(7, "LOGIN_GOOGLE");

    const purge = execute.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM bg_account_reactivation_tickets"));
    expect(purge?.[0]).toBe("DELETE FROM bg_account_reactivation_tickets WHERE expires_at < NOW()");
  });
});

describe("discardReactivationTicket", () => {
  it("discardReactivationTicket_validToken_deletesThatTicketByHash", async () => {
    const execute = poolExecute([]);

    await discardReactivationTicket(TOKEN);

    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_account_reactivation_tickets WHERE token_hash = ?", [TOKEN_HASH]);
  });

  it("discardReactivationTicket_malformedToken_noQuery", async () => {
    const execute = poolExecute([]);

    await discardReactivationTicket("pas-un-jeton");

    expect(execute).not.toHaveBeenCalled();
  });

  it("discardReactivationTicket_noToken_noQuery", async () => {
    const execute = poolExecute([]);

    await discardReactivationTicket(undefined);

    expect(execute).not.toHaveBeenCalled();
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
  const PENDING = {
    ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
    locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
  };

  // Les tickets d'un autre appareil n'ont plus d'objet une fois le compte réactivé.
  it("reactivateAccount_valid_dropsEveryTicketOfTheAccountInTransaction", async () => {
    const connection = transaction(PENDING);

    await reactivateAccount(TOKEN);

    const sqls = connection.execute.mock.calls.map(([sql]) => sql);
    const dropAll = sqls.indexOf("DELETE FROM bg_account_reactivation_tickets WHERE user_id = ?");
    expect(dropAll).toBeGreaterThan(-1);
    expect(connection.execute.mock.invocationCallOrder[dropAll]).toBeLessThan(connection.commit.mock.invocationCallOrder[0]);
  });

  it("reactivateAccount_realPseudoRestored_pseudoChangedFalse", async () => {
    transaction(PENDING);
    jest.mocked(restoreAccountIdentity).mockResolvedValue("RESTORED");

    expect((await reactivateAccount(TOKEN))?.pseudoChanged).toBe(false);
  });

  it("reactivateAccount_pseudoTakenMeanwhile_pseudoChangedTrue", async () => {
    transaction(PENDING);
    jest.mocked(restoreAccountIdentity).mockResolvedValue("RENAMED");

    expect((await reactivateAccount(TOKEN))?.pseudoChanged).toBe(true);
  });

  it("reactivateAccount_unknownTicket_nullWithoutTransaction", async () => {
    const connection = transaction({});

    expect(await reactivateAccount(TOKEN)).toBeNull();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE bg_users"))).toBe(false);
  });

  it("reactivateAccount_valid_consumesTicketAndClearsPending", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });

    expect(await reactivateAccount(TOKEN)).toEqual({ userId: 7, event: "LOGIN_DISCORD", pseudoChanged: false });
    const sqls = connection.execute.mock.calls.map(([sql]) => sql);
    expect(sqls.some((sql) => sql.startsWith("DELETE FROM bg_account_reactivation_tickets"))).toBe(true);
    // Le compte revit avec son vrai pseudo et son avatar, sur la transaction.
    expect(restoreAccountIdentity).toHaveBeenCalledWith(expect.anything(), 7);
    expect(connection.commit).toHaveBeenCalled();
    expect(recordAccountReactivation).toHaveBeenCalledWith(
      {
        userId: 7,
        accountCreatedAt: "2025-01-01 10:00:00",
        undoneRequestAt: String(RECENT),
      },
      { strict: true },
    );
    expect(invalidateTeamIdentityViews).toHaveBeenCalled();
    expect(invalidateStats).toHaveBeenCalled();
  });

  // Revue sécurité #579 : le verrou du compte attend derrière la suppression définitive.
  it("reactivateAccount_deadlockOnAccountLock_replayedOnce", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
      lockErrors: [Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" })],
    });

    expect(await reactivateAccount(TOKEN)).toEqual({ userId: 7, event: "LOGIN_DISCORD", pseudoChanged: false });

    expect(connection.beginTransaction).toHaveBeenCalledTimes(2);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(recordAccountReactivation).toHaveBeenCalledTimes(1);
  });

  it("reactivateAccount_deadlockEveryAttempt_rethrowsWithoutSideEffects", async () => {
    const deadlock = () => Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" });
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
      lockErrors: [deadlock(), deadlock(), deadlock()],
    });

    await expect(reactivateAccount(TOKEN)).rejects.toThrow("Deadlock found");

    expect(connection.commit).not.toHaveBeenCalled();
    expect(invalidateStats).not.toHaveBeenCalled();
  });

  // Revue juridique #546, cycle 3 : la ligne de réactivation précède le commit.
  it("reactivateAccount_valid_journalsBeforeCommit", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });

    await reactivateAccount(TOKEN);

    const journaled = jest.mocked(recordAccountReactivation).mock.invocationCallOrder[0];
    const committed = connection.commit.mock.invocationCallOrder[0];
    expect(journaled).toBeLessThan(committed);
  });

  it("reactivateAccount_journalWriteFails_rollsBackWithoutCommit", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });
    jest.mocked(recordAccountReactivation).mockRejectedValueOnce(new Error("EACCES"));

    await expect(reactivateAccount(TOKEN)).rejects.toThrow("EACCES");
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
    expect(invalidateTeamIdentityViews).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("reactivateAccount_valid_logsReactivationWithoutPseudo", async () => {
    transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });

    await reactivateAccount(TOKEN);

    expect(sendBotLog).toHaveBeenCalledWith("↩️ Compte réactivé — suppression demandée annulée.", { category: "signups" });
  });

  it("reactivateAccount_valid_republishesSoloEntryTournaments", async () => {
    transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });
    jest.mocked(listSoloRegistrationTournamentIds).mockResolvedValue([8, 9]);

    await reactivateAccount(TOKEN);

    expect(jest.mocked(publishUpdatedEvent).mock.calls).toEqual([[8], [9]]);
  });

  it("reactivateAccount_republishFails_stillReturnsAccount", async () => {
    transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });
    jest.mocked(listSoloRegistrationTournamentIds).mockRejectedValue(new Error("DB_DOWN"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    expect(await reactivateAccount(TOKEN)).toEqual({ userId: 7, event: "LOGIN_DISCORD", pseudoChanged: false });
  });

  it("reactivateAccount_valid_revokesSessionsBeforeCommit", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });

    await reactivateAccount(TOKEN);

    const revoke = connection.execute.mock.calls.find(([sql]) => sql === "DELETE FROM bg_user_sessions WHERE user_id = ?");
    expect(revoke?.[1]).toEqual([7]);
    expect(connection.execute.mock.invocationCallOrder.at(-1)).toBeLessThan(connection.commit.mock.invocationCallOrder[0]);
  });

  it("reactivateAccount_restoreRefused_keepsSessionsUntouched", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });
    jest.mocked(restoreAccountIdentity).mockResolvedValue(null);

    expect(await reactivateAccount(TOKEN)).toBeNull();
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_user_sessions"))).toBe(false);
  });

  it("reactivateAccount_ticketConsumedConcurrently_nullWithoutRestore", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
      ticketDeleted: 0,
    });

    expect(await reactivateAccount(TOKEN)).toBeNull();
    expect(connection.commit).toHaveBeenCalled();
    expect(restoreAccountIdentity).not.toHaveBeenCalled();
    expect(recordAccountReactivation).not.toHaveBeenCalled();
  });

  // ERREUR.txt (revue perf #546) : le compte se verrouille avant le ticket,
  // dans l'ordre de la suppression définitive (compte puis cascade).
  it("reactivateAccount_valid_locksAccountBeforeConsumingTicket", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });

    await reactivateAccount(TOKEN);
    const sqls = connection.execute.mock.calls.map(([sql]) => sql);
    const lockIndex = sqls.findIndex((sql) => sql.includes("FROM bg_users WHERE id = ? FOR UPDATE"));
    const consumeIndex = sqls.findIndex((sql) => sql.startsWith("DELETE FROM bg_account_reactivation_tickets"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(consumeIndex).toBeGreaterThan(lockIndex);
    expect(connection.execute.mock.calls[consumeIndex][1]).toEqual([expect.any(String), 7]);
  });

  it("reactivateAccount_ticketReadBeforeTransaction_snapshotNotFixedBeforeLock", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });

    await reactivateAccount(TOKEN);
    const sqls = connection.execute.mock.calls.map(([sql]) => sql);
    const ticketRead = sqls.findIndex((sql) => sql.includes("SELECT user_id, login_event"));
    expect(connection.execute.mock.invocationCallOrder[ticketRead]).toBeLessThan(
      connection.beginTransaction.mock.invocationCallOrder[0],
    );
    const consume = sqls.find((sql) => sql.startsWith("DELETE FROM bg_account_reactivation_tickets"));
    expect(consume).toContain("expires_at > NOW()");
  });

  it("reactivateAccount_unknownTicket_neverLocksAccount", async () => {
    const connection = transaction({});

    expect(await reactivateAccount(TOKEN)).toBeNull();
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(false);
  });

  it("reactivateAccount_restoreRefused_nullAndJournalKept", async () => {
    const connection = transaction({
      ticket: { user_id: 7, login_event: "LOGIN_DISCORD" },
      locked: { is_deleted: 1, deletion_requested_at: RECENT, created_at: "2025-01-01 10:00:00" },
    });
    jest.mocked(restoreAccountIdentity).mockResolvedValue(null);

    expect(await reactivateAccount(TOKEN)).toBeNull();
    expect(recordAccountReactivation).not.toHaveBeenCalled();
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

  it("reactivateAccount_error_rollsBackAndReleases", async () => {
    const connection = transaction({ failOn: "FROM bg_users WHERE id = ? FOR UPDATE", ticket: { user_id: 7, login_event: "LOGIN_DISCORD" } });

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

// Décision R1 du 2026-11-04 : rejeu d'une réactivation après restauration.
describe("replayAccountReactivation", () => {
  const CREATED = "2025-01-01 10:00:00";
  const reactivation = {
    userId: 7,
    accountCreatedAt: CREATED,
    deletedAt: "2026-11-03T09:00:00.000Z",
    reactivated: true,
    undoneRequestAt: "2026-11-01 10:00:00",
  };
  const lockedPending = { is_deleted: 1, deletion_requested_at: "2026-11-01 10:00:00", created_at: CREATED };

  it("replayAccountReactivation_pendingRow_restoresAndRevokesSessions", async () => {
    const connection = transaction({ locked: lockedPending });

    expect(await replayAccountReactivation(reactivation)).toBe("REACTIVATED");

    expect(restoreAccountIdentity).toHaveBeenCalledWith(expect.anything(), 7);
    const sqls = connection.execute.mock.calls.map(([sql]) => String(sql));
    expect(sqls).toContain("DELETE FROM bg_user_sessions WHERE user_id = ?");
    expect(connection.commit).toHaveBeenCalled();
    expect(invalidateTeamIdentityViews).toHaveBeenCalled();
    expect(invalidateStats).toHaveBeenCalled();
    expect(recordAccountReactivation).not.toHaveBeenCalled();
  });

  it("replayAccountReactivation_aliveRow_alreadyActiveWithoutRestore", async () => {
    const connection = transaction({ locked: { is_deleted: 0, deletion_requested_at: null, created_at: CREATED } });

    expect(await replayAccountReactivation(reactivation)).toBe("ALREADY_ACTIVE");

    expect(restoreAccountIdentity).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalled();
    expect(invalidateStats).not.toHaveBeenCalled();
  });

  it("replayAccountReactivation_error_rollsBackAndReleases", async () => {
    const connection = transaction({ locked: lockedPending });
    jest.mocked(restoreAccountIdentity).mockRejectedValue(new Error("DB_DOWN"));

    await expect(replayAccountReactivation(reactivation)).rejects.toThrow("DB_DOWN");

    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  // Revue sécurité #546, cycle 9 : revérifié sous verrou.
  it("replayAccountReactivation_laterRequestUnderLock_supersededWithoutRestore", async () => {
    const connection = transaction({ locked: { ...lockedPending, deletion_requested_at: "2026-11-05 10:00:00" } });

    expect(await replayAccountReactivation(reactivation)).toBe("SUPERSEDED");

    expect(restoreAccountIdentity).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalled();
  });

  // Revue de correction #571 : un autre compte n'est pas « une demande postérieure ».
  it("replayAccountReactivation_otherCreatedAt_otherAccountWithoutRestore", async () => {
    transaction({ locked: { ...lockedPending, created_at: "2026-09-22 08:00:00" } });

    expect(await replayAccountReactivation(reactivation)).toBe("OTHER_ACCOUNT");

    expect(restoreAccountIdentity).not.toHaveBeenCalled();
  });

  it("replayAccountReactivation_noRowUnderLock_absentWithoutRestore", async () => {
    transaction({});

    expect(await replayAccountReactivation(reactivation)).toBe("ABSENT");

    expect(restoreAccountIdentity).not.toHaveBeenCalled();
  });

  it("replayAccountReactivation_finalDeletionUnderLock_goneWithoutRestore", async () => {
    transaction({ locked: { ...lockedPending, deletion_requested_at: null } });

    expect(await replayAccountReactivation(reactivation)).toBe("GONE");

    expect(restoreAccountIdentity).not.toHaveBeenCalled();
  });

  // Revue sécurité #571, cycle 3 : un masque manquant n'est pas une demande qui
  // tient — l'entrée échoue, rien n'est commité.
  it("replayAccountReactivation_holdMissing_throwsReactivationNotRestoredAndRollsBack", async () => {
    const connection = transaction({ locked: lockedPending });
    jest.mocked(restoreAccountIdentity).mockResolvedValue(null);

    await expect(replayAccountReactivation(reactivation)).rejects.toThrow("REACTIVATION_NOT_RESTORED");

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
    const sqls = connection.execute.mock.calls.map(([sql]) => String(sql));
    expect(sqls).not.toContain("DELETE FROM bg_user_sessions WHERE user_id = ?");
  });
});
