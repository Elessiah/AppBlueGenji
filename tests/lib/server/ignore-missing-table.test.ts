import { describe, expect, it } from "@jest/globals";

import { ignoreMissingTable } from "@/lib/server/mysql-errors";

/** Erreur mysql2 réduite à ce que le module lit : son code. */
function mysqlError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("ignoreMissingTable", () => {
  it("laisse passer une écriture réussie", async () => {
    await expect(ignoreMissingTable(Promise.resolve([{ affectedRows: 3 }]))).resolves.toBeUndefined();
  });

  it("tient une table absente pour « rien à faire »", async () => {
    await expect(
      ignoreMissingTable(Promise.reject(mysqlError("ER_NO_SUCH_TABLE"))),
    ).resolves.toBeUndefined();
  });

  it("relance un interblocage : la transaction est déjà défaite", async () => {
    await expect(
      ignoreMissingTable(Promise.reject(mysqlError("ER_LOCK_DEADLOCK"))),
    ).rejects.toThrow("ER_LOCK_DEADLOCK");
  });

  it("relance une erreur sans code MySQL", async () => {
    await expect(ignoreMissingTable(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});
