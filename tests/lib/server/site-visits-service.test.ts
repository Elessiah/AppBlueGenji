import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  emptySiteVisitStats,
  visitHashSalt,
  getSiteVisitStats,
  recordSiteVisit,
  resetSiteVisitSyncThrottle,
  resetVisitRateLimit,
  syncSiteVisitStatsToBot,
} from "@/lib/server/site-visits-service";
import { SITE_VISIT_WINDOW_MINUTES } from "@/lib/shared/site-visits";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
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
  beforeEach(() => {
    jest.clearAllMocks();
    resetVisitRateLimit();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("enregistre une visite et le signale", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await expect(recordSiteVisit({ userId: 12, path: "/tournois" })).resolves.toEqual({
      recorded: true,
    });
  });

  it("ne crée rien quand la visite tombe dans la fenêtre de session", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
    await mockDb(execute);

    await expect(recordSiteVisit({ userId: 12, path: "/tournois" })).resolves.toEqual({
      recorded: false,
    });
  });

  it("stocke une empreinte hachée, jamais l'IP ni le user-agent", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ ip: "203.0.113.7", userAgent: "Firefox/130", path: "/" });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(params)).not.toContain("203.0.113.7");
    expect(JSON.stringify(params)).not.toContain("Firefox/130");
  });

  it("normalise le chemin avant insertion", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ path: "https://bluegenji.fr/equipes/12?tab=roster" });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[2]).toBe("/equipes/12");
  });

  it("marque un compte connecté sans jamais écrire son identifiant", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: 321, path: "/profil" });

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("user_id");
    expect(sql).toContain("authenticated");
    expect(params[1]).toBe(1);
    expect(params).not.toContain(321);
    expect(JSON.stringify(params)).not.toContain("321");
    expect(params[3]).toBe(params[0]); // même empreinte pour la clause NOT EXISTS
    expect(params[4]).toBe(SITE_VISIT_WINDOW_MINUTES);
  });

  it("marque un visiteur anonyme comme non connecté", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: null, ip: "1.2.3.4", userAgent: "Chrome" });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(0);
    expect(JSON.stringify(params)).not.toContain("1.2.3.4");
  });

  it("l'empreinte d'un compte dépend du sel : sans le secret, on ne la renverse pas", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);
    const saved = process.env.VISIT_HASH_SALT;

    process.env.VISIT_HASH_SALT = "secret-a";
    await recordSiteVisit({ userId: 7, path: "/" });
    process.env.VISIT_HASH_SALT = "secret-b";
    resetVisitRateLimit();
    await recordSiteVisit({ userId: 7, path: "/" });
    process.env.VISIT_HASH_SALT = saved;

    const first = (execute.mock.calls[0][1] as unknown[])[0];
    const second = (execute.mock.calls[1][1] as unknown[])[0];
    expect(first).not.toBe(second);
    expect(String(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("donne la même empreinte à deux visites du même compte", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: 5, ip: "1.2.3.4", userAgent: "Chrome" });
    await recordSiteVisit({ userId: 5, ip: "9.9.9.9", userAgent: "Safari" });

    const first = (execute.mock.calls[0][1] as unknown[])[0];
    const second = (execute.mock.calls[1][1] as unknown[])[0];
    expect(first).toBe(second);
  });
});

describe("getSiteVisitStats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("projette la ligne agrégée", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[FULL_ROW]]);
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
    const execute = jest.fn<SqlQuery>().mockResolvedValue([
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

  it("signale une lecture impossible par null, pas par des zéros", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("DB_DOWN"));
    await mockDb(execute);

    // Distinction essentielle : des zéros écraseraient l'instantané du bot.
    await expect(getSiteVisitStats()).resolves.toBeNull();
  });

  it("dégrade en statistiques vides si aucune ligne n'est renvoyée", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    await mockDb(execute);

    await expect(getSiteVisitStats()).resolves.toEqual(emptySiteVisitStats());
  });
});

