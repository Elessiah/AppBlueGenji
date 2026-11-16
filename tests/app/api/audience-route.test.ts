import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/audience-service");

import { POST } from "@/app/api/audience/route";
import { AUDIENCE_REQUEST_RULE } from "@/lib/server/api-guard";
import { maintainAudience, recordAudienceViews } from "@/lib/server/audience-service";
import { resetRateLimit } from "@/lib/server/rate-limit";

/** Réception des pages vues (`docs/features/AUDIENCE_MEASUREMENT.md`, registre T19). */

const BROWSER = "Mozilla/5.0 (Windows NT 10.0) Firefox/130.0";
const BATCH = { v: [{ p: "/regles", t: 4000, a: 4000, d: "mobile", f: 1, r: "discord.com" }] };

function audienceReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/audience", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": BROWSER, "x-forwarded-for": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit(AUDIENCE_REQUEST_RULE.name);
  jest.mocked(recordAudienceViews).mockReturnValue(1);
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

  it("n'enregistre rien sous Global Privacy Control", async () => {
    const res = await POST(audienceReq(BATCH, { "sec-gpc": "1" }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("n'enregistre rien sous Do Not Track", async () => {
    const res = await POST(audienceReq(BATCH, { dnt: "1" }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("n'enregistre rien après le choix fait sur /rgpd", async () => {
    const res = await POST(audienceReq(BATCH, { cookie: "bg_audience_optout=1" }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("n'enregistre rien pour un robot", async () => {
    const res = await POST(audienceReq(BATCH, { "user-agent": "Googlebot/2.1" }));

    expect(await res.json()).toEqual({ recorded: 0 });
    expect(recordAudienceViews).not.toHaveBeenCalled();
  });

  it("répond 429 au-delà de 30 envois par minute d'une même adresse", async () => {
    for (let i = 0; i < 30; i += 1) await POST(audienceReq(BATCH));

    const res = await POST(audienceReq(BATCH));

    expect(res.status).toBe(429);
    expect(recordAudienceViews).toHaveBeenCalledTimes(30);
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
});
