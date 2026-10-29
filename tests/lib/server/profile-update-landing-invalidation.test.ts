import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/landing-cache");
jest.mock("@/lib/server/avatar-rotation");

import { getDatabase } from "@/lib/server/database";
import { invalidateLandingTeamViews } from "@/lib/server/landing-cache";
import { syncSoloEntryIdentity } from "@/lib/server/solo-entries-service";
import { updateOwnProfile } from "@/lib/server/users/profile-update";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import { fakePool } from "../../helpers/sql-double";

/**
 * Le bandeau et le mini-arbre de la vitrine, mis en cache sans compte, nomment
 * une entrée solo à son pseudo : un renommage les vide, sans quoi l'ancien
 * pseudo y restait jusqu'à une minute. Une écriture refusée n'y touche pas.
 */
function mockDb(update: () => Promise<unknown>) {
  const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>();
  execute.mockImplementation(async (sql: string) => (/^\s*UPDATE/.test(sql) ? update() : [[]]));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

const matched = async () => [{ affectedRows: 1 }];

describe("updateOwnProfile — vues de la vitrine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(syncSoloEntryIdentity).mockResolvedValue(undefined);
  });

  it("updateOwnProfile_pseudoChanged_invalidatesLandingTeamViewsAfterSoloSync", async () => {
    mockDb(matched);

    await updateOwnProfile(42, { pseudo: "Nova" });

    expect(invalidateLandingTeamViews).toHaveBeenCalledTimes(1);
    expect(jest.mocked(syncSoloEntryIdentity).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(invalidateLandingTeamViews).mock.invocationCallOrder[0],
    );
  });

  it("updateOwnProfile_visibilityOnlyPatch_doesNotInvalidateLanding", async () => {
    mockDb(matched);

    await updateOwnProfile(42, { visibility: { avatar: true } });

    expect(syncSoloEntryIdentity).toHaveBeenCalledWith(42);
    expect(invalidateLandingTeamViews).not.toHaveBeenCalled();
  });

  it("updateOwnProfile_accountDeleted_doesNotInvalidateLanding", async () => {
    mockDb(async () => [{ affectedRows: 0 }]);

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow(ACCOUNT_DELETED_ERROR);

    expect(invalidateLandingTeamViews).not.toHaveBeenCalled();
  });

  it("updateOwnProfile_duplicatePseudoRace_doesNotInvalidateLanding", async () => {
    mockDb(async () => {
      throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    });

    await expect(updateOwnProfile(42, { pseudo: "Nova" })).rejects.toThrow("PSEUDO_ALREADY_USED");

    expect(invalidateLandingTeamViews).not.toHaveBeenCalled();
  });
});
