import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/recruitment-service");

import { GET, POST } from "@/app/api/recruitment/route";
import { PUT, DELETE } from "@/app/api/recruitment/[id]/route";
import { PUT as REORDER } from "@/app/api/recruitment/reorder/route";
import { GET as HIGHLIGHT } from "@/app/api/recruitment/highlight/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/recruitment-service";
import type { RecruitmentAd } from "@/lib/shared/recruitment";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });
// Rôle scopé : accès recrutement sans être administrateur.
const recruteur = { id: 3, isAdmin: false, roles: ["RECRUTEUR"] } as Awaited<
  ReturnType<typeof getCurrentUser>
>;
// Rôle scopé sur un autre domaine : ne doit PAS ouvrir le recrutement.
const arbitre = { id: 4, isAdmin: false, roles: ["ARBITRE"] } as Awaited<
  ReturnType<typeof getCurrentUser>
>;

const sampleAd: RecruitmentAd = {
  id: 5,
  title: "Recherche arbitre",
  teamName: null,
  domain: "AUTRE",
  roles: null,
  body: null,
  contactUrl: null,
  contactDiscord: null,
  contactDiscordId: null,
  contactPreferred: "AUTO",
  highlight: "NONE",
  active: true,
};

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/recruitment", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /api/recruitment", () => {
  it("returns active ads for anonymous visitors", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    jest.mocked(service.listRecruitmentAds).mockResolvedValue([sampleAd]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ads: [sampleAd] });
    // Les visiteurs ne voient pas les brouillons.
    expect(service.listRecruitmentAds).toHaveBeenCalledWith(false);
  });

  it("includes inactive ads for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.listRecruitmentAds).mockResolvedValue([]);

    await GET();
    expect(service.listRecruitmentAds).toHaveBeenCalledWith(true);
  });
});

describe("POST /api/recruitment", () => {
  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await POST(jsonReq("POST", { title: "X" }))).status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    expect((await POST(jsonReq("POST", { title: "X" }))).status).toBe(403);
  });

  it("rejects a role scoped to another domain (ARBITRE) with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    expect((await POST(jsonReq("POST", { title: "X" }))).status).toBe(403);
    expect(service.createRecruitmentAd).not.toHaveBeenCalled();
  });

  it("creates an ad for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createRecruitmentAd).mockResolvedValue(sampleAd);

    const res = await POST(jsonReq("POST", { title: "Recherche TANK" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ad: sampleAd });
  });

  it("creates an ad for a scoped RECRUTEUR (non-admin)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(recruteur);
    jest.mocked(service.createRecruitmentAd).mockResolvedValue(sampleAd);

    const res = await POST(jsonReq("POST", { title: "Recherche TANK" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ad: sampleAd });
  });

  it("returns 400 with the validation error message", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createRecruitmentAd).mockRejectedValue(new Error("INVALID_DOMAIN"));
    const res = await POST(jsonReq("POST", { title: "X", domain: "LOL" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_DOMAIN" });
  });

  it("forwards the Discord contact and preferred channel to the service", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createRecruitmentAd).mockResolvedValue(sampleAd);

    await POST(
      jsonReq("POST", {
        title: "Recherche caster",
        contactDiscord: "marie#0001",
        contactDiscordId: "123456789012345678",
        contactPreferred: "DISCORD",
      }),
    );
    expect(service.createRecruitmentAd).toHaveBeenCalledWith(
      expect.objectContaining({
        contactDiscord: "marie#0001",
        contactDiscordId: "123456789012345678",
        contactPreferred: "DISCORD",
      }),
    );
  });
});

describe("PUT /api/recruitment/[id]", () => {
  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    expect((await PUT(jsonReq("PUT", { title: "X" }), params("1"))).status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", { title: "X" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates an ad for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateRecruitmentAd).mockResolvedValue(sampleAd);

    const res = await PUT(jsonReq("PUT", { title: "Recherche TANK" }), params("5"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ad: sampleAd });
  });

  it("returns 404 when the ad does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateRecruitmentAd).mockRejectedValue(
      new Error("RECRUITMENT_NOT_FOUND"),
    );
    expect((await PUT(jsonReq("PUT", { title: "X" }), params("99"))).status).toBe(404);
  });
});

describe("DELETE /api/recruitment/[id]", () => {
  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await DELETE(jsonReq("DELETE", {}), params("1"))).status).toBe(401);
  });

  it("deletes an ad for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteRecruitmentAd).mockResolvedValue(undefined);
    expect((await DELETE(jsonReq("DELETE", {}), params("4"))).status).toBe(200);
  });

  it("returns 404 when the ad does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteRecruitmentAd).mockRejectedValue(
      new Error("RECRUITMENT_NOT_FOUND"),
    );
    expect((await DELETE(jsonReq("DELETE", {}), params("99"))).status).toBe(404);
  });
});

describe("PUT /api/recruitment/reorder", () => {
  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    expect((await REORDER(jsonReq("PUT", { ids: [1, 2] }))).status).toBe(403);
  });

  it("rejects an invalid ids payload with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await REORDER(jsonReq("PUT", { ids: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IDS_EMPTY" });
  });

  it("reorders for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.reorderRecruitmentAds).mockResolvedValue(undefined);

    const res = await REORDER(jsonReq("PUT", { ids: [3, 1, 2] }));
    expect(res.status).toBe(200);
    expect(service.reorderRecruitmentAds).toHaveBeenCalledWith([3, 1, 2]);
  });
});

describe("GET /api/recruitment/highlight", () => {
  it("returns the highlighted ad without auth, cacheable", async () => {
    const banner: RecruitmentAd = { ...sampleAd, highlight: "BANNER" };
    jest.mocked(service.getHighlightedAd).mockResolvedValue(banner);

    const res = await HIGHLIGHT();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ad: banner });
    // Réponse publique mise en cache pour éviter une requête DB par page.
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
    expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate");
  });

  it("returns null when there is nothing to highlight", async () => {
    jest.mocked(service.getHighlightedAd).mockResolvedValue(null);
    const res = await HIGHLIGHT();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ad: null });
  });

  it("does not cache the degraded (error) response", async () => {
    jest.mocked(service.getHighlightedAd).mockRejectedValue(new Error("down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await HIGHLIGHT();
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    spy.mockRestore();
  });
});
