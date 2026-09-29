import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  emptySiteVisitStats,
  visitHashSalt,
  getSiteVisitStats,
  recordSiteVisit,
  resetSiteVisitSyncThrottle,
  resetVisitRateLimit,
  rollUpExpiredSiteVisits,
  syncSiteVisitStatsToBot,
} from "@/lib/server/site-visits-service";
import {
  SITE_VISIT_DETAIL_RETENTION_DAYS,
  SITE_VISIT_WINDOW_MINUTES,
} from "@/lib/shared/site-visits";
import {
  type SqlQuery,
  type SqlMock,
  connectionMock,
  fakeConnection,
  fakePool,
} from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

/**
 * Connexion du repli des visites anciennes : par défaut, rien à replier. Les
 * tests du repli la remplacent par la leur.
 */
function idleRollUpConnection() {
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql: string) =>
    sql.includes("AS cutoff") ? [[{ cutoff: "2026-07-01" }]] : [{ affectedRows: 0 }],
  );
  return connection;
}

async function mockDb(execute: SqlMock, connection = idleRollUpConnection()) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ execute, getConnection: async () => fakeConnection(connection) }),
  );
}

/** Appels d'insertion d'une visite, à l'exclusion de l'empreinte du visiteur. */
function visitInserts(execute: SqlMock) {
  return execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO bg_site_visits ("));
}

const FULL_ROW = {
  // 340 visites repliées en compteurs journaliers + 900 encore au détail.
  archived_visits: 340,
  recent_visits: 900,
  unique_visitors: 310,
  identified_visitors: 58,
  visits_24h: 42,
  unique_24h: 20,
  visits_7d: 260,
  unique_7d: 95,
  visits_30d: 900,
  unique_30d: 240,
  first_archived_visit_at: "2026-01-05 10:00:00",
  first_recent_visit_at: "2026-07-20 08:00:00",
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

    const [firstCall, secondCall] = visitInserts(execute);
    const first = (firstCall[1] as unknown[])[0];
    const second = (secondCall[1] as unknown[])[0];
    expect(first).not.toBe(second);
    expect(String(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("donne la même empreinte à deux visites du même compte", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: 5, ip: "1.2.3.4", userAgent: "Chrome" });
    await recordSiteVisit({ userId: 5, ip: "9.9.9.9", userAgent: "Safari" });

    const [firstCall, secondCall] = visitInserts(execute);
    const first = (firstCall[1] as unknown[])[0];
    const second = (secondCall[1] as unknown[])[0];
    expect(first).toBe(second);
  });

  // Le total des visiteurs uniques ne se reconstitue pas depuis des compteurs
  // journaliers : chaque visite enregistrée laisse l'empreinte du visiteur.
  it("retient l'empreinte du visiteur pour le total, drapeau « connecté » compris", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: 9, path: "/" });

    const [insert] = visitInserts(execute);
    const remember = execute.mock.calls.find(([sql]) => String(sql).includes("bg_site_visitors"));
    expect(remember).toBeDefined();
    expect(String(remember![0])).toContain("GREATEST(bg_site_visitors.authenticated");
    expect(remember![1]).toEqual([(insert[1] as unknown[])[0], 1]);
  });

  it("n'écrit aucune empreinte pour une visite absorbée par la fenêtre", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
    await mockDb(execute);

    await recordSiteVisit({ userId: 9, path: "/" });

    expect(execute.mock.calls.some(([sql]) => String(sql).includes("bg_site_visitors"))).toBe(false);
  });

  it("garde la visite comptée si l'empreinte ne peut pas être retenue", async () => {
    const execute = jest.fn<SqlQuery>().mockImplementation(async (sql: string) => {
      if (sql.includes("bg_site_visitors")) throw new Error("DB_DOWN");
      return [{ affectedRows: 1 }];
    });
    await mockDb(execute);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(recordSiteVisit({ userId: 9, path: "/" })).resolves.toEqual({ recorded: true });
    expect(error).toHaveBeenCalled();
  });
});

