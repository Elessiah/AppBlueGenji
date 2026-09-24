import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/seeding");

import { GET, PATCH } from "@/app/api/admin/tournaments/[id]/seeding/route";
import { getCurrentUser } from "@/lib/server/auth";
import { loadSeedingBoard, reorderSeeding } from "@/lib/server/tournaments/seeding";
import { authUser } from "../../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });

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
    expect(loadSeedingBoard).not.toHaveBeenCalled();
  });

  it("renvoie l'ordre courant pour un arbitre", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(loadSeedingBoard).mockResolvedValue(board);

    const res = await GET(getReq(), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(board);
    expect(loadSeedingBoard).toHaveBeenCalledWith(5);
  });

  it("renvoie 404 pour un tournoi inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(loadSeedingBoard).mockResolvedValue(null);

    expect((await GET(getReq(), params("5"))).status).toBe(404);
  });
});

describe("PATCH /api/admin/tournaments/[id]/seeding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    expect((await PATCH(patchReq({ teamIds: [1, 2] }), params("5"))).status).toBe(403);
    expect(reorderSeeding).not.toHaveBeenCalled();
  });

  it("enregistre le nouvel ordre et renvoie l'état à jour", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(reorderSeeding).mockResolvedValue(undefined);
    jest.mocked(loadSeedingBoard).mockResolvedValue(board);

    const res = await PATCH(patchReq({ teamIds: [4, 9] }), params("5"));

    expect(res.status).toBe(200);
    expect(reorderSeeding).toHaveBeenCalledWith(5, [4, 9]);
    expect(await res.json()).toEqual(board);
  });

  it("renvoie 409 quand un score a déjà été saisi", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(reorderSeeding).mockRejectedValue(new Error("SEEDING_LOCKED"));

    const res = await PATCH(patchReq({ teamIds: [4, 9] }), params("5"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "SEEDING_LOCKED" });
  });

  it("renvoie 400 quand l'ordre proposé n'est pas une permutation", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(reorderSeeding).mockRejectedValue(new Error("INVALID_SEED_ORDER"));

    expect((await PATCH(patchReq({ teamIds: [4] }), params("5"))).status).toBe(400);
  });

  it.each([
    [{ teamIds: [] }],
    [{ teamIds: "nope" }],
    [{ teamIds: [1, 0] }],
    [{ teamIds: [1, "x"] }],
    [{}],
  ])("rejette un corps invalide (%p) sans toucher à la base", async (body) => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const res = await PATCH(patchReq(body), params("5"));

    expect(res.status).toBe(400);
    expect(reorderSeeding).not.toHaveBeenCalled();
  });

  it("rejette un identifiant de tournoi invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    expect((await PATCH(patchReq({ teamIds: [1, 2] }), params("abc"))).status).toBe(400);
    expect(reorderSeeding).not.toHaveBeenCalled();
  });
});
