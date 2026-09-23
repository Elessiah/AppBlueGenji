import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { PATCH } from "@/app/api/profile/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getFullProfile, updateOwnProfile } from "@/lib/server/users-service";

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
  return PATCH(
    new Request("http://localhost:3000/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7, roles: [] } as never);
  profileMock.mockResolvedValue({ profile: { id: 7 } } as never);
});

describe("PATCH /api/profile — tag Discord verrouillé", () => {
  it("rend 409 sur DISCORD_TAG_LOCKED", async () => {
    updateMock.mockRejectedValue(new Error("DISCORD_TAG_LOCKED") as never);

    const response = await patch({ discordPseudo: "quelquun_dautre" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("DISCORD_TAG_LOCKED");
  });

  it("garde 409 pour le pseudo déjà pris — les deux refus d'état cohabitent", async () => {
    updateMock.mockRejectedValue(new Error("PSEUDO_ALREADY_USED") as never);

    expect((await patch({ pseudo: "Nova" })).status).toBe(409);
  });

  it("laisse les autres refus en 400", async () => {
    updateMock.mockRejectedValue(new Error("INVALID_PSEUDO") as never);

    expect((await patch({ pseudo: "" })).status).toBe(400);
  });

  it("rend le profil quand rien ne refuse", async () => {
    updateMock.mockResolvedValue(undefined as never);

    expect((await patch({ isAdult: true })).status).toBe(200);
  });

  it("refuse toujours l'appel anonyme avant de lire le corps", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    expect((await patch({ discordPseudo: "keryan" })).status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
