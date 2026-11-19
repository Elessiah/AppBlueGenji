import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/planning-guest");

import { PUT } from "@/app/api/admin/users/[id]/planning-guest/route";
import { getCurrentUser } from "@/lib/server/auth";
import { publishPlanningGuestChange, setPlanningGuest } from "@/lib/server/users/planning-guest";
import { authUser } from "../../../helpers/auth-user";

/** PUT /api/admin/users/[id]/planning-guest (`CAST_PLANNING.md` § Invités). */

const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/admin/users/7/planning-guest", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(admin);
});

describe("PUT /api/admin/users/[id]/planning-guest", () => {
  it("put_anonymous_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await PUT(jsonReq({ guest: true }), params("7"));

    expect(res.status).toBe(401);
    expect(setPlanningGuest).not.toHaveBeenCalled();
  });

  it("put_staffWithoutRolesPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3, isAdmin: false, roles: ["CASTER", "ARBITRE", "PROD"] }));

    const res = await PUT(jsonReq({ guest: true }), params("7"));

    expect(res.status).toBe(403);
    expect(setPlanningGuest).not.toHaveBeenCalled();
  });

  it("put_invalidId_returns400", async () => {
    const res = await PUT(jsonReq({ guest: true }), params("abc"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "INVALID_ID" });
  });

  it("put_ownAccount_returns400", async () => {
    const res = await PUT(jsonReq({ guest: true }), params("1"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "CANNOT_MODIFY_SELF" });
  });

  it("put_guestNotBoolean_returns400", async () => {
    const res = await PUT(jsonReq({ guest: "oui" }), params("7"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "INVALID_PAYLOAD" });
  });

  it("put_unknownUser_returns404", async () => {
    jest.mocked(setPlanningGuest).mockRejectedValue(new Error("USER_NOT_FOUND"));

    const res = await PUT(jsonReq({ guest: true }), params("7"));

    expect(res.status).toBe(404);
  });

  it("put_adminTarget_returns409", async () => {
    jest.mocked(setPlanningGuest).mockRejectedValue(new Error("PLANNING_GUEST_ADMIN"));

    const res = await PUT(jsonReq({ guest: true }), params("7"));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "PLANNING_GUEST_ADMIN" });
    expect(publishPlanningGuestChange).not.toHaveBeenCalled();
  });

  it("put_flagged_returnsCountsAndPublishes", async () => {
    const saved = { guest: true, changed: true, release: { withdrawn: 2, failed: 1, availabilityCleared: 0 } };
    jest.mocked(setPlanningGuest).mockResolvedValue(saved);

    const res = await PUT(jsonReq({ guest: true }), params("7"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ guest: true, changed: true, withdrawn: 2, failed: 1 });
    expect(setPlanningGuest).toHaveBeenCalledWith(7, true, 1);
    expect(publishPlanningGuestChange).toHaveBeenCalledWith({ id: 1, pseudo: admin.pseudo }, 7, saved);
  });

  it("put_unflagged_returnsZeroCounts", async () => {
    jest.mocked(setPlanningGuest).mockResolvedValue({ guest: false, changed: true, release: null });

    const res = await PUT(jsonReq({ guest: false }), params("7"));

    expect(await res.json()).toMatchObject({ guest: false, withdrawn: 0, failed: 0 });
  });

  it("put_publishThrows_stillReturns200", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(setPlanningGuest).mockResolvedValue({ guest: true, changed: true, release: null });
    jest.mocked(publishPlanningGuestChange).mockImplementation(() => {
      throw new Error("journal");
    });

    const res = await PUT(jsonReq({ guest: true }), params("7"));

    expect(res.status).toBe(200);
  });
});
