import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/benevoles-service");

import { GET, POST } from "@/app/api/benevoles/route";
import { PUT, DELETE } from "@/app/api/benevoles/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/benevoles-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

const sampleBenevole = {
  id: 1,
  firstName: "Marie",
  pseudo: "MarieD",
  lastName: "Dupont",
  category: "Développeur",
  photoUrl: null,
  joinedAt: "2024-03-15",
};

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/benevoles", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/benevoles", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("returns the public list without auth", async () => {
    (service.listBenevoles as jest.Mock).mockResolvedValue([sampleBenevole] as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevoles: [sampleBenevole] });
  });

  it("returns an empty array when no benevoles exist", async () => {
    (service.listBenevoles as jest.Mock).mockResolvedValue([] as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevoles: [] });
  });
});

describe("POST /api/benevoles", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  const body = {
    firstName: "Marie",
    lastName: "Dupont",
    category: "Développeur",
    joinedAt: "2024-03-15",
  };

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(403);
  });

  it("creates a benevole for admins and returns 201", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.createBenevole as jest.Mock).mockResolvedValue(sampleBenevole as never);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ benevole: sampleBenevole });
  });

  it("returns 400 with the validation error code", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.createBenevole as jest.Mock).mockRejectedValue(new Error("FIRST_NAME_REQUIRED") as never);
    const res = await POST(jsonReq("POST", { ...body, firstName: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FIRST_NAME_REQUIRED" });
  });

  it("returns 400 for invalid JSON body", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(new Request("http://localhost/api/benevoles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_BODY" });
  });
});

describe("PUT /api/benevoles/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  const body = {
    firstName: "Marie",
    lastName: "Dupont",
    category: "Développeur",
    joinedAt: "2024-03-15",
  };

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq("PUT", body), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("rejects a non-positive id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq("PUT", body), params("0"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a benevole for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.updateBenevole as jest.Mock).mockResolvedValue(sampleBenevole as never);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevole: sampleBenevole });
  });

  it("returns 404 when benevole does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.updateBenevole as jest.Mock).mockRejectedValue(new Error("BENEVOLE_NOT_FOUND") as never);
    const res = await PUT(jsonReq("PUT", body), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/benevoles/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await DELETE(jsonReq("DELETE", {}), params("abc"));
    expect(res.status).toBe(400);
  });

  it("deletes a benevole for admins and returns 200", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteBenevole as jest.Mock).mockResolvedValue(undefined as never);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when benevole does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteBenevole as jest.Mock).mockRejectedValue(new Error("BENEVOLE_NOT_FOUND") as never);
    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});
