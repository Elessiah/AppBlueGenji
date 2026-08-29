import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/teams-service");

import { POST as transferRoute } from "@/app/api/teams/[id]/transfer-ownership/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getTeamDetail, transferTeamOwnership } from "@/lib/server/teams-service";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const owner = { id: 4, isAdmin: false, roles: [] } as unknown as SessionUser;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/teams/7/transfer-ownership", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/teams/[id]/transfer-ownership", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params("7"));

    expect(res.status).toBe(401);
    expect(transferTeamOwnership).not.toHaveBeenCalled();
  });

  it.each(["0", "-3", "abc"])("rejette un identifiant d'équipe invalide (%s)", async (id) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(owner as never);

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params(id));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TEAM_ID" });
    expect(transferTeamOwnership).not.toHaveBeenCalled();
  });

  it.each([[undefined], [0], [1.5], ["9"]])(
    "rejette un destinataire invalide (%s)",
    async (newOwnerUserId) => {
      (getCurrentUser as jest.Mock).mockResolvedValue(owner as never);

      const res = await transferRoute(jsonReq({ newOwnerUserId }), params("7"));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "MISSING_USER_ID" });
      expect(transferTeamOwnership).not.toHaveBeenCalled();
    },
  );

  it("transfère la propriété et renvoie la fiche à jour", async () => {
    const detail = { team: { id: 7, name: "Dragons" }, members: [] };
    (getCurrentUser as jest.Mock).mockResolvedValue(owner as never);
    (transferTeamOwnership as jest.Mock).mockResolvedValue(undefined as never);
    (getTeamDetail as jest.Mock).mockResolvedValue(detail as never);

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params("7"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(detail);
    // Le demandeur vient de la session, jamais du corps de la requête.
    expect(transferTeamOwnership).toHaveBeenCalledWith(4, 7, 9);
    expect(getTeamDetail).toHaveBeenCalledWith(7, 4);
  });

  it.each([
    ["FORBIDDEN", 403],
    ["MEMBER_NOT_FOUND", 404],
    ["TRANSFER_TO_SELF", 400],
  ])("traduit %s en %i", async (message, status) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(owner as never);
    (transferTeamOwnership as jest.Mock).mockRejectedValue(new Error(message) as never);

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params("7"));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
    expect(getTeamDetail).not.toHaveBeenCalled();
  });

  it("retombe sur 400 pour une erreur inattendue", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(owner as never);
    (transferTeamOwnership as jest.Mock).mockRejectedValue(new Error("DB_DOWN") as never);

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params("7"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "DB_DOWN" });
  });
});
