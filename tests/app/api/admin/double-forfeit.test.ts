import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST as resolveRoute } from "@/app/api/admin/matches/[matchId]/resolve/route";
import { PATCH as scoresRoute } from "@/app/api/admin/matches/[matchId]/scores/route";
import { getCurrentUser } from "@/lib/server/auth";
import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments-service";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const arbitre = { id: 3, isAdmin: false, roles: ["ARBITRE"] } as unknown as SessionUser;
const player = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;

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
  (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
  (adminResolveMatch as jest.Mock).mockResolvedValue(undefined as never);
});

describe("POST /api/admin/matches/[matchId]/resolve — double forfait", () => {
  it("tranche le match en double forfait", async () => {
    const res = await resolveRoute(req("POST", { doubleForfeit: true }), params);

    expect(res.status).toBe(200);
    expect(adminResolveMatch).toHaveBeenCalledWith(42, undefined, undefined, undefined, true);
  });

  it("refuse un double forfait accompagné d'un score", async () => {
    const res = await resolveRoute(
      req("POST", { doubleForfeit: true, team1Score: 1, team2Score: 0 }),
      params,
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("DOUBLE_FORFEIT_EXCLUSIVE");
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("refuse un double forfait accompagné d'un forfait nominatif", async () => {
    const res = await resolveRoute(req("POST", { doubleForfeit: true, forfeitTeamId: 7 }), params);
    expect(res.status).toBe(400);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("refuse une valeur qui n'est pas un booléen", async () => {
    const res = await resolveRoute(req("POST", { doubleForfeit: "yes" }), params);
    expect(res.status).toBe(400);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("traite `doubleForfeit: null` comme une absence, comme les autres champs", async () => {
    const res = await resolveRoute(
      req("POST", { doubleForfeit: null, forfeitTeamId: null, team1Score: 3, team2Score: 1 }),
      params,
    );
    expect(res.status).toBe(200);
    expect(adminResolveMatch).toHaveBeenCalledWith(42, 3, 1, undefined, false);
  });

  it("traite `doubleForfeit: false` comme une saisie ordinaire", async () => {
    const res = await resolveRoute(
      req("POST", { doubleForfeit: false, team1Score: 3, team2Score: 1 }),
      params,
    );
    expect(res.status).toBe(200);
    expect(adminResolveMatch).toHaveBeenCalledWith(42, 3, 1, undefined, false);
  });

  it("réserve le geste à la permission tournois", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    const res = await resolveRoute(req("POST", { doubleForfeit: true }), params);
    expect(res.status).toBe(403);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("rend 409 quand la cascade toucherait une rencontre jouée", async () => {
    (adminResolveMatch as jest.Mock).mockRejectedValue(
      new Error("CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES") as never,
    );
    const res = await resolveRoute(req("POST", { doubleForfeit: true }), params);
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/admin/matches/[matchId]/scores — double forfait", () => {
  it("renvoie vers la validation : un double forfait n'est pas un avancement", async () => {
    const res = await scoresRoute(req("PATCH", { doubleForfeit: true }), params);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("DOUBLE_FORFEIT_RESOLVE_ONLY");
    expect(adminSaveMatchScores).not.toHaveBeenCalled();
  });
});
