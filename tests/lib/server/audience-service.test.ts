import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/transaction");

import {
  audienceVisitorKey,
  dailySalt,
  flushAudienceViews,
  forgetSalts,
  getAudienceStats,
  lastRollableDay,
  MAINTENANCE_INTERVAL_MS,
  RECORDING_WAIT_MS,
  SALT_READ_TIMEOUT_MS,
  pendingAudienceCount,
  purgeAudienceViews,
  rawRetentionStart,
  recordAudienceViews,
  resetAudienceState,
  rollUpAudienceDays,
  runMaintenance,
  SALT_RETRY_MS,
} from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import { AUDIENCE_MAX_OPEN_AGE_MS, type AudienceView } from "@/lib/shared/audience";
import { connectionMock, fakeConnection, fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/** Statistiques de fréquentation détaillées, registre T19 (`docs/features/AUDIENCE_MEASUREMENT.md`). */

const NOW = new Date("2026-11-16T12:00:00Z");

function view(overrides: Partial<AudienceView> = {}): AudienceView {
  const ageMs = overrides.ageMs ?? 0;
  return { pageKey: "home", locale: "fr", device: "mobile", source: "direct", isView: true, engagedMs: 4000, ageMs, openedAgeMs: ageMs, ...overrides };
}

function mockDb(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

const SALT = Buffer.alloc(32, 7);

/**
 * Base vide : rien à replier, rien à purger, aucun jour compté, communauté à
 * 3 (accueil : 4 équipes, 5 comptes) ; le sel de chaque jour vaut {@link SALT}.
 */
function emptyDatabase(salt: Buffer = SALT): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (sql.includes("AS players")) return [[{ players: 5, teams: 4, tournaments: 9 }]];
    if (sql.includes("AS matches")) return [[{ matches: 3, tournaments: 2 }]];
    if (sql.includes("COUNT(*)")) return [[{ n: 3 }]];
    if (sql.includes("SELECT salt")) return [[{ salt }]];
    if (sql.startsWith("DELETE") || sql.startsWith("INSERT IGNORE")) return [{ affectedRows: 0 }];
    return [[]];
  });
}

function saltWrites(execute: SqlMock) {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_audience_salts"));
}

beforeEach(() => {
  resetAudienceState();
  jest.clearAllMocks();
});

afterEach(() => {
  resetAudienceState();
  jest.restoreAllMocks();
});

describe("dailySalt", () => {
  it("dailySalt_sameDay_readsDatabaseOnce", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    // Un jour encore ouvert (horloge réelle) : le sel d'un jour clos est effacé dès sa lecture.
    await dailySalt("2099-11-16");
    await dailySalt("2099-11-16");

    expect(saltWrites(execute)).toHaveLength(1);
  });

  it("dailySalt_restart_reusesStoredSalt", async () => {
    mockDb(emptyDatabase());

    expect((await dailySalt("2026-11-16")).equals(SALT)).toBe(true);
  });

  it("dailySalt_firstOfDay_insertsRandom32Bytes", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    await dailySalt("2026-11-16", NOW);

    const [day, salt] = saltWrites(execute)[0][1] as [string, Buffer];
    expect(day).toBe("2026-11-16");
    expect(salt).toHaveLength(32);
  });

  it("dailySalt_databaseFails_retriesAfterBackoffAndLogsOnce", async () => {
    jest.useFakeTimers();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const execute = emptyDatabase();
    execute.mockRejectedValueOnce(new Error("down"));
    mockDb(execute);

    await expect(dailySalt("2026-11-16", NOW)).rejects.toThrow("down");
    // Pendant le délai, l'échec est resservi sans relire la base.
    await expect(dailySalt("2026-11-16", NOW)).rejects.toThrow("down");
    expect(saltWrites(execute)).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(SALT_RETRY_MS);
    await expect(dailySalt("2026-11-16", NOW)).resolves.toEqual(SALT);
    jest.useRealTimers();
  });

  it("dailySalt_wrongLength_rejects", async () => {
    mockDb(emptyDatabase(Buffer.alloc(8)));

    await expect(dailySalt("2026-11-16")).rejects.toThrow("audience salt unreadable");
  });
});

