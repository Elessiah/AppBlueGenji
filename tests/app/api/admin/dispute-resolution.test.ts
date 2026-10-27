import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/tournaments/staff-action-logs");

import { POST as resolveRoute } from "@/app/api/admin/matches/[matchId]/resolve/route";
import { getCurrentUser } from "@/lib/server/auth";
import { adminResolveMatch } from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";
import { mapsFor } from "../../../helpers/match-maps";

/**
 * Litige de score (`docs/features/SCORE_DISPUTE_LOCK.md`) : la saisie des deux
 * équipes est verrouillée, seul l'arbitrage tranche — par la route d'arbitrage,
 * gardée par `can(user, "tournaments")`.
 */
const referee = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const admin = authUser({ id: 1, isAdmin: true, roles: [] });
const captain = authUser({ id: 2, isAdmin: false, roles: [] });

function req(body: unknown) {
  return new Request("http://localhost/api/admin/matches/42/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ matchId: "42" }) };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(adminResolveMatch).mockResolvedValue(undefined);
});

describe("POST /api/admin/matches/[matchId]/resolve — litige de score", () => {
  it.each([
    ["un arbitre", referee],
    ["un administrateur", admin],
  ])("%s tranche le litige en fixant le score final", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    const res = await resolveRoute(req({ maps: mapsFor(2, 1) }), params);
    expect(res.status).toBe(200);
    expect(adminResolveMatch).toHaveBeenCalledWith(42, expect.objectContaining({ userId: user.id }), { id: user.id, pseudo: user.pseudo });
  });

  it("un capitaine engagé dans le match ne peut pas trancher son propre litige", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(captain);
    const res = await resolveRoute(req({ maps: mapsFor(2, 1) }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("refuse un visiteur sans session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await resolveRoute(req({ maps: mapsFor(2, 1) }), params);
    expect(res.status).toBe(401);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });
});
