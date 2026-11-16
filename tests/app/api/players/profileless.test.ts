import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/api-guard", () => ({
  DIRECTORY_READ_RULE: { name: "directory-read", limit: 60, windowMs: 60_000 },
  enforceRateLimit: jest.fn(),
}));
jest.mock("@/lib/server/users/profileless-players");

import { NextResponse } from "next/server";
import { GET } from "@/app/api/players/profileless/route";
import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/api-guard";
import { loadProfilelessPlayerIdsForClient } from "@/lib/server/users/profileless-players";
import { authUser } from "../../../helpers/auth-user";

/** Relecture des comptes sans fiche à la navigation client (EF-62) : connecté seulement. */
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(enforceRateLimit).mockReturnValue(null);
  jest.mocked(loadProfilelessPlayerIdsForClient).mockResolvedValue([3, 8]);
});

describe("GET /api/players/profileless", () => {
  it("GET_anonymous_returns401WithoutReading", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(loadProfilelessPlayerIdsForClient).not.toHaveBeenCalled();
  });

  it("GET_signedIn_returnsIds", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [3, 8] });
  });

  it("GET_rateLimited_returns429", async () => {
    jest.mocked(enforceRateLimit).mockReturnValue(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));

    const res = await GET();

    expect(res.status).toBe(429);
    expect(loadProfilelessPlayerIdsForClient).not.toHaveBeenCalled();
  });
});
