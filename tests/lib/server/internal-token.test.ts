import { afterEach, describe, expect, it } from "@jest/globals";
import { internalTokenMatches, rejectWithoutSiteInternalToken } from "@/lib/server/internal-token";

/** Jeton du bot vers le site : route fermée sans secret, comparaison en temps constant. */

const saved = process.env.SITE_INTERNAL_TOKEN;
afterEach(() => {
  if (saved === undefined) delete process.env.SITE_INTERNAL_TOKEN;
  else process.env.SITE_INTERNAL_TOKEN = saved;
});

const request = (token?: string) =>
  new Request("http://127.0.0.1:3000/api/internal/tournament-message", {
    method: "POST",
    headers: token === undefined ? {} : { "x-internal-token": token },
  });

describe("rejectWithoutSiteInternalToken", () => {
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

  it("rejectWithoutSiteInternalToken_headerMissing_returns401", async () => {
    process.env.SITE_INTERNAL_TOKEN = "secret";

    const actual = rejectWithoutSiteInternalToken(request());

    expect(actual?.status).toBe(401);
    await expect(actual?.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
  });

  it("rejectWithoutSiteInternalToken_wrongToken_returns401", () => {
    process.env.SITE_INTERNAL_TOKEN = "secret";

    expect(rejectWithoutSiteInternalToken(request("secreT"))?.status).toBe(401);
  });

  it("rejectWithoutSiteInternalToken_rightToken_returnsNull", () => {
    process.env.SITE_INTERNAL_TOKEN = "secret";

    expect(rejectWithoutSiteInternalToken(request("secret"))).toBeNull();
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
