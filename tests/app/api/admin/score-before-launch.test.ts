import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST as resolveRoute } from "@/app/api/admin/matches/[matchId]/resolve/route";
import { PATCH as scoresRoute } from "@/app/api/admin/matches/[matchId]/scores/route";
import { getCurrentUser } from "@/lib/server/auth";
import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";
import { mapsFor } from "../../../helpers/match-maps";

/**
 * Aucun score avant le lancement, arbitrage compris : le refus du service
 * (`MATCH_NOT_IN_LAUNCH`) sort en 409 — la saisie est bien formée, c'est l'état
 * du match qui la refuse — et jamais en 500.
 */
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/admin/matches/42/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ matchId: "42" }) };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
});

describe("routes d'arbitrage — score avant le lancement", () => {
  it("« Enregistrer » refusé en 409 MATCH_NOT_IN_LAUNCH", async () => {
    jest.mocked(adminSaveMatchScores).mockRejectedValue(new Error("MATCH_NOT_IN_LAUNCH"));
    const res = await scoresRoute(req("PATCH", { maps: mapsFor(1, 0) }), params);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("MATCH_NOT_IN_LAUNCH");
  });

  it("« Valider le résultat » refusé en 409 MATCH_NOT_IN_LAUNCH", async () => {
    jest.mocked(adminResolveMatch).mockRejectedValue(new Error("MATCH_NOT_IN_LAUNCH"));
    const res = await resolveRoute(req("POST", { maps: mapsFor(3, 0) }), params);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("MATCH_NOT_IN_LAUNCH");
  });
});