describe("audienceVisitorKey", () => {
  it("rend la même empreinte le même jour pour la même IP et le même navigateur", async () => {
    mockDb(emptyDatabase());

    const first = await audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox");

    expect(await audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox")).toBe(first);
  });

  it("audienceVisitorKey_differentDaySalts_differ", async () => {
    mockDb(
      jest.fn<SqlQuery>(async (sql: string, params?: unknown) => {
        if (sql.includes("SELECT salt")) return [[{ salt: Buffer.alloc(32, (params as string[])[0] === "2026-11-16" ? 1 : 2) }]];
        return [{ affectedRows: 1 }];
      }),
    );

    const monday = await audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox");

    expect(await audienceVisitorKey("2026-11-17", "203.0.113.7", "Firefox")).not.toBe(monday);
  });

  it("ne contient pas l'adresse IP", async () => {
    mockDb(emptyDatabase());

    expect(await audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("forgetSalts", () => {
  it("forgetSalts_until_deletesUpToThatDayAndForgetsMemory", async () => {
    const execute = emptyDatabase();
    mockDb(execute);
    await dailySalt("2026-11-16", NOW);

    await forgetSalts("2026-11-16");
    await dailySalt("2026-11-16", NOW);

    expect(execute.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM bg_audience_salts"))?.[1]).toEqual(["2026-11-16"]);
    // Oublié en mémoire : relu en base au signalement suivant.
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("SELECT salt"))).toHaveLength(2);
  });
});

describe("runMaintenance", () => {
  it("runMaintenance_afterGrace_deletesSaltsOfRolledDays", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    await runMaintenance(NOW);

    expect(execute.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM bg_audience_salts"))?.[1]).toEqual(["2026-11-15"]);
  });
});

describe("recordAudienceViews", () => {
  it("recordAudienceViews_viewOfRolledDay_dropped", async () => {
    mockDb(emptyDatabase());

    const kept = await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view({ ageMs: 14 * 3_600_000 }), view()], now: NOW });

    expect(kept).toBe(1);
    expect(pendingAudienceCount()).toBe(1);
  });

  it("recordAudienceViews_yesterdayBeforeGrace_keptWithYesterdaySalt", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    // 0 h 02 à Paris ; page ouverte à 23 h 58 la veille.
    const kept = await recordAudienceViews({
      ip: "203.0.113.7",
      userAgent: "Firefox",
      views: [view({ ageMs: 4 * 60_000 })],
      now: new Date("2026-11-15T23:02:00Z"),
    });

    expect(kept).toBe(1);
    expect(saltWrites(execute).map(([, params]) => (params as unknown[])[0])).toEqual(["2026-11-15"]);
  });

  it("cesse de retenir au-delà de 5 000 pages en attente", async () => {
    mockDb(emptyDatabase());
    const views = Array.from({ length: 5001 }, () => view());

    expect(await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views, now: NOW })).toBe(5000);
  });
});

describe("flushAudienceViews", () => {
  it("écrit la file en un seul INSERT, sans l'adresse IP", async () => {
    const execute = emptyDatabase();
    mockDb(execute);
    await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view(), view({ pageKey: "rules" })], now: NOW });
    execute.mockClear();

    await flushAudienceViews(NOW);

    // Aucune ligne d'un jour repliable : pas de lecture du dernier jour replié.
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("INSERT INTO bg_audience_views");
    expect(params).toHaveLength(20);
    expect(params).not.toContain("203.0.113.7");
    expect(pendingAudienceCount()).toBe(0);
  });

  it("perd le lot et le journalise quand la base refuse l'écriture", async () => {
    const execute = emptyDatabase();
    mockDb(execute);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view()], now: NOW });
    execute.mockRejectedValue(new Error("down"));

    await flushAudienceViews();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(pendingAudienceCount()).toBe(0);
  });
});

