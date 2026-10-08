import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET } from "@/app/api/spectator/tournaments/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { clearCache } from "@/lib/server/cache";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { SPECTATOR_READ_RULE } from "@/lib/server/api-guard";
import { resetSpectatorLoad } from "@/lib/server/spectator-load";
import {
  SPECTATOR_MAX_POLL_MS,
  SPECTATOR_POLL_HEADER,
  SPECTATOR_PRE_LAUNCH_POLL_MS,
  SPECTATOR_RUNNING_POLL_MS,
} from "@/lib/shared/spectator-view";
import type { TournamentSnapshot } from "@/lib/shared/types";
import { tournamentSnapshot } from "../../../helpers/tournament-detail";
import { tournamentCard } from "../../../helpers/tournament-card";
import { bracketMatch } from "../../../helpers/bracket-match";

/**
 * Lecture publique d'un tournoi : la route est appelée pour de vrai, cache,
 * plafond de débit et mesure de charge compris — seule la base est simulée.
 */

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(id = "5", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/spectator/tournaments/${id}`, {
    headers: { "x-forwarded-for": "203.0.113.7", ...headers },
  });
}

function snapshot(overrides: Partial<TournamentSnapshot> = {}): TournamentSnapshot {
  return tournamentSnapshot({
    card: tournamentCard({ id: 5, state: "RUNNING" }),
    matches: [
      bracketMatch({
        id: 1,
        tournamentId: 5,
        status: "COMPLETED",
        maps: [{ mapNumber: 1, replayCode: "SECRET1", team1Score: 3, team2Score: 1 }],
      }),
    ],
    version: "v42",
    ...overrides,
  });
}

const mockedSnapshot = jest.mocked(getVisibleTournamentSnapshot);

beforeEach(() => {
  clearCache();
  resetRateLimit();
  resetSpectatorLoad();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
  resetSpectatorLoad();
});

describe("GET /api/spectator/tournaments/[id]", () => {
  it("sert l'instantané sans les codes de replay, avec son empreinte et la cadence accordée", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"v42"');
    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(SPECTATOR_RUNNING_POLL_MS));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as TournamentSnapshot;
    expect(body.card.id).toBe(5);
    expect(body.matches[0].maps[0]).toMatchObject({ replayCode: "", team1Score: 3, team2Score: 1 });
    expect(JSON.stringify(body)).not.toContain("SECRET1");
  });

  it("passe par la porte de visibilité sans aucun droit, et ne lit jamais la session", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    await GET(req(), params("5"));

    expect(mockedSnapshot).toHaveBeenCalledWith(5);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("répond 304 sans corps quand le client détient déjà cette version", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    const res = await GET(req("5", { "if-none-match": '"v42"' }), params("5"));

    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(SPECTATOR_RUNNING_POLL_MS));
  });

  it("reconnaît une empreinte faible ou une liste d'empreintes", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    expect((await GET(req("5", { "if-none-match": 'W/"v42"' }), params("5"))).status).toBe(304);
    expect((await GET(req("5", { "if-none-match": '"v1", "v42"' }), params("5"))).status).toBe(304);
    expect((await GET(req("5", { "if-none-match": '"v41"' }), params("5"))).status).toBe(200);
  });

  it("mutualise la lecture : deux visiteurs, une seule passe en base", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    await GET(req(), params("5"));
    await GET(req("5", { "x-forwarded-for": "198.51.100.9" }), params("5"));

    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
  });

  it("espace la relecture avant le coup d'envoi", async () => {
    mockedSnapshot.mockResolvedValue(snapshot({ card: tournamentCard({ id: 5, state: "REGISTRATION" }) }));

    const res = await GET(req(), params("5"));

    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(SPECTATOR_PRE_LAUNCH_POLL_MS));
  });

  it("ne demande plus de relecture d'un tournoi terminé", async () => {
    mockedSnapshot.mockResolvedValue(snapshot({ card: tournamentCard({ id: 5, state: "FINISHED" }) }));

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(200);
    expect(res.headers.has(SPECTATOR_POLL_HEADER)).toBe(false);
  });

  it("répond 404 pour un tournoi absent ou pas encore publié, sans dire lequel", async () => {
    mockedSnapshot.mockResolvedValue(null);

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
  });

  it("refuse un identifiant qui n'en est pas un, sans interroger la base", async () => {
    const res = await GET(req("abc"), params("abc"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(mockedSnapshot).not.toHaveBeenCalled();
  });

  it("fait reculer le visiteur au plus loin quand la base ne répond pas", async () => {
    mockedSnapshot.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.2:3306"));

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe(String(SPECTATOR_MAX_POLL_MS / 1000));
    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(SPECTATOR_MAX_POLL_MS));
    // Seul un code sort : ni hôte ni port de la base.
    expect(await res.json()).toEqual({ error: "TOURNAMENT_LOAD_FAILED" });
  });

  it("plafonne les lectures d'une même adresse", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    for (let i = 0; i < SPECTATOR_READ_RULE.limit; i += 1) {
      expect((await GET(req(), params("5"))).status).toBe(200);
    }
    const refused = await GET(req(), params("5"));

    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
    // Une autre adresse passe toujours.
    expect((await GET(req("5", { "x-forwarded-for": "198.51.100.9" }), params("5"))).status).toBe(200);
  });
});
