import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments-service");

import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { cached, clearCache } from "@/lib/server/cache";
import { getSpectatorPayload } from "@/lib/server/spectator-snapshot";
import { tournamentSnapshot } from "../../helpers/tournament-detail";

/** Réponse publique mutualisée : ce qui entre dans le cache partagé, et ce qui n'y entre pas. */

const mockedSnapshot = jest.mocked(getVisibleTournamentSnapshot);

beforeEach(() => {
  clearCache();
});
afterEach(() => {
  jest.resetAllMocks();
});

describe("getSpectatorPayload", () => {
  it("garde un tournoi trouvé pour sa durée de vie", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot({ version: "v1" }));

    await getSpectatorPayload(5, 60_000);
    await getSpectatorPayload(5, 60_000);

    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
  });

  it("ne met jamais un « introuvable » dans le cache partagé", async () => {
    mockedSnapshot.mockResolvedValue(null);

    expect(await getSpectatorPayload(9, 60_000)).toBeNull();

    // La clé est vide : un chargeur témoin s'exécute, au lieu de relire un `null` rangé.
    const probe = jest.fn(async () => "témoin");
    expect(await cached("spectator-snapshot:9", 60_000, probe)).toBe("témoin");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("laisse remonter une vraie panne", async () => {
    mockedSnapshot.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(getSpectatorPayload(5, 60_000)).rejects.toThrow("ECONNREFUSED");
  });
});
