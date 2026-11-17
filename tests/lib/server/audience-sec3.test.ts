import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/transaction");

import {
  AUDIENCE_FAIR_IDENTITIES,
  AUDIENCE_FAIR_VIEWS,
  AUDIENCE_GLOBAL_IDENTITY_RULE,
  AUDIENCE_GLOBAL_VIEW_RULE,
  AUDIENCE_MAX_KEYS,
  AUDIENCE_VIEW_RULE,
  AUDIENCE_WIDE_VIEW_RULE,
  admitAudienceViews,
  resetAudienceUnknownWarning,
} from "@/lib/server/api-guard";
import { audienceVisitorKey, resetAudienceState, rollUpAudienceDays } from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { chargeRateLimit, checkRateLimit, resetRateLimit, type RateLimitRule } from "@/lib/server/rate-limit";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import {
  AUDIENCE_SMALL_KEY,
  anonymizeAudienceDay,
  isAudienceScriptRequest,
  sendsFetchMetadata,
  type AudienceDayAggregate,
  type AudienceDistinctCounter,
  type AudienceView,
} from "@/lib/shared/audience";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Sécurité, cycle 3 de `feature/stats-page` : k-anonymat écrit au repli avec
 * suppression complémentaire, filtre `Sec-Fetch` selon le navigateur, seaux
 * triés (purge par la tête, refus vu au contrôle, fenêtre glissante), part de
 * chaque réseau hors plafonds du site, empreinte par réseau `/64`
 * (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

const BROWSER = "Mozilla/5.0 (Windows NT 10.0) Firefox/130.0";
const NOW = new Date("2026-11-16T12:00:00Z");

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

describe("anonymizeAudienceDay", () => {
  it("anonymizeAudienceDay_allRowsAtThreshold_keepsRowsUnchanged", async () => {
    const day = aggregate({
      pages: [{ pageKey: "home", views: 9, visitors: 5, engagedMs: 50 }],
      hours: [{ hour: 20, views: 9, visitors: 5 }],
      dims: [{ dim: "device", value: "mobile", views: 9, visitors: 5 }],
    });

    const safe = await anonymizeAudienceDay(day, neverCalled);

    expect(safe).toEqual(day);
  });

  it("anonymizeAudienceDay_oneSmallPageAndBigOnes_complementsWithNextSmallest", async () => {
    const distinct = jest.fn<AudienceDistinctCounter>().mockResolvedValue(8);
    const day = aggregate({
      pages: [
        { pageKey: "home", views: 30, visitors: 12, engagedMs: 300 },
        { pageKey: "tournament", views: 10, visitors: 7, engagedMs: 70 },
        { pageKey: "team", views: 1, visitors: 1, engagedMs: 10 },
      ],
    });

    const safe = await anonymizeAudienceDay(day, distinct);

    expect(safe.pages).toEqual([
      { pageKey: "home", views: 30, visitors: 12, engagedMs: 300 },
      { pageKey: "other", views: 11, visitors: 8, engagedMs: 80 },
    ]);
  });

  it("anonymizeAudienceDay_smallRowsTogether_otherCountsDistinctVisitors", async () => {
    const distinct = jest.fn<AudienceDistinctCounter>().mockResolvedValue(5);
    const day = aggregate({
      pages: [
        { pageKey: "home", views: 40, visitors: 20, engagedMs: 0 },
        { pageKey: "team", views: 3, visitors: 3, engagedMs: 0 },
        { pageKey: "player", views: 3, visitors: 3, engagedMs: 0 },
      ],
    });

    const safe = await anonymizeAudienceDay(day, distinct);

    expect(safe.pages).toContainEqual({ pageKey: "other", views: 6, visitors: 5, engagedMs: 0 });
  });

  it("anonymizeAudienceDay_wholeDayUnderThreshold_dropsBreakdownsKeepsTotals", async () => {
    const distinct = jest.fn<AudienceDistinctCounter>().mockResolvedValue(3);
    const day = aggregate({
      totals: { views: 4, visitors: 3, visits: 3, bounces: 2, engagedMs: 10 },
      pages: [
        { pageKey: "home", views: 2, visitors: 2, engagedMs: 5 },
        { pageKey: "team", views: 2, visitors: 2, engagedMs: 5 },
      ],
      hours: [
        { hour: 3, views: 2, visitors: 2 },
        { hour: 4, views: 2, visitors: 2 },
      ],
      dims: [
        { dim: "device", value: "mobile", views: 2, visitors: 2 },
        { dim: "device", value: "desktop", views: 2, visitors: 1 },
      ],
    });

    const safe = await anonymizeAudienceDay(day, distinct);

    expect(safe).toEqual({ totals: day.totals, pages: [], hours: [], dims: [] });
  });

  it("anonymizeAudienceDay_unknownAndOtherKeysAboveThreshold_foldedIntoOther", async () => {
    const distinct = jest.fn<AudienceDistinctCounter>().mockResolvedValue(11);
    const day = aggregate({
      pages: [
        { pageKey: "other", views: 6, visitors: 6, engagedMs: 1 },
        { pageKey: "retired-key", views: 6, visitors: 6, engagedMs: 2 },
      ],
    });

    const safe = await anonymizeAudienceDay(day, distinct);

    expect(safe.pages).toEqual([{ pageKey: "other", views: 12, visitors: 11, engagedMs: 3 }]);
  });

  it("anonymizeAudienceDay_smallDeviceRow_becomesSmallKey", async () => {
    const distinct = jest.fn<AudienceDistinctCounter>().mockResolvedValue(9);
    const day = aggregate({
      dims: [
        { dim: "device", value: "desktop", views: 20, visitors: 12 },
        { dim: "device", value: "mobile", views: 9, visitors: 7 },
        { dim: "device", value: "tablet", views: 1, visitors: 1 },
      ],
    });

    const safe = await anonymizeAudienceDay(day, distinct);

    expect(safe.dims).toEqual([
      { dim: "device", value: "desktop", views: 20, visitors: 12 },
      { dim: "device", value: AUDIENCE_SMALL_KEY, views: 10, visitors: 9 },
    ]);
  });

  it("anonymizeAudienceDay_smallHourWithComplement_neitherWritten", async () => {
    const distinct = jest.fn<AudienceDistinctCounter>().mockResolvedValue(7);
    const day = aggregate({
      hours: [
        { hour: 21, views: 50, visitors: 20 },
        { hour: 22, views: 10, visitors: 6 },
        { hour: 3, views: 4, visitors: 1 },
      ],
    });

    const safe = await anonymizeAudienceDay(day, distinct);

    expect(safe.hours).toEqual([{ hour: 21, views: 50, visitors: 20 }]);
  });

  it("anonymizeAudienceDay_foldOfSeveralRows_passesDimAndValuesToCounter", async () => {
    const distinct = jest.fn<AudienceDistinctCounter>().mockResolvedValue(5);
    const day = aggregate({
      dims: [
        { dim: "source", value: "direct", views: 30, visitors: 15 },
        { dim: "source", value: "video", views: 2, visitors: 2 },
        { dim: "source", value: "social", views: 3, visitors: 3 },
      ],
    });

    await anonymizeAudienceDay(day, distinct);

    expect(distinct).toHaveBeenCalledWith("source", ["video", "social"]);
  });
});

describe("sendsFetchMetadata", () => {
  it("sendsFetchMetadata_chrome76_true", () => {
    expect(sendsFetchMetadata("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/76.0.0.0 Safari/537.36")).toBe(true);
  });

  it("sendsFetchMetadata_chrome75_false", () => {
    expect(sendsFetchMetadata("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/75.0.0.0 Safari/537.36")).toBe(false);
  });

  it("sendsFetchMetadata_firefox90_true", () => {
    expect(sendsFetchMetadata("Mozilla/5.0 (X11; Linux x86_64; rv:90.0) Gecko/20100101 Firefox/90.0")).toBe(true);
  });

  it("sendsFetchMetadata_firefox89_false", () => {
    expect(sendsFetchMetadata("Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0")).toBe(false);
  });

  it("sendsFetchMetadata_ios16_4ChromeShell_true", () => {
    expect(sendsFetchMetadata("Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1")).toBe(true);
  });

  it("sendsFetchMetadata_ios16_3ChromeShell_false", () => {
    expect(sendsFetchMetadata("Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });

  it("sendsFetchMetadata_macSafari16_4_true", () => {
    expect(sendsFetchMetadata("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/16.4 Safari/605.1.15")).toBe(true);
  });

  it("sendsFetchMetadata_macSafari16_3_false", () => {
    expect(sendsFetchMetadata("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/16.3 Safari/605.1.15")).toBe(false);
  });

  it("sendsFetchMetadata_unknownOrMissing_false", () => {
    expect(sendsFetchMetadata("SomeWebView/1.0")).toBe(false);
    expect(sendsFetchMetadata(null)).toBe(false);
  });
});

describe("isAudienceScriptRequest", () => {
  const none = new Headers();

  it("isAudienceScriptRequest_noHeadersModernBrowser_false", () => {
    expect(isAudienceScriptRequest(none, BROWSER)).toBe(false);
  });

  it("isAudienceScriptRequest_noHeadersOldSafari_true", () => {
    expect(isAudienceScriptRequest(none, "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) Version/15.6 Mobile/15E148 Safari/604.1")).toBe(true);
  });
});

describe("rate-limit — seaux triés", () => {
  const REFUSE: RateLimitRule = { name: "sec3-refuse", limit: 1, windowMs: 60_000, maxKeys: 2, overflow: "refuse" };
  const SLIDE: RateLimitRule = { name: "sec3-slide", limit: 100, windowMs: 60_000, slide: true };
  const FIXED: RateLimitRule = { name: "sec3-fixed", limit: 100, windowMs: 60_000 };

  it("checkRateLimit_refuseBucketFullNewKey_refusedUntilOldestWindowEnds", () => {
    chargeRateLimit(REFUSE, "a", 0);
    chargeRateLimit(REFUSE, "b", 10_000);

    const state = checkRateLimit(REFUSE, "c", 20_000);

    expect(state).toEqual({ allowed: false, remaining: 0, retryAfterMs: 40_000 });
  });

  it("checkRateLimit_refuseBucketFullExistingKeyWithQuota_allowed", () => {
    const rule: RateLimitRule = { ...REFUSE, name: "sec3-refuse-quota", limit: 5 };
    chargeRateLimit(rule, "a", 0);
    chargeRateLimit(rule, "b", 0);

    expect(checkRateLimit(rule, "a", 1000).allowed).toBe(true);
  });

  it("chargeRateLimit_refuseBucketFullHeadExpired_admitsNewKey", () => {
    chargeRateLimit(REFUSE, "a", 0);
    chargeRateLimit(REFUSE, "b", 30_000);

    expect(chargeRateLimit(REFUSE, "c", 60_000).allowed).toBe(true);
  });

  it("chargeRateLimit_refuseBucketFull_retryAfterIsOldestWindowEnd", () => {
    chargeRateLimit(REFUSE, "a", 0);
    chargeRateLimit(REFUSE, "b", 10_000);

    expect(chargeRateLimit(REFUSE, "c", 59_000).retryAfterMs).toBe(1000);
  });

  it("chargeRateLimit_expiredKeyRestarted_movesToTail", () => {
    chargeRateLimit(REFUSE, "a", 0);
    chargeRateLimit(REFUSE, "b", 30_000);
    chargeRateLimit(REFUSE, "a", 61_000);

    // « b » est désormais la plus ancienne fenêtre : elle seule borne l'attente.
    expect(checkRateLimit(REFUSE, "c", 62_000).retryAfterMs).toBe(28_000);
  });

  it("chargeRateLimit_slideRule_extendsWindowFromLastCharge", () => {
    chargeRateLimit(SLIDE, "k", 0);
    chargeRateLimit(SLIDE, "k", 50_000);

    expect(checkRateLimit(SLIDE, "k", 100_000).remaining).toBe(SLIDE.limit - 2);
  });

  it("chargeRateLimit_fixedRule_windowEndsFromFirstCharge", () => {
    chargeRateLimit(FIXED, "k", 0);
    chargeRateLimit(FIXED, "k", 50_000);

    expect(checkRateLimit(FIXED, "k", 100_000).remaining).toBe(FIXED.limit);
  });
});

describe("admitAudienceViews — cycle 3", () => {
  it("admitAudienceViews_activeBrowsersIntoNextWindow_notCountedNewAgain", () => {
    jest.useFakeTimers({ now: NOW });
    try {
      const round = () => {
        for (let i = 0; i < 30; i += 1) admitAudienceViews("203.0.113.7", `${BROWSER} n${i}`, [view({ isView: false })]);
      };
      round();
      jest.setSystemTime(new Date(NOW.getTime() + 50_000));
      round();
      jest.setSystemTime(new Date(NOW.getTime() + 61_000));
      round();

      // Toujours actifs, les 30 navigateurs ne sont pas recomptés : un nouveau a sa place.
      expect(admitAudienceViews("203.0.113.7", `${BROWSER} new`, [view()])).toEqual([view()]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("admitAudienceViews_sameIpWithDifferentPorts_oneIdentity", () => {
    for (let port = 40_000; port < 40_100; port += 1) admitAudienceViews(`203.0.113.7:${port}`, BROWSER, [view({ isView: false })]);

    expect(checkRateLimit({ name: "audience-identity", limit: 30, windowMs: 60_000 }, "203.0.113.7").remaining).toBe(29);
  });

  it("admitAudienceViews_siteIdentityCapExhausted_fairShareBrowserAdmitted", () => {
    for (let i = 0; i < AUDIENCE_GLOBAL_IDENTITY_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_IDENTITY_RULE, "site");

    expect(admitAudienceViews("198.51.100.4", BROWSER, [view()])).toEqual([view()]);
  });

  it("admitAudienceViews_siteIdentityCapExhaustedBeyondFairShare_refused", () => {
    for (let i = 0; i < AUDIENCE_GLOBAL_IDENTITY_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_IDENTITY_RULE, "site");
    for (let i = 0; i < AUDIENCE_FAIR_IDENTITIES; i += 1) admitAudienceViews("198.51.100.4", `${BROWSER} n${i}`, [view({ isView: false })]);

    expect(admitAudienceViews("198.51.100.4", `${BROWSER} late`, [view()])).toEqual([]);
  });

  it("admitAudienceViews_siteViewCapExhausted_firstViewsOfNetworkAdmitted", () => {
    for (let i = 0; i < AUDIENCE_GLOBAL_VIEW_RULE.limit; i += 1) chargeRateLimit(AUDIENCE_GLOBAL_VIEW_RULE, "site");
    const views = Array.from({ length: AUDIENCE_FAIR_VIEWS + 1 }, () => view());

    expect(admitAudienceViews("198.51.100.4", BROWSER, views)).toHaveLength(AUDIENCE_FAIR_VIEWS);
  });

  it("admitAudienceViews_wideTierBucketFull_networkQuotaUntouched", () => {
    for (let i = 0; i < AUDIENCE_MAX_KEYS; i += 1) chargeRateLimit(AUDIENCE_WIDE_VIEW_RULE, `filler-${i}`);

    admitAudienceViews("2001:db8:1:2::1", BROWSER, [view(), view(), view()]);

    expect(checkRateLimit(AUDIENCE_VIEW_RULE, "2001:db8:1:2::/64").remaining).toBe(AUDIENCE_VIEW_RULE.limit);
  });
});

describe("audienceVisitorKey — réseau", () => {
  function mockSalt() {
    jest.mocked(getDatabase).mockResolvedValue(
      fakePool({ execute: jest.fn<SqlQuery>(async (sql: string) => (sql.includes("SELECT salt") ? [[{ salt: Buffer.alloc(32, 7) }]] : [{ affectedRows: 1 }])) }),
    );
  }

  it("audienceVisitorKey_twoAddressesOfOneSlash64_sameKey", async () => {
    mockSalt();

    const first = await audienceVisitorKey("2026-11-16", "2001:db8:1:2::a", "Firefox");

    expect(await audienceVisitorKey("2026-11-16", "2001:db8:1:2:ffff::b", "Firefox")).toBe(first);
  });

  it("audienceVisitorKey_ipv4WithPort_sameAsWithout", async () => {
    mockSalt();

    const bare = await audienceVisitorKey("2026-11-16", "203.0.113.7", "Firefox");

    expect(await audienceVisitorKey("2026-11-16", "203.0.113.7:51234", "Firefox")).toBe(bare);
  });
});

describe("rollUpAudienceDays — visiteurs distincts", () => {
  it("rollUpDay_severalSmallRows_countsDistinctVisitorsWithInClause", async () => {
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
      sql.includes("COUNT(DISTINCT")
        ? [[{ total: 2 }]]
        : sql.includes("COUNT(*) AS total")
        ? [[{ total: 2 }]]
        : sql.includes("SELECT viewed_at")
        ? [[raw("v1", "team"), raw("v2", "player")]]
        : [{ affectedRows: 1 }],
    );
    jest.mocked(inTransaction).mockImplementation(async (run) => run(fakeConnection(connection)));

    await rollUpAudienceDays(NOW);

    const distinct = connection.execute.mock.calls.find(([sql]) => sql.includes("COUNT(DISTINCT visitor_key)"));
    expect(distinct?.[0]).toContain("page_key IN (?, ?)");
    expect(distinct?.[1]).toEqual(["2026-11-14", "player", "team"]);
  });
});