describe("lastRollableDay", () => {
  it("attend 75 minutes après minuit (Paris) avant de replier la veille", () => {
    expect(lastRollableDay(new Date("2026-11-16T00:14:00Z"))).toBe("2026-11-14");
    expect(lastRollableDay(new Date("2026-11-16T00:15:00Z"))).toBe("2026-11-15");
  });
});

describe("rawRetentionStart", () => {
  it("garde 13 mois de détail", () => {
    expect(rawRetentionStart(NOW)).toBe("2025-10-16");
  });
});

describe("purgeAudienceViews", () => {
  it("efface par passes jusqu'à une passe incomplète", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([{ affectedRows: 10_000 }])
      .mockResolvedValueOnce([{ affectedRows: 3 }]);
    mockDb(execute);

    const purged = await purgeAudienceViews(NOW);

    expect(purged).toBe(10_003);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toEqual(["2025-10-16"]);
  });
});

describe("rollUpAudienceDays", () => {
  it("efface puis réécrit les compteurs d'un jour, la ligne du jour en dernier", async () => {
    mockDb(jest.fn<SqlQuery>().mockResolvedValue([[{ day: "2026-11-14" }]]));
    const connection = connectionMock();
    connection.execute.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*) AS total")
        ? [[{ total: 1 }]]
        : sql.includes("SELECT viewed_at")
        ? [
            [
              {
                viewed_at: "2026-11-14 18:00:00",
                hour: 19,
                visitor_key: "k",
                page_key: "home",
                locale: "fr",
                device: "mobile",
                source: "search",
                is_view: 1,
                engaged_ms: 3000,
              },
            ],
          ]
        : [{ affectedRows: 1 }],
    );
    jest.mocked(inTransaction).mockImplementation(async (run) => run(fakeConnection(connection)));

    const rolled = await rollUpAudienceDays(NOW);

    expect(rolled).toBe(1);
    const statements = connection.execute.mock.calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(" "));
    expect(statements).toEqual([
      "SELECT COUNT(*) AS",
      "SELECT viewed_at, hour,",
      "DELETE FROM bg_audience_day_pages",
      "DELETE FROM bg_audience_day_hours",
      "DELETE FROM bg_audience_day_dims",
      "DELETE FROM bg_audience_days",
      // Un seul visiteur : aucune ligne de répartition n'atteint le seuil (k-anonymat).
      "INSERT INTO bg_audience_days",
    ]);
    // Le temps d'une page vue n'est pas compté (il n'arrive que par ses suites).
    expect(connection.execute.mock.calls[6][1]).toEqual(["2026-11-14", 1, 1, 1, 1, 0]);
  });

  it("ne replie rien quand aucun jour clos n'attend", async () => {
    mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));

    expect(await rollUpAudienceDays(NOW)).toBe(0);
    expect(inTransaction).not.toHaveBeenCalled();
  });
});

