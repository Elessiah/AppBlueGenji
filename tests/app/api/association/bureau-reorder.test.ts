import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bureau-service");

import { PUT } from "@/app/api/association/bureau/reorder/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/bureau-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/association/bureau/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/association/bureau/reorder", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(401);
    expect(service.reorderBureauMembers).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(403);
    expect(service.reorderBureauMembers).not.toHaveBeenCalled();
  });

  it("rejects an invalid ids payload with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq({ ids: [1, 1] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "DUPLICATE_ID" });
    expect(service.reorderBureauMembers).not.toHaveBeenCalled();
  });

  it("reorders for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.reorderBureauMembers as jest.Mock).mockResolvedValue(undefined as never);

    const res = await PUT(jsonReq({ ids: [3, 1, 2] }));
    expect(res.status).toBe(200);
    expect(service.reorderBureauMembers).toHaveBeenCalledWith([3, 1, 2]);
  });

  it("returns 400 when the service throws", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.reorderBureauMembers as jest.Mock).mockRejectedValue(new Error("BOOM") as never);

    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "BOOM" });
  });
});
