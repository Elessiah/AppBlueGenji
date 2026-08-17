import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/teams-service");

import { POST } from "@/app/api/tournaments/[id]/forfeit/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import * as teams from "@/lib/server/teams-service";

const member = { id: 2, isAdmin: false, roles: [] } as unknown as Awaited<
  ReturnType<typeof getCurrentUser>
>;
const referee = { id: 9, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;

function req(body: unknown = {}) {
  return new Request("http://localhost/api/tournaments/5/forfeit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "5" }) };

describe("POST /api/tournaments/[id]/forfeit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (service.forfeitSurvivalTeam as jest.Mock).mockResolvedValue(undefined as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("rejette les anonymes (401)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
    expect(service.forfeitSurvivalTeam).not.toHaveBeenCalled();
  });

  it("un membre déclare le forfait de son équipe active", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (teams.getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 77 } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(service.forfeitSurvivalTeam).toHaveBeenCalledWith(5, 77);
  });

  it("refuse un membre sans équipe active (400)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (teams.getUserActiveTeam as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "NO_ACTIVE_TEAM" });
  });

  it("accepte qu'un membre cible explicitement sa propre équipe", async () => {
    // Le bouton du classement envoie toujours l'identifiant de l'équipe.
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (teams.getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 77 } as never);
    const res = await POST(req({ teamId: 77 }), params);
    expect(res.status).toBe(200);
    expect(service.forfeitSurvivalTeam).toHaveBeenCalledWith(5, 77);
  });

  it("empêche un membre de forfaiter une autre équipe (403)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (teams.getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 77 } as never);
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(403);
    expect(service.forfeitSurvivalTeam).not.toHaveBeenCalled();
  });

  it("un arbitre peut forcer le forfait d'une équipe ciblée", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(200);
    expect(service.forfeitSurvivalTeam).toHaveBeenCalledWith(5, 88);
  });

  it("remonte TEAM_ALREADY_OUT en 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    (service.forfeitSurvivalTeam as jest.Mock).mockRejectedValue(
      new Error("TEAM_ALREADY_OUT") as never,
    );
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "TEAM_ALREADY_OUT" });
  });
});
