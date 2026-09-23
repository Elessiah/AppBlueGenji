import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-schedule");

import { PUT } from "@/app/api/admin/matches/[matchId]/schedule/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setMatchStartAt } from "@/lib/server/tournaments/match-schedule";
import { authUser } from "../../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const caster = authUser({ id: 4, isAdmin: false, roles: ["CASTER"] });
const cm = authUser({ id: 5, isAdmin: false, roles: ["COMMUNITY_MANAGER"] });
const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

function req(body: unknown) {
  return new Request("http://localhost/api/admin/matches/42/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT /api/admin/matches/[matchId]/schedule — permissions", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));
    expect(res.status).toBe(401);
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("rejette un joueur sans permission avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(403);
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("rejette un caster : il diffuse, il ne programme pas", async () => {
    // `CASTER` porte `live` mais pas `tournaments` : il pose la chaîne d'un
    // match, il ne décide pas de son horaire.
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(403);
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("rejette un community manager avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);
    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(403);
  });

  it("accepte un arbitre", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchStartAt).mockResolvedValue("2026-08-29T18:30:00.000Z");

    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ startAt: "2026-08-29T18:30:00.000Z" });
    expect(setMatchStartAt).toHaveBeenCalledWith(42, "2026-08-29T18:30:00Z");
  });

  it("accepte un admin", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setMatchStartAt).mockResolvedValue(null);

    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(200);
    expect(setMatchStartAt).toHaveBeenCalledWith(42, null);
  });
});

describe("PUT /api/admin/matches/[matchId]/schedule — corps et erreurs", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
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
    jest.mocked(setMatchStartAt).mockResolvedValue(null);
    const res = await PUT(
      new Request("http://localhost/api/admin/matches/42/schedule", { method: "PUT" }),
      params("42"),
    );
    expect(res.status).toBe(200);
    expect(setMatchStartAt).toHaveBeenCalledWith(42, null);
  });

  it("remonte 404 sur un match introuvable", async () => {
    jest.mocked(setMatchStartAt).mockRejectedValue(new Error("MATCH_NOT_FOUND"));
    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));
    expect(res.status).toBe(404);
  });

  it("remonte 400 sur une date refusée par le service", async () => {
    jest.mocked(setMatchStartAt).mockRejectedValue(
      new Error("INVALID_MATCH_START_AT"),
    );
    const res = await PUT(req({ startAt: "demain" }), params("42"));
    expect(res.status).toBe(400);
  });

  it("remonte 500 sur une panne inattendue", async () => {
    jest.mocked(setMatchStartAt).mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));
    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));
    expect(res.status).toBe(500);
  });
});
