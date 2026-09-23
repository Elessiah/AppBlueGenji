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
import { authUser } from "../../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

function jsonReq(body: unknown, url = "http://localhost/api/teams") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/teams — création d'équipe fantôme", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuse un joueur sans permission tournois avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const res = await createTeamRoute(jsonReq({ name: "Fantômes", ghost: true }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(createGhostTeam).not.toHaveBeenCalled();
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("crée l'équipe fantôme pour un arbitre, sans en faire son équipe", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(createGhostTeam).mockResolvedValue(42);

    const res = await createTeamRoute(jsonReq({ name: "Fantômes", description: null, ghost: true }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ teamId: 42, ghost: true });
    expect(createGhostTeam).toHaveBeenCalledWith("Fantômes", null, null);
    // Aucune équipe « réelle » créée : l'arbitre garde son équipe active.
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("laisse le flux normal intact quand ghost n'est pas demandé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(createTeam).mockResolvedValue(11);

    const res = await createTeamRoute(jsonReq({ name: "Vraie équipe" }));

    expect(res.status).toBe(201);
    expect(createTeam).toHaveBeenCalledWith(2, "Vraie équipe", null, null);
    expect(createGhostTeam).not.toHaveBeenCalled();
  });

  it("valide le nom avant de regarder la permission", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await createTeamRoute(jsonReq({ name: "ab", ghost: true }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TEAM_NAME" });
    expect(createGhostTeam).not.toHaveBeenCalled();
  });
});

describe("POST /api/teams/[id]/claim", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("3"));

    expect(res.status).toBe(401);
    expect(claimGhostTeam).not.toHaveBeenCalled();
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("3"));

    expect(res.status).toBe(403);
    expect(claimGhostTeam).not.toHaveBeenCalled();
  });

  it("attribue l'équipe au joueur résolu par son pseudo", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(getUserIdByPseudo).mockResolvedValue(9);
    jest.mocked(claimGhostTeam).mockResolvedValue(undefined);

    const res = await claimRoute(jsonReq({ pseudo: "  Kery  " }), params("3"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ownerUserId: 9 });
    expect(getUserIdByPseudo).toHaveBeenCalledWith("Kery");
    expect(claimGhostTeam).toHaveBeenCalledWith(3, 9);
  });

  it("renvoie 404 pour un pseudo inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(getUserIdByPseudo).mockResolvedValue(null);

    const res = await claimRoute(jsonReq({ pseudo: "Inconnu" }), params("3"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "USER_NOT_FOUND" });
  });

  it("renvoie 409 si l'équipe n'est pas fantôme", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(getUserIdByPseudo).mockResolvedValue(9);
    jest.mocked(claimGhostTeam).mockRejectedValue(new Error("NOT_A_GHOST_TEAM"));

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("3"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "NOT_A_GHOST_TEAM" });
  });

  it("renvoie 409 si le joueur a déjà une équipe", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(getUserIdByPseudo).mockResolvedValue(9);
    jest.mocked(claimGhostTeam).mockRejectedValue(new Error("USER_ALREADY_IN_TEAM"));

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("3"));

    expect(res.status).toBe(409);
  });

  it("rejette un identifiant d'équipe invalide avec 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await claimRoute(jsonReq({ pseudo: "Kery" }), params("abc"));

    expect(res.status).toBe(400);
    expect(claimGhostTeam).not.toHaveBeenCalled();
  });
});
