import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { PATCH } from "@/app/api/profile/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getFullProfile, updateOwnProfile } from "@/lib/server/users-service";
import { profilePatchRequest } from "../../../helpers/profile-request";
import { authUser, fullProfileResponse } from "../../../helpers/auth-user";

/**
 * Le refus du tag verrouillé, traduit en HTTP.
 *
 * **409 et non 400** : la saisie est bonne, c'est l'état du compte qui
 * l'interdit — un compte Discord rattaché possède son tag. Même distinction que
 * `DISCORD_ID_MISMATCH` sur la route de certification, et que les refus
 * d'inscription d'une équipe : un 400 enverrait corriger un champ qui n'a rien
 * d'invalide.
 */
const updateMock = updateOwnProfile as jest.MockedFunction<typeof updateOwnProfile>;
const profileMock = getFullProfile as jest.MockedFunction<typeof getFullProfile>;

function patch(body: unknown) {
  return PATCH(profilePatchRequest(body));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7, roles: [] }));
  profileMock.mockResolvedValue(fullProfileResponse({ profile: { id: 7 } }));
});

describe("PATCH /api/profile — tag Discord verrouillé", () => {
  it("rend 409 sur DISCORD_TAG_LOCKED", async () => {
    updateMock.mockRejectedValue(new Error("DISCORD_TAG_LOCKED"));

    const response = await patch({ discordPseudo: "quelquun_dautre" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("DISCORD_TAG_LOCKED");
  });

  it("rend 409 sur BATTLETAG_LOCKED, de la même nature", async () => {
    // Un compte Blizzard rattaché possède son BattleTag
    // (`lib/shared/battletag-lock.ts`) : la saisie est bonne, c'est l'état du
    // compte qui l'interdit. Sans cette ligne, le refus retombait sur le 400
    // générique et le joueur lisait « La sauvegarde a échoué » sur un refus
    // qu'on sait pourtant nommer.
    updateMock.mockRejectedValue(new Error("BATTLETAG_LOCKED"));

    const response = await patch({ overwatchBattletag: "Autre#9999" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("BATTLETAG_LOCKED");
  });

  it("rend 400 sur un BattleTag qui n'est pas du texte", async () => {
    // Une **saisie** fautive, elle, reste un 400 : la valeur doit être lue pour
    // être comparée à celle de Blizzard, et le refus est nommé plutôt que laissé
    // au `TypeError`.
    updateMock.mockRejectedValue(new Error("INVALID_OVERWATCH_BATTLETAG"));

    const response = await patch({ overwatchBattletag: 123 });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_OVERWATCH_BATTLETAG");
  });

  it("garde 409 pour le pseudo déjà pris — les deux refus d'état cohabitent", async () => {
    updateMock.mockRejectedValue(new Error("PSEUDO_ALREADY_USED"));

    expect((await patch({ pseudo: "Nova" })).status).toBe(409);
  });

  it("laisse les autres refus en 400", async () => {
    updateMock.mockRejectedValue(new Error("INVALID_PSEUDO"));

    expect((await patch({ pseudo: "" })).status).toBe(400);
  });

  it("rend le profil quand rien ne refuse", async () => {
    updateMock.mockResolvedValue(undefined);

    expect((await patch({ isAdult: true })).status).toBe(200);
  });

  it("refuse toujours l'appel anonyme avant de lire le corps", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await patch({ discordPseudo: "keryan" })).status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
