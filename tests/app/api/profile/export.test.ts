import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { GET } from "@/app/api/profile/export/route";
import { getCurrentUser } from "@/lib/server/auth";
import { exportOwnData } from "@/lib/server/users-service";
import type { PersonalDataExport } from "@/lib/shared/types";

const user = { id: 42 } as Awaited<ReturnType<typeof getCurrentUser>>;

function sampleExport(): PersonalDataExport {
  return {
    exportedAt: "2026-07-04T00:00:00.000Z",
    account: {
      id: 42,
      pseudo: "player",
      email: "user@example.com",
      discordId: "123",
      discordPseudo: "player#0001",
      googleSub: null,
      isAdult: true,
      isAdmin: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    profile: {
      avatarUrl: null,
      overwatchBattletag: "Player#1234",
      marvelRivalsTag: null,
      visibility: { avatar: false, pseudo: true, overwatch: false, marvel: false, major: false },
    },
    stats: {
      tournamentsPlayed: 0,
      tournamentsWon: 0,
      matchesWon: 0,
      matchesLost: 0,
      bestRank: null,
      averageRank: null,
    },
    teamsTimeline: [],
    tournaments: [],
  };
}

describe("GET /api/profile/export", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(exportOwnData).not.toHaveBeenCalled();
  });

  it("exports only the authenticated user's own data", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (exportOwnData as jest.Mock).mockResolvedValue(sampleExport() as never);

    const res = await GET();
    expect(res.status).toBe(200);
    // L'export porte sur l'id du user authentifié — jamais un tiers.
    expect(exportOwnData).toHaveBeenCalledWith(42);

    const body = JSON.parse(await res.text()) as PersonalDataExport;
    expect(body.account.email).toBe("user@example.com");
    expect(body.account.id).toBe(42);
  });

  it("serves the payload as a downloadable JSON attachment", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (exportOwnData as jest.Mock).mockResolvedValue(sampleExport() as never);

    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="bluegenji-donnees-42.json"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 when the profile no longer exists", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (exportOwnData as jest.Mock).mockRejectedValue(new Error("PROFILE_NOT_FOUND") as never);

    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "PROFILE_NOT_FOUND" });
  });
});
