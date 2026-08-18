import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/site-visits-service");

import { POST } from "@/app/api/visits/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordSiteVisit, syncSiteVisitStatsToBot } from "@/lib/server/site-visits-service";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const member = { id: 42, isAdmin: false, roles: [] } as unknown as SessionUser;

function visitReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/visits", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function lastCall() {
  return (recordSiteVisit as jest.Mock).mock.calls[0][0] as {
    userId: number | null;
    ip: string | null;
    userAgent: string | null;
    path: unknown;
  };
}

describe("POST /api/visits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    (recordSiteVisit as jest.Mock).mockResolvedValue({ recorded: true } as never);
    (syncSiteVisitStatsToBot as jest.Mock).mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("enregistre la visite d'un visiteur anonyme", async () => {
    const res = await POST(visitReq({ path: "/tournois" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });
    expect(lastCall()).toMatchObject({ userId: null, path: "/tournois" });
  });

  it("rattache la visite au compte connecté", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);

    await POST(visitReq({ path: "/profil" }));

    expect(lastCall().userId).toBe(42);
  });

  it("retient l'IP ajoutée par le proxy, pas celle annoncée par le client", async () => {
    await POST(
      visitReq({ path: "/" }, { "x-forwarded-for": "1.1.1.1, 203.0.113.7", "user-agent": "Firefox/130" }),
    );

    // `1.1.1.1` est falsifiable : seule la dernière entrée vient du proxy.
    expect(lastCall()).toMatchObject({ ip: "203.0.113.7", userAgent: "Firefox/130" });
  });

  it("suit le nombre de relais configuré", async () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    try {
      await POST(visitReq({ path: "/" }, { "x-forwarded-for": "1.1.1.1, 203.0.113.7, 70.41.3.18" }));
      expect(lastCall().ip).toBe("203.0.113.7");
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });

  it("retombe sur X-Real-IP quand X-Forwarded-For manque", async () => {
    await POST(visitReq({ path: "/" }, { "x-real-ip": "198.51.100.4" }));

    expect(lastCall().ip).toBe("198.51.100.4");
  });

  it("enregistre quand même la visite si le corps est illisible", async () => {
    const res = await POST(
      new Request("http://localhost/api/visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "pas du json",
      }),
    );

    expect(res.status).toBe(200);
    expect(recordSiteVisit).toHaveBeenCalledTimes(1);
  });

  it("ne réveille le bot que si une visite a réellement été créée", async () => {
    (recordSiteVisit as jest.Mock).mockResolvedValue({ recorded: false } as never);

    expect(await (await POST(visitReq({ path: "/" }))).json()).toEqual({ recorded: false });
    expect(syncSiteVisitStatsToBot).not.toHaveBeenCalled();
  });

  it("pousse la fréquentation au bot après une visite créée", async () => {
    await POST(visitReq({ path: "/" }));

    expect(syncSiteVisitStatsToBot).toHaveBeenCalledTimes(1);
  });

  it("reste silencieux si l'enregistrement échoue", async () => {
    (recordSiteVisit as jest.Mock).mockRejectedValue(new Error("DB_DOWN") as never);

    const res = await POST(visitReq({ path: "/" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: false });
  });

  it("n'échoue pas si la synchronisation vers le bot casse", async () => {
    (syncSiteVisitStatsToBot as jest.Mock).mockRejectedValue(new Error("BOT_DOWN") as never);

    const res = await POST(visitReq({ path: "/" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });
  });
});