describe("getAudienceStats", () => {
  it("rend un état sans jour compté et les chiffres de la communauté", async () => {
    mockDb(emptyDatabase());

    const stats = await getAudienceStats(NOW);

    expect(stats.lastDay).toBeNull();
    expect(stats.daily).toEqual([]);
    expect(stats.community).toEqual({ tournaments: 2, matches: 3, teams: 4, players: 5 });
  });

  it("getAudienceStats_hourRows_fillWeekdayHourGrid", async () => {
    mockDb(
      jest.fn<SqlQuery>(async (sql: string) => {
        if (sql.includes("FROM bg_audience_days\n")) return [[{ day: "2026-11-15", views: 3, visitors: 1, visits: 1, bounces: 0, engaged_ms: 0 }]];
        if (sql.includes("WEEKDAY(day)")) return [[{ weekday: 6, hour: 21, views: "3" }, { weekday: 9, hour: 1, views: 4 }]];
        if (sql.includes("AS players")) return [[{ players: 5, teams: 4, tournaments: 9 }]];
        if (sql.includes("COUNT(*)")) return [[{ n: 3 }]];
        if (sql.startsWith("DELETE")) return [{ affectedRows: 0 }];
        return [[]];
      }),
    );

    const stats = await getAudienceStats(NOW);

    expect(stats.ranges["7d"].heatmap[6][21]).toBe(3);
    expect(stats.ranges["7d"].heatmap.flat().filter((views) => views > 0)).toEqual([3]);
  });

  it("sert la lecture en cache pendant dix minutes", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    await getAudienceStats(NOW);
    await getAudienceStats(new Date("2026-11-16T12:09:00Z"));

    const dailyReads = execute.mock.calls.filter(([sql]) => sql.includes("FROM bg_audience_days\n"));
    expect(dailyReads).toHaveLength(1);
  });

  it("relit après dix minutes", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    await getAudienceStats(NOW);
    await getAudienceStats(new Date("2026-11-16T12:10:00Z"));

    const dailyReads = execute.mock.calls.filter(([sql]) => sql.includes("FROM bg_audience_days\n"));
    expect(dailyReads).toHaveLength(2);
  });

  it("rend null pour la communauté quand sa lecture échoue", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(
      jest.fn<SqlQuery>(async (sql: string) => {
        if (sql.includes("COUNT(*)")) throw new Error("down");
        if (sql.startsWith("DELETE")) return [{ affectedRows: 0 }];
        return [[]];
      }),
    );

    expect((await getAudienceStats(NOW)).community).toBeNull();
  });
});

describe("recordAudienceViews — jour de la page ouverte, sels par jour", () => {
  it("recordAudienceViews_continuationOpenedYesterday_usesOpenDaySalt", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    // 0 h 20 à Paris ; la page lue s'est ouverte à 23 h 50 la veille.
    const kept = await recordAudienceViews({
      ip: "203.0.113.7",
      userAgent: "Firefox",
      views: [view({ isView: false, ageMs: 0, openedAgeMs: 30 * 60_000 })],
      now: new Date("2026-11-15T23:20:00Z"),
    });
    await flushAudienceViews();

    expect(kept).toBe(1);
    expect(saltWrites(execute).map(([, params]) => (params as unknown[])[0])).toEqual(["2026-11-15"]);
    const insert = execute.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO bg_audience_views"));
    expect((insert?.[1] as unknown[]).slice(0, 3)).toEqual(["2026-11-15", 23, "2026-11-15 23:20:00"]);
  });

  it("recordAudienceViews_oneDaySaltFails_keepsOtherDaysRows", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(
      jest.fn<SqlQuery>(async (sql: string, params?: unknown) => {
        if (sql.includes("SELECT salt")) {
          if ((params as string[])[0] === "2026-11-15") throw new Error("down");
          return [[{ salt: SALT }]];
        }
        return [{ affectedRows: 1 }];
      }),
    );

    const kept = await recordAudienceViews({
      ip: "203.0.113.7",
      userAgent: "Firefox",
      views: [view({ ageMs: 4 * 60_000 }), view()],
      now: new Date("2026-11-15T23:02:00Z"),
    });

    expect(kept).toBe(1);
    expect(pendingAudienceCount()).toBe(1);
  });
});

