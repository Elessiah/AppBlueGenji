import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/users/account-deletion");
jest.mock("@/lib/server/users/account-deletion-request", () => ({ requestAccountDeletion: jest.fn() }));
jest.mock("@/lib/server/users/account-reactivation", () => ({ replayAccountReactivation: jest.fn() }));

import { replayAccountDeletions } from "@/lib/server/account-deletion-replay";
import { getDatabase } from "@/lib/server/database";
import { deleteOwnAccount, finalizeAccountDeletion } from "@/lib/server/users/account-deletion";
import { requestAccountDeletion } from "@/lib/server/users/account-deletion-request";
import { replayAccountReactivation } from "@/lib/server/users/account-reactivation";
import type { AccountDeletionEntry } from "@/lib/shared/account-deletion-journal";
import { fakePool } from "../../helpers/sql-double";

const CREATED = "2026-01-02 03:04:05";
const entry = (userId: number, accountCreatedAt = CREATED): AccountDeletionEntry => ({
  userId,
  accountCreatedAt,
  deletedAt: "2026-09-20T10:00:00.000Z",
});

/** La base restaurée : un compte par identifiant, ou rien. */
function restoredDb(
  rows: Record<number, { created_at: string; is_deleted: number; deletion_requested_at?: string | null }>,
  update: { affectedRows?: number; error?: Error } = {},
) {
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("UPDATE")) {
      if (update.error) throw update.error;
      return [{ affectedRows: update.affectedRows ?? 1 }];
    }
    const row = rows[Number(params[0])];
    return [row ? [row] : []];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

const lines: string[] = [];
const log = (line: string) => {
  lines.push(line);
};

beforeEach(() => {
  jest.clearAllMocks();
  lines.length = 0;
  jest.mocked(deleteOwnAccount).mockResolvedValue({ mode: "ERASE", reason: null });
});

