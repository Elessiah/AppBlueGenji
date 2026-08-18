import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/seeding");

import { GET, PATCH } from "@/app/api/admin/tournaments/[id]/seeding/route";
import { getCurrentUser } from "@/lib/server/auth";
import { loadSeedingBoard, reorderSeeding } from "@/lib/server/tournaments/seeding";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const player = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;
const arbitre = { id: 3, isAdmin: false, roles: ["ARBITRE"] } as unknown as SessionUser;

const board = {
  entries: [{ teamId: 4, teamName: "Alpha", seed: 1 }],
  lockReason: null,
  manualSeeding: true,
};

function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/5/seeding", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const getReq = () => new Request("http://localhost/api/admin/tournaments/5/seeding");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/admin/tournaments/[id]/seeding", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await GET(getReq(), params("5"))).status).toBe(401);
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    expect((await GET(getReq(), params("5"))).status).toBe(403);
    expect(loadSeedingBoard).not.toHaveBeenCalled();
  });

  it("renvoie l'ordre courant pour un arbitre", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (loadSeedingBoard as jest.Mock).mockResolvedValue(board as never);

    const res = await GET(getReq(), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(board);
    expect(loadSeedingBoard).toHaveBeenCalledWith(5);
  });

  it("renvoie 404 pour un tournoi inconnu", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (loadSeedingBoard as jest.Mock).mockResolvedValue(null as never);

    expect((await GET(getReq(), params("5"))).status).toBe(404);
  });
});

describe("PATCH /api/admin/tournaments/[id]/seeding", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);

    expect((await PATCH(patchReq({ teamIds: [1, 2] }), params("5"))).status).toBe(403);
    expect(reorderSeeding).not.toHaveBeenCalled();
  });

  it("enregistre le nouvel ordre et renvoie l'état à jour", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (reorderSeeding as jest.Mock).mockResolvedValue(undefined as never);
    (loadSeedingBoard as jest.Mock).mockResolvedValue(board as never);

    const res = await PATCH(patchReq({ teamIds: [4, 9] }), params("5"));

    expect(res.status).toBe(200);
    expect(reorderSeeding).toHaveBeenCalledWith(5, [4, 9]);
    expect(await res.json()).toEqual(board);
  });

  it("renvoie 409 quand un score a déjà été saisi", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (reorderSeeding as jest.Mock).mockRejectedValue(new Error("SEEDING_LOCKED") as never);

    const res = await PATCH(patchReq({ teamIds: [4, 9] }), params("5"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "SEEDING_LOCKED" });
  });

  it("renvoie 400 quand l'ordre proposé n'est pas une permutation", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (reorderSeeding as jest.Mock).mockRejectedValue(new Error("INVALID_SEED_ORDER") as never);

    expect((await PATCH(patchReq({ teamIds: [4] }), params("5"))).status).toBe(400);
  });

  it.each([
    [{ teamIds: [] }],
    [{ teamIds: "nope" }],
    [{ teamIds: [1, 0] }],
    [{ teamIds: [1, "x"] }],
    [{}],
  ])("rejette un corps invalide (%p) sans toucher à la base", async (body) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    const res = await PATCH(patchReq(body), params("5"));

    expect(res.status).toBe(400);
    expect(reorderSeeding).not.toHaveBeenCalled();
  });

  it("rejette un identifiant de tournoi invalide", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    expect((await PATCH(patchReq({ teamIds: [1, 2] }), params("abc"))).status).toBe(400);
    expect(reorderSeeding).not.toHaveBeenCalled();
  });
});
