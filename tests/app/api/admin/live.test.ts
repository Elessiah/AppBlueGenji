import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/live-streams");

import { PUT as putTournamentLive } from "@/app/api/admin/tournaments/[id]/live/route";
import {
  POST as postMatchOnAir,
  PUT as putMatchLive,
} from "@/app/api/admin/matches/[matchId]/live/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  setMatchLiveConfig,
  setMatchOnAir,
  setTournamentLiveUrl,
} from "@/lib/server/tournaments/live-streams";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const player = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;
const arbitre = { id: 3, isAdmin: false, roles: ["ARBITRE"] } as unknown as SessionUser;
const caster = { id: 4, isAdmin: false, roles: ["CASTER"] } as unknown as SessionUser;
const cm = { id: 5, isAdmin: false, roles: ["COMMUNITY_MANAGER"] } as unknown as SessionUser;
const admin = { id: 1, isAdmin: true, roles: ["ADMIN"] } as unknown as SessionUser;

function req(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const tournamentReq = (body: unknown) =>
  req("http://localhost/api/admin/tournaments/5/live", "PUT", body);
const matchReq = (method: string, body: unknown) =>
  req("http://localhost/api/admin/matches/42/live", method, body);

const tournamentParams = (id: string) => ({ params: Promise.resolve({ id }) });
const matchParams = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe("PUT /api/admin/tournaments/[id]/live", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"));
    expect(res.status).toBe(401);
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"))).status,
    ).toBe(403);
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("rejette un CASTER : la chaîne officielle engage l'organisation", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: "https://twitch.tv/x" }), tournamentParams("5")))
        .status,
    ).toBe(403);
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("rejette un community manager avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"))).status,
    ).toBe(403);
  });

  it("accepte un arbitre et renvoie l'URL normalisée", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (setTournamentLiveUrl as jest.Mock).mockResolvedValue("https://twitch.tv/bg" as never);

    const res = await putTournamentLive(
      tournamentReq({ liveUrl: "twitch.tv/bg" }),
      tournamentParams("5"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liveUrl: "https://twitch.tv/bg" });
    expect(setTournamentLiveUrl).toHaveBeenCalledWith(5, "twitch.tv/bg");
  });

  it("accepte un admin", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (setTournamentLiveUrl as jest.Mock).mockResolvedValue(null as never);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"))).status,
    ).toBe(200);
  });

  it("refuse un id de tournoi invalide", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    for (const id of ["abc", "0", "-3"]) {
      const res = await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams(id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    }
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("refuse un liveUrl qui n'est pas une chaîne", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await putTournamentLive(tournamentReq({ liveUrl: 42 }), tournamentParams("5"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_STREAM_URL" });
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("traduit INVALID_STREAM_URL en 400 et TOURNAMENT_NOT_FOUND en 404", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    (setTournamentLiveUrl as jest.Mock).mockRejectedValue(new Error("INVALID_STREAM_URL") as never);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: "https://nope.fr" }), tournamentParams("5")))
        .status,
    ).toBe(400);

    (setTournamentLiveUrl as jest.Mock).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND") as never);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"))).status,
    ).toBe(404);
  });
});

