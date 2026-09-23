import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/users-service");

import { replayAccountDeletions } from "@/lib/server/account-deletion-replay";
import { getDatabase } from "@/lib/server/database";
import { deleteOwnAccount } from "@/lib/server/users-service";
import type { AccountDeletionEntry } from "@/lib/shared/account-deletion-journal";

const CREATED = "2026-01-02 03:04:05";
const entry = (userId: number, accountCreatedAt = CREATED): AccountDeletionEntry => ({
  userId,
  accountCreatedAt,
  deletedAt: "2026-09-20T10:00:00.000Z",
});

/** La base restaurée : un compte par identifiant, ou rien. */
function restoredDb(rows: Record<number, { created_at: string; is_deleted: number }>) {
  const execute = jest.fn(async (_sql: string, params: unknown[] = []) => {
    const row = rows[Number(params[0])];
    return [row ? [row] : []];
  });
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return execute;
}

const lines: string[] = [];
const log = (line: string) => {
  lines.push(line);
};

beforeEach(() => {
  jest.clearAllMocks();
  lines.length = 0;
  (deleteOwnAccount as jest.Mock).mockResolvedValue({ mode: "ERASE", reason: null } as never);
});

describe("replayAccountDeletions", () => {
  it("rejoue un compte revenu avec la sauvegarde, par le chemin ordinaire", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    const report = await replayAccountDeletions([entry(7)], { log });
    expect(deleteOwnAccount).toHaveBeenCalledWith(7);
    expect(report).toEqual({ replayed: 1, absent: 0, alreadyDeleted: 0, otherAccount: 0, failed: 0 });
    expect(lines.join("\n")).toContain("effacé");
  });

  it("dit l'anonymisation quand la base restaurée retient la ligne", async () => {
    restoredDb({ 7: { created_at: CREATED, is_deleted: 0 } });
    (deleteOwnAccount as jest.Mock).mockResolvedValue({ mode: "ANONYMIZE", reason: "TOURNAMENTS" } as never);
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
    expect(report).toEqual({ replayed: 0, absent: 1, alreadyDeleted: 1, otherAccount: 1, failed: 0 });
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
    (deleteOwnAccount as jest.Mock)
      .mockRejectedValueOnce(new Error("ACCOUNT_STILL_REFERENCED") as never)
      .mockResolvedValueOnce({ mode: "ERASE", reason: null } as never);
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
      failed: 0,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
