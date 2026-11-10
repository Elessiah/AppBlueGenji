import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/server/database");

import { updateOwnProfile } from "@/lib/server/users/profile-update";
import { PSEUDO_MAX_LENGTH } from "@/lib/shared/pseudo";
import { fakePool } from "../../helpers/sql-double";

/**
 * Le pseudo d'un `PATCH /api/profile` est contrôlé **avant** d'être lu.
 *
 * Le corps n'est qu'annoté : `{"pseudo": 123}` faisait lever `normalizePseudo`,
 * et `raw.replace is not a function` ressortait dans le corps du 400. Deux
 * saisies passaient aussi sans être des pseudos : que des espaces (écrit vide),
 * et plus long que la colonne (refusé par MySQL, message brut compris).
 */
async function mockDb() {
  const { getDatabase } = await import("@/lib/server/database");
  const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>();
  execute.mockImplementation(async (sql: string) =>
    /^\s*UPDATE/.test(sql) ? [{ affectedRows: 1 }] : [[]],
  );
  const getConnection = jest.fn(async () => ({
    execute: jest.fn<() => Promise<unknown>>().mockResolvedValue([[], []]),
    release: () => undefined,
  }));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection }));
  return execute;
}

function writtenPseudo(execute: jest.Mock<(sql: string, params?: unknown[]) => Promise<unknown>>): unknown {
  const call = (execute.mock.calls as [string, unknown[]][]).find(([sql]) => /UPDATE bg_users/.test(sql));
  return call?.[1][0];
}

describe("updateOwnProfile — le pseudo est validé avant d'être lu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([123, null, true, ["Nova"], { pseudo: "Nova" }])(
    "refuse %p en INVALID_PSEUDO, sans toucher la base",
    async (value) => {
      const execute = await mockDb();
      await expect(updateOwnProfile(42, { pseudo: value as never })).rejects.toThrow("INVALID_PSEUDO");
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each(["", "   ", "\t\n"])("refuse un pseudo vide (%p) plutôt que de l'écrire", async (value) => {
    const execute = await mockDb();
    await expect(updateOwnProfile(42, { pseudo: value })).rejects.toThrow("PSEUDO_EMPTY");
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuse un pseudo plus long que la colonne", async () => {
    const execute = await mockDb();
    await expect(
      updateOwnProfile(42, { pseudo: "a".repeat(PSEUDO_MAX_LENGTH + 1) }),
    ).rejects.toThrow("PSEUDO_TOO_LONG");
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepte la limite exacte, comptée en caractères", async () => {
    const execute = await mockDb();
    const pseudo = "🎮".repeat(PSEUDO_MAX_LENGTH);
    await expect(updateOwnProfile(42, { pseudo })).resolves.toBeUndefined();
    expect(writtenPseudo(execute)).toBe(pseudo);
  });

  it("écrit le pseudo normalisé, comme il vérifie son unicité", async () => {
    const execute = await mockDb();
    await updateOwnProfile(42, { pseudo: "  Nova   Prime " });
    const conflict = (execute.mock.calls as [string, unknown[]][]).find(([sql]) =>
      /SELECT id FROM bg_users WHERE pseudo/.test(sql),
    );
    expect(conflict?.[1][0]).toBe("Nova Prime");
    expect(writtenPseudo(execute)).toBe("Nova Prime");
  });

  it("laisse le pseudo inchangé quand le patch n'en parle pas", async () => {
    const execute = await mockDb();
    await updateOwnProfile(42, { openToRecruitment: false });
    expect(writtenPseudo(execute)).toBeNull();
    // Aucune vérification d'unicité sans pseudo à écrire.
    expect(
      (execute.mock.calls as [string][]).some(([sql]) => /WHERE pseudo = \?/.test(sql)),
    ).toBe(false);
  });
});

describe("updateOwnProfile — la course sur l'index unique du pseudo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("dit « pseudo déjà pris » quand l'index tranche entre deux sauvegardes simultanées", async () => {
    // Les deux joueurs passent le `SELECT` d'unicité ; c'est l'`UPDATE` du
    // second qui bute sur l'index.
    const execute = await mockDb();
    execute.mockImplementation(async (sql: string) => {
      if (/^\s*UPDATE/.test(sql)) {
        throw Object.assign(new Error("Duplicate entry 'Nova' for key 'pseudo'"), { code: "ER_DUP_ENTRY" });
      }
      return [[]];
    });
    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("PSEUDO_ALREADY_USED");
  });

  it("refuse lisiblement un pseudo déjà pris, avant toute écriture", async () => {
    const execute = await mockDb();
    execute.mockImplementation(async (sql: string) =>
      /SELECT id FROM bg_users WHERE pseudo = \?/.test(sql) ? [[{ id: 7 }]] : [{ affectedRows: 1 }],
    );
    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("PSEUDO_ALREADY_USED");
    expect(execute.mock.calls[0]?.[1]).toEqual(["Nova", 42]);
    expect(writtenPseudo(execute)).toBeUndefined();
  });

  it("laisse passer toute autre panne telle quelle", async () => {
    const execute = await mockDb();
    execute.mockImplementation(async (sql: string) => {
      if (/^\s*UPDATE/.test(sql)) throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" });
      return [[]];
    });
    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("deadlock");
  });

  it("updateOwnProfile_pseudoHeldByPendingDeletion_rejectedAsTaken", async () => {
    const execute = await mockDb();
    execute.mockImplementation(async (sql: string) =>
      /bg_account_deletion_holds/.test(sql) ? [[{ user_id: 9 }]] : /^\s*UPDATE/.test(sql) ? [{ affectedRows: 1 }] : [[]],
    );

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("PSEUDO_ALREADY_USED");
    expect(writtenPseudo(execute)).toBeUndefined();
  });

  it("updateOwnProfile_ownHeldPseudo_accepted", async () => {
    const execute = await mockDb();
    execute.mockImplementation(async (sql: string) =>
      /bg_account_deletion_holds/.test(sql) ? [[{ user_id: 42 }]] : /^\s*UPDATE/.test(sql) ? [{ affectedRows: 1 }] : [[]],
    );

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).resolves.toBeUndefined();
  });
});

