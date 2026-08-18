import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  emptySiteVisitStats,
  getSiteVisitStats,
  recordSiteVisit,
  resetSiteVisitSyncThrottle,
  syncSiteVisitStatsToBot,
} from "@/lib/server/site-visits-service";
import { SITE_VISIT_WINDOW_MINUTES } from "@/lib/shared/site-visits";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

const FULL_ROW = {
  total_visits: 1240,
  unique_visitors: 310,
  identified_visitors: 58,
  visits_24h: 42,
  unique_24h: 20,
  visits_7d: 260,
  unique_7d: 95,
  visits_30d: 900,
  unique_30d: 240,
  first_visit_at: "2026-01-05 10:00:00",
  last_visit_at: "2026-08-18 09:30:00",
};

describe("recordSiteVisit", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("enregistre une visite et le signale", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await expect(recordSiteVisit({ userId: 12, path: "/tournois" })).resolves.toEqual({
      recorded: true,
    });
  });

  it("ne crée rien quand la visite tombe dans la fenêtre de session", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 0 }]);
    await mockDb(execute);

    await expect(recordSiteVisit({ userId: 12, path: "/tournois" })).resolves.toEqual({
      recorded: false,
    });
  });

  it("stocke une empreinte hachée, jamais l'IP ni le user-agent", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ ip: "203.0.113.7", userAgent: "Firefox/130", path: "/" });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(params)).not.toContain("203.0.113.7");
    expect(JSON.stringify(params)).not.toContain("Firefox/130");
  });

  it("normalise le chemin avant insertion", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ path: "https://bluegenji.fr/equipes/12?tab=roster" });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[2]).toBe("/equipes/12");
  });

  it("attache le compte connecté et interroge la bonne fenêtre", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: 321, path: "/profil" });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(321);
    expect(params[3]).toBe(params[0]); // même empreinte pour la clause NOT EXISTS
    expect(params[4]).toBe(SITE_VISIT_WINDOW_MINUTES);
  });

  it("laisse `user_id` nul pour un visiteur anonyme", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: null, ip: "1.2.3.4", userAgent: "Chrome" });

    expect((execute.mock.calls[0][1] as unknown[])[1]).toBeNull();
  });

  it("donne la même empreinte à deux visites du même compte", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: 5, ip: "1.2.3.4", userAgent: "Chrome" });
    await recordSiteVisit({ userId: 5, ip: "9.9.9.9", userAgent: "Safari" });

    const first = (execute.mock.calls[0][1] as unknown[])[0];
    const second = (execute.mock.calls[1][1] as unknown[])[0];
    expect(first).toBe(second);
  });
});

describe("getSiteVisitStats", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("projette la ligne agrégée", async () => {
    const execute = jest.fn().mockResolvedValue([[FULL_ROW]]);
    await mockDb(execute);

    await expect(getSiteVisitStats()).resolves.toEqual({
      totalVisits: 1240,
      uniqueVisitors: 310,
      visitsLast24h: 42,
      uniqueVisitorsLast24h: 20,
      visitsLast7Days: 260,
      uniqueVisitorsLast7Days: 95,
      visitsLast30Days: 900,
      uniqueVisitorsLast30Days: 240,
      identifiedVisitors: 58,
      firstVisitAt: new Date("2026-01-05 10:00:00").toISOString(),
      lastVisitAt: new Date("2026-08-18 09:30:00").toISOString(),
    });
  });

  it("rend des zéros sur une table vierge (SUM renvoie NULL)", async () => {
    const execute = jest.fn().mockResolvedValue([
      [
        {
          total_visits: 0,
          unique_visitors: 0,
          identified_visitors: 0,
          visits_24h: null,
          unique_24h: 0,
          visits_7d: null,
          unique_7d: 0,
          visits_30d: null,
          unique_30d: 0,
          first_visit_at: null,
          last_visit_at: null,
        },
      ],
    ]);
    await mockDb(execute);

    await expect(getSiteVisitStats()).resolves.toEqual(emptySiteVisitStats());
  });

  it("dégrade en statistiques vides si la base est injoignable", async () => {
    const execute = jest.fn().mockRejectedValue(new Error("DB_DOWN"));
    await mockDb(execute);

    await expect(getSiteVisitStats()).resolves.toEqual(emptySiteVisitStats());
  });

  it("dégrade en statistiques vides si aucune ligne n'est renvoyée", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await expect(getSiteVisitStats()).resolves.toEqual(emptySiteVisitStats());
  });
});

describe("syncSiteVisitStatsToBot", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetSiteVisitSyncThrottle();
    await mockDb(jest.fn().mockResolvedValue([[FULL_ROW]]));
  });
  afterEach(() => jest.restoreAllMocks());

  it("pousse la fréquentation au bot", async () => {
    const { pushSiteVisitStats } = await import("@/lib/server/bot-integration");

    await expect(syncSiteVisitStatsToBot()).resolves.toBe(true);
    expect(pushSiteVisitStats).toHaveBeenCalledTimes(1);
    expect(pushSiteVisitStats).toHaveBeenCalledWith(
      expect.objectContaining({ totalVisits: 1240, uniqueVisitors: 310 }),
    );
  });

  it("respecte la cadence : un seul envoi par intervalle", async () => {
    const { pushSiteVisitStats } = await import("@/lib/server/bot-integration");

    await syncSiteVisitStatsToBot();
    await expect(syncSiteVisitStatsToBot()).resolves.toBe(false);
    expect(pushSiteVisitStats).toHaveBeenCalledTimes(1);
  });

  it("force l'envoi quand on le demande explicitement", async () => {
    const { pushSiteVisitStats } = await import("@/lib/server/bot-integration");

    await syncSiteVisitStatsToBot();
    await expect(syncSiteVisitStatsToBot(true)).resolves.toBe(true);
    expect(pushSiteVisitStats).toHaveBeenCalledTimes(2);
  });
});
