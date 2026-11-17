import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/transaction");

import {
  FLUSH_SIZE,
  getAudienceStats,
  INSERT_CHUNK,
  maintainAudience,
  pendingAudienceCount,
  recordAudienceViews,
  resetAudienceState,
  ROLLUP_SHARD_ROWS,
  rollUpAudienceDays,
} from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import type { AudienceView } from "@/lib/shared/audience";
import { connectionMock, fakeConnection, fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";
import { readSource } from "../../helpers/read-source";

/** Performance, cycle 1 de `feature/stats-page` : écriture, repli, lecture, côté client. */

const NOW = new Date("2026-11-16T12:00:00Z");
const SALT = Buffer.alloc(32, 7);

function view(overrides: Partial<AudienceView> = {}): AudienceView {
  return { pageKey: "home", locale: "fr", device: "mobile", source: "direct", isView: true, engagedMs: 4000, ageMs: 0, openedAgeMs: 0, ...overrides };
}

function mockDb(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

function baseDatabase(extra?: (sql: string) => Promise<unknown> | undefined): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    const custom = extra?.(sql);
    if (custom) return custom;
    if (sql.includes("AS players")) return [[{ players: 5, teams: 4, tournaments: 9 }]];
    if (sql.includes("AS matches")) return [[{ matches: 3, tournaments: 2 }]];
    if (sql.includes("SELECT salt")) return [[{ salt: SALT }]];
    if (sql.startsWith("DELETE") || sql.startsWith("INSERT")) return [{ affectedRows: 0 }];
    return [[]];
  });
}

const inserts = (execute: SqlMock) => execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO bg_audience_views"));
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  resetAudienceState();
  jest.clearAllMocks();
});

afterEach(() => {
  resetAudienceState();
  jest.restoreAllMocks();
});

describe("getAudienceStats — jamais derrière l'entretien", () => {
  it("getAudienceStats_maintenanceStuck_stillAnswers", async () => {
    // Le repli ne finit jamais : la page se lit quand même.
    mockDb(baseDatabase((sql) => (sql.includes("FROM bg_audience_views") && sql.includes("GROUP BY day") ? new Promise(() => undefined) : undefined)));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const stats = await getAudienceStats(NOW);

    expect(stats.daily).toEqual([]);
    expect(stats.community).not.toBeNull();
  });

  it("getAudienceStats_cachedAndMaintenanceDue_servesCache", async () => {
    mockDb(baseDatabase());
    const first = await getAudienceStats(NOW);

    const second = await getAudienceStats(new Date(NOW.getTime() + 9 * 60_000));

    expect(second).toBe(first);
  });
});

describe("flushAudienceViews — rafales", () => {
  it("flush_queueAtThresholdWhileWriting_flushesAgainWithoutTimer", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const execute = baseDatabase((sql) => {
      if (!sql.startsWith("INSERT INTO bg_audience_views") || !first) return undefined;
      first = false;
      return gate.then(() => [{ affectedRows: 1 }]);
    });
    mockDb(execute);
    await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: Array.from({ length: FLUSH_SIZE }, () => view()), now: NOW });
    await settle();
    // L'écriture est en cours ; une nouvelle rafale remplit la file.
    await recordAudienceViews({ ip: "203.0.113.8", userAgent: "Firefox", views: Array.from({ length: FLUSH_SIZE }, () => view()), now: NOW });
    expect(pendingAudienceCount()).toBe(FLUSH_SIZE);

    release();
    await settle();
    await settle();

    expect(inserts(execute)).toHaveLength(2);
    expect(pendingAudienceCount()).toBe(0);
  });

  it("flush_hugeQueue_splitsInsertsByChunk", async () => {
    const execute = baseDatabase();
    mockDb(execute);
    const total = INSERT_CHUNK * 2 + 500;

    await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: Array.from({ length: total }, () => view()), now: NOW });
    await settle();
    await settle();

    const calls = inserts(execute);
    expect(calls).toHaveLength(3);
    expect(calls.map(([, params]) => (params as unknown[]).length / 10)).toEqual([INSERT_CHUNK, INSERT_CHUNK, 500]);
  });

  it("flush_rowsOfCurrentDay_skipsLastRolledDayLookup", async () => {
    const execute = baseDatabase();
    mockDb(execute);

    await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: Array.from({ length: FLUSH_SIZE }, () => view()), now: NOW });
    await settle();

    expect(execute.mock.calls.some(([sql]) => sql.includes("MAX(day)"))).toBe(false);
    expect(inserts(execute)).toHaveLength(1);
  });
});

