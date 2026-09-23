import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/teams-service");

import { POST as transferRoute } from "@/app/api/teams/[id]/transfer-ownership/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getTeamDetail, transferTeamOwnership } from "@/lib/server/teams-service";
import { authUser } from "../../../helpers/auth-user";
import { teamDetailResponse } from "../../../helpers/team-detail";

const owner = authUser({ id: 4, isAdmin: false, roles: [] });

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/teams/7/transfer-ownership", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/teams/[id]/transfer-ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params("7"));

    expect(res.status).toBe(401);
    expect(transferTeamOwnership).not.toHaveBeenCalled();
  });

  it.each(["0", "-3", "abc"])("rejette un identifiant d'équipe invalide (%s)", async (id) => {
    jest.mocked(getCurrentUser).mockResolvedValue(owner);

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params(id));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TEAM_ID" });
    expect(transferTeamOwnership).not.toHaveBeenCalled();
  });

  it.each([[undefined], [0], [1.5], ["9"]])(
    "rejette un destinataire invalide (%s)",
    async (newOwnerUserId) => {
      jest.mocked(getCurrentUser).mockResolvedValue(owner);

      const res = await transferRoute(jsonReq({ newOwnerUserId }), params("7"));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "MISSING_USER_ID" });
      expect(transferTeamOwnership).not.toHaveBeenCalled();
    },
  );

  it("transfère la propriété et renvoie la fiche à jour", async () => {
    const detail = teamDetailResponse({ team: { id: 7, name: "Dragons" } });
    jest.mocked(getCurrentUser).mockResolvedValue(owner);
    jest.mocked(transferTeamOwnership).mockResolvedValue(undefined);
    jest.mocked(getTeamDetail).mockResolvedValue(detail);

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
    jest.mocked(getCurrentUser).mockResolvedValue(owner);
    jest.mocked(transferTeamOwnership).mockRejectedValue(new Error(message));

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params("7"));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
    expect(getTeamDetail).not.toHaveBeenCalled();
  });

  it("retombe sur 400 pour une erreur inattendue", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(owner);
    jest.mocked(transferTeamOwnership).mockRejectedValue(new Error("DB_DOWN"));

    const res = await transferRoute(jsonReq({ newOwnerUserId: 9 }), params("7"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "DB_DOWN" });
  });
});
