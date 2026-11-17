import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/transaction");

import {
  AUDIENCE_IDENTITY_RULE,
  AUDIENCE_UNKNOWN_WARN_INTERVAL_MS,
  AUDIENCE_WIDE_IDENTITY_RULE,
  AUDIENCE_WIDE_REQUEST_RULE,
  AUDIENCE_WIDE_VIEW_RULE,
  admitAudienceViews,
  audienceWideNetworkKey,
  resetAudienceUnknownWarning,
  throttleAudienceRequest,
} from "@/lib/server/api-guard";
import { getAudienceStats, resetAudienceState } from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { chargeRateLimit, checkRateLimit, resetRateLimit, type RateLimitRule } from "@/lib/server/rate-limit";
import { AUDIENCE_SMALL_KEY, type AudienceView } from "@/lib/shared/audience";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Sécurité, cycle 2 de `feature/stats-page` : seaux qui refusent au lieu de se
 * vider, plafonds par `/48` et par adresse, avertissement du réseau illisible,
 * k-anonymat jour par jour (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

const BROWSER = "Mozilla/5.0 (Windows NT 10.0) Firefox/130.0";
const NOW = new Date("2026-11-16T12:00:00Z");

function view(overrides: Partial<AudienceView> = {}): AudienceView {
  return { pageKey: "home", locale: "fr", device: "mobile", source: "direct", isView: true, engagedMs: 0, ageMs: 0, openedAgeMs: 0, ...overrides };
}

const REFUSE_RULE: RateLimitRule = { name: "sec2-refuse", limit: 1, windowMs: 60_000, maxKeys: 2, overflow: "refuse" };
const RESET_RULE: RateLimitRule = { name: "sec2-reset", limit: 1, windowMs: 60_000, maxKeys: 2 };

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

describe("chargeRateLimit — seau plein", () => {
  it("chargeRateLimit_refuseRuleFullOfLiveWindows_refusesNewKeyKeepsExisting", () => {
    chargeRateLimit(REFUSE_RULE, "a", 0);
    chargeRateLimit(REFUSE_RULE, "b", 0);

    const state = chargeRateLimit(REFUSE_RULE, "c", 1000);

    expect(state.allowed).toBe(false);
    expect(checkRateLimit(REFUSE_RULE, "a", 1000).allowed).toBe(false);
  });

  it("chargeRateLimit_refuseRuleWithExpiredWindow_admitsNewKey", () => {
    chargeRateLimit(REFUSE_RULE, "a", 0);
    chargeRateLimit(REFUSE_RULE, "b", 30_000);

    const state = chargeRateLimit(REFUSE_RULE, "c", 61_000);

    expect(state.allowed).toBe(true);
    expect(checkRateLimit(REFUSE_RULE, "b", 61_000).allowed).toBe(false);
  });

  it("chargeRateLimit_defaultRuleFull_resetsBucket", () => {
    chargeRateLimit(RESET_RULE, "a", 0);
    chargeRateLimit(RESET_RULE, "b", 0);

    chargeRateLimit(RESET_RULE, "c", 1000);

    expect(checkRateLimit(RESET_RULE, "a", 1000).allowed).toBe(true);
  });
});

describe("audienceWideNetworkKey", () => {
  it("audienceWideNetworkKey_ipv6_returnsSlash48", () => {
    expect(audienceWideNetworkKey("2001:db8:1:2::a")).toBe("2001:db8:1::/48");
    expect(audienceWideNetworkKey("2001:db8:1:ff00::9")).toBe("2001:db8:1::/48");
  });

  it("audienceWideNetworkKey_ipv4OrNull_returnsNull", () => {
    expect(audienceWideNetworkKey("203.0.113.7")).toBeNull();
    expect(audienceWideNetworkKey(null)).toBeNull();
  });
});

describe("admitAudienceViews — étages", () => {
  it("admitAudienceViews_newAddressesInOneSlash64_countAsOneBrowser", () => {
    // Même empreinte (réseau /64 + navigateur) : changer d'adresse ne fait pas un navigateur de plus.
    for (let i = 1; i <= AUDIENCE_IDENTITY_RULE.limit + 5; i += 1) admitAudienceViews(`2001:db8:1:2::${i.toString(16)}`, BROWSER, [view({ isView: false })]);

    expect(admitAudienceViews("2001:db8:1:2::ffff", `${BROWSER} other`, [view()])).toEqual([view()]);
  });

  it("admitAudienceViews_networksOfOneSlash48_sharedWideIdentityCap", () => {
    // Chaque /64 reste sous son plafond ; le /48 atteint le sien.
    for (let i = 0; i < AUDIENCE_WIDE_IDENTITY_RULE.limit; i += 1) admitAudienceViews(`2001:db8:1:${i.toString(16)}::1`, BROWSER, [view({ isView: false })]);

    expect(admitAudienceViews("2001:db8:1:ffff::1", BROWSER, [view()])).toEqual([]);
  });

  it("admitAudienceViews_networksOfOneSlash48_sharedWideViewCap", () => {
    // Cinq vues par /64, bien sous le plafond d'un réseau.
    for (let i = 0; i < AUDIENCE_WIDE_VIEW_RULE.limit / 5; i += 1) {
      admitAudienceViews(`2001:db8:1:${i.toString(16)}::1`, BROWSER, [view(), view(), view(), view(), view()]);
    }

    expect(admitAudienceViews("2001:db8:1:ffff::1", BROWSER, [view()])).toEqual([]);
  });

  it("admitAudienceViews_otherSlash48_unaffected", () => {
    for (let i = 0; i < AUDIENCE_WIDE_IDENTITY_RULE.limit; i += 1) admitAudienceViews(`2001:db8:1:${i.toString(16)}::1`, BROWSER, [view({ isView: false })]);

    expect(admitAudienceViews("2001:db8:2:1::1", BROWSER, [view()])).toEqual([view()]);
  });

  it("admitAudienceViews_unknownNetworkThrottled_warnsOncePerInterval", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    for (let i = 0; i <= AUDIENCE_IDENTITY_RULE.limit + 5; i += 1) admitAudienceViews(null, `${BROWSER} n${i}`, [view()]);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("admitAudienceViews_unknownNetworkAfterInterval_warnsAgain", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    for (let i = 0; i <= AUDIENCE_IDENTITY_RULE.limit; i += 1) admitAudienceViews(null, `${BROWSER} n${i}`, [view()]);
    now.mockReturnValue(1_000_000 + AUDIENCE_UNKNOWN_WARN_INTERVAL_MS + 30_000);
    for (let i = 0; i <= AUDIENCE_IDENTITY_RULE.limit; i += 1) admitAudienceViews(null, `${BROWSER} m${i}`, [view()]);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("admitAudienceViews_knownNetworkThrottled_noWarning", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i <= AUDIENCE_IDENTITY_RULE.limit; i += 1) admitAudienceViews("203.0.113.7", `${BROWSER} n${i}`, [view()]);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("throttleAudienceRequest", () => {
  it("throttleAudienceRequest_underLimits_returnsNull", () => {
    expect(throttleAudienceRequest("203.0.113.7")).toBeNull();
  });

  it("throttleAudienceRequest_slash48Exhausted_returns429ForSiblingSlash64", () => {
    for (let i = 0; i < AUDIENCE_WIDE_REQUEST_RULE.limit; i += 1) throttleAudienceRequest(`2001:db8:1:${(i % 50).toString(16)}::1`);

    expect(throttleAudienceRequest("2001:db8:1:ffff::1")?.status).toBe(429);
  });
});

describe("getAudienceStats — k-anonymat jour par jour", () => {
  function captureSql() {
    const execute = jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("FROM bg_audience_day_dims")) {
        return [[{ dim: "device", dim_value: AUDIENCE_SMALL_KEY, views: 3, visitors: 2 }]];
      }
      if (sql.includes("SELECT salt")) return [[{ salt: Buffer.alloc(32, 7) }]];
      if (sql.startsWith("DELETE") || sql.startsWith("INSERT")) return [{ affectedRows: 0 }];
      return [[]];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    return execute;
  }

  const sqlOf = (execute: ReturnType<typeof captureSql>, table: string) =>
    execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes(table)) ?? "";

  // Les compteurs sont k-anonymes dès le repli (`anonymizeAudienceDay`) : la
  // lecture additionne, sans seuil propre à la période (qui laisserait le
  // groupe écarté se déduire des totaux).
  it("getAudienceStats_queries_sumStoredDailyRowsWithoutPeriodThreshold", async () => {
    const execute = captureSql();

    await getAudienceStats(NOW);

    for (const table of ["FROM bg_audience_day_pages", "FROM bg_audience_day_dims", "FROM bg_audience_day_hours"]) {
      expect(sqlOf(execute, table)).not.toContain("CASE WHEN");
    }
  });

  it("getAudienceStats_storedSmallRow_shownAsIs", async () => {
    captureSql();

    const stats = await getAudienceStats(NOW);

    expect(stats.ranges["7d"].devices).toEqual([{ key: AUDIENCE_SMALL_KEY, views: 3, visitors: 2 }]);
  });
});
