import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// Ces trois fonctions sont le point de passage unique de « quelque chose a
// changé sur ce tournoi ». Elles portent donc une responsabilité que rien
// d'autre ne rattrape : invalider les caches de lecture en même temps qu'elles
// réveillent les abonnés. Un oubli ici afficherait un score périmé pendant toute
// la durée de vie du cache — sans aucun autre symptôme.
const invalidateSnapshot = jest.fn();
const invalidateLists = jest.fn();
const publishEvent = jest.fn();

jest.mock("@/lib/server/tournaments/snapshot", () => ({
  invalidateTournamentSnapshot: (id: number) => invalidateSnapshot(id),
}));

jest.mock("@/lib/server/tournaments/list-cache", () => ({
  invalidateTournamentLists: () => invalidateLists(),
}));

jest.mock("@/lib/server/live", () => ({
  publishTournamentEvent: (event: unknown) => publishEvent(event),
}));

import {
  publishScoreReportedEvent,
  publishScoreResolvedEvent,
  publishUpdatedEvent,
} from "@/lib/server/tournaments/notifications";

beforeEach(() => {
  invalidateSnapshot.mockReset();
  invalidateLists.mockReset();
  publishEvent.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("notifications — invalidation des caches", () => {
  it("oublie l'instantané et les listes à une mise à jour", () => {
    publishUpdatedEvent(7);
    expect(invalidateSnapshot).toHaveBeenCalledWith(7);
    expect(invalidateLists).toHaveBeenCalledTimes(1);
  });

  it("oublie l'instantané et les listes à un score rapporté", () => {
    publishScoreReportedEvent(7, 42);
    expect(invalidateSnapshot).toHaveBeenCalledWith(7);
    expect(invalidateLists).toHaveBeenCalledTimes(1);
  });

  it("oublie l'instantané et les listes à un score arbitré", () => {
    publishScoreResolvedEvent(7, 42);
    expect(invalidateSnapshot).toHaveBeenCalledWith(7);
    expect(invalidateLists).toHaveBeenCalledTimes(1);
  });

  it("invalide avant de réveiller les abonnés", () => {
    // L'ordre compte : un abonné réveillé le premier relirait l'instantané
    // encore en cache, donc la version d'avant l'écriture.
    const order: string[] = [];
    invalidateSnapshot.mockImplementation(() => order.push("cache"));
    publishEvent.mockImplementation(() => order.push("publish"));

    publishScoreReportedEvent(7, 42);
    expect(order).toEqual(["cache", "publish"]);
  });
});

describe("notifications — événements publiés", () => {
  it("annonce le type et le tournoi", () => {
    publishUpdatedEvent(7);
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "updated", tournamentId: 7 }),
    );
  });

  it("porte le match concerné pour les événements de score", () => {
    publishScoreReportedEvent(7, 42);
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "score_reported", tournamentId: 7, matchId: 42 }),
    );

    publishScoreResolvedEvent(7, 43);
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "score_resolved", tournamentId: 7, matchId: 43 }),
    );
  });

  it("horodate chaque événement", () => {
    publishUpdatedEvent(7);
    const event = publishEvent.mock.calls[0][0] as { emittedAt: string };
    expect(Number.isNaN(Date.parse(event.emittedAt))).toBe(false);
  });
});
