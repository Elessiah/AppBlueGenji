import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/about-pillars-service");

import { GET, POST } from "@/app/api/association/about-pillars/route";
import { PUT, DELETE } from "@/app/api/association/about-pillars/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/about-pillars-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/association/about-pillars", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/association/about-pillars", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("returns the public list without auth", async () => {
    const pillars = [{ id: 1, title: "Accessible", text: "Inscription gratuite." }];
    (service.listAboutPillars as jest.Mock).mockResolvedValue(pillars as never);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pillars });
  });
});

describe("POST /api/association/about-pillars", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(jsonReq("POST", { title: "X", text: "Y" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await POST(jsonReq("POST", { title: "X", text: "Y" }));
    expect(res.status).toBe(403);
  });

  it("creates a pillar for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const pillar = { id: 5, title: "X", text: "Y" };
    (service.createAboutPillar as jest.Mock).mockResolvedValue(pillar as never);

    const res = await POST(jsonReq("POST", { title: "X", text: "Y" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pillar });
  });

  it("returns 400 with the validation error message", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.createAboutPillar as jest.Mock).mockRejectedValue(new Error("TITLE_REQUIRED") as never);

    const res = await POST(jsonReq("POST", { title: "", text: "Y" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "TITLE_REQUIRED" });
  });
});

describe("PUT /api/association/about-pillars/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await PUT(jsonReq("PUT", { title: "X", text: "Y" }), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq("PUT", { title: "X", text: "Y" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a pillar for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const pillar = { id: 3, title: "X", text: "Y" };
    (service.updateAboutPillar as jest.Mock).mockResolvedValue(pillar as never);

    const res = await PUT(jsonReq("PUT", { title: "X", text: "Y" }), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pillar });
  });

  it("returns 404 when the pillar does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.updateAboutPillar as jest.Mock).mockRejectedValue(new Error("ABOUT_PILLAR_NOT_FOUND") as never);

    const res = await PUT(jsonReq("PUT", { title: "X", text: "Y" }), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/association/about-pillars/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(401);
  });

  it("deletes a pillar for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteAboutPillar as jest.Mock).mockResolvedValue(undefined as never);

    const res = await DELETE(jsonReq("DELETE", {}), params("4"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when the pillar does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteAboutPillar as jest.Mock).mockRejectedValue(new Error("ABOUT_PILLAR_NOT_FOUND") as never);

    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});
