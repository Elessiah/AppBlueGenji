import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { updateOwnProfile } from "@/lib/server/users-service";
import { PSEUDO_MAX_LENGTH } from "@/lib/shared/pseudo";

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
  (getDatabase as jest.Mock).mockResolvedValue({ execute, getConnection } as never);
  return execute;
}

function writtenPseudo(execute: jest.Mock): unknown {
  const call = (execute.mock.calls as [string, unknown[]][]).find(([sql]) => /UPDATE bg_users/.test(sql));
  return call?.[1][0];
}

describe("updateOwnProfile — le pseudo est validé avant d'être lu", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

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