describe("getSiteVisitStats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Les totaux « depuis toujours » viennent des tables de cumul, les fenêtres
  // glissantes du seul détail restant : la lecture ne grandit plus avec
  // l'historique.
  it("lit les totaux sur les cumuls, jamais par un COUNT(DISTINCT) sur tout l'historique", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[FULL_ROW]]);
    await mockDb(execute);

    await getSiteVisitStats();

    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain("FROM bg_site_visit_days");
    expect(sql).toContain("(SELECT COUNT(*) FROM bg_site_visitors)");
    expect(sql).not.toContain("COUNT(DISTINCT visitor_key)");
  });

  it("date la première visite au détail quand rien n'a encore été replié", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([
      [{ ...FULL_ROW, archived_visits: null, first_archived_visit_at: null }],
    ]);
    await mockDb(execute);

    const stats = await getSiteVisitStats();
    expect(stats?.totalVisits).toBe(900);
    expect(stats?.firstVisitAt).toBe(new Date("2026-07-20 08:00:00").toISOString());
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
          recent_visits: 0,
          archived_visits: 0,
          unique_visitors: 0,
          identified_visitors: 0,
          visits_24h: null,
          unique_24h: 0,
          visits_7d: null,
          unique_7d: 0,
          visits_30d: null,
          unique_30d: 0,
          first_recent_visit_at: null,
          first_archived_visit_at: null,
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
    expect(visitInserts(execute)).toHaveLength(30);
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

  it("replie les visites anciennes avant de lire", async () => {
    const connection = idleRollUpConnection();
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[FULL_ROW]]), connection);

    await syncSiteVisitStatsToBot();

    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("DELETE FROM bg_site_visits"))).toBe(
      true,
    );
  });

  it("synchronise quand même si le repli échoue", async () => {
    const { pushSiteVisitStats } = await import("@/lib/server/bot-integration");
    const connection = idleRollUpConnection();
    connection.execute.mockRejectedValue(new Error("LOCK_WAIT"));
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[FULL_ROW]]), connection);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(syncSiteVisitStatsToBot()).resolves.toBe(true);
    expect(pushSiteVisitStats).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
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

describe("rollUpExpiredSiteVisits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function rollUpConnection(deleted = 12) {
    const connection = connectionMock();
    connection.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("AS cutoff")) return [[{ cutoff: "2026-07-01" }]];
      if (sql.startsWith("DELETE")) return [{ affectedRows: deleted }];
      return [{ affectedRows: 3 }];
    });
    return connection;
  }

  it("reporte les jours révolus en compteurs puis les efface, sur une seule borne", async () => {
    const connection = rollUpConnection();
    await mockDb(jest.fn<SqlQuery>(), connection);

    await expect(rollUpExpiredSiteVisits()).resolves.toBe(12);

    const calls = connection.execute.mock.calls;
    expect(calls[0][1]).toEqual([SITE_VISIT_DETAIL_RETENTION_DAYS]);
    const insert = calls.find(([sql]) => sql.includes("INSERT INTO bg_site_visit_days"))!;
    const remove = calls.find(([sql]) => sql.startsWith("DELETE FROM bg_site_visits"))!;
    // La même borne, lue une fois : `NOW()` relu entre les deux effacerait une
    // visite qui n'a pas été reportée.
    expect(insert[1]).toEqual(["2026-07-01"]);
    expect(remove[1]).toEqual(["2026-07-01"]);
    expect(insert[0]).toContain("visits = bg_site_visit_days.visits + VALUES(visits)");
    expect(calls.indexOf(insert)).toBeLessThan(calls.indexOf(remove));
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("défait le report si l'effacement échoue : une visite ne compte jamais deux fois", async () => {
    const connection = rollUpConnection();
    connection.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("AS cutoff")) return [[{ cutoff: "2026-07-01" }]];
      if (sql.startsWith("DELETE")) throw new Error("LOCK_WAIT");
      return [{ affectedRows: 3 }];
    });
    connection.rollback.mockResolvedValue(undefined);
    await mockDb(jest.fn<SqlQuery>(), connection);

    await expect(rollUpExpiredSiteVisits()).rejects.toThrow("LOCK_WAIT");
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
