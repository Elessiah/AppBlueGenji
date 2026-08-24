import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/about-pillars-service");

import { PUT } from "@/app/api/association/about-pillars/reorder/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/about-pillars-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/association/about-pillars/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/association/about-pillars/reorder", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(401);
    expect(service.reorderAboutPillars).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(403);
  });

  it("rejects an empty ids list with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await PUT(jsonReq({ ids: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IDS_EMPTY" });
    expect(service.reorderAboutPillars).not.toHaveBeenCalled();
  });

  it("reorders for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.reorderAboutPillars as jest.Mock).mockResolvedValue(undefined as never);

    const res = await PUT(jsonReq({ ids: [2, 1] }));
    expect(res.status).toBe(200);
    expect(service.reorderAboutPillars).toHaveBeenCalledWith([2, 1]);
  });
});
