import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { PATCH } from "@/app/api/profile/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getFullProfile, updateOwnProfile } from "@/lib/server/users-service";

const user = { id: 42 } as Awaited<ReturnType<typeof getCurrentUser>>;

function patchReq(body: unknown) {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * La sauvegarde de profil arrivée **après** la suppression du compte.
 *
 * Même course que sur l'avatar, mais celle-ci reposait l'identité entière :
 * pseudo réel, BattleTag, tag Marvel, tag Discord. Un `409` plutôt qu'un `400`
 * — la saisie était bonne, c'est l'état de la ligne qui a changé sous elle.
 */
describe("PATCH /api/profile — course avec la suppression du compte", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rend 409 et le code que l'écran sait traduire", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (updateOwnProfile as jest.Mock).mockRejectedValue(new Error("ACCOUNT_DELETED") as never);

    const res = await PATCH(patchReq({ pseudo: "Nova" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ACCOUNT_DELETED" });
    // Rien n'est relu : un profil rendu ici serait celui du compte anonymisé.
    expect(getFullProfile).not.toHaveBeenCalled();
  });

  it("garde 409 pour le pseudo déjà pris et 400 pour le reste", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);

    (updateOwnProfile as jest.Mock).mockRejectedValue(new Error("PSEUDO_ALREADY_USED") as never);
    expect((await PATCH(patchReq({ pseudo: "Nova" }))).status).toBe(409);

    (updateOwnProfile as jest.Mock).mockRejectedValue(new Error("BOOM") as never);
    expect((await PATCH(patchReq({ pseudo: "Nova" }))).status).toBe(400);
  });

  it("rend le profil relu quand l'écriture passe", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (updateOwnProfile as jest.Mock).mockResolvedValue(undefined as never);
    (getFullProfile as jest.Mock).mockResolvedValue({ profile: { pseudo: "Nova" } } as never);

    const res = await PATCH(patchReq({ pseudo: "Nova" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile: { pseudo: "Nova" } });
  });
});
