import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");

import { updateOwnProfile } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { syncSoloEntryIdentity } from "@/lib/server/solo-entries-service";

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
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
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
