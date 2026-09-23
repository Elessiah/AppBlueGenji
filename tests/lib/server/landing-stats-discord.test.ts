import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/discord-community");

import { clearCache } from "@/lib/server/cache";
import { getDatabase } from "@/lib/server/database";
import { getDiscordCommunity } from "@/lib/server/discord-community";
import { getLandingStats } from "@/lib/server/landing-service";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/**
 * Les chiffres du site et ceux du Discord voyagent ensemble jusqu'à l'accueil,
 * mais **tombent séparément** : ils ne viennent ni de la même machine ni du
 * même réseau, et l'un ne doit jamais emporter l'autre.
 */

const mockedDb = getDatabase as jest.MockedFunction<typeof getDatabase>;
const mockedDiscord = getDiscordCommunity as jest.MockedFunction<typeof getDiscordCommunity>;

function countsRow(players: number, teams: number, tournaments: number) {
  return fakePool({
    execute: jest.fn<SqlQuery>(async () => [[{ players, teams, tournaments }], []]),
  });
}

describe("compteurs de l'accueil", () => {
  beforeEach(() => {
    clearCache();
    jest.clearAllMocks();
  });

  afterEach(() => {
    clearCache();
  });

  it("joint la fréquentation Discord aux chiffres du site", async () => {
    mockedDb.mockResolvedValue(countsRow(150, 25, 10));
    mockedDiscord.mockResolvedValue({ memberCount: 1284, onlineCount: 213 });

    await expect(getLandingStats()).resolves.toEqual({
      players: 150,
      teams: 25,
      tournaments: 10,
      discord: { memberCount: 1284, onlineCount: 213 },
    });
  });

  it("garde les chiffres du site quand Discord ne répond pas", async () => {
    mockedDb.mockResolvedValue(countsRow(150, 25, 10));
    mockedDiscord.mockResolvedValue(null);

    const stats = await getLandingStats();

    expect(stats.discord).toBeNull();
    expect(stats.players).toBe(150);
  });

  it("garde la fréquentation Discord quand la base est injoignable", async () => {
    // L'inverse compte autant : une base tombée n'a rien à voir avec Discord,
    // et le bloc communauté reste le seul chiffre encore vrai de la page.
    mockedDb.mockRejectedValue(new Error("ECONNREFUSED"));
    mockedDiscord.mockResolvedValue({ memberCount: 1284, onlineCount: 213 });

    await expect(getLandingStats()).resolves.toEqual({
      players: 0,
      teams: 0,
      tournaments: 0,
      discord: { memberCount: 1284, onlineCount: 213 },
    });
  });

  it("charge les deux de front, sans les enchaîner", async () => {
    // Discord est un appel sortant : le placer après la requête SQL ajouterait
    // son délai au rendu d'une page déjà dynamique.
    let discordStarted = false;
    let dbResolved = false;

    mockedDb.mockImplementation(async () => {
      await Promise.resolve();
      dbResolved = true;
      return countsRow(1, 1, 1);
    });
    mockedDiscord.mockImplementation(async () => {
      discordStarted = !dbResolved;
      return null;
    });

    await getLandingStats();

    expect(discordStarted).toBe(true);
  });
});