describe("runMaintenance — signalements en cours", () => {
  it("runMaintenance_recordInFlight_waitsBeforeRollup", async () => {
    let releaseSalt: () => void = () => undefined;
    const saltReady = new Promise<void>((resolve) => {
      releaseSalt = resolve;
    });
    const execute = jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("SELECT salt")) {
        await saltReady;
        return [[{ salt: SALT }]];
      }
      if (sql.startsWith("DELETE") || sql.startsWith("INSERT")) return [{ affectedRows: 0 }];
      return [[]];
    });
    mockDb(execute);

    const record = recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view()], now: NOW });
    const maintenance = runMaintenance(NOW);
    releaseSalt();
    await Promise.all([record, maintenance]);

    const sqls = execute.mock.calls.map(([sql]) => sql);
    const insertAt = sqls.findIndex((sql) => sql.startsWith("INSERT INTO bg_audience_views"));
    const rollupAt = sqls.findIndex((sql) => sql.includes("FROM bg_audience_views") && sql.includes("GROUP BY day"));
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeLessThan(rollupAt);
  });
});

describe("dailySalt — balayage en mémoire", () => {
  it("dailySalt_idleProcess_sweepForgetsClosedSalt", async () => {
    // 1 h 10 à Paris le 17 : le 16 est encore ouvert ; dix minutes plus tard, il est clos.
    jest.useFakeTimers({ now: new Date("2026-11-17T00:10:00Z") });
    const execute = emptyDatabase();
    mockDb(execute);
    await dailySalt("2026-11-16");

    jest.advanceTimersByTime(MAINTENANCE_INTERVAL_MS);
    await dailySalt("2026-11-16");

    // Oublié en mémoire, le sel est relu en base (sans en tirer un neuf : jour clos).
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("SELECT salt"))).toHaveLength(2);
    expect(saltWrites(execute)).toHaveLength(1);
    jest.useRealTimers();
  });
});

describe("délais bornés et jours repliés", () => {
  it("dailySalt_readHangs_rejectsAfterTimeout", async () => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(
      jest.fn<SqlQuery>(async (sql: string) => {
        if (sql.includes("SELECT salt")) return new Promise<never>(() => undefined);
        return [{ affectedRows: 1 }];
      }),
    );

    const salt = dailySalt("2026-11-16");
    const outcome = expect(salt).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(SALT_READ_TIMEOUT_MS);
    await outcome;
    jest.useRealTimers();
  });

  it("runMaintenance_recordStuck_rollsUpAfterWaitAndDropsLateRows", async () => {
    jest.useFakeTimers();
    let releaseSalt: () => void = () => undefined;
    const saltReady = new Promise<void>((resolve) => {
      releaseSalt = resolve;
    });
    const execute = jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("SELECT salt")) {
        await saltReady;
        return [[{ salt: SALT }]];
      }
      if (sql.startsWith("DELETE") || sql.startsWith("INSERT")) return [{ affectedRows: 0 }];
      return [[]];
    });
    mockDb(execute);
    // 1 h 20 à Paris : la veille (15) est repliable ; la page date de la veille au soir.
    const now = new Date("2026-11-16T00:20:00Z");

    const record = recordAudienceViews({
      ip: "203.0.113.7",
      userAgent: "Firefox",
      views: [view({ ageMs: 30 * 60_000 })],
      now,
    });
    const maintenance = runMaintenance(now);
    await jest.advanceTimersByTimeAsync(RECORDING_WAIT_MS);
    await maintenance;
    releaseSalt();
    jest.useRealTimers();

    expect(await record).toBe(0);
    expect(pendingAudienceCount()).toBe(0);
  });

  it("recordAudienceViews_noMaintenanceYet_keepsRowOfOpenDay", async () => {
    mockDb(emptyDatabase());

    const kept = await recordAudienceViews({
      ip: "203.0.113.7",
      userAgent: "Firefox",
      views: [view()],
      // 1 h 14 à Paris : la veille n'est pas encore repliable.
      now: new Date("2026-11-16T00:14:00Z"),
    });

    expect(kept).toBe(1);
  });

  it("getAudienceStats_community_countsRunningAndFinishedTournaments", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    const stats = await getAudienceStats(NOW);

    expect(stats.community?.tournaments).toBe(2);
    expect(execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("AS matches"))).toContain("state IN ('RUNNING', 'FINISHED')");
  });

  it("getAudienceStats_matchesCount_restrictedToPlayedStates", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    await getAudienceStats(NOW);

    expect(execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("AS matches"))).toContain("t.state IN ('RUNNING', 'FINISHED')");
  });

  it("RECORDING_WAIT_MS_exceedsSaltReadTimeout", () => {
    expect(RECORDING_WAIT_MS).toBeGreaterThan(SALT_READ_TIMEOUT_MS);
  });
});