describe("replayAccountDeletions", () => {
  it("rejoue un compte revenu avec la sauvegarde, par le chemin ordinaire", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    const report = await replayAccountDeletions([entry(7)], { log });
    expect(deleteOwnAccount).toHaveBeenCalledWith(7);
    expect(report).toEqual({
      replayed: 1,
      absent: 0,
      alreadyDeleted: 0,
      otherAccount: 0,
      reactivated: 0,
      alreadyActive: 0,
      superseded: 0,
      alreadyPending: 0,
      failed: 0,
    });
    expect(lines.join("\n")).toContain("effacé");
  });

  it("dit l'anonymisation quand la base restaurée retient la ligne", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    jest.mocked(deleteOwnAccount).mockResolvedValue({ mode: "ANONYMIZE", reason: "TOURNAMENTS" });
    await replayAccountDeletions([entry(7)], { log });
    expect(lines.join("\n")).toContain("anonymisé");
  });

  it("ne touche ni un compte absent, ni un compte déjà supprimé, ni un identifiant réattribué", async () => {
    restoredDb({
      2: { created_at: CREATED, is_deleted: 1 },
      3: { created_at: "2026-09-22 08:00:00", is_deleted: 0 },
    });
    const report = await replayAccountDeletions([entry(1), entry(2), entry(3)], { log });
    expect(deleteOwnAccount).not.toHaveBeenCalled();
    expect(report).toEqual({
      replayed: 0,
      absent: 1,
      alreadyDeleted: 1,
      otherAccount: 1,
      reactivated: 0,
      alreadyActive: 0,
      superseded: 0,
      alreadyPending: 0,
      failed: 0,
    });
    expect(lines.join("\n")).toContain("#3");
  });

  it("en simulation, n'écrit rien mais compte ce qui serait rejoué", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    const report = await replayAccountDeletions([entry(7)], { dryRun: true, log });
    expect(deleteOwnAccount).not.toHaveBeenCalled();
    expect(report.replayed).toBe(1);
    expect(lines.join("\n")).toContain("serait supprimé");
  });

  it("un échec n'arrête pas le rejeu des suivantes, et se compte", async () => {
    restoredDb({ 1: { created_at: CREATED, is_deleted: 0 }, 2: { created_at: CREATED, is_deleted: 0 } });
    jest.mocked(deleteOwnAccount)
      .mockRejectedValueOnce(new Error("ACCOUNT_STILL_REFERENCED"))
      .mockResolvedValueOnce({ mode: "ERASE", reason: null });
    const report = await replayAccountDeletions([entry(1), entry(2)], { log });
    expect(deleteOwnAccount).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ replayed: 1, failed: 1 });
    expect(lines.join("\n")).toContain("ACCOUNT_STILL_REFERENCED");
  });

  it("lit la date de création et l'état du compte, sur son identifiant", async () => {
    const execute = restoredDb({});
    await replayAccountDeletions([entry(42)], { log });
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("created_at");
    expect(String(sql)).toContain("is_deleted");
    expect(params).toEqual([42]);
  });

  it("un journal vide ne fait rien", async () => {
    const execute = restoredDb({});
    expect(await replayAccountDeletions([], { log })).toEqual({
      replayed: 0,
      absent: 0,
      alreadyDeleted: 0,
      otherAccount: 0,
      reactivated: 0,
      alreadyActive: 0,
      superseded: 0,
      alreadyPending: 0,
      failed: 0,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("replayAccountDeletions — demande en attente (décision du 2026-11-04)", () => {
  const pending = (deletedAt: string): AccountDeletionEntry => ({ ...entry(7), pending: true, deletedAt });

  it("replayAccountDeletions_pendingWindowOpen_reRequestsWithOriginalDate", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    const requestedAt = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    jest.mocked(requestAccountDeletion).mockResolvedValue({ mode: "ERASE", reason: null, finalAt: requestedAt });

    const report = await replayAccountDeletions([pending(requestedAt)], { log });

    expect(requestAccountDeletion).toHaveBeenCalledWith(7, { requestedAt: new Date(requestedAt) });
    expect(deleteOwnAccount).not.toHaveBeenCalled();
    expect(report.replayed).toBe(1);
    expect(lines.join("\n")).toContain("demande de suppression rejouée");
  });

  // Revue juridique #546, cycle 3 : revenu vivant, le compte passe d'abord par la demande
  // (équipes quittées, tournois cédés…) avant d'être effacé.
  it("replayAccountDeletions_pendingWindowClosedLiveRow_requestsThenDeletes", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });

    await replayAccountDeletions([pending("2026-09-20T10:00:00.000Z")], { log });

    expect(requestAccountDeletion).toHaveBeenCalledWith(7, { requestedAt: new Date("2026-09-20T10:00:00.000Z") });
    expect(deleteOwnAccount).toHaveBeenCalledWith(7);
    expect(jest.mocked(requestAccountDeletion).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(deleteOwnAccount).mock.invocationCallOrder[0],
    );
  });

  it("replayAccountDeletions_requestSaysUserNotFound_stillDeletes", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    jest.mocked(requestAccountDeletion).mockRejectedValueOnce(new Error("USER_NOT_FOUND"));

    const report = await replayAccountDeletions([entry(7)], { log });

    expect(deleteOwnAccount).toHaveBeenCalledWith(7);
    expect(report.replayed).toBe(1);
  });

  it("replayAccountDeletions_requestFailsOtherwise_failedWithoutDelete", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    jest.mocked(requestAccountDeletion).mockRejectedValueOnce(new Error("DB_DOWN"));

    const report = await replayAccountDeletions([entry(7)], { log });

    expect(deleteOwnAccount).not.toHaveBeenCalled();
    expect(report.failed).toBe(1);
  });

  it("replayAccountDeletions_pendingWindowOpenDryRun_saysRequestWouldReplay", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    const requestedAt = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

    await replayAccountDeletions([pending(requestedAt)], { log, dryRun: true });

    expect(lines.join("\n")).toContain(`demande de suppression du ${requestedAt} à rejouer`);
    expect(requestAccountDeletion).not.toHaveBeenCalled();
  });

  it("replayAccountDeletions_pendingWindowClosedDryRun_saysWouldBeDeleted", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });

    await replayAccountDeletions([pending("2026-09-20T10:00:00.000Z")], { log, dryRun: true });

    expect(lines.join("\n")).toContain("serait supprimé");
    expect(deleteOwnAccount).not.toHaveBeenCalled();
  });
});