describe("plafond de débit par IP", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetVisitRateLimit();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("coupe un client qui fabrique une empreinte neuve à chaque requête", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    const results: boolean[] = [];
    for (let i = 0; i < 40; i += 1) {
      // Empreinte neuve à chaque coup : la fenêtre de session ne l'arrête pas.
      const { recorded } = await recordSiteVisit({ ip: "203.0.113.7", userAgent: `UA-${i}` });
      results.push(recorded);
    }

    expect(results.filter(Boolean)).toHaveLength(30);
    expect(execute).toHaveBeenCalledTimes(30);
  });

  it("compte les IP séparément", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    for (let i = 0; i < 30; i += 1) {
      await recordSiteVisit({ ip: "203.0.113.7", userAgent: `UA-${i}` });
    }

    // Le plafond de la première IP ne pénalise pas la seconde.
    await expect(recordSiteVisit({ ip: "198.51.100.4", userAgent: "UA" })).resolves.toEqual({
      recorded: true,
    });
  });

  it("regroupe les requêtes sans IP sous une même clé plutôt que de les ignorer", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    const results: boolean[] = [];
    for (let i = 0; i < 35; i += 1) {
      const { recorded } = await recordSiteVisit({ ip: null, userAgent: `UA-${i}` });
      results.push(recorded);
    }

    expect(results.filter(Boolean)).toHaveLength(30);
  });

  it("ne décompte que les insertions, pas les chargements absorbés par la fenêtre", async () => {
    // Sortie NAT partagée : beaucoup de requêtes, peu d'insertions.
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
    await mockDb(execute);

    for (let i = 0; i < 200; i += 1) {
      await recordSiteVisit({ ip: "203.0.113.7", userAgent: `UA-${i}` });
    }

    // Le quota est intact : un vrai nouveau visiteur derrière la même IP passe.
    execute.mockResolvedValue([{ affectedRows: 1 }]);
    await expect(recordSiteVisit({ ip: "203.0.113.7", userAgent: "Nouveau" })).resolves.toEqual({
      recorded: true,
    });
  });
});

describe("syncSiteVisitStatsToBot", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetSiteVisitSyncThrottle();
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[FULL_ROW]]));
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it("n'écrase jamais l'instantané du bot avec des zéros si la lecture échoue", async () => {
    const { pushSiteVisitStats } = await import("@/lib/server/bot-integration");
    await mockDb(jest.fn<SqlQuery>().mockRejectedValue(new Error("DB_DOWN")));

    await expect(syncSiteVisitStatsToBot()).resolves.toBe(false);
    expect(pushSiteVisitStats).not.toHaveBeenCalled();
  });

  it("ne consomme pas la cadence après un échec de lecture", async () => {
    const { pushSiteVisitStats } = await import("@/lib/server/bot-integration");
    await mockDb(jest.fn<SqlQuery>().mockRejectedValue(new Error("DB_DOWN")));
    await syncSiteVisitStatsToBot();

    // La base revient : la visite suivante doit pouvoir synchroniser aussitôt.
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[FULL_ROW]]));
    await expect(syncSiteVisitStatsToBot()).resolves.toBe(true);
    expect(pushSiteVisitStats).toHaveBeenCalledTimes(1);
  });

  it("pousse bien des zéros quand la table est réellement vide", async () => {
    const { pushSiteVisitStats } = await import("@/lib/server/bot-integration");
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));

    await expect(syncSiteVisitStatsToBot()).resolves.toBe(true);
    expect(pushSiteVisitStats).toHaveBeenCalledWith(emptySiteVisitStats());
  });
});

describe("visitHashSalt", () => {
  it("prend VISIT_HASH_SALT, puis le secret interne du bot", () => {
    expect(visitHashSalt({ VISIT_HASH_SALT: " sel ", BOT_INTERNAL_TOKEN: "jeton" } as unknown as NodeJS.ProcessEnv)).toBe("sel");
    expect(visitHashSalt({ BOT_INTERNAL_TOKEN: "jeton" } as unknown as NodeJS.ProcessEnv)).toBe("jeton");
  });

  it("garde une constante hors production", () => {
    expect(visitHashSalt({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("bg-site-visits");
  });

  it("refuse un sel connu en production : une empreinte au sel public se renverse par énumération", () => {
    expect(visitHashSalt({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
    expect(visitHashSalt({ NODE_ENV: "production", VISIT_HASH_SALT: "  " } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("recordSiteVisit — sans secret en production", () => {
  it("ne compte rien plutôt que de compter de façon réversible, et le dit une fois", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);
    resetVisitRateLimit();
    const env = { ...process.env };
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.VISIT_HASH_SALT;
    delete process.env.BOT_INTERNAL_TOKEN;
    try {
      expect(await recordSiteVisit({ userId: 1, path: "/" })).toEqual({ recorded: false });
      expect(await recordSiteVisit({ userId: 2, path: "/" })).toEqual({ recorded: false });
      expect(execute).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      process.env = env;
      error.mockRestore();
    }
  });
});
