import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/match-launch-info");

import { POST as readyPost } from "@/app/api/matches/[matchId]/ready/route";
import { DELETE as casterDelete, POST as casterPost } from "@/app/api/matches/[matchId]/caster/route";
import { POST as launchPost } from "@/app/api/admin/matches/[matchId]/launch/route";
import { PUT as hostPut } from "@/app/api/admin/matches/[matchId]/host/route";
import { GET as launchesGet } from "@/app/api/me/match-launches/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  claimMatchCast,
  forceLaunchMatch,
  releaseMatchCast,
  setMatchHost,
  setMatchReady,
} from "@/lib/server/tournaments/match-launch";
import { listViewerMatchLaunches } from "@/lib/server/tournaments/match-launch-info";
import { authUser } from "../../helpers/auth-user";

const player = authUser({ id: 2, roles: [] });
const caster = authUser({ id: 4, roles: ["CASTER"] });
const arbitre = authUser({ id: 3, roles: ["ARBITRE"] });

const params = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

function jsonRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/matches/42", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/matches/[matchId]/ready", () => {
  it("rejette un visiteur anonyme", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await readyPost(jsonRequest("POST", { ready: true }), params("42"))).status).toBe(401);
    expect(setMatchReady).not.toHaveBeenCalled();
  });

  it("valide l'identifiant et le corps", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await readyPost(jsonRequest("POST", { ready: true }), params("abc"))).status).toBe(400);
    expect((await readyPost(jsonRequest("POST", { ready: "oui" }), params("42"))).status).toBe(400);
    expect((await readyPost(jsonRequest("POST", {}), params("42"))).status).toBe(400);
    expect(setMatchReady).not.toHaveBeenCalled();
  });

  it("transmet le « Prêt » et rend l'issue", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(setMatchReady).mockResolvedValue({ launched: true });
    const res = await readyPost(jsonRequest("POST", { ready: true }), params("42"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ launched: true });
    expect(setMatchReady).toHaveBeenCalledWith(42, 2, true);
  });

  it.each<[string, number]>([
    ["MATCH_NOT_FOUND", 404],
    ["TOURNAMENT_NOT_RUNNING", 409],
    ["MATCH_ALREADY_LAUNCHED", 409],
    ["MATCH_NOT_IN_LOBBY", 409],
    ["NOT_MATCH_PARTY", 403],
    ["NOT_TEAM_READY_ROLE", 403],
  ])("traduit %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(setMatchReady).mockRejectedValue(new Error(code));
    const res = await readyPost(jsonRequest("POST", { ready: false }), params("42"));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: code });
  });

  it("ne laisse pas fuir le message d'une vraie panne", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(setMatchReady).mockRejectedValue(new Error("ER_LOCK_DEADLOCK: base bg_prod"));
    const res = await readyPost(jsonRequest("POST", { ready: true }), params("42"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "MATCH_READY_FAILED" });
  });
});

describe("POST / DELETE /api/matches/[matchId]/caster", () => {
  it("rejette un visiteur anonyme", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await casterPost(jsonRequest("POST"), params("42"))).status).toBe(401);
    expect((await casterDelete(jsonRequest("DELETE"), params("42"))).status).toBe(401);
  });

  it("transmet la permission `live` au service, qui décide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(claimMatchCast).mockResolvedValue();
    expect((await casterPost(jsonRequest("POST"), params("42"))).status).toBe(200);
    expect(claimMatchCast).toHaveBeenCalledWith(42, 4, true);

    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(claimMatchCast).mockRejectedValue(new Error("NOT_CASTER"));
    expect((await casterPost(jsonRequest("POST"), params("42"))).status).toBe(403);
    expect(claimMatchCast).toHaveBeenLastCalledWith(42, 2, false);
  });

  it.each<[string, number]>([
    ["CASTER_IDENTITY_REQUIRED", 409],
    ["MATCH_ALREADY_CASTED", 409],
    ["CASTER_IS_PLAYER", 409],
    ["MATCH_ALREADY_COMPLETED", 409],
    ["MATCH_NOT_FOUND", 404],
  ])("traduit le refus %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(claimMatchCast).mockRejectedValue(new Error(code));
    expect((await casterPost(jsonRequest("POST"), params("42"))).status).toBe(status);
  });

  it("laisse l'arbitrage retirer un caster, pas un joueur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(releaseMatchCast).mockResolvedValue();
    expect((await casterDelete(jsonRequest("DELETE"), params("42"))).status).toBe(200);
    expect(releaseMatchCast).toHaveBeenCalledWith(42, 3, true);

    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(releaseMatchCast).mockRejectedValue(new Error("NOT_MATCH_CASTER"));
    expect((await casterDelete(jsonRequest("DELETE"), params("42"))).status).toBe(403);
    expect(releaseMatchCast).toHaveBeenLastCalledWith(42, 2, false);
  });
});

