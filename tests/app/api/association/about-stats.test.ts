import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/about-stats-service");

import { GET, POST } from "@/app/api/association/about-stats/route";
import { PUT, DELETE } from "@/app/api/association/about-stats/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/about-stats-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/association/about-stats", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/association/about-stats", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("returns the public list without auth", async () => {
    const stats = [{ id: 1, value: "100%", label: "Bénévole" }];
    (service.listAboutStats as jest.Mock).mockResolvedValue(stats as never);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stats });
  });
});

describe("POST /api/association/about-stats", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(jsonReq("POST", { value: "X", label: "Y" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await POST(jsonReq("POST", { value: "X", label: "Y" }));
    expect(res.status).toBe(403);
  });

  it("creates a stat for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const stat = { id: 5, value: "X", label: "Y" };
    (service.createAboutStat as jest.Mock).mockResolvedValue(stat as never);

    const res = await POST(jsonReq("POST", { value: "X", label: "Y" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ stat });
  });

  it("returns 400 with the validation error message", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.createAboutStat as jest.Mock).mockRejectedValue(new Error("VALUE_REQUIRED") as never);

    const res = await POST(jsonReq("POST", { value: "", label: "Y" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "VALUE_REQUIRED" });
  });
});

describe("PUT /api/association/about-stats/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await PUT(jsonReq("PUT", { value: "X", label: "Y" }), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq("PUT", { value: "X", label: "Y" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a stat for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const stat = { id: 3, value: "X", label: "Y" };
    (service.updateAboutStat as jest.Mock).mockResolvedValue(stat as never);

    const res = await PUT(jsonReq("PUT", { value: "X", label: "Y" }), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stat });
  });

  it("returns 404 when the stat does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.updateAboutStat as jest.Mock).mockRejectedValue(new Error("ABOUT_STAT_NOT_FOUND") as never);

    const res = await PUT(jsonReq("PUT", { value: "X", label: "Y" }), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/association/about-stats/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(401);
  });

  it("deletes a stat for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteAboutStat as jest.Mock).mockResolvedValue(undefined as never);

    const res = await DELETE(jsonReq("DELETE", {}), params("4"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when the stat does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteAboutStat as jest.Mock).mockRejectedValue(new Error("ABOUT_STAT_NOT_FOUND") as never);

    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});
