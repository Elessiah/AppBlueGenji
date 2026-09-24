import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/benevoles-service");

import { GET, POST } from "@/app/api/benevoles/route";
import { PUT, DELETE } from "@/app/api/benevoles/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/benevoles-service";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

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
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the public list without auth", async () => {
    jest.mocked(service.listBenevoles).mockResolvedValue([sampleBenevole]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevoles: [sampleBenevole] });
  });

  it("returns an empty array when no benevoles exist", async () => {
    jest.mocked(service.listBenevoles).mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevoles: [] });
  });
});

describe("POST /api/benevoles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const body = {
    firstName: "Marie",
    lastName: "Dupont",
    category: "Développeur",
    joinedAt: "2024-03-15",
  };

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(403);
  });

  it("creates a benevole for admins and returns 201", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockResolvedValue(sampleBenevole);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ benevole: sampleBenevole });
  });

  it("returns 400 with the validation error code", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockRejectedValue(new Error("FIRST_NAME_REQUIRED"));
    const res = await POST(jsonReq("POST", { ...body, firstName: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FIRST_NAME_REQUIRED" });
  });

  it("returns 400 for invalid JSON body", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
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
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const body = {
    firstName: "Marie",
    lastName: "Dupont",
    category: "Développeur",
    joinedAt: "2024-03-15",
  };

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", body), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("rejects a non-positive id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", body), params("0"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a benevole for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateBenevole).mockResolvedValue(sampleBenevole);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevole: sampleBenevole });
  });

  it("returns 404 when benevole does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateBenevole).mockRejectedValue(new Error("BENEVOLE_NOT_FOUND"));
    const res = await PUT(jsonReq("PUT", body), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/benevoles/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await DELETE(jsonReq("DELETE", {}), params("abc"));
    expect(res.status).toBe(400);
  });

  it("deletes a benevole for admins and returns 200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBenevole).mockResolvedValue(undefined);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when benevole does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBenevole).mockRejectedValue(new Error("BENEVOLE_NOT_FOUND"));
    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});