/*
 * Décision D39 (2026-11-10) : le pseudo d'un compte en attente de suppression
 * reste réservé, mais son refus ne doit rien dire de cette demande — il est
 * indiscernable de celui d'un pseudo porté par un compte.
 */
describe("updateOwnProfile — un pseudo réservé se refuse comme un pseudo pris (D39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function refusal(execute: Awaited<ReturnType<typeof mockDb>>): Promise<{ name: string; message: string; keys: string[] }> {
    const error = await updateOwnProfile(42, { pseudo: "Nova" }).then(
      () => new Error("NOT_REFUSED"),
      (thrown: Error) => thrown,
    );
    expect(writtenPseudo(execute)).toBeUndefined();
    return { name: error.name, message: error.message, keys: Object.keys(error) };
  }

  it("updateOwnProfile_takenVsHeldPseudo_sameErrorAndSameReads", async () => {
    const taken = await mockDb();
    taken.mockImplementation(async (sql: string) =>
      /SELECT id FROM bg_users WHERE pseudo = \?/.test(sql) ? [[{ id: 7 }]] : [[]],
    );
    const takenRefusal = await refusal(taken);
    const takenReads = taken.mock.calls.map(([sql, params]) => [sql, params]);

    const held = await mockDb();
    held.mockImplementation(async (sql: string) => (/bg_account_deletion_holds/.test(sql) ? [[{ user_id: 9 }]] : [[]]));
    const heldRefusal = await refusal(held);
    const heldReads = held.mock.calls.map(([sql, params]) => [sql, params]);

    expect(heldRefusal).toEqual(takenRefusal);
    expect(heldRefusal.message).toBe("PSEUDO_ALREADY_USED");
    expect(heldReads).toEqual(takenReads);
  });

  it("updateOwnProfile_takenPseudo_stillReadsHolds", async () => {
    const execute = await mockDb();
    execute.mockImplementation(async (sql: string) =>
      /SELECT id FROM bg_users WHERE pseudo = \?/.test(sql) ? [[{ id: 7 }]] : [[]],
    );

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("PSEUDO_ALREADY_USED");

    expect(execute.mock.calls.some(([sql]) => /bg_account_deletion_holds/.test(sql))).toBe(true);
  });

  it("updateOwnProfile_heldPseudoAndMissingHoldsTable_sameRefusalAsTaken", async () => {
    const execute = await mockDb();
    execute.mockImplementation(async (sql: string) => {
      if (/bg_account_deletion_holds/.test(sql)) throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
      return /SELECT id FROM bg_users WHERE pseudo = \?/.test(sql) ? [[{ id: 7 }]] : [[]];
    });

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("PSEUDO_ALREADY_USED");
  });
});

describe("pseudo réservé — aucun code ni texte dédié (D39)", () => {
  const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
  const DEDICATED = /PSEUDO_(?:RESERVED|HELD|ON_HOLD|PENDING|UNAVAILABLE|AWAITING)[A-Z_]*/;

  it.each([
    "lib/server/users/profile-update.ts",
    "lib/server/users/account-deletion-hold.ts",
    "lib/server/auth.ts",
    "app/api/profile/route.ts",
    "lib/shared/field-errors.ts",
    "messages/fr/profile.json",
    "messages/en/profile.json",
  ])("pseudoRefusal_%s_noDedicatedCode", (path) => {
    expect(read(path)).not.toMatch(DEDICATED);
  });

  it.each(["fr", "en"])("pseudoRefusal_%sMessages_singleTakenText", (locale) => {
    const source = read(`messages/${locale}/profile.json`);

    expect(source.match(/"PSEUDO_ALREADY_USED"/g)).toHaveLength(1);
  });

  it("pseudoRefusal_route_single409ForTheSingleCode", () => {
    const route = read("app/api/profile/route.ts");

    expect(route.match(/PSEUDO_[A-Z_]+"\) return fail\(message, 409\)/g)).toEqual([
      'PSEUDO_ALREADY_USED") return fail(message, 409)',
    ]);
  });
});
