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
import { tournamentSnapshot } from "../../helpers/tournament-detail";

/** Rendus sans session : jamais hors du plafond des lectures publiques. */

beforeEach(() => {
  mockForwardedFor = "203.0.113.7";
  resetRateLimit();
  jest.mocked(publicTournamentCard).mockResolvedValue(tournamentCard({ id: 5 }));
  jest.mocked(publicTournamentSnapshot).mockResolvedValue(null);
});

/** Une carte qui touche la base : consulte `admit` avant de lire, comme la vraie. */
function cardReadsDatabase() {
  jest.mocked(publicTournamentCard).mockImplementation(async (id, admit) =>
    (admit ?? (() => true))() ? tournamentCard({ id }) : null,
  );
}

/** Une carte servie par la copie ou le cache de carte : `admit` n'est jamais consulté. */
function cardServedFromCache() {
  jest.mocked(publicTournamentCard).mockImplementation(async (id) => tournamentCard({ id }));
}

/** Épuise le plafond du réseau par des lectures en base. */
async function exhaustReadAllowance() {
  cardReadsDatabase();
  for (let i = 0; i < SPECTATOR_READ_RULE.limit; i += 1) await publicTournamentCardForRequest(i + 1);
}

describe("publicTournamentCardForRequest", () => {
  it("rend la carte lue pour le tournoi demandé", async () => {
    cardReadsDatabase();
    expect((await publicTournamentCardForRequest(5))?.id).toBe(5);
    expect(publicTournamentCard).toHaveBeenCalledWith(5, expect.any(Function));
  });

  it("rend null une fois le plafond des lectures en base du réseau atteint", async () => {
    await exhaustReadAllowance();
    expect(await publicTournamentCardForRequest(5)).toBeNull();
  });

  it("une carte servie par un cache ne prend aucun jeton : le plafond ne s'épuise pas", async () => {
    cardServedFromCache();
    for (let i = 0; i < SPECTATOR_READ_RULE.limit * 2; i += 1) await publicTournamentCardForRequest(i + 1);
    cardReadsDatabase();
    expect(await publicTournamentCardForRequest(5)).not.toBeNull();
  });

  it("un jeton seulement par lecture en base : deux mises en page, un cache chaud pour la seconde", async () => {
    cardReadsDatabase();
    await publicTournamentCardForRequest(5);
    cardServedFromCache();
    await publicTournamentCardForRequest(5);
    // Il reste limit - 1 jetons : limit - 1 lectures passent encore, la suivante est refusée.
    cardReadsDatabase();
    for (let i = 0; i < SPECTATOR_READ_RULE.limit - 1; i += 1) {
      expect(await publicTournamentCardForRequest(i + 1)).not.toBeNull();
    }
    expect(await publicTournamentCardForRequest(5)).toBeNull();
  });

  it("ne plafonne pas un réseau inconnu, et un autre réseau n'en pâtit pas", async () => {
    await exhaustReadAllowance();
    mockForwardedFor = "198.51.100.9";
    expect(await publicTournamentCardForRequest(5)).not.toBeNull();
    mockForwardedFor = null;
    expect(await publicTournamentCardForRequest(5)).not.toBeNull();
  });
});

/** Une réponse publique à (re)construire : consulte `admit` avant de lire, comme la vraie. */
function snapshotReadsDatabase() {
  jest.mocked(publicTournamentSnapshot).mockImplementation(async (_id, _level, _client, admit) =>
    (admit ?? (() => true))() ? tournamentSnapshot() : null,
  );
}

describe("publicTournamentSnapshotForRequest", () => {
  it("publicTournamentSnapshotForRequest_capReached_returnsNull", async () => {
    snapshotReadsDatabase();
    await exhaustReadAllowance();

    const actual = await publicTournamentSnapshotForRequest(5);

    expect(actual).toBeNull();
    expect(publicTournamentSnapshot).toHaveBeenCalledWith(5, expect.any(Number), "203.0.113.7", expect.any(Function));
  });

  it("publicTournamentSnapshotForRequest_servedFromCache_takesNoToken", async () => {
    jest.mocked(publicTournamentSnapshot).mockResolvedValue(tournamentSnapshot());
    for (let i = 0; i < SPECTATOR_READ_RULE.limit * 2; i += 1) await publicTournamentSnapshotForRequest(5);

    cardReadsDatabase();
    expect(await publicTournamentCardForRequest(5)).not.toBeNull();
  });
});
