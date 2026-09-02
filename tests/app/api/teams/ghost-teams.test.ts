import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/ghost-teams-service");
jest.mock("@/lib/server/users-service");

import { POST as createTeamRoute } from "@/app/api/teams/route";
import { POST as claimRoute } from "@/app/api/teams/[id]/claim/route";
import { getCurrentUser } from "@/lib/server/auth";
import { createTeam } from "@/lib/server/teams-service";
import { claimGhostTeam, createGhostTeam } from "@/lib/server/ghost-teams-service";
import { getUserIdByPseudo } from "@/lib/server/users-service";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const player = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;
const arbitre = { id: 3, isAdmin: false, roles: ["ARBITRE"] } as unknown as SessionUser;
const admin = { id: 1, isAdmin: true, roles: ["ADMIN"] } as unknown as SessionUser;

function jsonReq(body: unknown, url = "http://localhost/api/teams") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/teams — création d'équipe fantôme", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("refuse un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);

    const res = await createTeamRoute(jsonReq({ name: "Fantômes", ghost: true }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(createGhostTeam).not.toHaveBeenCalled();
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("crée l'équipe fantôme pour un arbitre, sans en faire son équipe", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (createGhostTeam as jest.Mock).mockResolvedValue(42 as never);

    const res = await createTeamRoute(jsonReq({ name: "Fantômes", description: null, ghost: true }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ teamId: 42, ghost: true });
    expect(createGhostTeam).toHaveBeenCalledWith("Fantômes", null, null);
    // Aucune équipe « réelle » créée : l'arbitre garde son équipe active.
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("laisse le flux normal intact quand ghost n'est pas demandé", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (createTeam as jest.Mock).mockResolvedValue(11 as never);

    const res = await createTeamRoute(jsonReq({ name: "Vraie équipe" }));

    expect(res.status).toBe(201);
    expect(createTeam).toHaveBeenCalledWith(2, "Vraie équipe", null, null);
    expect(createGhostTeam).not.toHaveBeenCalled();
  });

  it("valide le nom avant de regarder la permission", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await createTeamRoute(jsonReq({ name: "ab", ghost: true }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TEAM_NAME" });
    expect(createGhostTeam).not.toHaveBeenCalled();
  });
});

describe("POST /api/teams/[id]/claim", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("3"));

    expect(res.status).toBe(401);
    expect(claimGhostTeam).not.toHaveBeenCalled();
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("3"));

    expect(res.status).toBe(403);
    expect(claimGhostTeam).not.toHaveBeenCalled();
  });

  it("attribue l'équipe au joueur résolu par son pseudo", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (getUserIdByPseudo as jest.Mock).mockResolvedValue(9 as never);
    (claimGhostTeam as jest.Mock).mockResolvedValue(undefined as never);

    const res = await claimRoute(jsonReq({ pseudo: "  Kery  " }), params("3"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ownerUserId: 9 });
    expect(getUserIdByPseudo).toHaveBeenCalledWith("Kery");
    expect(claimGhostTeam).toHaveBeenCalledWith(3, 9);
  });

  it("renvoie 404 pour un pseudo inconnu", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (getUserIdByPseudo as jest.Mock).mockResolvedValue(null as never);

    const res = await claimRoute(jsonReq({ pseudo: "Inconnu" }), params("3"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "USER_NOT_FOUND" });
  });

  it("renvoie 409 si l'équipe n'est pas fantôme", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (getUserIdByPseudo as jest.Mock).mockResolvedValue(9 as never);
    (claimGhostTeam as jest.Mock).mockRejectedValue(new Error("NOT_A_GHOST_TEAM") as never);

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("3"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "NOT_A_GHOST_TEAM" });
  });

  it("renvoie 409 si le joueur a déjà une équipe", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (getUserIdByPseudo as jest.Mock).mockResolvedValue(9 as never);
    (claimGhostTeam as jest.Mock).mockRejectedValue(new Error("USER_ALREADY_IN_TEAM") as never);

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("3"));

    expect(res.status).toBe(409);
  });

  it("rejette un identifiant d'équipe invalide avec 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("abc"));

    expect(res.status).toBe(400);
    expect(claimGhostTeam).not.toHaveBeenCalled();
  });
});
