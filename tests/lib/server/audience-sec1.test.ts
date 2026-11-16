import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/transaction");

import {
  AUDIENCE_IDENTITY_RULE,
  AUDIENCE_UNKNOWN_NETWORK,
  AUDIENCE_VIEW_RULE,
  admitAudienceViews,
  audienceNetworkKey,
} from "@/lib/server/api-guard";
import {
  FLUSH_SIZE,
  MAX_PENDING,
  getAudienceStats,
  pendingAudienceCount,
  recordAudienceViews,
  resetAudienceState,
} from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { resetRateLimit } from "@/lib/server/rate-limit";
import type { AudienceView } from "@/lib/shared/audience";
import { fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/**
 * Sécurité, cycle 1 de `feature/stats-page` : signalements fabriqués
 * (plafonds par réseau, navigateurs distincts), file partagée, petits nombres
 * sur la page publique (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

const NOW = new Date("2026-11-16T12:00:00Z");
const SALT = Buffer.alloc(32, 7);
const BROWSER = "Mozilla/5.0 (Windows NT 10.0) Firefox/130.0";

function view(overrides: Partial<AudienceView> = {}): AudienceView {
  return { pageKey: "home", locale: "fr", device: "mobile", source: "direct", isView: true, engagedMs: 0, ageMs: 0, openedAgeMs: 0, ...overrides };
}

const continuation = () => view({ isView: false, engagedMs: 60_000, source: "internal" });

function mockDb(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

function database(extra?: (sql: string) => Promise<unknown> | undefined): SqlMock {
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

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  resetAudienceState();
  resetRateLimit();
  jest.clearAllMocks();
});

afterEach(() => {
  resetAudienceState();
  resetRateLimit();
  jest.restoreAllMocks();
});

describe("audienceNetworkKey", () => {
  it("audienceNetworkKey_ipv6AddressesOfOneSlash64_sameKey", () => {
    expect(audienceNetworkKey("2001:db8:1:2::a")).toBe(audienceNetworkKey("2001:db8:1:2:ffff::9"));
  });

  it("audienceNetworkKey_nullIp_sharedUnknownNetwork", () => {
    expect(audienceNetworkKey(null)).toBe(AUDIENCE_UNKNOWN_NETWORK);
  });
});

describe("admitAudienceViews", () => {
  it("admitAudienceViews_underLimits_keepsAllViews", () => {
    const views = [view(), continuation()];

    expect(admitAudienceViews("203.0.113.7", BROWSER, views)).toEqual(views);
  });

  it("admitAudienceViews_viewsOverViewRule_dropsExtraViewsKeepsContinuations", () => {
    admitAudienceViews("203.0.113.7", BROWSER, Array.from({ length: AUDIENCE_VIEW_RULE.limit }, () => view()));

    const admitted = admitAudienceViews("203.0.113.7", BROWSER, [view(), continuation()]);

    expect(admitted).toEqual([continuation()]);
  });

  it("admitAudienceViews_newUserAgentsOverIdentityRule_returnsEmpty", () => {
    for (let i = 0; i < AUDIENCE_IDENTITY_RULE.limit; i += 1) admitAudienceViews("203.0.113.7", `${BROWSER} n${i}`, [view()]);

    expect(admitAudienceViews("203.0.113.7", `${BROWSER} other`, [view()])).toEqual([]);
  });

  it("admitAudienceViews_sameUserAgentRepeated_countsOneIdentity", () => {
    for (let i = 0; i < AUDIENCE_IDENTITY_RULE.limit + 10; i += 1) admitAudienceViews("203.0.113.7", BROWSER, [continuation()]);

    expect(admitAudienceViews("203.0.113.7", BROWSER, [view()])).toEqual([view()]);
  });

  it("admitAudienceViews_identityCapOfOneNetwork_leavesOtherNetworksAlone", () => {
    for (let i = 0; i <= AUDIENCE_IDENTITY_RULE.limit; i += 1) admitAudienceViews("203.0.113.7", `${BROWSER} n${i}`, [view()]);

    expect(admitAudienceViews("198.51.100.4", `${BROWSER} other`, [view()])).toEqual([view()]);
  });
});

describe("recordAudienceViews — file partagée", () => {
  it("recordAudienceViews_queueHalfFull_keepsOneRowPerRequest", async () => {
    // L'écriture ne finit pas (base lente) : la file se remplit.
    mockDb(database((sql) => (sql.startsWith("INSERT INTO bg_audience_views") ? new Promise(() => undefined) : undefined)));
    await recordAudienceViews({ ip: "203.0.113.7", userAgent: BROWSER, views: Array.from({ length: FLUSH_SIZE }, () => view()), now: NOW });
    await settle();
    await recordAudienceViews({ ip: "203.0.113.8", userAgent: BROWSER, views: Array.from({ length: MAX_PENDING / 2 }, () => view()), now: NOW });

    const kept = await recordAudienceViews({ ip: "203.0.113.9", userAgent: BROWSER, views: [view(), view(), view()], now: NOW });

    expect(kept).toBe(1);
    expect(pendingAudienceCount()).toBe(MAX_PENDING / 2 + 1);
  });

  it("recordAudienceViews_queueUnderHalf_keepsWholeBatch", async () => {
    mockDb(database());

    const kept = await recordAudienceViews({ ip: "203.0.113.9", userAgent: BROWSER, views: [view(), view(), view()], now: NOW });

    expect(kept).toBe(3);
  });
});

describe("getAudienceStats — petits nombres", () => {
  it("getAudienceStats_smallAndRetiredPageTypes_foldedIntoOther", async () => {
    mockDb(
      database((sql) =>
        sql.includes("FROM bg_audience_day_pages")
          ? Promise.resolve([
              [
                { page_key: "home", views: 40, visitors: 12, engaged_ms: 1000 },
                { page_key: "admin", views: 9, visitors: 2, engaged_ms: 500 },
                { page_key: "rules", views: 6, visitors: 4, engaged_ms: 300 },
              ],
            ])
          : undefined,
      ),
    );

    const stats = await getAudienceStats(NOW);

    expect(stats.ranges["7d"].pages).toEqual([
      { key: "home", views: 40, visitors: 12, engagedMs: 1000 },
      { key: "other", views: 15, visitors: 6, engagedMs: 800 },
    ]);
  });
});
