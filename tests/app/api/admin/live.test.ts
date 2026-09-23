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
import { authUser } from "../../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const caster = authUser({ id: 4, isAdmin: false, roles: ["CASTER"] });
const cm = authUser({ id: 5, isAdmin: false, roles: ["COMMUNITY_MANAGER"] });
const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

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

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT /api/admin/tournaments/[id]/live", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"));
    expect(res.status).toBe(401);
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("rejette un joueur sans permission tournois avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"))).status,
    ).toBe(403);
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("rejette un CASTER : la chaîne officielle engage l'organisation", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: "https://twitch.tv/x" }), tournamentParams("5")))
        .status,
    ).toBe(403);
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("rejette un community manager avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"))).status,
    ).toBe(403);
  });

  it("accepte un arbitre et renvoie l'URL normalisée", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTournamentLiveUrl).mockResolvedValue("https://twitch.tv/bg");

    const res = await putTournamentLive(
      tournamentReq({ liveUrl: "twitch.tv/bg" }),
      tournamentParams("5"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liveUrl: "https://twitch.tv/bg" });
    expect(setTournamentLiveUrl).toHaveBeenCalledWith(5, "twitch.tv/bg");
  });

  it("accepte un admin", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setTournamentLiveUrl).mockResolvedValue(null);
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"))).status,
    ).toBe(200);
  });

  it("refuse un id de tournoi invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    for (const id of ["abc", "0", "-3"]) {
      const res = await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams(id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    }
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("refuse un liveUrl qui n'est pas une chaîne", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await putTournamentLive(tournamentReq({ liveUrl: 42 }), tournamentParams("5"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_STREAM_URL" });
    expect(setTournamentLiveUrl).not.toHaveBeenCalled();
  });

  it("traduit INVALID_STREAM_URL en 400 et TOURNAMENT_NOT_FOUND en 404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    jest.mocked(setTournamentLiveUrl).mockRejectedValue(new Error("INVALID_STREAM_URL"));
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: "https://nope.fr" }), tournamentParams("5")))
        .status,
    ).toBe(400);

    jest.mocked(setTournamentLiveUrl).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    expect(
      (await putTournamentLive(tournamentReq({ liveUrl: null }), tournamentParams("5"))).status,
    ).toBe(404);
  });
});

describe("PUT /api/admin/matches/[matchId]/live", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      401,
    );
  });

  it("rejette un joueur sans permission live avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      403,
    );
    expect(setMatchLiveConfig).not.toHaveBeenCalled();
  });

  it("accepte un CASTER — c'est tout l'intérêt du rôle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setMatchLiveConfig).mockResolvedValue(undefined);

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
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setMatchLiveConfig).mockResolvedValue(undefined);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      200,
    );
  });

  it("rejette un community manager avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      403,
    );
  });

  it("démarque le match quand trigger est absent ou null", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setMatchLiveConfig).mockResolvedValue(undefined);

    await putMatchLive(matchReq("PUT", {}), matchParams("42"));
    expect(setMatchLiveConfig).toHaveBeenCalledWith(42, { trigger: null, liveUrl: null });
  });

  it("accepte le mode START_TIME", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setMatchLiveConfig).mockResolvedValue(undefined);

    const res = await putMatchLive(matchReq("PUT", { trigger: "START_TIME" }), matchParams("42"));

    expect(res.status).toBe(200);
    expect(setMatchLiveConfig).toHaveBeenCalledWith(42, {
      trigger: "START_TIME",
      liveUrl: null,
    });
  });

  it("refuse un mode inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const res = await putMatchLive(matchReq("PUT", { trigger: "SOMETIMES" }), matchParams("42"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_LIVE_TRIGGER" });
    expect(setMatchLiveConfig).not.toHaveBeenCalled();
  });

  it("refuse un liveUrl qui n'est pas une chaîne", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const res = await putMatchLive(
      matchReq("PUT", { trigger: "AUTO", liveUrl: { href: "x" } }),
      matchParams("42"),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_STREAM_URL" });
  });

  it("refuse un id de match invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const res = await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_MATCH_ID" });
  });

  it("traduit les erreurs du service", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    jest.mocked(setMatchLiveConfig).mockRejectedValue(new Error("MATCH_NOT_FOUND"));
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      404,
    );

    jest.mocked(setMatchLiveConfig).mockRejectedValue(new Error("INVALID_STREAM_URL"));
    expect((await putMatchLive(matchReq("PUT", { trigger: "AUTO" }), matchParams("42"))).status).toBe(
      400,
    );

    // Conflit d'état, pas de saisie : la date manque sur le match, pas dans la
    // requête — c'est un 409, comme les autres refus de l'antenne.
    jest.mocked(setMatchLiveConfig).mockRejectedValue(
      new Error("MATCH_START_AT_REQUIRED"),
    );
    const res = await putMatchLive(matchReq("PUT", { trigger: "START_TIME" }), matchParams("42"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "MATCH_START_AT_REQUIRED" });
  });
});

describe("POST /api/admin/matches/[matchId]/live", () => {
  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect(
      (await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"))).status,
    ).toBe(401);
  });

  it("rejette un joueur sans permission live avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect(
      (await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"))).status,
    ).toBe(403);
    expect(setMatchOnAir).not.toHaveBeenCalled();
  });

  it("ouvre l'antenne pour un CASTER", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setMatchOnAir).mockResolvedValue(undefined);

    const res = await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onAir: true });
    expect(setMatchOnAir).toHaveBeenCalledWith(42, true);
  });

  it("referme l'antenne", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setMatchOnAir).mockResolvedValue(undefined);

    await postMatchOnAir(matchReq("POST", { onAir: false }), matchParams("42"));
    expect(setMatchOnAir).toHaveBeenCalledWith(42, false);
  });

  it("exige un onAir booléen — une chaîne « false » ne doit pas ouvrir l'antenne", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    for (const onAir of ["true", "false", 1, 0, null, undefined]) {
      const res = await postMatchOnAir(matchReq("POST", { onAir }), matchParams("42"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_ON_AIR" });
    }
    expect(setMatchOnAir).not.toHaveBeenCalled();
  });

  it("traduit les conflits du service en 409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    jest.mocked(setMatchOnAir).mockRejectedValue(new Error("LIVE_TRIGGER_NOT_MANUAL"));
    expect(
      (await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"))).status,
    ).toBe(409);

    jest.mocked(setMatchOnAir).mockRejectedValue(new Error("MATCH_NOT_LIVE_READY"));
    expect(
      (await postMatchOnAir(matchReq("POST", { onAir: true }), matchParams("42"))).status,
    ).toBe(409);
  });
});
