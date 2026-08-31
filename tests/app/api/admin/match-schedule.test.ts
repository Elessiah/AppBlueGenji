import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-schedule");

import { PUT } from "@/app/api/admin/matches/[matchId]/schedule/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setMatchStartAt } from "@/lib/server/tournaments/match-schedule";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const player = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;
const arbitre = { id: 3, isAdmin: false, roles: ["ARBITRE"] } as unknown as SessionUser;
const caster = { id: 4, isAdmin: false, roles: ["CASTER"] } as unknown as SessionUser;
const cm = { id: 5, isAdmin: false, roles: ["COMMUNITY_MANAGER"] } as unknown as SessionUser;
const admin = { id: 1, isAdmin: true, roles: ["ADMIN"] } as unknown as SessionUser;

function req(body: unknown) {
  return new Request("http://localhost/api/admin/matches/42/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe("PUT /api/admin/matches/[matchId]/schedule — permissions", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));
    expect(res.status).toBe(401);
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("rejette un joueur sans permission avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(403);
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("rejette un caster : il diffuse, il ne programme pas", async () => {
    // `CASTER` porte `live` mais pas `tournaments` : il pose la chaîne d'un
    // match, il ne décide pas de son horaire.
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(403);
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("rejette un community manager avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);
    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(403);
  });

  it("accepte un arbitre", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (setMatchStartAt as jest.Mock).mockResolvedValue("2026-08-29T18:30:00.000Z" as never);

    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ startAt: "2026-08-29T18:30:00.000Z" });
    expect(setMatchStartAt).toHaveBeenCalledWith(42, "2026-08-29T18:30:00Z");
  });

  it("accepte un admin", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (setMatchStartAt as jest.Mock).mockResolvedValue(null as never);

    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(200);
    expect(setMatchStartAt).toHaveBeenCalledWith(42, null);
  });
});

describe("PUT /api/admin/matches/[matchId]/schedule — corps et erreurs", () => {
  beforeEach(() => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
  });

  it("refuse un identifiant de match invalide", async () => {
    for (const raw of ["0", "-3", "abc", "1.5"]) {
      const res = await PUT(req({ startAt: null }), params(raw));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "INVALID_MATCH_ID" });
    }
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("refuse une date qui n'est pas une chaîne", async () => {
    const res = await PUT(req({ startAt: 1772000000 }), params("42"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "INVALID_MATCH_START_AT" });
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("traite un corps vide comme un effacement", async () => {
    (setMatchStartAt as jest.Mock).mockResolvedValue(null as never);
    const res = await PUT(
      new Request("http://localhost/api/admin/matches/42/schedule", { method: "PUT" }),
      params("42"),
    );
    expect(res.status).toBe(200);
    expect(setMatchStartAt).toHaveBeenCalledWith(42, null);
  });

  it("remonte 404 sur un match introuvable", async () => {
    (setMatchStartAt as jest.Mock).mockRejectedValue(new Error("MATCH_NOT_FOUND") as never);
    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));
    expect(res.status).toBe(404);
  });

  it("remonte 400 sur une date refusée par le service", async () => {
    (setMatchStartAt as jest.Mock).mockRejectedValue(
      new Error("INVALID_MATCH_START_AT") as never,
    );
    const res = await PUT(req({ startAt: "demain" }), params("42"));
    expect(res.status).toBe(400);
  });

  it("remonte 500 sur une panne inattendue", async () => {
    (setMatchStartAt as jest.Mock).mockRejectedValue(new Error("ER_LOCK_DEADLOCK") as never);
    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));
    expect(res.status).toBe(500);
  });
});
