import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/api-guard", () => ({
  DIRECTORY_READ_RULE: { name: "directory-read", limit: 60, windowMs: 60_000 },
  enforceRateLimit: jest.fn(),
}));
jest.mock("@/lib/server/users/profileless-players");

import { NextRequest, NextResponse } from "next/server";
import { GET } from "@/app/api/players/profileless/route";
import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/api-guard";
import { profilelessAmong } from "@/lib/server/users/profileless-players";
import { authUser } from "../../../helpers/auth-user";

/** Question des liens de joueur (D86) : connecté seulement, pour les seuls comptes affichés. */
function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/players/profileless${query}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(enforceRateLimit).mockReturnValue(null);
  jest.mocked(profilelessAmong).mockResolvedValue([8]);
});

describe("GET /api/players/profileless", () => {
  it("GET_anonymous_returns401WithoutReading", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await get("?ids=3,8");

    expect(res.status).toBe(401);
    expect(profilelessAmong).not.toHaveBeenCalled();
  });

  it("GET_signedIn_returnsProfilelessAmongAskedIds", async () => {
    const res = await get("?ids=3,8");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [8] });
    expect(profilelessAmong).toHaveBeenCalledWith([3, 8]);
  });

  it("GET_missingIds_returns400WithoutReading", async () => {
    const res = await get("");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PLAYER_IDS" });
    expect(profilelessAmong).not.toHaveBeenCalled();
  });

  it("GET_malformedIds_returns400", async () => {
    const res = await get("?ids=3,abc");

    expect(res.status).toBe(400);
  });

  it("GET_rateLimited_returns429", async () => {
    jest.mocked(enforceRateLimit).mockReturnValue(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));

    const res = await get("?ids=3");

    expect(res.status).toBe(429);
    expect(profilelessAmong).not.toHaveBeenCalled();
  });
});
