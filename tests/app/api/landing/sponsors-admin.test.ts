import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/sponsors-service");

import { GET, POST } from "@/app/api/landing/sponsors/route";
import { PUT, DELETE } from "@/app/api/landing/sponsors/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/sponsors-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

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
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("returns the public list without auth", async () => {
    const sponsors = [{ id: 1, name: "X", slug: "x", tier: "GOLD", logoUrl: null, websiteUrl: null, description: null }];
    (service.listSponsors as jest.Mock).mockResolvedValue(sponsors as never);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sponsors });
  });
});

describe("POST /api/landing/sponsors", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await POST(jsonReq("POST", { name: "X" }))).status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    expect((await POST(jsonReq("POST", { name: "X" }))).status).toBe(403);
  });

  it("creates a sponsor for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const sponsor = { id: 5, name: "X", slug: "x", tier: "PARTNER", logoUrl: null, websiteUrl: null, description: null };
    (service.createSponsor as jest.Mock).mockResolvedValue(sponsor as never);

    const res = await POST(jsonReq("POST", { name: "X" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ sponsor });
  });

  it("returns 400 with the validation error message", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.createSponsor as jest.Mock).mockRejectedValue(new Error("INVALID_TIER") as never);
    const res = await POST(jsonReq("POST", { name: "X", tier: "PLATINUM" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TIER" });
  });
});

describe("PUT /api/landing/sponsors/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    expect((await PUT(jsonReq("PUT", { name: "X" }), params("1"))).status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq("PUT", { name: "X" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a sponsor for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const sponsor = { id: 3, name: "X", slug: "x", tier: "GOLD", logoUrl: null, websiteUrl: null, description: null };
    (service.updateSponsor as jest.Mock).mockResolvedValue(sponsor as never);

    const res = await PUT(jsonReq("PUT", { name: "X", tier: "GOLD" }), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sponsor });
  });

  it("returns 404 when the sponsor does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.updateSponsor as jest.Mock).mockRejectedValue(new Error("SPONSOR_NOT_FOUND") as never);
    const res = await PUT(jsonReq("PUT", { name: "X" }), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/landing/sponsors/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await DELETE(jsonReq("DELETE", {}), params("1"))).status).toBe(401);
  });

  it("deletes a sponsor for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteSponsor as jest.Mock).mockResolvedValue(undefined as never);
    expect((await DELETE(jsonReq("DELETE", {}), params("4"))).status).toBe(200);
  });

  it("returns 404 when the sponsor does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteSponsor as jest.Mock).mockRejectedValue(new Error("SPONSOR_NOT_FOUND") as never);
    expect((await DELETE(jsonReq("DELETE", {}), params("99"))).status).toBe(404);
  });
});
