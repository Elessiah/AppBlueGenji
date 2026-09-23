import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/sponsors-service");
jest.mock("@/lib/server/api-guard", () => ({
  enforceRateLimit: jest.fn(() => null),
  requestClientIp: jest.fn(() => "203.0.113.9"),
  LANDING_READ_RULE: { name: "landing-read", limit: 180, windowMs: 60_000 },
}));

import { NextResponse } from "next/server";
import { GET } from "@/app/api/landing/sponsors/[id]/logo/route";
import { enforceRateLimit } from "@/lib/server/api-guard";
import { getSponsorLogoUrl } from "@/lib/server/sponsors-service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function req(id = "7") {
  return {
    request: new Request(`http://localhost/api/landing/sponsors/${id}/logo`),
    context: { params: Promise.resolve({ id }) },
  };
}

function call(id = "7") {
  const { request, context } = req(id);
  return GET(request, context);
}

/** Réponse amont factice : le relais ne doit voir que des `Response` standard. */
function upstream(
  body: Uint8Array | null,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(body ? new Uint8Array(body) : null, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function mockFetch(...responses: Response[]) {
  const fn = jest.fn<typeof fetch>();
  for (const res of responses) fn.mockResolvedValueOnce(res);
  fn.mockResolvedValue(upstream(null, { status: 404 }));
  global.fetch = fn;
  return fn;
}

describe("GET /api/landing/sponsors/[id]/logo", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(enforceRateLimit).mockReturnValue(null);
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("relays a remote logo from our own origin", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    const fetchMock = mockFetch(upstream(PNG, { headers: { "content-type": "image/png" } }));

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    // L'octet vient d'un tiers : rien ne doit pouvoir s'exécuter depuis lui.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://cdn.example.com/logo.png");
  });

  it("returns 404 for a sponsor without a logo", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("returns 404 for a logo we host ourselves — /api/uploads serves it", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("/uploads/sponsors/1-abc.webp");
    const fetchMock = mockFetch();
    expect((await call()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "abc", "1.5", ""])("returns 404 for the invalid id %p", async (id) => {
    const fetchMock = mockFetch();
    expect((await call(id)).status).toBe(404);
    expect(getSponsorLogoUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never reaches a host on the machine's own network", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://169.254.169.254/latest/meta-data");
    const fetchMock = mockFetch();
    expect((await call()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a logo served in clear text", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("http://cdn.example.com/logo.png");
    const fetchMock = mockFetch();
    expect((await call()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the database is unreachable", async () => {
    jest.mocked(getSponsorLogoUrl).mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await call()).status).toBe(404);
  });

  it("refuses an upstream that is not an accepted image", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    mockFetch(upstream(PNG, { headers: { "content-type": "text/html" } }));
    expect((await call()).status).toBe(404);
  });

  it("refuses an svg — it would run script on our origin", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.svg");
    mockFetch(upstream(PNG, { headers: { "content-type": "image/svg+xml" } }));
    expect((await call()).status).toBe(404);
  });

  it("refuses an upstream error", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    mockFetch(upstream(null, { status: 500 }));
    expect((await call()).status).toBe(404);
  });

  it("refuses an upstream that announces more than the size cap", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    mockFetch(
      upstream(PNG, {
        headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) },
      }),
    );
    expect((await call()).status).toBe(404);
  });

  it("refuses an empty body", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    mockFetch(upstream(new Uint8Array(0), { headers: { "content-type": "image/png" } }));
    expect((await call()).status).toBe(404);
  });

  it("returns 404 when the fetch itself fails", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    const fn = jest.fn<() => Promise<Response>>().mockRejectedValue(new Error("timeout"));
    global.fetch = fn as unknown as typeof fetch;
    expect((await call()).status).toBe(404);
  });

  it("follows a redirect and relays the final image", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    const fetchMock = mockFetch(
      upstream(null, { status: 302, headers: { location: "https://cdn2.example.com/logo.png" } }),
      upstream(PNG, { headers: { "content-type": "image/png" } }),
    );

    const res = await call();
    expect(res.status).toBe(200);
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toBe("https://cdn2.example.com/logo.png");
  });

  it("revalidates the host on each hop — a redirect cannot smuggle in an internal address", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    const fetchMock = mockFetch(
      upstream(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
      upstream(PNG, { headers: { "content-type": "image/png" } }),
    );

    expect((await call()).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a redirect loop instead of following it forever", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    const fn = jest
      .fn<() => Promise<Response>>()
      .mockResolvedValue(
        upstream(null, { status: 302, headers: { location: "https://cdn.example.com/logo.png" } }),
      );
    global.fetch = fn as unknown as typeof fetch;

    expect((await call()).status).toBe(404);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("refuses a redirect without a destination", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    mockFetch(upstream(null, { status: 302 }));
    expect((await call()).status).toBe(404);
  });

  it("ignores the `v` cache-busting parameter — it is read by the optimiser, not by us", async () => {
    jest.mocked(getSponsorLogoUrl).mockResolvedValue("https://cdn.example.com/logo.png");
    mockFetch(upstream(PNG, { headers: { "content-type": "image/png" } }));

    const res = await GET(
      new Request("http://localhost/api/landing/sponsors/7/logo?v=zzz"),
      { params: Promise.resolve({ id: "7" }) },
    );
    expect(res.status).toBe(200);
  });

  it("returns the rate limiter's answer before touching the database", async () => {
    const tooMany = new NextResponse(null, { status: 429 });
    jest.mocked(enforceRateLimit).mockReturnValue(tooMany);
    const fetchMock = mockFetch();

    expect((await call()).status).toBe(429);
    expect(getSponsorLogoUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