describe("PUT /api/admin/matches/[matchId]/live", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      401,
    );
  });

  it("rejette un joueur sans permission live avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      403,
    );
    expect(setMatchLiveConfig).not.toHaveBeenCalled();
  });

  it("accepte un CASTER — c'est tout l'intérêt du rôle", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    (setMatchLiveConfig as jest.Mock).mockResolvedValue(undefined as never);

    const res = await putMatchLive(
      matchReq("PUT", { trigger: "MANUAL", liveUrl: "kick.com/bg" }),
      matchParams("42"),
    );

    expect(res.status).toBe(200);
    expect(setMatchLiveConfig).toHaveBeenCalledWith(42, {
      trigger: "MANUAL",
      liveUrl: "kick.com/bg",
    });
  });

  it("accepte un arbitre — il cumule tournaments et live", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);
    (setMatchLiveConfig as jest.Mock).mockResolvedValue(undefined as never);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      200,
    );
  });

  it("rejette un community manager avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      403,
    );
  });

  it("démarque le match quand trigger est absent ou null", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    (setMatchLiveConfig as jest.Mock).mockResolvedValue(undefined as never);

    await putMatchLive(matchReq("PUT", {}), matchParams("42"));
    expect(setMatchLiveConfig).toHaveBeenCalledWith(42, { trigger: null, liveUrl: null });
  });

  it("accepte le mode START_TIME", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    (setMatchLiveConfig as jest.Mock).mockResolvedValue(undefined as never);

    const res = await putMatchLive(matchReq("PUT", { trigger: "START_TIME" }), matchParams("42"));

    expect(res.status).toBe(200);
    expect(setMatchLiveConfig).toHaveBeenCalledWith(42, {
      trigger: "START_TIME",
      liveUrl: null,
    });
  });

  it("refuse un mode inconnu", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    const res = await putMatchLive(matchReq("PUT", { trigger: "SOMETIMES" }), matchParams("42"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_LIVE_TRIGGER" });
    expect(setMatchLiveConfig).not.toHaveBeenCalled();
  });

  it("refuse un liveUrl qui n'est pas une chaîne", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    const res = await putMatchLive(
      matchReq("PUT", { trigger: "AUTO", liveUrl: { href: "x" } }),
      matchParams("42"),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_STREAM_URL" });
  });

  it("refuse un id de match invalide", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    const res = await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_MATCH_ID" });
  });

  it("traduit les erreurs du service", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);

    (setMatchLiveConfig as jest.Mock).mockRejectedValue(new Error("MATCH_NOT_FOUND") as never);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      404,
    );

    (setMatchLiveConfig as jest.Mock).mockRejectedValue(new Error("INVALID_STREAM_URL") as never);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      400,
    );

    // Conflit d'état, pas de saisie : la date manque sur le match, pas dans la
    // requête — c'est un 409, comme les autres refus de l'antenne.
    (setMatchLiveConfig as jest.Mock).mockRejectedValue(
      new Error("MATCH_START_AT_REQUIRED") as never,
    );
    const res = await putMatchLive(matchReq("PUT", { trigger: "START_TIME" }), matchParams("42"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "MATCH_START_AT_REQUIRED" });
  });
});

describe("POST /api/admin/matches/[matchId]/live", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect(
      (await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"))).status,
    ).toBe(401);
  });

  it("rejette un joueur sans permission live avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    expect(
      (await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"))).status,
    ).toBe(403);
    expect(setMatchOnAir).not.toHaveBeenCalled();
  });

  it("ouvre l'antenne pour un CASTER", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    (setMatchOnAir as jest.Mock).mockResolvedValue(undefined as never);

    const res = await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onAir: true });
    expect(setMatchOnAir).toHaveBeenCalledWith(42, true);
  });

  it("referme l'antenne", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    (setMatchOnAir as jest.Mock).mockResolvedValue(undefined as never);

    await postMatchOnAir(matchReq("POST", { onAir: false }), matchParams("42"));
    expect(setMatchOnAir).toHaveBeenCalledWith(42, false);
  });

  it("exige un onAir booléen — une chaîne « false » ne doit pas ouvrir l'antenne", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);
    for (const onAir of ["true", "false", 1, 0, null, undefined]) {
      const res = await postMatchOnAir(matchReq("POST", { onAir }), matchParams("42"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_ON_AIR" });
    }
    expect(setMatchOnAir).not.toHaveBeenCalled();
  });

  it("traduit les conflits du service en 409", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(caster as never);

    (setMatchOnAir as jest.Mock).mockRejectedValue(new Error("LIVE_TRIGGER_NOT_MANUAL") as never);
    expect(
      (await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"))).status,
    ).toBe(409);

    (setMatchOnAir as jest.Mock).mockRejectedValue(new Error("MATCH_NOT_LIVE_READY") as never);
    expect(
      (await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"))).status,
    ).toBe(409);
  });
});
