import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { removeUserAvatarAsModerator } from "@/lib/server/users/avatar";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");

const AVATAR = "/api/uploads/avatars/9-a.webp";

let connection: ReturnType<typeof connectionMock>;

async function install(user: object | null) {
  const { getDatabase } = await import("@/lib/server/database");
  connection = connectionMock();
  connection.execute = jest.fn<SqlQuery>(async (sql) => {
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
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(undefined);
    await install({ pseudo: "Nova", avatar_url: AVATAR, is_deleted: 0 });

    await expect(removeUserAvatarAsModerator(9)).resolves.toEqual({
      pseudo: "Nova",
      removedAvatarUrl: AVATAR,
    });
    expect(connection.commit).toHaveBeenCalled();
    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 9);
  });

  it("refuse un compte inconnu, supprimé, ou sans avatar", async () => {
    await install(null);
    await expect(removeUserAvatarAsModerator(9)).rejects.toThrow("USER_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();

    await install({ pseudo: "Nova", avatar_url: AVATAR, is_deleted: 1 });
    await expect(removeUserAvatarAsModerator(9)).rejects.toThrow("USER_NOT_FOUND");

    await install({ pseudo: "Nova", avatar_url: null, is_deleted: 0 });
    await expect(removeUserAvatarAsModerator(9)).rejects.toThrow("USER_HAS_NO_AVATAR");
  });
});
