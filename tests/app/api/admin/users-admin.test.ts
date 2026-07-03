import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { POST } from "@/app/api/admin/users/[id]/admin/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/users-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/admin/users/7/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/users/[id]/admin", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(jsonReq({ isAdmin: true }), params("7"));
    expect(res.status).toBe(401);
    expect(service.setUserAdmin).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await POST(jsonReq({ isAdmin: true }), params("7"));
    expect(res.status).toBe(403);
    expect(service.setUserAdmin).not.toHaveBeenCalled();
  });

  it("rejects invalid ids with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(jsonReq({ isAdmin: true }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("prevents an admin from modifying their own rights", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(jsonReq({ isAdmin: false }), params("1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CANNOT_MODIFY_SELF" });
    expect(service.setUserAdmin).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean payload with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(jsonReq({ isAdmin: "yes" }), params("7"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PAYLOAD" });
    expect(service.setUserAdmin).not.toHaveBeenCalled();
  });

  it("promotes a user for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.setUserAdmin as jest.Mock).mockResolvedValue(undefined as never);

    const res = await POST(jsonReq({ isAdmin: true }), params("7"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isAdmin: true });
    expect(service.setUserAdmin).toHaveBeenCalledWith(7, true);
  });

  it("revokes admin rights", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.setUserAdmin as jest.Mock).mockResolvedValue(undefined as never);

    const res = await POST(jsonReq({ isAdmin: false }), params("7"));
    expect(res.status).toBe(200);
    expect(service.setUserAdmin).toHaveBeenCalledWith(7, false);
  });

  it("returns 404 when the target user does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.setUserAdmin as jest.Mock).mockRejectedValue(new Error("USER_NOT_FOUND") as never);

    const res = await POST(jsonReq({ isAdmin: true }), params("7"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "USER_NOT_FOUND" });
  });
});