describe("cycle 4 — jours repliés, quel que soit le processus", () => {
  /** Base dont le dernier jour replié est `lastRolled`. */
  function rolledDatabase(lastRolled: string | null): SqlMock {
    return jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("MAX(day)") && sql.includes("FROM bg_audience_days")) return [[{ day: lastRolled }]];
      if (sql.includes("SELECT salt")) return [[{ salt: SALT }]];
      if (sql.startsWith("DELETE") || sql.startsWith("INSERT")) return [{ affectedRows: 0 }];
      return [[]];
    });
  }

  function viewInserts(execute: SqlMock) {
    return execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO bg_audience_views"));
  }

  it("flushAudienceViews_rowsOfRolledDay_skipsThem", async () => {
    const execute = rolledDatabase("2026-11-16");
    mockDb(execute);
    await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view()], now: NOW });

    // Lendemain 3 h (Paris) : le 16 est devenu repliable, un autre processus l'a replié.
    await flushAudienceViews(new Date("2026-11-17T02:00:00Z"));

    expect(viewInserts(execute)).toHaveLength(0);
  });

  it("flushAudienceViews_rowsAfterRolledDay_inserted", async () => {
    const execute = rolledDatabase("2026-11-15");
    mockDb(execute);
    await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view()], now: NOW });

    await flushAudienceViews(new Date("2026-11-17T02:00:00Z"));

    expect(viewInserts(execute)).toHaveLength(1);
  });

  it("dailySalt_insert_guardedAgainstRolledDay", async () => {
    const execute = emptyDatabase();
    mockDb(execute);

    await dailySalt("2026-11-16", NOW);

    const [sql, params] = saltWrites(execute)[0];
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM bg_audience_days WHERE day >= ?)");
    expect((params as unknown[])[2]).toBe("2026-11-16");
  });

  it("recordAudienceViews_hugeOpenAgeAmongValid_keepsValidEntries", async () => {
    mockDb(emptyDatabase());

    const kept = await recordAudienceViews({
      ip: "203.0.113.7",
      userAgent: "Firefox",
      views: [view(), view({ isView: false, openedAgeMs: AUDIENCE_MAX_OPEN_AGE_MS })],
      now: NOW,
    });

    expect(kept).toBe(1);
  });

  it("runMaintenance_rollupFails_lateRowsOfDayStillRecorded", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(
      jest.fn<SqlQuery>(async (sql: string) => {
        if (sql.includes("GROUP BY day")) throw new Error("deadlock");
        if (sql.includes("SELECT salt")) return [[{ salt: SALT }]];
        return [{ affectedRows: 0 }];
      }),
    );
    // Entretien à 1 h 20 à Paris (le 15 devient repliable), puis un signalement
    // commencé à 1 h 14 (le 15 encore ouvert ; page de 23 h 54 le 15) qui finit après.
    await expect(runMaintenance(new Date("2026-11-16T00:20:00Z"))).rejects.toThrow("deadlock");

    const kept = await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view({ ageMs: 80 * 60_000 })], now: new Date("2026-11-16T00:14:00Z") });

    expect(kept).toBe(1);
  });

  it("runMaintenance_rollupSucceeds_lateRowsOfRolledDayDropped", async () => {
    mockDb(emptyDatabase());
    await runMaintenance(new Date("2026-11-16T00:20:00Z"));

    const kept = await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view({ ageMs: 80 * 60_000 })], now: new Date("2026-11-16T00:14:00Z") });

    expect(kept).toBe(0);
  });
});
