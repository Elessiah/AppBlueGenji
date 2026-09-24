import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/sponsors-service");
jest.mock("@/lib/server/image-upload");

import { GET, POST } from "@/app/api/landing/sponsors/route";
import { PUT, DELETE } from "@/app/api/landing/sponsors/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { deleteStoredImage } from "@/lib/server/image-upload";
import * as service from "@/lib/server/sponsors-service";
import type { Sponsor } from "@/lib/shared/sponsors";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/landing/sponsors", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/landing/sponsors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the public list without auth", async () => {
    const sponsors: Sponsor[] = [{
      id: 1,
      name: "X",
      slug: "x",
      tier: "GOLD",
      logoUrl: null,
      websiteUrl: null,
      description: null,
    }];
    jest.mocked(service.listSponsors).mockResolvedValue(sponsors);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sponsors });
  });
});

describe("POST /api/landing/sponsors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await POST(jsonReq("POST", { name: "X" }))).status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    expect((await POST(jsonReq("POST", { name: "X" }))).status).toBe(403);
  });

  it("creates a sponsor for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const sponsor: Sponsor = {
      id: 5,
      name: "X",
      slug: "x",
      tier: "PARTNER",
      logoUrl: null,
      websiteUrl: null,
      description: null,
    };
    jest.mocked(service.createSponsor).mockResolvedValue(sponsor);

    const res = await POST(jsonReq("POST", { name: "X" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ sponsor });
  });

  it("returns 400 with the validation error message", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createSponsor).mockRejectedValue(new Error("INVALID_TIER"));
    const res = await POST(jsonReq("POST", { name: "X", tier: "PLATINUM" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TIER" });
  });
});

describe("PUT /api/landing/sponsors/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    expect((await PUT(jsonReq("PUT", { name: "X" }), params("1"))).status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", { name: "X" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a sponsor for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const sponsor: Sponsor = {
      id: 3,
      name: "X",
      slug: "x",
      tier: "GOLD",
      logoUrl: null,
      websiteUrl: null,
      description: null,
    };
    jest.mocked(service.updateSponsor).mockResolvedValue(sponsor);

    const res = await PUT(jsonReq("PUT", { name: "X", tier: "GOLD" }), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sponsor });
  });

  it("returns 404 when the sponsor does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateSponsor).mockRejectedValue(new Error("SPONSOR_NOT_FOUND"));
    const res = await PUT(jsonReq("PUT", { name: "X" }), params("99"));
    expect(res.status).toBe(404);
  });

  it("deletes the previous uploaded logo (mapped to its disk path) when replaced", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.getSponsorLogoUrl).mockResolvedValue("/api/uploads/sponsors/old.webp");
    jest.mocked(service.updateSponsor).mockResolvedValue({
      id: 3, name: "X", slug: "x", tier: "GOLD", logoUrl: "/api/uploads/sponsors/new.webp", websiteUrl: null, description: null,
    });

    await PUT(jsonReq("PUT", { name: "X", logoUrl: "/api/uploads/sponsors/new.webp" }), params("3"));
    // L'URL servie est reconvertie en chemin disque avant suppression.
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/sponsors/old.webp");
  });

  it("keeps an external (non-uploaded) logo untouched", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.getSponsorLogoUrl).mockResolvedValue("https://cdn/old.png");
    jest.mocked(service.updateSponsor).mockResolvedValue({
      id: 3, name: "X", slug: "x", tier: "GOLD", logoUrl: "https://cdn/new.png", websiteUrl: null, description: null,
    });

    await PUT(jsonReq("PUT", { name: "X", logoUrl: "https://cdn/new.png" }), params("3"));
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/landing/sponsors/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await DELETE(jsonReq("DELETE", {}), params("1"))).status).toBe(401);
  });

  it("deletes a sponsor for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteSponsor).mockResolvedValue(undefined);
    expect((await DELETE(jsonReq("DELETE", {}), params("4"))).status).toBe(200);
  });

  it("removes the uploaded logo file alongside the sponsor", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.getSponsorLogoUrl).mockResolvedValue("/uploads/sponsors/x.webp");
    jest.mocked(service.deleteSponsor).mockResolvedValue(undefined);

    await DELETE(jsonReq("DELETE", {}), params("4"));
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/sponsors/x.webp");
  });

  it("still succeeds when the file cleanup fails (best-effort)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.getSponsorLogoUrl).mockResolvedValue("/uploads/sponsors/x.webp");
    jest.mocked(service.deleteSponsor).mockResolvedValue(undefined);
    jest.mocked(deleteStoredImage).mockRejectedValue(new Error("EPERM"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await DELETE(jsonReq("DELETE", {}), params("4"));
    expect(res.status).toBe(200);
    spy.mockRestore();
  });

  it("returns 404 when the sponsor does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteSponsor).mockRejectedValue(new Error("SPONSOR_NOT_FOUND"));
    expect((await DELETE(jsonReq("DELETE", {}), params("99"))).status).toBe(404);
  });
});
