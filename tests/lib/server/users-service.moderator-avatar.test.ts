import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { removeUserAvatarAsModerator } from "@/lib/server/users/avatar";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");

const AVATAR = "/api/uploads/avatars/9-a.webp";

let connection: ReturnType<typeof connectionMock>;

/** `held` : avatar du masque (`null` : masque sans avatar ; absent : pas de masque). */
async function install(user: object | null, held?: { avatar: string | null }) {
  const { getDatabase } = await import("@/lib/server/database");
  connection = connectionMock();
  connection.execute = jest.fn<SqlQuery>(async (sql) => {
    if (/FROM bg_account_deletion_holds/.test(sql)) return [held ? [{ pseudo: "Nova", avatar_url: held.avatar }] : []];
    if (/UPDATE bg_account_deletion_holds SET avatar_url = \?/.test(sql)) return [{}];
    if (/FOR UPDATE/.test(sql)) return [user ? [user] : []];
    if (/UPDATE bg_users SET avatar_url = NULL/.test(sql)) return [{}];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ execute: jest.fn<SqlQuery>(), getConnection: async () => fakeConnection(connection) }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("removeUserAvatarAsModerator", () => {
  it("vide la colonne, resynchronise l'entrée solo et rend l'avatar retiré", async () => {
    const { syncSoloEntryIdentityOn } = await import("@/lib/server/solo-entries-service");
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    await install({ pseudo: "Nova", avatar_url: AVATAR, is_deleted: 0 });

    await expect(removeUserAvatarAsModerator(9)).resolves.toEqual({
      pseudo: "Nova",
      removedAvatarUrl: AVATAR,
    });
    expect(connection.commit).toHaveBeenCalled();
    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 9);
  });

  it("refuse un compte inconnu, supprimé sans masque, ou sans avatar", async () => {
    await install(null);
    await expect(removeUserAvatarAsModerator(9)).rejects.toThrow("USER_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();

    await install({ pseudo: "Anonyme", avatar_url: null, is_deleted: 1 });
    await expect(removeUserAvatarAsModerator(9)).rejects.toThrow("USER_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();

    await install({ pseudo: "Nova", avatar_url: null, is_deleted: 0 });
    await expect(removeUserAvatarAsModerator(9)).rejects.toThrow("USER_HAS_NO_AVATAR");
  });

  // Revue sécurité #571, cycle 3 (D6) : un compte en attente de suppression
  // garde son avatar dans le masque — la modération l'y retire.
  it("removeUserAvatarAsModerator_pendingWithHeldAvatar_takesHeldAvatarAndCommits", async () => {
    const { syncSoloEntryIdentityOn } = await import("@/lib/server/solo-entries-service");
    await install({ pseudo: "Anonyme", avatar_url: null, is_deleted: 1 }, { avatar: AVATAR });

    await expect(removeUserAvatarAsModerator(9)).resolves.toEqual({ pseudo: "Anonyme", removedAvatarUrl: AVATAR });

    expect(connection.commit).toHaveBeenCalled();
    expect(connection.execute).toHaveBeenCalledWith("UPDATE bg_account_deletion_holds SET avatar_url = ? WHERE user_id = ?", [null, 9]);
    const sqls = connection.execute.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => /UPDATE bg_users SET avatar_url/.test(sql))).toBe(false);
    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
  });

  // Revue sécurité #571, cycle 4 : masque sans avatar = rien à retirer, pas un compte introuvable.
  it("removeUserAvatarAsModerator_pendingWithoutHeldAvatar_throwsUserHasNoAvatar", async () => {
    await install({ pseudo: "Anonyme", avatar_url: null, is_deleted: 1 }, { avatar: null });

    await expect(removeUserAvatarAsModerator(9)).rejects.toThrow("USER_HAS_NO_AVATAR");

    expect(connection.rollback).toHaveBeenCalled();
  });
});
