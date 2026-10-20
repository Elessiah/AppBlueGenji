import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/account-deletion");
jest.mock("@/lib/server/users/data-export");
jest.mock("@/lib/server/users/full-profile");
jest.mock("@/lib/server/users/profile-update");
jest.mock("@/lib/server/terms-acceptance");

import { GET as previewDeletion } from "@/app/api/profile/deletion/route";
import { GET as exportData } from "@/app/api/profile/export/route";
import { DELETE } from "@/app/api/profile/route";
import { clearSession, getCurrentUser } from "@/lib/server/auth";
import { assertTermsAccepted, hasAcceptedCurrentTerms, needsTermsAcceptance } from "@/lib/server/terms-acceptance";
import { deleteOwnAccount, getAccountDeletionPlan } from "@/lib/server/users/account-deletion";
import { exportOwnData } from "@/lib/server/users/data-export";
import { TERMS_ACCEPTANCE_REQUIRED } from "@/lib/shared/terms-of-use";
import { authUser } from "../../../helpers/auth-user";
import { readSource } from "../../../helpers/read-source";

/**
 * La fenêtre bloquante des conditions offre « Supprimer mon compte » (et lie
 * l'export, art. 15) : ces routes doivent répondre à un compte qui **n'a pas
 * accepté** les conditions en vigueur. Toute porte des conditions est ici
 * fermée — elles passent quand même.
 */
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7, roles: [] }));
  jest.mocked(clearSession).mockResolvedValue(undefined);
  jest.mocked(assertTermsAccepted).mockRejectedValue(new Error(TERMS_ACCEPTANCE_REQUIRED));
  jest.mocked(hasAcceptedCurrentTerms).mockResolvedValue(false);
  jest.mocked(needsTermsAcceptance).mockResolvedValue("UPDATED");
});

describe("suppression et export sans conditions acceptées", () => {
  it("l'aperçu de la suppression répond", async () => {
    jest.mocked(getAccountDeletionPlan).mockResolvedValue({ mode: "ERASE", reason: null });
    const response = await previewDeletion();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "ERASE", reason: null });
  });

  it("la suppression s'exécute et ferme la session", async () => {
    jest.mocked(deleteOwnAccount).mockResolvedValue({ mode: "ANONYMIZE", reason: "TOURNAMENTS" });
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, mode: "ANONYMIZE", reason: "TOURNAMENTS" });
    expect(deleteOwnAccount).toHaveBeenCalledWith(7);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("l'export de ses données passe la porte des conditions (seule l'absence de compte le refuse)", async () => {
    jest.mocked(exportOwnData).mockRejectedValue(new Error("PROFILE_NOT_FOUND"));
    expect((await exportData()).status).toBe(404);
    expect(exportOwnData).toHaveBeenCalledWith(7);
  });

  it("aucune de ces routes, ni la suppression côté serveur, ne consulte les conditions", () => {
    expect(assertTermsAccepted).not.toHaveBeenCalled();
    for (const path of [
      "app/api/profile/route.ts",
      "app/api/profile/deletion/route.ts",
      "app/api/profile/export/route.ts",
      "lib/server/users/account-deletion.ts",
    ]) {
      expect(readSource(path)).not.toMatch(/terms-acceptance|assertTermsAccepted|TERMS_ACCEPTANCE_REQUIRED/);
    }
  });
});
