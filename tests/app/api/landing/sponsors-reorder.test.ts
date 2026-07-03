import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/sponsors-service");

import { PUT } from "@/app/api/landing/sponsors/reorder/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/sponsors-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/landing/sponsors/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/landing/sponsors/reorder", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(401);
    expect(service.reorderSponsors).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq({ ids: [1, -3] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
    expect(service.reorderSponsors).not.toHaveBeenCalled();
  });

  it("reorders for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.reorderSponsors as jest.Mock).mockResolvedValue(undefined as never);

    const res = await PUT(jsonReq({ ids: [5, 4, 3] }));
    expect(res.status).toBe(200);
    expect(service.reorderSponsors).toHaveBeenCalledWith([5, 4, 3]);
  });
});
