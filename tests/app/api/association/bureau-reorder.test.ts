import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bureau-service");

import { PUT } from "@/app/api/association/bureau/reorder/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/bureau-service";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/association/bureau/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/association/bureau/reorder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(401);
    expect(service.reorderBureauMembers).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(403);
    expect(service.reorderBureauMembers).not.toHaveBeenCalled();
  });

  it("rejects an invalid ids payload with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq({ ids: [1, 1] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "DUPLICATE_ID" });
    expect(service.reorderBureauMembers).not.toHaveBeenCalled();
  });

  it("reorders for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.reorderBureauMembers).mockResolvedValue(undefined);

    const res = await PUT(jsonReq({ ids: [3, 1, 2] }));
    expect(res.status).toBe(200);
    expect(service.reorderBureauMembers).toHaveBeenCalledWith([3, 1, 2]);
  });

  it("returns 400 when the service throws", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.reorderBureauMembers).mockRejectedValue(new Error("BOOM"));

    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "BOOM" });
  });
});
