import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/about-pillars-service");

import { PUT } from "@/app/api/association/about-pillars/reorder/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/about-pillars-service";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/association/about-pillars/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/association/about-pillars/reorder", () => {
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
    expect(service.reorderAboutPillars).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq({ ids: [1, 2] }));
    expect(res.status).toBe(403);
  });

  it("rejects an empty ids list with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq({ ids: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IDS_EMPTY" });
    expect(service.reorderAboutPillars).not.toHaveBeenCalled();
  });

  it("reorders for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.reorderAboutPillars).mockResolvedValue(undefined);

    const res = await PUT(jsonReq({ ids: [2, 1] }));
    expect(res.status).toBe(200);
    expect(service.reorderAboutPillars).toHaveBeenCalledWith([2, 1]);
  });
});
