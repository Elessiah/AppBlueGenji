import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { PATCH } from "@/app/api/profile/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getFullProfile, updateOwnProfile } from "@/lib/server/users-service";
import { PROFILE_INPUT_ERRORS } from "@/lib/shared/profile-input-errors";

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
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

    jest.spyOn(console, "error").mockImplementation(() => undefined);
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

/**
 * Seule une liste fermée de codes sort de la route telle quelle : le message de
 * n'importe quelle exception partait sinon dans le corps du 400 —
 * `raw.replace is not a function` sur un `{"pseudo": 123}`, le message MySQL
 * d'un pseudo trop long, le `SyntaxError` d'un corps illisible.
 */
describe("PATCH /api/profile — aucun message interne ne sort", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([...PROFILE_INPUT_ERRORS])(
    "rend le refus de saisie %s tel quel, en 400",
    async (code) => {
      (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
      (updateOwnProfile as jest.Mock).mockRejectedValue(new Error(code) as never);
      const res = await PATCH(patchReq({ pseudo: "Nova" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: code });
    },
  );

  it.each([
    "raw.replace is not a function",
    "Data too long for column 'pseudo' at row 1",
    "BOOM",
  ])("remplace « %s » par le code générique", async (message) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (updateOwnProfile as jest.Mock).mockRejectedValue(new Error(message) as never);
    const res = await PATCH(patchReq({ pseudo: "Nova" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "PROFILE_UPDATE_FAILED" });
    // Le message reste au journal du serveur, pour qui doit le lire.
    expect(console.error).toHaveBeenCalled();
  });

  it("ne rend pas le message d'un corps illisible", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    const req = new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{pas du json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "PROFILE_UPDATE_FAILED" });
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });
});
