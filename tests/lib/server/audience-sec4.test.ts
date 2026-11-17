import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () =>
  jest.requireActual<typeof import("../../helpers/named-lock-passthrough")>("../../helpers/named-lock-passthrough").namedLockPassThrough(),
);
jest.mock("@/lib/server/tournaments/transaction");

import {
  AUDIENCE_FAIR_VIEWS,
  AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE,
  AUDIENCE_GLOBAL_IDENTITY_RULE,
  AUDIENCE_GLOBAL_FAIR_VIEW_RULE,
  AUDIENCE_GLOBAL_VIEW_RULE,
  AUDIENCE_IDENTITY_RULE,
  AUDIENCE_MAX_KEYS,
  AUDIENCE_UNKNOWN_NETWORK,
  admitAudienceViews,
  audienceNetworkKey,
  resetAudienceUnknownWarning,
} from "@/lib/server/api-guard";
import { resetAudienceState, rollUpAudienceDays } from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { chargeRateLimit, checkRateLimit, resetRateLimit, type RateLimitRule } from "@/lib/server/rate-limit";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import {
  anonymizeAudienceDay,
  inMemoryDistinctCounter,
  isAudienceScriptRequest,
  type AudienceDayAggregate,
  type AudienceDistinctCounter,
  type AudienceRawRow,
  type AudienceView,
} from "@/lib/shared/audience";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Sécurité, cycle 4 de `feature/stats-page` : réserve du site pour la part de
 * chaque réseau, registre des déjà vus plein sans perte, adresse forgée
 * ramenée au réseau commun, repli `Origin` sans `Sec-Fetch-*`, lignes sans
 * visiteur au repli, visiteurs distincts comptés en mémoire
 * (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

const BROWSER = "Mozilla/5.0 (Windows NT 10.0) Firefox/130.0";
const CHROME = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";
const NOW = new Date("2026-11-16T12:00:00Z");

/** Registre des navigateurs déjà vus (règle privée d'`api-guard`, mêmes nom et réglages). */
const SEEN_RULE: RateLimitRule = {
  name: "audience-identity-seen",
  limit: Number.MAX_SAFE_INTEGER,
  windowMs: 60_000,
  maxKeys: AUDIENCE_MAX_KEYS,
  overflow: "refuse",
  slide: true,
};

function view(overrides: Partial<AudienceView> = {}): AudienceView {
  return { pageKey: "home", locale: "fr", device: "mobile", source: "direct", isView: true, engagedMs: 0, ageMs: 0, openedAgeMs: 0, ...overrides };
}

function aggregate(overrides: Partial<AudienceDayAggregate> = {}): AudienceDayAggregate {
  return {
    totals: { views: 100, visitors: 30, visits: 40, bounces: 10, engagedMs: 1000 },
    pages: [],
    hours: [],
    dims: [],
    ...overrides,
  };
}

function rawRow(overrides: Partial<AudienceRawRow> = {}): AudienceRawRow {
  return {
    viewedAt: NOW,
    hour: 13,
    visitorKey: "v1",
    pageKey: "home",
    locale: "fr",
    device: "mobile",
    source: "direct",
    isView: true,
    engagedMs: 0,
    ...overrides,
  };
}

function fillSeenRegistry(): void {
  for (let i = 0; i < AUDIENCE_MAX_KEYS; i += 1) chargeRateLimit(SEEN_RULE, `filler-${i}`);
}

const neverCalled: AudienceDistinctCounter = async () => {
  throw new Error("distinct must not be called");
};

beforeEach(() => {
  resetRateLimit();
  resetAudienceUnknownWarning();
  resetAudienceState();
  jest.clearAllMocks();
});

afterEach(() => {
  resetRateLimit();
  resetAudienceState();
  jest.restoreAllMocks();
});

describe("audienceNetworkKey", () => {
  it("audienceNetworkKey_nonAddressValue_returnsUnknownNetwork", () => {
    expect(audienceNetworkKey("a1")).toBe(AUDIENCE_UNKNOWN_NETWORK);
  });

  it("audienceNetworkKey_ipv4OctetOver255_returnsUnknownNetwork", () => {
    expect(audienceNetworkKey("999.1.1.1")).toBe(AUDIENCE_UNKNOWN_NETWORK);
  });

  it("audienceNetworkKey_validIpv4_returnsAddress", () => {
    expect(audienceNetworkKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("audienceNetworkKey_validIpv6_returnsSlash64", () => {
    expect(audienceNetworkKey("2001:db8:1:2::5")).toBe("2001:db8:1:2::/64");
  });
});

describe("admitAudienceViews — cycle 4", () => {
  it("admitAudienceViews_forgedAddressValues_shareOneNetworkCap", () => {
    for (let i = 0; i < AUDIENCE_IDENTITY_RULE.limit; i += 1) admitAudienceViews(`a${i}`, `${BROWSER} n${i}`, [view({ isView: false })]);

    expect(admitAudienceViews("forged-other", `${BROWSER} late`, [view()])).toEqual([]);
  });

  // Cycle standard 5 : une réserve épuisée (réseaux forgés) renvoie la part
  // d'un foyer au plafond commun, qui a encore de la place.
  it("admitAudienceViews_fairViewReserveExhausted_fallsBackToSiteCap", () => {
    for (let i = 0; i < AUDIENCE_GLOBAL_FAIR_VIEW_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_FAIR_VIEW_RULE, "site");

    expect(admitAudienceViews("198.51.100.4", BROWSER, [view()])).toEqual([view()]);
    expect(checkRateLimit(AUDIENCE_GLOBAL_VIEW_RULE, "site").remaining).toBe(AUDIENCE_GLOBAL_VIEW_RULE.limit - 1);
  });

  it("admitAudienceViews_fairIdentityReserveExhausted_fallsBackToSiteCap", () => {
    for (let i = 0; i < AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE, "site");

    expect(admitAudienceViews("198.51.100.4", BROWSER, [view()])).toEqual([view()]);
    expect(checkRateLimit(AUDIENCE_GLOBAL_IDENTITY_RULE, "site").remaining).toBe(AUDIENCE_GLOBAL_IDENTITY_RULE.limit - 1);
  });

  it("admitAudienceViews_fairReserveAndSiteCapExhausted_viewRefused", () => {
    for (let i = 0; i < AUDIENCE_GLOBAL_FAIR_VIEW_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_FAIR_VIEW_RULE, "site");
    for (let i = 0; i < AUDIENCE_GLOBAL_VIEW_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_VIEW_RULE, "site");

    expect(admitAudienceViews("198.51.100.4", BROWSER, [view()])).toEqual([]);
  });

  it("admitAudienceViews_fairIdentityReserveAndSiteCapExhausted_newBrowserRefused", () => {
    for (let i = 0; i < AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE, "site");
    for (let i = 0; i < AUDIENCE_GLOBAL_IDENTITY_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_IDENTITY_RULE, "site");

    expect(admitAudienceViews("198.51.100.4", BROWSER, [view()])).toEqual([]);
  });

  it("admitAudienceViews_beyondFairShare_chargesSitePoolNotReserve", () => {
    const views = Array.from({ length: AUDIENCE_FAIR_VIEWS + 1 }, () => view());

    admitAudienceViews("198.51.100.4", BROWSER, views);

    expect(checkRateLimit(AUDIENCE_GLOBAL_FAIR_VIEW_RULE, "site").remaining).toBe(AUDIENCE_GLOBAL_FAIR_VIEW_RULE.limit - AUDIENCE_FAIR_VIEWS);
    expect(checkRateLimit(AUDIENCE_GLOBAL_VIEW_RULE, "site").remaining).toBe(AUDIENCE_GLOBAL_VIEW_RULE.limit - 1);
  });

  it("admitAudienceViews_seenRegistryFull_newBrowserAdmittedAsNew", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    fillSeenRegistry();

    const admitted = admitAudienceViews("198.51.100.4", BROWSER, [view()]);

    expect(admitted).toEqual([view()]);
    expect(checkRateLimit(AUDIENCE_IDENTITY_RULE, "198.51.100.4").remaining).toBe(AUDIENCE_IDENTITY_RULE.limit - 1);
  });

  it("admitAudienceViews_seenRegistryFull_eachSendCountsAsNewIdentity", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    fillSeenRegistry();

    admitAudienceViews("198.51.100.4", BROWSER, [view({ isView: false })]);
    admitAudienceViews("198.51.100.4", BROWSER, [view({ isView: false })]);

    expect(checkRateLimit(AUDIENCE_IDENTITY_RULE, "198.51.100.4").remaining).toBe(AUDIENCE_IDENTITY_RULE.limit - 2);
  });

  it("admitAudienceViews_seenRegistryFull_warnsOncePerInterval", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    fillSeenRegistry();

    admitAudienceViews("198.51.100.4", BROWSER, [view({ isView: false })]);
    admitAudienceViews("198.51.100.5", BROWSER, [view({ isView: false })]);

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("isAudienceScriptRequest — repli Origin", () => {
  it("isAudienceScriptRequest_noSecFetchModernBrowserWithOrigin_true", () => {
    expect(isAudienceScriptRequest(new Headers({ origin: "https://bluegenji.test" }), CHROME)).toBe(true);
  });
});

describe("anonymizeAudienceDay — lignes sans visiteur", () => {
  it("anonymizeAudienceDay_zeroVisitorPageAlone_noAbsorptionRowDropped", async () => {
    const day = aggregate({
      pages: [
        { pageKey: "home", views: 20, visitors: 8, engagedMs: 100 },
        { pageKey: "team", views: 9, visitors: 6, engagedMs: 50 },
        { pageKey: "rules", views: 0, visitors: 0, engagedMs: 70 },
      ],
    });

    const result = await anonymizeAudienceDay(day, neverCalled);

    expect(result.pages).toEqual([
      { pageKey: "team", views: 9, visitors: 6, engagedMs: 50 },
      { pageKey: "home", views: 20, visitors: 8, engagedMs: 100 },
    ]);
  });

  it("anonymizeAudienceDay_zeroVisitorPageWithKeptOther_timeJoinsOther", async () => {
    const day = aggregate({
      pages: [
        { pageKey: "home", views: 20, visitors: 8, engagedMs: 100 },
        { pageKey: "team", views: 4, visitors: 3, engagedMs: 40 },
        { pageKey: "player", views: 3, visitors: 2, engagedMs: 30 },
        { pageKey: "rules", views: 0, visitors: 0, engagedMs: 70 },
      ],
    });

    const result = await anonymizeAudienceDay(day, async () => 5);

    expect(result.pages).toContainEqual({ pageKey: "other", views: 7, visitors: 5, engagedMs: 140 });
  });
});

describe("inMemoryDistinctCounter", () => {
  it("inMemoryDistinctCounter_visitorOnSeveralValues_countedOnce", async () => {
    const counter = inMemoryDistinctCounter([
      rawRow({ visitorKey: "v1", pageKey: "team" }),
      rawRow({ visitorKey: "v1", pageKey: "player" }),
      rawRow({ visitorKey: "v2", pageKey: "player" }),
    ]);

    expect(await counter("page", ["team", "player"])).toBe(2);
  });

  it("inMemoryDistinctCounter_continuationRows_ignored", async () => {
    const counter = inMemoryDistinctCounter([
      rawRow({ visitorKey: "v1", device: "desktop" }),
      rawRow({ visitorKey: "v2", device: "desktop", isView: false }),
    ]);

    expect(await counter("device", ["desktop"])).toBe(1);
  });
});

describe("rollUpAudienceDays — jour d'une seule tranche", () => {
  it("rollUpDay_singleShard_countsDistinctInMemoryWithoutSql", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[{ day: "2026-11-14" }]]) }));
    const raw = (visitor: string, page: string) => ({
      viewed_at: "2026-11-14 18:00:00",
      hour: 19,
      visitor_key: visitor,
      page_key: page,
      locale: "fr",
      device: "mobile",
      source: "direct",
      is_view: 1,
      engaged_ms: 0,
    });
    const connection = connectionMock();
    connection.execute.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*) AS total")
        ? [[{ total: 2 }]]
        : sql.includes("SELECT viewed_at")
        ? [[raw("v1", "team"), raw("v2", "player")]]
        : [{ affectedRows: 1 }],
    );
    jest.mocked(inTransaction).mockImplementation(async (run) => run(fakeConnection(connection)));

    await rollUpAudienceDays(NOW);

    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("COUNT(DISTINCT"))).toBe(false);
  });
});
