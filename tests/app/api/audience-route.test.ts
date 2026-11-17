import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/audience-service");

import { POST } from "@/app/api/audience/route";
import { AUDIENCE_IDENTITY_RULE, AUDIENCE_REQUEST_RULE } from "@/lib/server/api-guard";
import { maintainAudience, recordAudienceViews } from "@/lib/server/audience-service";
import { resetRateLimit } from "@/lib/server/rate-limit";

/** Réception des pages vues (`docs/features/AUDIENCE_MEASUREMENT.md`, registre T19). */

const BROWSER = "Mozilla/5.0 (Windows NT 10.0) Firefox/130.0";
const BATCH = { v: [{ p: "/regles", t: 4000, a: 4000, d: "mobile", f: 1, r: "discord.com" }] };

function audienceReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/audience", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": BROWSER,
      "x-forwarded-for": "203.0.113.7",
      // Ce que pose le `fetch()` d'une page du site.
      "sec-fetch-site": "same-origin",
      "sec-fetch-dest": "empty",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.mocked(recordAudienceViews).mockResolvedValue(1);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/audience", () => {
  it("retient le lot d'un navigateur ordinaire", async () => {
    const res = await POST(audienceReq(BATCH));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: 1 });
    expect(jest.mocked(recordAudienceViews).mock.calls[0][0]).toMatchObject({
      ip: "203.0.113.7",
      userAgent: BROWSER,
      views: [{ pageKey: "rules", source: "discord", isView: true }],
    });
    expect(maintainAudience).toHaveBeenCalledTimes(1);
  });

  const optOuts: { signal: string; headers: Record<string, string> }[] = [
    { signal: "Global Privacy Control", headers: { "sec-gpc": "1" } },
    { signal: "Do Not Track", headers: { dnt: "1" } },
    { signal: "le choix fait sur /rgpd", headers: { cookie: "bg_audience_optout=1" } },
  ];

  it.each(optOuts)("n'enregistre rien sous $signal", async ({ headers }) => {
    const res = await POST(audienceReq(BATCH, headers));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("n'enregistre rien pour un robot", async () => {
    const res = await POST(audienceReq(BATCH, { "user-agent": "Googlebot/2.1" }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("POST_overLimit_returns429AfterLimitSends", async () => {
    for (let i = 0; i < AUDIENCE_REQUEST_RULE.limit; i += 1) await POST(audienceReq(BATCH));

    const res = await POST(audienceReq(BATCH));

    expect(res.status).toBe(429);
    expect(recordAudienceViews).toHaveBeenCalledTimes(120);
  });

  it("POST_saltUnreadable_returnsRecordedZero", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(recordAudienceViews).mockRejectedValue(new Error("down"));

    const res = await POST(audienceReq(BATCH));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: 0 });
  });

  it("rend zéro pour un corps illisible", async () => {
    const res = await POST(audienceReq("{pas du json"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("rend zéro pour un lot sans page mesurable", async () => {
    const res = await POST(audienceReq({ v: [{ p: "/frequentation", t: 1, a: 1, d: "mobile" }] }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("POST_noFetchMetadataHeadersFromOldSafari_recordsViews", async () => {
    // Safari avant iOS 16.4 : ni Sec-Fetch-Site ni Sec-Fetch-Dest.
    const req = audienceReq(BATCH, {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
    });
    req.headers.delete("sec-fetch-site");
    req.headers.delete("sec-fetch-dest");

    const res = await POST(req);

    expect(await res.json()).toEqual({ recorded: 1 });
  });

  it("POST_noFetchMetadataHeadersFromModernBrowser_recordsNothing", async () => {
    // Un script qui se dit Firefox 130 sans les en-têtes que Firefox pose toujours.
    const req = audienceReq(BATCH);
    req.headers.delete("sec-fetch-site");
    req.headers.delete("sec-fetch-dest");

    const res = await POST(req);

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("POST_emptyFetchMetadata_recordsNothing", async () => {
    const res = await POST(audienceReq(BATCH, { "sec-fetch-site": "", "sec-fetch-dest": "" }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("POST_crossSiteFetch_recordsNothing", async () => {
    const res = await POST(audienceReq(BATCH, { "sec-fetch-site": "cross-site" }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("POST_ownHostReferrer_countedDirect", async () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = "https://bluegenji.example";
    try {
      await POST(audienceReq({ v: [{ p: "/", t: 0, a: 0, d: "mobile", f: 1, r: "www.bluegenji.example" }] }));
    } finally {
      process.env.APP_URL = previous;
    }

    expect(jest.mocked(recordAudienceViews).mock.calls[0][0].views[0].source).toBe("direct");
  });

  it("POST_rotatingUserAgents_cappedAtIdentityLimit", async () => {
    for (let i = 0; i < AUDIENCE_IDENTITY_RULE.limit; i += 1) await POST(audienceReq(BATCH, { "user-agent": `${BROWSER} n${i}` }));

    const res = await POST(audienceReq(BATCH, { "user-agent": `${BROWSER} other` }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).toHaveBeenCalledTimes(AUDIENCE_IDENTITY_RULE.limit);
  });

  it("POST_rotatingAddressesOfOneIpv6Slash64_shareRequestLimit", async () => {
    for (let i = 0; i < AUDIENCE_REQUEST_RULE.limit; i += 1) {
      await POST(audienceReq({ v: [{ p: "/regles", t: 0, a: 0, d: "mobile", c: 1 }] }, { "x-forwarded-for": `2001:db8:1:2::${(i + 1).toString(16)}` }));
    }

    const res = await POST(audienceReq(BATCH, { "x-forwarded-for": "2001:db8:1:2::ffff" }));

    expect(res.status).toBe(429);
  });
});