// Décision R1 du 2026-11-04 : une réactivation journalisée se rejoue.
describe("replayAccountDeletions — réactivation (décision R1)", () => {
  const reactivated: AccountDeletionEntry = {
    ...entry(7),
    reactivated: true,
    deletedAt: "2026-11-03T09:00:00.000Z",
    undoneRequestAt: "2026-11-01 10:00:00",
  };
  const pendingRow = { created_at: CREATED, is_deleted: 1, deletion_requested_at: "2026-11-01 10:00:00" };

  it("replayAccountDeletions_reactivatedEntryPendingRow_callsReplayReactivation", async () => {
    restoredDb({ 7: pendingRow });
    jest.mocked(replayAccountReactivation).mockResolvedValue("REACTIVATED");

    const report = await replayAccountDeletions([reactivated], { log });

    expect(replayAccountReactivation).toHaveBeenCalledWith(reactivated);
    expect(deleteOwnAccount).not.toHaveBeenCalled();
    expect(report).toMatchObject({ reactivated: 1, replayed: 0, failed: 0 });
    expect(lines.join("\n")).toContain("réactivé");
  });

  it("replayAccountDeletions_reactivatedEntryDryRun_countsWithoutWriting", async () => {
    restoredDb({ 7: pendingRow });

    const report = await replayAccountDeletions([reactivated], { dryRun: true, log });

    expect(replayAccountReactivation).not.toHaveBeenCalled();
    expect(report.reactivated).toBe(1);
    expect(lines.join("\n")).toContain("à réactiver");
  });

  // Revue sécurité #546, cycle 8 : une demande refaite après la réactivation tient.
  it("replayAccountDeletions_reactivatedEntryLaterRequest_notReactivated", async () => {
    restoredDb({ 7: { ...pendingRow, deletion_requested_at: "2026-11-05 10:00:00" } });

    const report = await replayAccountDeletions([reactivated], { log });

    expect(replayAccountReactivation).not.toHaveBeenCalled();
    expect(report).toMatchObject({ alreadyDeleted: 1, reactivated: 0 });
  });

  it("replayAccountDeletions_reactivatedEntryAliveRow_alreadyActive", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0, deletion_requested_at: null } });

    const report = await replayAccountDeletions([reactivated], { log });

    expect(replayAccountReactivation).not.toHaveBeenCalled();
    expect(report).toMatchObject({ alreadyActive: 1, reactivated: 0 });
  });

  // Revue sécurité #546, cycle 9 : un refus relu sous verrou n'est pas « déjà réactivé ».
  it("replayAccountDeletions_replayReactivationSuperseded_countedApart", async () => {
    restoredDb({ 7: pendingRow });
    jest.mocked(replayAccountReactivation).mockResolvedValue("SUPERSEDED");

    const report = await replayAccountDeletions([reactivated], { log });

    expect(report).toMatchObject({ superseded: 1, alreadyActive: 0, reactivated: 0 });
    expect(lines.join("\n")).toContain("demande postérieure");
  });

  it("replayAccountDeletions_replayReactivationAlreadyActiveUnderLock_alreadyActive", async () => {
    restoredDb({ 7: pendingRow });
    jest.mocked(replayAccountReactivation).mockResolvedValue("ALREADY_ACTIVE");

    const report = await replayAccountDeletions([reactivated], { log });

    expect(report).toMatchObject({ alreadyActive: 1, superseded: 0, reactivated: 0 });
  });

  it("replayAccountDeletions_replayReactivationThrows_failedCounted", async () => {
    restoredDb({ 7: pendingRow });
    jest.mocked(replayAccountReactivation).mockRejectedValue(new Error("DB_DOWN"));

    const report = await replayAccountDeletions([reactivated], { log });

    expect(report).toMatchObject({ failed: 1, reactivated: 0 });
    expect(lines.join("\n")).toContain("DB_DOWN");
  });
});

