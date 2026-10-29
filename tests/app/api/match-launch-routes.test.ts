import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/match-launch-info");
jest.mock("@/lib/server/tournaments/staff-action-logs");

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
import { listViewerMatchLaunches, loadViewerMatchContacts } from "@/lib/server/tournaments/match-launch-info";
import { GET as contactsGet } from "@/app/api/matches/[matchId]/contacts/route";
import type { LaunchSide, MatchLaunchInfo } from "@/lib/shared/match-launch";
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
    expect(claimMatchCast).toHaveBeenCalledWith(42, 4, true, { liveUrl: null });

    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(claimMatchCast).mockRejectedValue(new Error("NOT_CASTER"));
    expect((await casterPost(jsonRequest("POST"), params("42"))).status).toBe(403);
    expect(claimMatchCast).toHaveBeenLastCalledWith(42, 2, false, { liveUrl: null });
  });

  it("transmet le stream choisi : co-cast d'un stream, ou stream séparé avec ou sans lien", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(claimMatchCast).mockResolvedValue();
    expect((await casterPost(jsonRequest("POST", { streamId: 7 }), params("42"))).status).toBe(200);
    expect(claimMatchCast).toHaveBeenLastCalledWith(42, 4, true, { streamId: 7 });
    expect((await casterPost(jsonRequest("POST", { liveUrl: "https://twitch.tv/voix" }), params("42"))).status).toBe(200);
    expect(claimMatchCast).toHaveBeenLastCalledWith(42, 4, true, { liveUrl: "https://twitch.tv/voix" });
    expect((await casterPost(jsonRequest("POST", { liveUrl: null }), params("42"))).status).toBe(200);
    expect(claimMatchCast).toHaveBeenLastCalledWith(42, 4, true, { liveUrl: null });
  });

  it("refuse un corps illisible au lieu de le prendre pour un corps vide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const broken = new Request("http://localhost/api/matches/42", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ pas du json",
    });

    const res = await casterPost(broken, params("42"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "INVALID_CAST_TARGET" });
    expect(claimMatchCast).not.toHaveBeenCalled();
  });

  it("refuse un corps non déclaré en JSON (415) et accepte l'absence de corps", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const text = new Request("http://localhost/api/matches/42", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect((await casterPost(text, params("42"))).status).toBe(415);
    expect(claimMatchCast).not.toHaveBeenCalled();

    const none = new Request("http://localhost/api/matches/42", { method: "POST" });
    expect((await casterPost(none, params("42"))).status).toBe(200);
    expect(claimMatchCast).toHaveBeenLastCalledWith(42, 4, true, { liveUrl: null });
  });

  it("refuse un choix de stream mal formé, sans appeler le service", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const bodies: unknown[] = [
      { streamId: 7, liveUrl: "https://twitch.tv/voix" },
      { streamId: "7" },
      { streamId: 0 },
      { streamId: 1.5 },
      { liveUrl: 12 },
    ];
    for (const body of bodies) {
      const res = await casterPost(jsonRequest("POST", body), params("42"));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "INVALID_CAST_TARGET" });
    }
    expect(claimMatchCast).not.toHaveBeenCalled();
  });

  it.each<[string, number]>([
    ["CASTER_IDENTITY_REQUIRED", 409],
    ["STREAM_NOT_FOUND", 409],
    ["INVALID_STREAM_URL", 400],
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
    expect(releaseMatchCast).toHaveBeenCalledWith(42, 3, true, 3);

    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(releaseMatchCast).mockRejectedValue(new Error("NOT_MATCH_CASTER"));
    expect((await casterDelete(jsonRequest("DELETE"), params("42"))).status).toBe(403);
    expect(releaseMatchCast).toHaveBeenLastCalledWith(42, 2, false, 2);
  });

  it("désigne le caster retiré par `?userId=` (co-casters), le lecteur sinon", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(releaseMatchCast).mockResolvedValue();
    const res = await casterDelete(new Request("http://localhost/api/matches/42/caster?userId=9", { method: "DELETE" }), params("42"));
    expect(res.status).toBe(200);
    expect(releaseMatchCast).toHaveBeenCalledWith(42, 3, true, 9);
    // Un caster qui retire un autre caster sans l'arbitrage : refus du service.
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(releaseMatchCast).mockRejectedValue(new Error("NOT_MATCH_CASTER"));
    expect((await casterDelete(new Request("http://localhost/api/matches/42/caster?userId=9", { method: "DELETE" }), params("42"))).status).toBe(403);
    expect(releaseMatchCast).toHaveBeenLastCalledWith(42, 4, false, 9);
  });

  it("refuse un `?userId=` qui n'est pas un identifiant", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    for (const raw of ["abc", "0", "-3", "1.5", ""]) {
      const res = await casterDelete(new Request(`http://localhost/api/matches/42/caster?userId=${raw}`, { method: "DELETE" }), params("42"));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "INVALID_USER_ID" });
    }
    expect(releaseMatchCast).not.toHaveBeenCalled();
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

