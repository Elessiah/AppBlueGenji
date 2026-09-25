import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments-service");

import { getLandingCalendar } from "@/lib/server/landing-service";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { tournamentCard } from "../../helpers/tournament-card";

/**
 * « Prochains événements » n'a plus le droit de montrer un tournoi déjà lancé
 * — il serait daté dans le passé, sous un titre qui promet ce qui **arrive**.
 * Contrairement à `activeTournamentCards` (la grille principale), le panier
 * `running` en est donc exclu ici.
 */

function card(id: number, state: TournamentCard["state"], startAt: string): TournamentCard {
  return tournamentCard({
    id,
    name: `Tournoi ${id}`,
    description: null,
    format: "SINGLE",
    game: "OW",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 4,
    state,
    startVisibilityAt: "2026-01-01T00:00:00.000Z",
    registrationOpenAt: "2026-01-01T00:00:00.000Z",
    registrationCloseAt: "2026-01-05T00:00:00.000Z",
    startAt,
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    liveUrl: null,
  });
}

function buckets(partial: Partial<TournamentBuckets>): TournamentBuckets {
  return { upcoming: [], registration: [], running: [], finished: [], ...partial };
}

describe("getLandingCalendar", () => {
  it("exclut les tournois déjà en cours", async () => {
    const running = card(1, "RUNNING", "2026-01-10T00:00:00.000Z");
    const upcoming = card(2, "UPCOMING", "2026-02-01T00:00:00.000Z");
    jest.mocked(listTournamentBuckets).mockResolvedValue(buckets({ running: [running], upcoming: [upcoming] }));

    const events = await getLandingCalendar();

    expect(events.map((event) => event.tournamentId)).toEqual([2]);
  });

  it("mélange à venir et inscriptions ouvertes, triés par date de début", async () => {
    const later = card(1, "UPCOMING", "2026-03-01T00:00:00.000Z");
    const sooner = card(2, "REGISTRATION", "2026-02-01T00:00:00.000Z");
    jest.mocked(listTournamentBuckets).mockResolvedValue(buckets({ upcoming: [later], registration: [sooner] }));

    const events = await getLandingCalendar();

    expect(events.map((event) => event.tournamentId)).toEqual([2, 1]);
  });

  it("n'inclut jamais un tournoi terminé", async () => {
    const finished = card(1, "FINISHED", "2026-01-01T00:00:00.000Z");
    jest.mocked(listTournamentBuckets).mockResolvedValue(buckets({ finished: [finished] }));

    const events = await getLandingCalendar();

    expect(events).toEqual([]);
  });

  it("rend une liste vide si la lecture échoue", async () => {
    jest.mocked(listTournamentBuckets).mockRejectedValue(new Error("db down"));

    await expect(getLandingCalendar()).resolves.toEqual([]);
  });
});