describe("rollUpAudienceDays — mémoire bornée", () => {
  function rollConnection(total: number, rowsByShard: (shard: number) => unknown[]) {
    const connection = connectionMock();
    connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
      if (sql.includes("COUNT(*) AS total")) return [[{ total }]];
      if (sql.includes("SELECT viewed_at")) {
        const list = params as unknown[];
        return [rowsByShard(list.length === 3 ? Number(list[2]) : 0)];
      }
      return [{ affectedRows: 1 }];
    });
    jest.mocked(inTransaction).mockImplementation(async (run) => run(fakeConnection(connection)));
    return connection;
  }

  const raw = (visitor: string, hour: number) => ({
    viewed_at: `2026-11-14 ${String(hour).padStart(2, "0")}:00:00`,
    hour,
    visitor_key: visitor,
    page_key: "home",
    locale: "fr",
    device: "mobile",
    source: "search",
    is_view: 1,
    engaged_ms: 1000,
  });

  beforeEach(() => {
    mockDb(jest.fn<SqlQuery>().mockResolvedValue([[{ day: "2026-11-14" }]]));
  });

  it("rollUpDay_smallDay_oneUnshardedSelect", async () => {
    const connection = rollConnection(10, () => [raw("a", 10)]);

    await rollUpAudienceDays(NOW);

    const selects = connection.execute.mock.calls.filter(([sql]) => sql.includes("SELECT viewed_at"));
    expect(selects).toHaveLength(1);
    expect(selects[0][0]).not.toContain("CRC32");
    expect(selects[0][1]).toEqual(["2026-11-14"]);
  });

  it("rollUpDay_hugeDay_shardsByVisitorAndAddsCounters", async () => {
    const connection = rollConnection(ROLLUP_SHARD_ROWS * 2 + 1, (shard) => [raw(`visitor-${shard}`, 10 + shard)]);

    await rollUpAudienceDays(NOW);

    const selects = connection.execute.mock.calls.filter(([sql]) => sql.includes("SELECT viewed_at"));
    expect(selects).toHaveLength(3);
    expect(selects.map(([, params]) => params)).toEqual([
      ["2026-11-14", 3, 0],
      ["2026-11-14", 3, 1],
      ["2026-11-14", 3, 2],
    ]);
    expect(selects[0][0]).toContain("MOD(CRC32(visitor_key), ?) = ?");
    const day = connection.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO bg_audience_days"));
    // 3 visiteurs, 3 pages vues, 3 visites, 3 rebonds, aucune suite (0 s) : somme des tranches.
    expect(day?.[1]).toEqual(["2026-11-14", 3, 3, 3, 3, 0]);
    // Trois visiteurs en tout : sous le seuil, aucune heure n'est écrite (k-anonymat).
    const hours = connection.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO bg_audience_day_hours"));
    expect(hours).toBeUndefined();
  });
});

describe("maintainAudience", () => {
  it("maintainAudience_secondCallWithinInterval_isNoop", async () => {
    const execute = baseDatabase();
    mockDb(execute);
    maintainAudience(NOW);
    await settle();
    await settle();
    const calls = execute.mock.calls.length;

    maintainAudience(new Date(NOW.getTime() + 1000));
    await settle();

    expect(execute.mock.calls).toHaveLength(calls);
  });
});

describe("côté navigateur et page", () => {
  it("beacon_followsClientPower_andDefersToIdle", () => {
    const source = readSource("components/audience-beacon.tsx");

    expect(source).toContain("powerPolicy(getClientPowerInput()).clocks");
    expect(source).toContain("subscribeClientPower(syncTimer)");
    expect(source).toContain("requestIdleCallback");
    // Aucun minuteur posé sans passer par le régime de charge.
    expect(source.match(/window\.setInterval/g)).toHaveLength(1);
    expect(source.indexOf("window.setInterval")).toBeGreaterThan(source.indexOf("const syncTimer"));
  });

  it("route_runsMaintenanceOnlyForMeasuredTraffic", () => {
    const source = readSource("app/api/audience/route.ts");

    expect(source.indexOf("maintainAudience();")).toBeGreaterThan(source.indexOf("enforceRateLimit"));
  });

  it("chart_effectIgnoresToastIdentity", () => {
    const source = readSource("app/frequentation/AudienceChart.tsx");

    expect(source).toContain("toastRef.current?.showError");
    expect(source).not.toMatch(/failedLabel, toast\]/);
  });

  it("heatmap_rowsAreMemoizedWithPrimitiveProps", () => {
    const source = readSource("app/frequentation/AudienceDashboard.tsx");

    expect(source).toContain("const HeatRow = memo(function HeatRow");
    expect(source).not.toContain("cellLabel=");
    expect(source).toContain("tabHour={tabStop.day === day ? tabStop.hour : -1}");
  });
});
