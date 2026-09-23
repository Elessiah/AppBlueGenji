import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/ghost-teams-service");
jest.mock("@/lib/server/tournaments-service");

import { GET, POST } from "@/app/api/admin/tournaments/[id]/ghost-registrations/route";
import { getCurrentUser } from "@/lib/server/auth";
import { listGhostTeams } from "@/lib/server/ghost-teams-service";
import { registerGhostTeams } from "@/lib/server/tournaments-service";
import { GHOST_BATCH_MAX } from "@/lib/shared/ghost-registration";
import { authUser } from "../../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });

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
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(getReq(), params("5"))).status).toBe(401);
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await GET(getReq(), params("5"))).status).toBe(403);
    expect(listGhostTeams).not.toHaveBeenCalled();
  });

  it("rejette un identifiant de tournoi invalide avec 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    expect((await GET(getReq(), params("abc"))).status).toBe(400);
    expect(listGhostTeams).not.toHaveBeenCalled();
  });

  it("ne propose que les fantômes encore libres de ce tournoi", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(listGhostTeams).mockResolvedValue([{ id: 1, name: "Alpha", logoUrl: null }]);

    const res = await GET(getReq(), params("5"));

    expect(res.status).toBe(200);
    // L'exclusion se fait en base : la route passe le tournoi, pas un filtre.
    expect(listGhostTeams).toHaveBeenCalledWith(5);
    expect(await res.json()).toEqual({ teams: [{ id: 1, name: "Alpha", logoUrl: null }] });
  });
});

describe("POST /api/admin/tournaments/[id]/ghost-registrations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await POST(jsonReq({ teamIds: [4] }), params("5"));

    expect(res.status).toBe(401);
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const res = await POST(jsonReq({ teamIds: [4] }), params("5"));

    expect(res.status).toBe(403);
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it("inscrit un lot d'équipes fantômes en une transaction", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(registerGhostTeams).mockResolvedValue(undefined);

    const res = await POST(jsonReq({ teamIds: [4, 7, 9] }), params("5"));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, registered: 3 });
    expect(registerGhostTeams).toHaveBeenCalledTimes(1);
    expect(registerGhostTeams).toHaveBeenCalledWith(5, [4, 7, 9]);
  });

  it("inscrit une seule fantôme par le même chemin", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(registerGhostTeams).mockResolvedValue(undefined);

    const res = await POST(jsonReq({ teamIds: [4] }), params("5"));

    expect(res.status).toBe(201);
    expect(registerGhostTeams).toHaveBeenCalledWith(5, [4]);
  });

  it("dédoublonne la sélection avant d'ouvrir la transaction", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(registerGhostTeams).mockResolvedValue(undefined);

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
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const res = await POST(jsonReq(body), params("5"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it("refuse un lot au-delà du plafond de forme", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

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
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(registerGhostTeams).mockRejectedValue(new Error(message));

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
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(registerGhostTeams).mockRejectedValue(teamScoped(message, 7));

    const res = await POST(jsonReq({ teamIds: [4, 7] }), params("5"));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message, teamId: 7 });
  });

  it("rejette un identifiant de tournoi invalide avec 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const res = await POST(jsonReq({ teamIds: [4] }), params("abc"));

    expect(res.status).toBe(400);
    expect(registerGhostTeams).not.toHaveBeenCalled();
  });

  it("remonte une panne inattendue en 500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(registerGhostTeams).mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));

    const res = await POST(jsonReq({ teamIds: [4] }), params("5"));

    expect(res.status).toBe(500);
  });
});
