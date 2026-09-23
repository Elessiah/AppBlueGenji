import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/benevoles-service");

import { PUT } from "@/app/api/benevoles/reorder/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/benevoles-service";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/benevoles/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/benevoles/reorder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await PUT(jsonReq({ categories: ["Dev", "Arbitre"] }));
    expect(res.status).toBe(401);
    expect(service.reorderBenevoleCategories).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq({ categories: ["Dev", "Arbitre"] }));
    expect(res.status).toBe(403);
    expect(service.reorderBenevoleCategories).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON body", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(new Request("http://localhost/api/benevoles/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_BODY" });
  });

  it("rejects an empty category list with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq({ categories: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CATEGORIES_EMPTY" });
    expect(service.reorderBenevoleCategories).not.toHaveBeenCalled();
  });

  it("rejects a duplicate category with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq({ categories: ["Dev", "Dev"] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "DUPLICATE_CATEGORY" });
  });

  it("reorders categories for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.reorderBenevoleCategories).mockResolvedValue(undefined);

    const res = await PUT(jsonReq({ categories: ["Caster", "Dev", "Arbitre"] }));
    expect(res.status).toBe(200);
    expect(service.reorderBenevoleCategories).toHaveBeenCalledWith(["Caster", "Dev", "Arbitre"]);
  });

  it("surfaces service errors as 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.reorderBenevoleCategories).mockRejectedValue(new Error("BOOM"));
    const res = await PUT(jsonReq({ categories: ["Dev"] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "BOOM" });
  });
});
