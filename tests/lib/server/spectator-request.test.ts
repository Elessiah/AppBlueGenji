import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let mockForwardedFor: string | null = "203.0.113.7";
jest.mock("next/headers", () => ({
  headers: async () => new Headers(mockForwardedFor === null ? {} : { "x-forwarded-for": mockForwardedFor }),
}));
jest.mock("@/lib/server/spectator-snapshot");

import { SPECTATOR_READ_RULE } from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { publicTournamentCard, publicTournamentSnapshot } from "@/lib/server/spectator-snapshot";
import { publicTournamentCardForRequest, publicTournamentSnapshotForRequest } from "@/lib/server/spectator-request";
import { tournamentCard } from "../../helpers/tournament-card";

/** Rendus sans session : jamais hors du plafond des lectures publiques. */

beforeEach(() => {
  mockForwardedFor = "203.0.113.7";
  resetRateLimit();
  jest.mocked(publicTournamentCard).mockResolvedValue(tournamentCard({ id: 5 }));
  jest.mocked(publicTournamentSnapshot).mockResolvedValue(null);
});

describe("publicTournamentCardForRequest", () => {
  it("rend la carte lue pour le tournoi demandé", async () => {
    expect((await publicTournamentCardForRequest(5))?.id).toBe(5);
    expect(publicTournamentCard).toHaveBeenCalledWith(5);
  });

  it("rend null, sans lire, une fois le plafond des lectures du réseau atteint", async () => {
    for (let i = 0; i < SPECTATOR_READ_RULE.limit; i += 1) await publicTournamentCardForRequest(i + 1);
    jest.mocked(publicTournamentCard).mockClear();

    expect(await publicTournamentCardForRequest(5)).toBeNull();
    expect(publicTournamentCard).not.toHaveBeenCalled();
  });

  it("ne plafonne pas un réseau inconnu, et un autre réseau n'en pâtit pas", async () => {
    for (let i = 0; i < SPECTATOR_READ_RULE.limit; i += 1) await publicTournamentCardForRequest(i + 1);
    mockForwardedFor = "198.51.100.9";
    expect(await publicTournamentCardForRequest(5)).not.toBeNull();
    mockForwardedFor = null;
    expect(await publicTournamentCardForRequest(5)).not.toBeNull();
  });
});

describe("publicTournamentSnapshotForRequest", () => {
  it("compte dans le même plafond et passe le réseau à la réponse publique", async () => {
    await publicTournamentSnapshotForRequest(5);
    expect(publicTournamentSnapshot).toHaveBeenCalledWith(5, expect.any(Number), "203.0.113.7");

    for (let i = 0; i < SPECTATOR_READ_RULE.limit; i += 1) await publicTournamentCardForRequest(i + 1);
    jest.mocked(publicTournamentSnapshot).mockClear();
    expect(await publicTournamentSnapshotForRequest(5)).toBeNull();
    expect(publicTournamentSnapshot).not.toHaveBeenCalled();
  });
});
