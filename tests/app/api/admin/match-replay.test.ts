import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-replay");

import { PUT } from "@/app/api/admin/matches/[matchId]/replay/route";
import { getCurrentUser, type AuthUser } from "@/lib/server/auth";
import { setMatchReplayUrl } from "@/lib/server/tournaments/match-replay";
import { authUser } from "../../../helpers/auth-user";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const caster = authUser({ id: 4, isAdmin: false, roles: ["CASTER"] });
const cm = authUser({ id: 5, isAdmin: false, roles: ["COMMUNITY_MANAGER"] });
const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

function req(body: unknown) {
  return new Request("http://localhost/api/admin/matches/42/replay", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT /api/admin/matches/[matchId]/replay — permissions", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await PUT(req({ replayUrl: VIDEO }), params("42"))).status).toBe(401);
    expect(setMatchReplayUrl).not.toHaveBeenCalled();
  });

  it.each<[string, AuthUser]>([
    ["un joueur", player],
    ["un community manager", cm],
  ])("rejette %s avec 403", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    expect((await PUT(req({ replayUrl: VIDEO }), params("42"))).status).toBe(403);
    expect(setMatchReplayUrl).not.toHaveBeenCalled();
  });

  it.each<[string, AuthUser]>([
    ["un admin", admin],
    ["un arbitre", arbitre],
    ["un caster", caster],
  ])("accepte %s", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(setMatchReplayUrl).mockResolvedValue(VIDEO);

    const res = await PUT(req({ replayUrl: VIDEO }), params("42"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ replayUrl: VIDEO });
    expect(setMatchReplayUrl).toHaveBeenCalledWith(42, VIDEO);
  });
});

describe("PUT /api/admin/matches/[matchId]/replay — entrées", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
  });

  it.each<[string]>([["0"], ["-1"], ["abc"], ["1.5"]])("refuse l'identifiant %s", async (id) => {
    expect((await PUT(req({ replayUrl: VIDEO }), params(id))).status).toBe(400);
    expect(setMatchReplayUrl).not.toHaveBeenCalled();
  });

  it("refuse un lien qui n'est pas une chaîne", async () => {
    const res = await PUT(req({ replayUrl: 42 }), params("42"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "INVALID_REPLAY_URL" });
    expect(setMatchReplayUrl).not.toHaveBeenCalled();
  });

  it("efface sur un corps illisible", async () => {
    jest.mocked(setMatchReplayUrl).mockResolvedValue(null);
    expect((await PUT(req("pas du json"), params("42"))).status).toBe(200);
    expect(setMatchReplayUrl).toHaveBeenCalledWith(42, null);
  });

  it.each<[string, number]>([
    ["MATCH_NOT_FOUND", 404],
    ["INVALID_REPLAY_URL", 400],
    ["MATCH_NOT_REPLAYABLE", 409],
    ["ER_SOMETHING", 500],
  ])("traduit %s en %i", async (code, status) => {
    jest.mocked(setMatchReplayUrl).mockRejectedValue(new Error(code));
    const res = await PUT(req({ replayUrl: VIDEO }), params("42"));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({
      error: status === 500 ? "MATCH_REPLAY_UPDATE_FAILED" : code,
    });
  });
});