describe("POST /api/admin/matches/[matchId]/launch", () => {
  it("est réservé à l'arbitrage", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await launchPost(jsonRequest("POST"), params("42"))).status).toBe(401);
    for (const user of [player, caster]) {
      jest.mocked(getCurrentUser).mockResolvedValue(user);
      expect((await launchPost(jsonRequest("POST"), params("42"))).status).toBe(403);
    }
    expect(forceLaunchMatch).not.toHaveBeenCalled();
  });

  it("lance pour un arbitre, et traduit les refus", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(forceLaunchMatch).mockResolvedValue();
    expect((await launchPost(jsonRequest("POST"), params("42"))).status).toBe(200);
    expect(forceLaunchMatch).toHaveBeenCalledWith(42);

    jest.mocked(forceLaunchMatch).mockRejectedValue(new Error("MATCH_ALREADY_LAUNCHED"));
    expect((await launchPost(jsonRequest("POST"), params("42"))).status).toBe(409);
    expect((await launchPost(jsonRequest("POST"), params("0"))).status).toBe(400);
  });
});

describe("PUT /api/admin/matches/[matchId]/host", () => {
  it("est réservé à l'arbitrage", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    expect((await hostPut(jsonRequest("PUT", { teamId: 20 }), params("42"))).status).toBe(403);
    expect(setMatchHost).not.toHaveBeenCalled();
  });

  it("valide l'équipe hôte et accepte `null`", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchHost).mockResolvedValue();
    for (const teamId of ["20", 1.5, -1, 0]) {
      expect((await hostPut(jsonRequest("PUT", { teamId }), params("42"))).status).toBe(400);
    }
    expect((await hostPut(jsonRequest("PUT", { teamId: 20 }), params("42"))).status).toBe(200);
    expect(setMatchHost).toHaveBeenLastCalledWith(42, 20);
    expect((await hostPut(jsonRequest("PUT", { teamId: null }), params("42"))).status).toBe(200);
    expect(setMatchHost).toHaveBeenLastCalledWith(42, null);
  });

  it("traduit une équipe étrangère au match en 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchHost).mockRejectedValue(new Error("INVALID_HOST_TEAM"));
    expect((await hostPut(jsonRequest("PUT", { teamId: 99 }), params("42"))).status).toBe(400);
  });
});

describe("GET /api/me/match-launches", () => {
  it("rejette un visiteur anonyme", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await launchesGet()).status).toBe(401);
    expect(listViewerMatchLaunches).not.toHaveBeenCalled();
  });

  it("rend les matchs du lecteur connecté", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 77 }));
    jest.mocked(listViewerMatchLaunches).mockResolvedValue([]);
    const res = await launchesGet();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ launches: [] });
    expect(listViewerMatchLaunches).toHaveBeenCalledWith(expect.objectContaining({ id: 77 }));
  });

  it("répond 500 sans détail sur une panne de lecture", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 78 }));
    jest.mocked(listViewerMatchLaunches).mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await launchesGet();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "MATCH_LAUNCH_READ_FAILED" });
  });
});
