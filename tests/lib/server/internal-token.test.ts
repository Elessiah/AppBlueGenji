import { afterEach, describe, expect, it } from "@jest/globals";
import { internalTokenMatches, isLoopbackAddress, rejectWithoutSiteInternalToken } from "@/lib/server/internal-token";

/** Jeton du bot vers le site : route fermée sans secret, en boucle locale seulement, comparaison en temps constant. */

const TOKEN = "a".repeat(32) + "-site-internal-token";
const saved = { site: process.env.SITE_INTERNAL_TOKEN, bot: process.env.BOT_INTERNAL_TOKEN };
afterEach(() => {
  if (saved.site === undefined) delete process.env.SITE_INTERNAL_TOKEN;
  else process.env.SITE_INTERNAL_TOKEN = saved.site;
  if (saved.bot === undefined) delete process.env.BOT_INTERNAL_TOKEN;
  else process.env.BOT_INTERNAL_TOKEN = saved.bot;
});

const request = (token?: string, extra: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:3000/api/internal/tournament-message", {
    method: "POST",
    headers: { ...(token === undefined ? {} : { "x-internal-token": token }), ...extra },
  });

describe("rejectWithoutSiteInternalToken — jeton", () => {
  it("rejectWithoutSiteInternalToken_tokenUnset_returns503", async () => {
    delete process.env.SITE_INTERNAL_TOKEN;

    const actual = rejectWithoutSiteInternalToken(request("anything"));

    expect(actual?.status).toBe(503);
    await expect(actual?.json()).resolves.toEqual({ error: "SITE_INTERNAL_TOKEN_NOT_CONFIGURED" });
  });

  it("rejectWithoutSiteInternalToken_blankToken_returns503", () => {
    process.env.SITE_INTERNAL_TOKEN = "   ";

    expect(rejectWithoutSiteInternalToken(request(""))?.status).toBe(503);
  });

  it("rejectWithoutSiteInternalToken_token31Chars_returns503", () => {
    process.env.SITE_INTERNAL_TOKEN = "b".repeat(31);

    expect(rejectWithoutSiteInternalToken(request("b".repeat(31)))?.status).toBe(503);
  });

  it("rejectWithoutSiteInternalToken_token32Chars_returnsNull", () => {
    process.env.SITE_INTERNAL_TOKEN = "b".repeat(32);

    expect(rejectWithoutSiteInternalToken(request("b".repeat(32)))).toBeNull();
  });

  it("rejectWithoutSiteInternalToken_tokenEqualsBotToken_returns503", () => {
    process.env.SITE_INTERNAL_TOKEN = TOKEN;
    process.env.BOT_INTERNAL_TOKEN = TOKEN;

    expect(rejectWithoutSiteInternalToken(request(TOKEN))?.status).toBe(503);
  });

  it("rejectWithoutSiteInternalToken_headerMissing_returns401", async () => {
    process.env.SITE_INTERNAL_TOKEN = TOKEN;

    const actual = rejectWithoutSiteInternalToken(request());

    expect(actual?.status).toBe(401);
    await expect(actual?.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
  });

  it("rejectWithoutSiteInternalToken_wrongToken_returns401", () => {
    process.env.SITE_INTERNAL_TOKEN = TOKEN;

    expect(rejectWithoutSiteInternalToken(request(TOKEN.toUpperCase()))?.status).toBe(401);
  });

  it("rejectWithoutSiteInternalToken_rightToken_returnsNull", () => {
    process.env.SITE_INTERNAL_TOKEN = TOKEN;

    expect(rejectWithoutSiteInternalToken(request(TOKEN))).toBeNull();
  });
});

describe("rejectWithoutSiteInternalToken — boucle locale seulement", () => {
  it("rejectWithoutSiteInternalToken_forwardedForLastHopPublic_returns403BeforeToken", async () => {
    process.env.SITE_INTERNAL_TOKEN = TOKEN;

    const actual = rejectWithoutSiteInternalToken(request(TOKEN, { "x-forwarded-for": "203.0.113.5" }));

    expect(actual?.status).toBe(403);
    await expect(actual?.json()).resolves.toEqual({ error: "INTERNAL_ROUTE_LOOPBACK_ONLY" });
  });

  it("rejectWithoutSiteInternalToken_spoofedLoopbackFirstHop_returns403", () => {
    process.env.SITE_INTERNAL_TOKEN = TOKEN;

    const actual = rejectWithoutSiteInternalToken(request(TOKEN, { "x-forwarded-for": "127.0.0.1, 203.0.113.5" }));

    expect(actual?.status).toBe(403);
  });

  it("rejectWithoutSiteInternalToken_tokenUnsetThroughProxy_returns403", () => {
    delete process.env.SITE_INTERNAL_TOKEN;

    expect(rejectWithoutSiteInternalToken(request(TOKEN, { "x-forwarded-for": "203.0.113.5" }))?.status).toBe(403);
  });

  it("rejectWithoutSiteInternalToken_forwardedForLoopback_returnsNull", () => {
    process.env.SITE_INTERNAL_TOKEN = TOKEN;

    expect(rejectWithoutSiteInternalToken(request(TOKEN, { "x-forwarded-for": "::ffff:127.0.0.1" }))).toBeNull();
  });

  it("rejectWithoutSiteInternalToken_realIpPublic_returns403", () => {
    process.env.SITE_INTERNAL_TOKEN = TOKEN;

    const actual = rejectWithoutSiteInternalToken(
      request(TOKEN, { "x-forwarded-for": "127.0.0.1", "x-real-ip": "198.51.100.7" }),
    );

    expect(actual?.status).toBe(403);
  });
});

describe("isLoopbackAddress", () => {
  it("isLoopbackAddress_ipv4Loopback_returnsTrue", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.8.9.10")).toBe(true);
  });

  it("isLoopbackAddress_ipv6LoopbackAndMapped_returnsTrue", () => {
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("[::1]")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("isLoopbackAddress_otherAddress_returnsFalse", () => {
    expect(isLoopbackAddress("203.0.113.5")).toBe(false);
    expect(isLoopbackAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isLoopbackAddress("1127.0.0.1")).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
  });
});

describe("internalTokenMatches", () => {
  it("internalTokenMatches_prefixOfToken_returnsFalse", () => {
    expect(internalTokenMatches("secre", "secret")).toBe(false);
  });

  it("internalTokenMatches_sameToken_returnsTrue", () => {
    expect(internalTokenMatches("secret", "secret")).toBe(true);
  });
});
