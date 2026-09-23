import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bureau-service");

import { GET, POST } from "@/app/api/association/bureau/route";
import { PUT, DELETE } from "@/app/api/association/bureau/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/bureau-service";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/association/bureau", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/association/bureau", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the public list without auth", async () => {
    const members = [{ id: 1, name: "Léo", role: "Président", initials: "LP", color: "c" }];
    jest.mocked(service.listBureauMembers).mockResolvedValue(members);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ members });
  });
});

describe("POST /api/association/bureau", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(403);
  });

  it("creates a member for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const member = { id: 5, name: "X", role: "Y", initials: "X", color: "c" };
    jest.mocked(service.createBureauMember).mockResolvedValue(member);

    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ member });
  });

  it("returns 400 with the validation error message", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBureauMember).mockRejectedValue(new Error("NAME_REQUIRED"));

    const res = await POST(jsonReq("POST", { name: "", role: "Y" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "NAME_REQUIRED" });
  });
});

describe("PUT /api/association/bureau/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a member for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const member = { id: 3, name: "X", role: "Y", initials: "X", color: "c" };
    jest.mocked(service.updateBureauMember).mockResolvedValue(member);

    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ member });
  });

  it("returns 404 when the member does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateBureauMember).mockRejectedValue(new Error("BUREAU_MEMBER_NOT_FOUND"));

    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/association/bureau/[id]", () => {
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

  it("deletes a member for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBureauMember).mockResolvedValue(undefined);

    const res = await DELETE(jsonReq("DELETE", {}), params("4"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when the member does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBureauMember).mockRejectedValue(new Error("BUREAU_MEMBER_NOT_FOUND"));

    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});
