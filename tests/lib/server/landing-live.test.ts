import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/tournaments/live-streams");

import { getLandingLive } from "@/lib/server/landing-service";
import { clearCache } from "@/lib/server/cache";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import { findBroadcastingTournament } from "@/lib/server/tournaments/live-streams";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

function card(id: number, name: string): TournamentCard {
  return {
    id,
    name,
    description: null,
    format: "SINGLE",
    game: "OW2",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 8,
    state: "RUNNING",
    startVisibilityAt: "2026-08-01T00:00:00.000Z",
    registrationOpenAt: "2026-08-01T00:00:00.000Z",
    registrationCloseAt: "2026-08-10T00:00:00.000Z",
    startAt: "2026-08-20T00:00:00.000Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    liveUrl: null,
  };
}

function buckets(running: TournamentCard[]): TournamentBuckets {
  return { upcoming: [], registration: [], running, finished: [] };
}

/** Ligne de match telle que la lit `getLandingLive`. */
function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    bracket: "UPPER",
    round_number: 1,
    match_number: 1,
    status: "READY",
    team1_name: "Alpha",
    team2_name: "Bravo",
    team1_score: null,
    team2_score: null,
    start_at: null,
    live_trigger: null,
    live_url: null,
    live_started_at: null,
    ...overrides,
  };
}

async function mockDb(rows: unknown[]) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({
    execute: jest.fn().mockResolvedValue([rows] as never),
  } as never);
}

/**
 * Sert la liste publique par la même porte que la production.
 *
 * `getLandingLive` ne prend plus de paniers en argument : son résultat est
 * mutualisé sous une clé fixe (`landing:live`), et une clé de cache ne peut pas
 * représenter un argument — un appelant passant une liste filtrée servirait son
 * direct à tous les visiteurs. Les tests injectent donc là où la production lit.
 */
async function liveFrom(list: TournamentBuckets) {
  (listTournamentBuckets as jest.Mock).mockResolvedValue(list as never);
  return getLandingLive();
}

beforeEach(() => {
  jest.clearAllMocks();
  // Le direct et la liste publique sont mutualisés (`lib/server/cache.ts`) :
  // sans purge, le premier cas servirait sa réponse à tous les suivants.
  clearCache();
});
afterEach(() => {
  clearCache();
  jest.restoreAllMocks();
});

describe("getLandingLive", () => {
  it("renvoie null sans tournoi en cours", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue(null as never);
    await mockDb([]);

    expect(await liveFrom(buckets([]))).toBeNull();
  });

  it("n'expose aucune cible tant que personne n'est à l'antenne", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue(null as never);
    await mockDb([matchRow()]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    // C'est la condition d'apparition du bouton d'accueil : pas de diffusion,
    // pas de bouton.
    expect(live?.stream).toBeNull();
    expect(live?.tournament.id).toBe(1);
  });

  it("expose la chaîne officielle quand un match est à l'antenne", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue({
      tournamentId: 1,
      url: "https://twitch.tv/bg",
    } as never);
    await mockDb([matchRow({ live_trigger: "AUTO", live_url: "https://twitch.tv/bg" })]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    expect(live?.stream).toEqual({
      tournamentId: 1,
      tournamentName: "Coupe A",
      url: "https://twitch.tv/bg",
    });
  });

  it("retient le tournoi qui diffuse, pas le plus récent", async () => {
    // Sans cette préférence, la carte live et le bouton désigneraient deux
    // tournois différents quand plusieurs tournent en parallèle.
    (findBroadcastingTournament as jest.Mock).mockResolvedValue({
      tournamentId: 2,
      url: "https://kick.com/bg",
    } as never);
    await mockDb([matchRow({ live_trigger: "AUTO" })]);

    const live = await liveFrom(buckets([card(1, "Coupe A"), card(2, "Coupe B")]));

    expect(live?.tournament.id).toBe(2);
    expect(live?.stream?.tournamentId).toBe(2);
  });

  it("retombe sur le premier tournoi en cours si le diffuseur n'est pas listé", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue({
      tournamentId: 99,
      url: "https://twitch.tv/bg",
    } as never);
    await mockDb([matchRow()]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    expect(live?.tournament.id).toBe(1);
    // Le tournoi affiché n'est pas celui qui diffuse : pas de bouton non plus.
    expect(live?.stream).toBeNull();
  });

  it("met en avant le match réellement à l'antenne, pas le premier jouable", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue(null as never);
    await mockDb([
      matchRow({ id: 100 }),
      matchRow({ id: 101, live_trigger: "AUTO", live_url: "https://twitch.tv/bg" }),
    ]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    expect(live?.currentMatch?.id).toBe(101);
    expect(live?.currentMatch?.liveState).toBe("LIVE");
    expect(live?.currentMatch?.liveUrl).toBe("https://twitch.tv/bg");
  });

  it("retombe sur le premier match jouable quand aucun n'est à l'antenne", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue(null as never);
    await mockDb([matchRow({ id: 100, status: "COMPLETED" }), matchRow({ id: 101 })]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    expect(live?.currentMatch?.id).toBe(101);
    expect(live?.currentMatch?.liveState).toBe("OFF");
  });

  it("expose l'état programmé d'un match casté hors antenne", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue(null as never);
    await mockDb([matchRow({ live_trigger: "MANUAL" })]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    expect(live?.currentMatch?.liveState).toBe("SCHEDULED");
  });

  it("met en avant un match dont l'heure de début est passée", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue(null as never);
    await mockDb([
      matchRow({
        live_trigger: "START_TIME",
        start_at: new Date(Date.now() - 60_000),
        live_url: "https://twitch.tv/bg",
      }),
    ]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    expect(live?.currentMatch?.liveState).toBe("LIVE");
  });

  it("laisse programmé un match dont l'heure n'est pas atteinte", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue(null as never);
    await mockDb([
      matchRow({ live_trigger: "START_TIME", start_at: new Date(Date.now() + 3_600_000) }),
    ]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    expect(live?.currentMatch?.liveState).toBe("SCHEDULED");
  });

  it("écarte un lien de match hors liste blanche", async () => {
    (findBroadcastingTournament as jest.Mock).mockResolvedValue(null as never);
    await mockDb([matchRow({ live_trigger: "AUTO", live_url: "https://exemple.com/live" })]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    expect(live?.currentMatch?.liveUrl).toBeNull();
  });

  it("survit à une panne du résolveur de diffusion", async () => {
    (findBroadcastingTournament as jest.Mock).mockRejectedValue(new Error("boom") as never);
    await mockDb([matchRow()]);

    const live = await liveFrom(buckets([card(1, "Coupe A")]));

    // La carte live reste servie : une panne de diffusion ne doit pas vider la
    // page d'accueil.
    expect(live?.tournament.id).toBe(1);
    expect(live?.stream).toBeNull();
  });
});