describe("GET /api/matches/[matchId]/contacts", () => {
  const side = (teamId: number, name: string): LaunchSide => ({
    teamId,
    name,
    logoUrl: null,
    isGhost: false,
    isSolo: false,
    ready: false,
    contacts: [],
    contactsShown: true,
  });
  const info: MatchLaunchInfo = {
    matchId: 42,
    tournamentId: 7,
    tournamentName: "Coupe",
    phase: "SCHEDULED",
    startAt: "2026-10-20T18:00:00.000Z",
    lobbyOpenedAt: null,
    autoLaunchAt: null,
    launchedAt: null,
    hostTeamId: 10,
    team1: side(10, "Alpha"),
    team2: side(20, "Bravo"),
    casters: [],
    referee: null,
    selfManaged: false,
    viewer: {
      role: "TEAM1",
      canDeclareReady: true,
      ready: false,
      isReferee: false,
      isCaster: false,
      earlyContacts: true,
    },
  };
  const request = () => new Request("http://localhost/api/matches/42/contacts");

  it("rejette un visiteur anonyme", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await contactsGet(request(), params("42"))).status).toBe(401);
    expect(loadViewerMatchContacts).not.toHaveBeenCalled();
  });

  it("valide l'identifiant du match", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 81 }));
    expect((await contactsGet(request(), params("abc"))).status).toBe(400);
    expect(loadViewerMatchContacts).not.toHaveBeenCalled();
  });

  it("rend la présentation du match à une de ses parties", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 82 }));
    jest.mocked(loadViewerMatchContacts).mockResolvedValue(info);
    const res = await contactsGet(request(), params("42"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ launch: info });
    expect(loadViewerMatchContacts).toHaveBeenCalledWith(expect.objectContaining({ id: 82 }), 42);
  });

  it("refuse par un seul code qui n'est pas partie du match, ou un match sans contacts", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 83 }));
    jest.mocked(loadViewerMatchContacts).mockResolvedValue(null);
    const res = await contactsGet(request(), params("42"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "MATCH_CONTACTS_UNAVAILABLE" });
  });

  it("a son propre quota : la modale qui interroge ne l'épuise pas, et il plafonne à trente par minute", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 85 }));
    jest.mocked(listViewerMatchLaunches).mockResolvedValue([]);
    jest.mocked(loadViewerMatchContacts).mockResolvedValue(info);
    for (let i = 0; i < 60; i++) await launchesGet();
    expect((await launchesGet()).status).toBe(429);
    for (let i = 0; i < 30; i++) expect((await contactsGet(request(), params("42"))).status).toBe(200);
    expect((await contactsGet(request(), params("42"))).status).toBe(429);
  });

  it("répond 500 sans détail sur une panne de lecture", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 84 }));
    jest.mocked(loadViewerMatchContacts).mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await contactsGet(request(), params("42"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "MATCH_CONTACTS_READ_FAILED" });
  });
});
