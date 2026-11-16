import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/transaction");

import {
  audienceVisitorKey,
  dailySalt,
  flushAudienceViews,
  getAudienceStats,
  lastRollableDay,
  pendingAudienceCount,
  purgeAudienceViews,
  rawRetentionStart,
  recordAudienceViews,
  resetAudienceState,
  rollUpAudienceDays,
} from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import type { AudienceView } from "@/lib/shared/audience";
import { connectionMock, fakeConnection, fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/** Statistiques de fréquentation détaillées, registre T19 (`docs/features/AUDIENCE_MEASUREMENT.md`). */

const NOW = new Date("2026-11-16T12:00:00Z");

function view(overrides: Partial<AudienceView> = {}): AudienceView {
  return { pageKey: "home", locale: "fr", device: "mobile", source: "direct", isView: true, engagedMs: 4000, ageMs: 0, ...overrides };
}

function mockDb(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

/** Base vide : rien à replier, rien à purger, aucun jour compté, communauté à 3. */
function emptyDatabase(): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (sql.includes("COUNT(*)")) return [[{ n: 3 }]];
    if (sql.startsWith("DELETE")) return [{ affectedRows: 0 }];
    return [[]];
  });
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
  it("garde le même sel toute la journée", () => {
    expect(dailySalt("2026-11-16").equals(dailySalt("2026-11-16"))).toBe(true);
  });

  it("tire un sel neuf au jour suivant", () => {
    const first = dailySalt("2026-11-16");

    expect(dailySalt("2026-11-17").equals(first)).toBe(false);
  });
});

describe("audienceVisitorKey", () => {
  it("rend la même empreinte le même jour pour la même IP et le même navigateur", () => {
    expect(audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox")).toBe(audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox"));
  });

  it("ne relie pas deux jours", () => {
    const monday = audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox");

    expect(audienceVisitorKey("2026-11-17", "203.0.113.7", "Firefox")).not.toBe(monday);
  });

  it("ne contient pas l'adresse IP", () => {
    expect(audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("recordAudienceViews", () => {
  it("écarte une page vue antérieure à la veille", () => {
    mockDb(emptyDatabase());

    const kept = recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view({ ageMs: 2 * 86_400_000 }), view()], now: NOW });

    expect(kept).toBe(1);
    expect(pendingAudienceCount()).toBe(1);
  });

  it("cesse de retenir au-delà de 5 000 pages en attente", () => {
    mockDb(emptyDatabase());
    const views = Array.from({ length: 5001 }, () => view());

    expect(recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views, now: NOW })).toBe(5000);
  });
});

describe("flushAudienceViews", () => {
  it("écrit la file en un seul INSERT, sans l'adresse IP", async () => {
    const execute = emptyDatabase();
    mockDb(execute);
    recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view(), view({ pageKey: "rules" })], now: NOW });

    await flushAudienceViews();

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("INSERT INTO bg_audience_views");
    expect(params).toHaveLength(20);
    expect(params).not.toContain("203.0.113.7");
    expect(pendingAudienceCount()).toBe(0);
  });

  it("perd le lot et le journalise quand la base refuse l'écriture", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("down"));
    mockDb(execute);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view()], now: NOW });

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
      sql.includes("SELECT viewed_at")
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
      "SELECT viewed_at, hour,",
      "DELETE FROM bg_audience_day_pages",
      "DELETE FROM bg_audience_day_hours",
      "DELETE FROM bg_audience_day_dims",
      "DELETE FROM bg_audience_days",
      "INSERT INTO bg_audience_day_pages",
      "INSERT INTO bg_audience_day_hours",
      "INSERT INTO bg_audience_day_dims",
      "INSERT INTO bg_audience_days",
    ]);
    expect(connection.execute.mock.calls[8][1]).toEqual(["2026-11-14", 1, 1, 1, 1, 3000]);
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
    expect(stats.community).toEqual({ tournaments: 3, matches: 3, teams: 3, players: 3 });
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
