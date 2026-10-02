import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/avatar-rotation");

import { updateUserAvatar } from "@/lib/server/users/avatar";
import { updateOwnProfile } from "@/lib/server/users/profile-update";
import { getDatabase } from "@/lib/server/database";
import { syncSoloEntryIdentity } from "@/lib/server/solo-entries-service";
import { rotateHiddenAvatarFile } from "@/lib/server/avatar-rotation";
import { connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

/**
 * Masquer son avatar doit l'**effacer** de l'entrée solo, pas seulement cesser
 * de l'y reposer.
 *
 * Le logo d'une entrée solo est une copie stockée de l'avatar, servie à tout le
 * monde (bracket, classement, carte du match en direct de l'accueil). La
 * resynchronisation ne se déclenchait qu'au renommage : bascule la visibilité
 * et la copie restait en place, indéfiniment. Voir
 * `docs/AUTHORIZATION_RULES.md` §2.3.
 */

const syncMock = syncSoloEntryIdentity as jest.MockedFunction<typeof syncSoloEntryIdentity>;

function mockDb() {
  const execute = jest.fn<() => Promise<unknown>>().mockResolvedValue([{ affectedRows: 1 }]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

describe("updateOwnProfile — resynchronisation de l'entrée solo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncMock.mockResolvedValue(undefined);
  });

  it("resynchronise quand la visibilité de l'avatar bascule à masqué", async () => {
    mockDb();
    await updateOwnProfile(42, { visibility: { avatar: false } });
    expect(syncMock).toHaveBeenCalledWith(42);
  });

  it("resynchronise aussi quand elle rebascule à visible", async () => {
    // L'autre sens compte autant : sans lui, un avatar remasqué puis démasqué
    // ne reviendrait jamais dans les brackets.
    mockDb();
    await updateOwnProfile(42, { visibility: { avatar: true } });
    expect(syncMock).toHaveBeenCalledWith(42);
  });

  it("resynchronise toujours au renommage", async () => {
    mockDb();
    await updateOwnProfile(42, { pseudo: "Nova" });
    expect(syncMock).toHaveBeenCalledWith(42);
  });

  it("ne resynchronise pas pour un champ qui ne voyage pas jusqu'à l'entrée", async () => {
    // L'entrée solo ne porte que le pseudo et le logo : la majorité, les tags de
    // jeu ou l'ouverture au recrutement n'ont rien à y recopier.
    mockDb();
    await updateOwnProfile(42, { isAdult: true, openToRecruitment: false });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("ne resynchronise pas quand la visibilité de l'avatar n'est pas dans le patch", async () => {
    mockDb();
    await updateOwnProfile(42, { visibility: { overwatch: true } });
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe("updateOwnProfile — renommage du fichier d'un avatar masqué", () => {
  const rotateMock = jest.mocked(rotateHiddenAvatarFile);

  function mockDbWith(visibleBefore: 0 | 1) {
    const execute = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([[{ visible_avatar: visibleBefore }]])
      .mockResolvedValue([{ affectedRows: 1 }]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    syncMock.mockResolvedValue(undefined);
    rotateMock.mockResolvedValue("/api/uploads/avatars/42-new.webp");
  });

  it("renomme le fichier à la bascule visible → masqué", async () => {
    mockDbWith(1);
    await updateOwnProfile(42, { visibility: { avatar: false } });
    expect(rotateMock).toHaveBeenCalledWith(42);
  });

  it("ne renomme pas un avatar déjà masqué — le formulaire renvoie le réglage à chaque sauvegarde", async () => {
    mockDbWith(0);
    await updateOwnProfile(42, { visibility: { avatar: false } });
    expect(rotateMock).not.toHaveBeenCalled();
  });

  it("ne renomme rien quand l'avatar redevient visible", async () => {
    mockDb();
    await updateOwnProfile(42, { visibility: { avatar: true } });
    expect(rotateMock).not.toHaveBeenCalled();
  });

  it("un échec du renommage n'annule pas le réglage déjà écrit", async () => {
    mockDbWith(1);
    rotateMock.mockRejectedValueOnce(new Error("disque"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(updateOwnProfile(42, { visibility: { avatar: false } })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    expect(syncMock).toHaveBeenCalledWith(42);
    spy.mockRestore();
  });
});

describe("updateUserAvatar — l'adresse remplacée est lue sous le verrou de l'écriture", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncMock.mockResolvedValue(undefined);
  });

  function mockConnection(rows: unknown[]) {
    const connection = connectionMock();
    connection.execute.mockResolvedValueOnce([rows]).mockResolvedValue([{ affectedRows: 1 }]);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ getConnection: async () => fakeConnection(connection) }));
    return connection;
  }

  it("rend l'adresse relue sous verrou, celle qu'il faut effacer", async () => {
    // Relue avant et hors verrou, elle pouvait avoir été renommée par le
    // masquage : l'appelant effaçait l'ancien nom et laissait le nouveau.
    const connection = mockConnection([{ avatar_url: "/api/uploads/avatars/42-renomme.webp" }]);
    expect(await updateUserAvatar(42, "/api/uploads/avatars/42-neuf.webp")).toEqual({
      previousUrl: "/api/uploads/avatars/42-renomme.webp",
    });
    expect(connection.execute.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
    expect(syncMock).toHaveBeenCalledWith(42);
  });

  it("rend null pour un compte supprimé, sans rien écrire", async () => {
    const connection = mockConnection([]);
    expect(await updateUserAvatar(42, null)).toBeNull();
    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
  });
});
