import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { updateOwnProfile } from "@/lib/server/users-service";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  // `getConnection` sert à la resynchronisation de l'entrée solo, que
  // `updateOwnProfile` déclenche dès que le pseudo ou la visibilité de l'avatar
  // change : la ligne de l'entrée solo porte une copie des deux. Connexion
  // distincte, et sans entrée solo à resynchroniser : les assertions portent
  // sur l'écriture du profil, pas sur ce ménage.
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute,
    getConnection: async () => ({
      execute: jest.fn<() => Promise<unknown>>().mockResolvedValue([[], []]),
      release: () => undefined,
    }),
  }));
}

/**
 * L'écriture du profil parmi les requêtes du mock.
 *
 * `updateOwnProfile` relit d'abord le rattachement Discord (le tag d'un compte
 * rattaché ne se réécrit pas), si bien que l'`UPDATE` n'est plus le premier
 * appel : le repérer par son texte plutôt que par son rang garde ces assertions
 * valables au prochain contrôle ajouté devant.
 */
function profileUpdate(execute: SqlMock): [string, unknown[]] {
  const call = (execute.mock.calls as [string, unknown[]][]).find(([sql]) =>
    sql.includes("UPDATE bg_users"),
  );
  if (!call) throw new Error("aucun UPDATE bg_users");
  return call;
}

describe("updateOwnProfile — pseudo non masquable + ouverture au recrutement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("n'écrit plus jamais visible_pseudo", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await updateOwnProfile(42, { visibility: { avatar: false } });

    const [sql] = profileUpdate(execute);
    expect(sql).not.toMatch(/visible_pseudo/);
    expect(sql).toMatch(/visible_avatar = COALESCE\(\?, visible_avatar\)/);
  });

  it("persiste la fermeture au recrutement", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await updateOwnProfile(42, { openToRecruitment: false });

    const [sql, params] = profileUpdate(execute);
    expect(sql).toMatch(/open_to_recruitment = COALESCE\(\?, open_to_recruitment\)/);
    // Dernier paramètre avant l'id = open_to_recruitment.
    expect(params[params.length - 2]).toBe(false);
    expect(params[params.length - 1]).toBe(42);
  });

  it("laisse la valeur inchangée quand le champ est absent du patch", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await updateOwnProfile(42, { isAdult: true });

    const [, params] = profileUpdate(execute);
    // `null` → COALESCE conserve la valeur en base.
    expect(params[params.length - 2]).toBeNull();
  });
});
