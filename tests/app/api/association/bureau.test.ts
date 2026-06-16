import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bureau-service");

import { GET, POST } from "@/app/api/association/bureau/route";
import { PUT, DELETE } from "@/app/api/association/bureau/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/bureau-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

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
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("returns the public list without auth", async () => {
    const members = [{ id: 1, name: "Léo", role: "Président", initials: "LP", color: "c" }];
    (service.listBureauMembers as jest.Mock).mockResolvedValue(members as never);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ members });
  });
});

describe("POST /api/association/bureau", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(403);
  });

  it("creates a member for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const member = { id: 5, name: "X", role: "Y", initials: "X", color: "c" };
    (service.createBureauMember as jest.Mock).mockResolvedValue(member as never);

    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ member });
  });

  it("returns 400 with the validation error message", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.createBureauMember as jest.Mock).mockRejectedValue(new Error("NAME_REQUIRED") as never);

    const res = await POST(jsonReq("POST", { name: "", role: "Y" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "NAME_REQUIRED" });
  });
});

describe("PUT /api/association/bureau/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a member for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const member = { id: 3, name: "X", role: "Y", initials: "X", color: "c" };
    (service.updateBureauMember as jest.Mock).mockResolvedValue(member as never);

    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ member });
  });

  it("returns 404 when the member does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.updateBureauMember as jest.Mock).mockRejectedValue(new Error("BUREAU_MEMBER_NOT_FOUND") as never);

    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/association/bureau/[id]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(401);
  });

  it("deletes a member for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteBureauMember as jest.Mock).mockResolvedValue(undefined as never);

    const res = await DELETE(jsonReq("DELETE", {}), params("4"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when the member does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.deleteBureauMember as jest.Mock).mockRejectedValue(new Error("BUREAU_MEMBER_NOT_FOUND") as never);

    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});
