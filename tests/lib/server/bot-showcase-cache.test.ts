import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Les lectures du bot servies à la vitrine `/bot`.
 *
 * La page déclarait `revalidate = 30`, mais tout le site est rendu à la demande
 * (la mise en page racine lit le nonce de la CSP) et les appels sortants sont en
 * `no-store` : chaque vue interrogeait le bot quatre fois — cinq, dont une dont
 * le résultat était jeté. Ce qui est tenu ici : une lecture par clé et par
 * durée de vie, y compris quand le bot ne répond pas.
 */
jest.mock("@/lib/server/bot-integration");

import {
  fetchBotActivity,
  fetchBotKpis,
  fetchBotServers,
  fetchBotStatus,
} from "@/lib/server/bot-integration";
import { clearCache } from "@/lib/server/cache";
import {
  BOT_SHOWCASE_TTL_MS,
  BOT_STATUS_TTL_MS,
  cachedBotActivity,
  cachedBotKpis,
  cachedBotServers,
  cachedBotStatus,
} from "@/lib/server/bot-showcase-cache";
import type { BotActivity, BotKpis, BotServersPayload, BotStatus } from "@/lib/shared/types";

const status = { state: "OPERATIONAL" } as unknown as BotStatus;
const kpis = { servers: 3 } as unknown as BotKpis;
const servers = { servers: [], total: 0 } as unknown as BotServersPayload;
const activity = (range: string) => ({ range }) as unknown as BotActivity;

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  jest.useRealTimers();
});

describe("lectures mutualisées", () => {
  it("n'interroge le bot qu'une fois pour des vues successives", async () => {
    jest.mocked(fetchBotStatus).mockResolvedValue(status);
    jest.mocked(fetchBotKpis).mockResolvedValue(kpis);
    jest.mocked(fetchBotServers).mockResolvedValue(servers);

    for (let view = 0; view < 3; view += 1) {
      expect(await cachedBotStatus()).toBe(status);
      expect(await cachedBotKpis()).toBe(kpis);
      expect(await cachedBotServers(8)).toBe(servers);
    }

    expect(fetchBotStatus).toHaveBeenCalledTimes(1);
    expect(fetchBotKpis).toHaveBeenCalledTimes(1);
    expect(fetchBotServers).toHaveBeenCalledTimes(1);
    expect(fetchBotServers).toHaveBeenCalledWith(8);
  });

  it("partage un seul appel entre des vues simultanées", async () => {
    jest.mocked(fetchBotStatus).mockResolvedValue(status);

    await Promise.all([cachedBotStatus(), cachedBotStatus(), cachedBotStatus()]);

    expect(fetchBotStatus).toHaveBeenCalledTimes(1);
  });

  it("ne lit l'activité (7 jours) qu'une fois pour toutes les vues", async () => {
    jest.mocked(fetchBotActivity).mockResolvedValue(activity("7j"));

    expect(await cachedBotActivity()).toEqual({ range: "7j" });
    expect(await cachedBotActivity()).toEqual({ range: "7j" });

    expect(fetchBotActivity).toHaveBeenCalledTimes(1);
  });

  it("garde une entrée par taille de liste de serveurs", async () => {
    jest.mocked(fetchBotServers).mockResolvedValue(servers);

    await cachedBotServers(8);
    await cachedBotServers(20);

    expect(fetchBotServers).toHaveBeenCalledTimes(2);
  });

  // Réinterroger un bot en panne à chaque vue ferait attendre chaque visiteur
  // jusqu'au délai d'appel, pour la même réponse.
  it("retient aussi « injoignable »", async () => {
    jest.mocked(fetchBotStatus).mockResolvedValue(null);

    expect(await cachedBotStatus()).toBeNull();
    expect(await cachedBotStatus()).toBeNull();

    expect(fetchBotStatus).toHaveBeenCalledTimes(1);
  });
});

describe("durées de vie", () => {
  it("rafraîchit l'état du bot au bout de 30 s, le reste au bout d'une minute", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-28T12:00:00.000Z") });
    jest.mocked(fetchBotStatus).mockResolvedValue(status);
    jest.mocked(fetchBotKpis).mockResolvedValue(kpis);

    await cachedBotStatus();
    await cachedBotKpis();

    jest.setSystemTime(Date.now() + BOT_STATUS_TTL_MS + 1);
    await cachedBotStatus();
    await cachedBotKpis();
    expect(fetchBotStatus).toHaveBeenCalledTimes(2);
    expect(fetchBotKpis).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + BOT_SHOWCASE_TTL_MS);
    await cachedBotKpis();
    expect(fetchBotKpis).toHaveBeenCalledTimes(2);

    expect(BOT_STATUS_TTL_MS).toBe(30_000);
    expect(BOT_SHOWCASE_TTL_MS).toBe(60_000);
  });
});
