import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/ghost-teams-service");
jest.mock("@/lib/server/tournaments-service");

import { GET, POST } from "@/app/api/admin/tournaments/[id]/ghost-registrations/route";
import { getCurrentUser } from "@/lib/server/auth";
import { isGhostTeam } from "@/lib/server/teams-service";
import { listGhostTeams } from "@/lib/server/ghost-teams-service";
import { registerGhostTeam } from "@/lib/server/tournaments-service";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const player = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;
const arbitre = { id: 3, isAdmin: false, roles: ["ARBITRE"] } as unknown as SessionUser;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/5/ghost-registrations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/admin/tournaments/[id]/ghost-registrations", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await GET()).status).toBe(401);
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    expect((await GET()).status).toBe(403);
    expect(listGhostTeams).not.toHaveBeenCalled();
  });

  it("liste les équipes fantômes pour un arbitre", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (listGhostTeams as jest.Mock).mockResolvedValue([{ id: 1, name: "Alpha", logoUrl: null }] as never);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teams: [{ id: 1, name: "Alpha", logoUrl: null }] });
  });
});

describe("POST /api/admin/tournaments/[id]/ghost-registrations", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);

    const res = await POST(jsonReq({ teamId: 4 }), params("5"));

    expect(res.status).toBe(403);
    expect(registerGhostTeam).not.toHaveBeenCalled();
  });

  it("refuse d'inscrire une équipe réelle à la place de ses joueurs", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (isGhostTeam as jest.Mock).mockResolvedValue(false as never);

    const res = await POST(jsonReq({ teamId: 4 }), params("5"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "NOT_A_GHOST_TEAM" });
    expect(registerGhostTeam).not.toHaveBeenCalled();
  });

  it("inscrit l'équipe fantôme au tournoi", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (isGhostTeam as jest.Mock).mockResolvedValue(true as never);
    (registerGhostTeam as jest.Mock).mockResolvedValue(undefined as never);

    const res = await POST(jsonReq({ teamId: 4 }), params("5"));

    expect(res.status).toBe(201);
    expect(registerGhostTeam).toHaveBeenCalledWith(5, 4);
  });

  it.each([
    ["REGISTRATION_CLOSED", 409],
    ["TOURNAMENT_FULL", 409],
    ["ALREADY_REGISTERED", 409],
    ["TOURNAMENT_NOT_FOUND", 404],
  ])("mappe %s sur %i", async (message, status) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (isGhostTeam as jest.Mock).mockResolvedValue(true as never);
    (registerGhostTeam as jest.Mock).mockRejectedValue(new Error(message) as never);

    const res = await POST(jsonReq({ teamId: 4 }), params("5"));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
  });

  it.each([
    [{ teamId: "abc" }, 400],
    [{}, 400],
  ])("rejette un teamId invalide (%p)", async (body, status) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    const res = await POST(jsonReq(body), params("5"));

    expect(res.status).toBe(status);
    expect(registerGhostTeam).not.toHaveBeenCalled();
  });

  it("rejette un identifiant de tournoi invalide avec 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    const res = await POST(jsonReq({ teamId: 4 }), params("abc"));

    expect(res.status).toBe(400);
    expect(registerGhostTeam).not.toHaveBeenCalled();
  });
});
