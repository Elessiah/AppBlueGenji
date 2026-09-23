import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/account-deletion-journal");

import { deleteOwnAccount } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { fakePool } from "../../helpers/sql-double";

/**
 * `deleteOwnAccount` consigne la suppression au journal — **après** le commit,
 * et seulement s'il a eu lieu : une ligne pour une suppression annulée ferait
 * effacer, à la prochaine restauration, un compte que personne n'a supprimé.
 */
const order: string[] = [];

function fakeDb(options: { failOn?: string } = {}) {
  const execute = jest.fn(async (sql: string) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (options.failOn && q.includes(options.failOn)) throw new Error("DB_DOWN");
    if (q.includes("AS tournaments")) return [[{ tournaments: 0, organized: 0, owned: 0 }]];
    if (q.includes("created_at FROM bg_users")) {
      return [[{ avatar_url: null, discord_id: null, created_at: "2026-01-02 03:04:05" }]];
    }
    return [[]];
  });
  const connection = {
    execute,
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {
      order.push("commit");
    }),
    rollback: jest.fn(async () => {}),
    release: jest.fn(() => {}),
  };
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute,
    getConnection: jest.fn(async () => connection),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  jest.mocked(recordAccountDeletion).mockImplementation(async () => {
    order.push("journal");
  });
});

describe("deleteOwnAccount — journal des suppressions", () => {
  it("consigne l'identifiant et la date de création relue sous le verrou", async () => {
    fakeDb();
    await deleteOwnAccount(7);
    expect(recordAccountDeletion).toHaveBeenCalledTimes(1);
    const [recorded] = jest.mocked(recordAccountDeletion).mock.calls[0];
    expect(recorded).toMatchObject({ userId: 7, accountCreatedAt: "2026-01-02 03:04:05" });
    expect(Number.isFinite(Date.parse(String(recorded.deletedAt)))).toBe(true);
  });

  it("consigne **après** le commit", async () => {
    fakeDb();
    await deleteOwnAccount(7);
    expect(order).toEqual(["commit", "journal"]);
  });

  it("ne consigne rien quand la suppression est annulée", async () => {
    fakeDb({ failOn: "DELETE FROM bg_users" });
    await expect(deleteOwnAccount(7)).rejects.toThrow("DB_DOWN");
    expect(recordAccountDeletion).not.toHaveBeenCalled();
  });

  it("ne consigne rien pour un compte introuvable", async () => {
    fakeDb();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({
      getConnection: jest.fn(async () => ({
        execute: jest.fn(async () => [[]]),
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn(() => {}),
      })),
    }));
    await expect(deleteOwnAccount(7)).rejects.toThrow("USER_NOT_FOUND");
    expect(recordAccountDeletion).not.toHaveBeenCalled();
  });
});
