import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/ghost-teams-service");
jest.mock("@/lib/server/tournaments-service");

import { GET, POST } from "@/app/api/admin/tournaments/[id]/ghost-registrations/route";
import { getCurrentUser } from "@/lib/server/auth";
import { listGhostTeams } from "@/lib/server/ghost-teams-service";
import { registerGhostTeams } from "@/lib/server/tournaments-service";
import { GHOST_BATCH_MAX } from "@/lib/shared/ghost-registration";

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

const getReq = () =>
  new Request("http://localhost/api/admin/tournaments/5/ghost-registrations");

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Erreur du moteur qui désigne l'engagé en cause, comme `registerTeamsByIds`. */
function teamScoped(code: string, teamId: number) {
  return Object.assign(new Error(code), { teamId });
}

describe("GET /api/admin/tournaments/[id]/ghost-registrations", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await GET(getReq(), params("5"))).status).toBe(401);
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    expect((await GET(getReq(), params("5"))).status).toBe(403);
    expect(listGhostTeams).not.toHaveBeenCalled();
  });

  it("rejette un identifiant de tournoi invalide avec 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    expect((await GET(getReq(), params("abc"))).status).toBe(400);
    expect(listGhostTeams).not.toHaveBeenCalled();
  });

  it("ne propose que les fantômes encore libres de ce tournoi", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (listGhostTeams as jest.Mock).mockResolvedValue([{ id: 1, name: "Alpha", logoUrl: null }] as never);

    const res = await GET(getReq(), params("5"));

    expect(res.status).toBe(200);
    // L'exclusion se fait en base : la route passe le tournoi, pas un filtre.
    expect(listGhostTeams).toHaveBeenCalledWith(5);
    expect(await res.json()).toEqual({ teams: [{ id: 1, name: "Alpha", logoUrl: null }] });
  });
});

describe("POST /api/admin/tournaments/[id]/ghost-registrations", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await POST(jsonReq({ teamIds: [4] }), params("5"));

    expect(res.status).toBe(401);
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);

    const res = await POST(jsonReq({ teamIds: [4] }), params("5"));

    expect(res.status).toBe(403);
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it("inscrit un lot d'équipes fantômes en une transaction", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (registerGhostTeams as jest.Mock).mockResolvedValue(undefined as never);

    const res = await POST(jsonReq({ teamIds: [4, 7, 9] }), params("5"));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, registered: 3 });
    expect(registerGhostTeams).toHaveBeenCalledTimes(1);
    expect(registerGhostTeams).toHaveBeenCalledWith(5, [4, 7, 9]);
  });

  it("inscrit une seule fantôme par le même chemin", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (registerGhostTeams as jest.Mock).mockResolvedValue(undefined as never);

    const res = await POST(jsonReq({ teamIds: [4] }), params("5"));

    expect(res.status).toBe(201);
    expect(registerGhostTeams).toHaveBeenCalledWith(5, [4]);
  });

  it("dédoublonne la sélection avant d'ouvrir la transaction", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (registerGhostTeams as jest.Mock).mockResolvedValue(undefined as never);

    const res = await POST(jsonReq({ teamIds: [4, 7, 4] }), params("5"));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, registered: 2 });
    expect(registerGhostTeams).toHaveBeenCalledWith(5, [4, 7]);
  });

  it.each([
    [{ teamIds: [] }, "EMPTY_TEAM_SELECTION"],
    [{}, "INVALID_TEAM_IDS"],
    [{ teamIds: 4 }, "INVALID_TEAM_IDS"],
    [{ teamIds: ["4"] }, "INVALID_TEAM_IDS"],
    [{ teamIds: [4, 0] }, "INVALID_TEAM_IDS"],
    [{ teamIds: [4, -1] }, "INVALID_TEAM_IDS"],
    [{ teamIds: [4, 1.5] }, "INVALID_TEAM_IDS"],
  ])("refuse une sélection illisible (%p) en 400", async (body, error) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    const res = await POST(jsonReq(body), params("5"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it("refuse un lot au-delà du plafond de forme", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    const teamIds = Array.from({ length: GHOST_BATCH_MAX + 1 }, (_, index) => index + 1);
    const res = await POST(jsonReq({ teamIds }), params("5"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "TOO_MANY_TEAMS" });
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it.each([
    ["REGISTRATION_CLOSED", 409],
    ["TOURNAMENT_FULL", 409],
    ["TOURNAMENT_NOT_FOUND", 404],
  ])("mappe %s sur %i, sans nommer d'engagé", async (message, status) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (registerGhostTeams as jest.Mock).mockRejectedValue(new Error(message) as never);

    const res = await POST(jsonReq({ teamIds: [4, 7] }), params("5"));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
  });

  it.each([
    ["ALREADY_REGISTERED", 409],
    ["NOT_A_GHOST_TEAM", 409],
    ["TEAM_ALREADY_DELETED", 409],
    ["TEAM_NOT_FOUND", 404],
  ])("joint l'engagé en cause à %s (%i)", async (message, status) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (registerGhostTeams as jest.Mock).mockRejectedValue(teamScoped(message, 7) as never);

    const res = await POST(jsonReq({ teamIds: [4, 7] }), params("5"));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message, teamId: 7 });
  });

  it("rejette un identifiant de tournoi invalide avec 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    const res = await POST(jsonReq({ teamIds: [4] }), params("abc"));

    expect(res.status).toBe(400);
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it("remonte une panne inattendue en 500", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (registerGhostTeams as jest.Mock).mockRejectedValue(new Error("ER_LOCK_DEADLOCK") as never);

    const res = await POST(jsonReq({ teamIds: [4] }), params("5"));

    expect(res.status).toBe(500);
  });
});
