import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { POST } from "@/app/api/admin/users/[id]/roles/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/users-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/admin/users/7/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/users/[id]/roles", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));
    expect(res.status).toBe(401);
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));
    expect(res.status).toBe(403);
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects invalid ids with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(jsonReq({ roles: [] }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("prevents an admin from modifying their own roles", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(jsonReq({ roles: [] }), params("1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CANNOT_MODIFY_SELF" });
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects a non-array roles payload with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(jsonReq({ roles: "ARBITRE" }), params("7"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PAYLOAD" });
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects unknown role values with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(jsonReq({ roles: ["ARBITRE", "NOPE"] }), params("7"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PAYLOAD" });
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("assigns cumulative roles for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.setUserRoles as jest.Mock).mockResolvedValue(["ARBITRE", "RECRUTEUR"] as never);

    const res = await POST(jsonReq({ roles: ["ARBITRE", "RECRUTEUR"] }), params("7"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roles: ["ARBITRE", "RECRUTEUR"] });
    expect(service.setUserRoles).toHaveBeenCalledWith(7, ["ARBITRE", "RECRUTEUR"]);
  });

  it("accepts an empty roles array (revokes all)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.setUserRoles as jest.Mock).mockResolvedValue([] as never);

    const res = await POST(jsonReq({ roles: [] }), params("7"));
    expect(res.status).toBe(200);
    expect(service.setUserRoles).toHaveBeenCalledWith(7, []);
  });

  it("returns 404 when the target user does not exist", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.setUserRoles as jest.Mock).mockRejectedValue(new Error("USER_NOT_FOUND") as never);

    const res = await POST(jsonReq({ roles: ["ADMIN"] }), params("7"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "USER_NOT_FOUND" });
  });
});