// Revue sécurité #546, cycle 9 : demande défaite puis refaite, revenue avec la
// sauvegarde sous sa date d'origine — la date du journal (la plus récente) la remplace.
describe("replayAccountDeletions — demande à redater", () => {
  const DAY = 24 * 3600 * 1000;
  // Fenêtre ouverte : demande d'il y a deux jours, à la milliseconde près.
  const recent = new Date(Math.floor((Date.now() - 2 * DAY) / 1000) * 1000 + 123);
  const pending: AccountDeletionEntry = { ...entry(7), pending: true, deletedAt: recent.toISOString() };
  const wholeSecond = new Date(Math.floor(recent.getTime() / 1000) * 1000);
  const pendingRow = { created_at: CREATED, is_deleted: 1, deletion_requested_at: "2026-10-01 10:00:00" };

  it("replayAccountDeletions_pendingEntryPendingRowOlderDate_redatedForwardOnlyAtWholeSecond", async () => {
    const execute = restoredDb({ 7: pendingRow }, { affectedRows: 1 });

    const report = await replayAccountDeletions([pending], { log });

    const update = execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE"));
    expect(update?.[0]).toContain("deletion_requested_at < ?");
    expect(update?.[1]).toEqual([wholeSecond, 7, CREATED, wholeSecond]);
    expect(requestAccountDeletion).not.toHaveBeenCalled();
    expect(deleteOwnAccount).not.toHaveBeenCalled();
    expect(finalizeAccountDeletion).not.toHaveBeenCalled();
    expect(report).toMatchObject({ replayed: 1, alreadyDeleted: 0, alreadyPending: 0 });
    expect(lines.join("\n")).toContain("redatée");
  });

  it("replayAccountDeletions_pendingEntrySameOrLaterDate_alreadyPendingNotDeleted", async () => {
    restoredDb({ 7: pendingRow }, { affectedRows: 0 });

    const report = await replayAccountDeletions([pending], { log });

    expect(report).toMatchObject({ replayed: 0, alreadyDeleted: 0, alreadyPending: 1 });
  });

  it("replayAccountDeletions_pendingEntryWindowClosed_finalizedAtOnce", async () => {
    restoredDb({ 7: pendingRow }, { affectedRows: 1 });
    jest.mocked(finalizeAccountDeletion).mockResolvedValue({ mode: "ANONYMIZE", reason: "TOURNAMENTS" });
    const old: AccountDeletionEntry = { ...pending, deletedAt: new Date(Date.now() - 40 * DAY).toISOString() };

    const report = await replayAccountDeletions([old], { log });

    expect(finalizeAccountDeletion).toHaveBeenCalledWith(7);
    expect(report).toMatchObject({ replayed: 1, alreadyPending: 0 });
    expect(lines.join("\n")).toContain("anonymisé (fenêtre close)");
  });

  it("replayAccountDeletions_pendingEntryWindowClosedNotDueUnderLock_countsRedate", async () => {
    restoredDb({ 7: pendingRow }, { affectedRows: 1 });
    jest.mocked(finalizeAccountDeletion).mockResolvedValue(null);
    const old: AccountDeletionEntry = { ...pending, deletedAt: new Date(Date.now() - 40 * DAY).toISOString() };

    const report = await replayAccountDeletions([old], { log });

    expect(report).toMatchObject({ replayed: 1 });
    expect(lines.join("\n")).toContain("redatée");
  });

  it("replayAccountDeletions_redateDryRun_countsWithoutWriting", async () => {
    const execute = restoredDb({ 7: pendingRow });

    const report = await replayAccountDeletions([pending], { dryRun: true, log });

    expect(execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(report.replayed).toBe(1);
    expect(lines.join("\n")).toContain("à redater");
  });

  it("replayAccountDeletions_redateDryRunWindowClosed_saysDeletion", async () => {
    restoredDb({ 7: pendingRow });
    const old: AccountDeletionEntry = { ...pending, deletedAt: new Date(Date.now() - 40 * DAY).toISOString() };

    await replayAccountDeletions([old], { dryRun: true, log });

    expect(lines.join("\n")).toContain("serait supprimé");
    expect(finalizeAccountDeletion).not.toHaveBeenCalled();
  });

  it("replayAccountDeletions_redateThrows_failedCounted", async () => {
    restoredDb({ 7: pendingRow }, { error: new Error("DB_DOWN") });

    const report = await replayAccountDeletions([pending], { log });

    expect(report).toMatchObject({ failed: 1, replayed: 0 });
    expect(lines.join("\n")).toContain("DB_DOWN");
  });
});
