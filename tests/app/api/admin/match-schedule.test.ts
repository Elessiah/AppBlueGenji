import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-schedule");

import { PUT } from "@/app/api/admin/matches/[matchId]/schedule/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setMatchStartAt } from "@/lib/server/tournaments/match-schedule";
import { authUser } from "../../../helpers/auth-user";
import { MATCH_SCHEDULE_WRITE_RULE } from "@/lib/server/api-guard";

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
    expect(setMatchStartAt).toHaveBeenCalledWith(42, "2026-08-29T18:30:00Z", { id: arbitre.id, pseudo: arbitre.pseudo });
  });

  it("accepte un admin", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setMatchStartAt).mockResolvedValue(null);

    expect((await PUT(req({ startAt: null }), params("42"))).status).toBe(200);
    expect(setMatchStartAt).toHaveBeenCalledWith(42, null, { id: admin.id, pseudo: admin.pseudo });
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

  it("refuse un corps vide, illisible ou sans startAt : effacer un horaire prévient les joueurs", async () => {
    const json = { "content-type": "application/json" };
    const bodies = [
      new Request("http://localhost/api/admin/matches/42/schedule", { method: "PUT", headers: json }),
      new Request("http://localhost/api/admin/matches/42/schedule", { method: "PUT", headers: json, body: "{\"startAt\": \"2026" }),
      req(null),
      req({}),
      req({ start: null }),
    ];
    for (const request of bodies) {
      const res = await PUT(request, params("42"));
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain("INVALID_MATCH_START_AT");
    }
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("rend le refus de la lecture : 415 hors JSON, 413 au-delà du plafond, jamais « date invalide »", async () => {
    const plain = await PUT(
      new Request("http://localhost/api/admin/matches/42/schedule", { method: "PUT", body: "{\"startAt\": null}" }),
      params("42"),
    );
    expect(plain.status).toBe(415);
    await expect(plain.json()).resolves.toEqual({ error: "UNSUPPORTED_CONTENT_TYPE" });

    const heavy = await PUT(req({ startAt: null, pad: "x".repeat(300 * 1024) }), params("42"));
    expect(heavy.status).toBe(413);
    await expect(heavy.json()).resolves.toEqual({ error: "PAYLOAD_TOO_LARGE" });
    expect(setMatchStartAt).not.toHaveBeenCalled();
  });

  it("efface l'horaire sur un null explicite, ou une chaîne vide", async () => {
    jest.mocked(setMatchStartAt).mockResolvedValue(null);
    for (const startAt of [null, ""]) {
      const res = await PUT(req({ startAt }), params("42"));
      expect(res.status).toBe(200);
    }
    expect(setMatchStartAt).toHaveBeenNthCalledWith(1, 42, null, { id: admin.id, pseudo: admin.pseudo });
    expect(setMatchStartAt).toHaveBeenNthCalledWith(2, 42, "", { id: admin.id, pseudo: admin.pseudo });
  });

  it("plafonne les gestes d'un arbitre : chacun écrit à tous les joueurs du match", async () => {
    // Un autre compte : le seau de l'arbitre des autres tests reste intact.
    const looping = authUser({ id: 991, isAdmin: true, roles: ["ADMIN"] });
    jest.mocked(getCurrentUser).mockResolvedValue(looping);
    jest.mocked(setMatchStartAt).mockResolvedValue("2026-08-29T18:30:00.000Z");
    // Un plateau entier (126 manches en double élimination à 64) passe d'une traite.
    expect(MATCH_SCHEDULE_WRITE_RULE.limit).toBeGreaterThanOrEqual(2 * 126);
    for (let call = 0; call < MATCH_SCHEDULE_WRITE_RULE.limit; call += 1) {
      expect((await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"))).status).toBe(200);
    }
    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).toContain("TOO_MANY_REQUESTS");
    expect(setMatchStartAt).toHaveBeenCalledTimes(MATCH_SCHEDULE_WRITE_RULE.limit);
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

  it("remonte 500 sur une panne inattendue, avec un code et jamais le texte de l'erreur", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest
      .mocked(setMatchStartAt)
      .mockRejectedValue(new Error("Deadlock found when trying to get lock; try restarting transaction"));
    const res = await PUT(req({ startAt: "2026-08-29T18:30:00Z" }), params("42"));
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("MATCH_SCHEDULE_UPDATE_FAILED");
    expect(body).not.toContain("Deadlock");
    // Le texte reste dans pm2.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
