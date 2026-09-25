import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/landing-service");

import { GET } from "@/app/api/landing/leaderboard/route";
import { getLandingLeaderboard } from "@/lib/server/landing-service";

/**
 * Le paramètre `game` était lu puis ignoré (`console.warn`) : la route le
 * traduit désormais en `TournamentGame` et le transmet au chargeur partagé.
 */
function req(query = ""): Request {
  return new Request(`http://localhost/api/landing/leaderboard${query}`);
}

describe("GET /api/landing/leaderboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getLandingLeaderboard).mockResolvedValue([]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("ne filtre rien sans paramètre `game` (« Général »)", async () => {
    await GET(req());
    expect(getLandingLeaderboard).toHaveBeenCalledWith(8, undefined);
  });

  it("traduit `ow` en `OW`", async () => {
    await GET(req("?game=ow"));
    expect(getLandingLeaderboard).toHaveBeenCalledWith(8, "OW");
  });

  it("traduit `mr` en `MR`", async () => {
    await GET(req("?game=mr"));
    expect(getLandingLeaderboard).toHaveBeenCalledWith(8, "MR");
  });

  it("est insensible à la casse", async () => {
    await GET(req("?game=OW"));
    expect(getLandingLeaderboard).toHaveBeenCalledWith(8, "OW");
  });

  it("retombe sur « aucun filtre » pour toute valeur inconnue, sans planter", async () => {
    await GET(req("?game=valorant"));
    expect(getLandingLeaderboard).toHaveBeenCalledWith(8, undefined);
  });

  it("traite `all` explicite comme l'absence de filtre", async () => {
    await GET(req("?game=all"));
    expect(getLandingLeaderboard).toHaveBeenCalledWith(8, undefined);
  });

  it("combine le jeu avec la limite demandée", async () => {
    await GET(req("?game=mr&limit=20"));
    expect(getLandingLeaderboard).toHaveBeenCalledWith(20, "MR");
  });

  it("rend le classement du chargeur", async () => {
    const rows = [
      {
        rank: 1,
        teamId: 1,
        teamName: "Alpha",
        logoUrl: null,
        wins: 1,
        losses: 0,
        points: 520,
        trend: "flat" as const,
        trendValue: 0,
      },
    ];
    jest.mocked(getLandingLeaderboard).mockResolvedValue(rows);

    const res = await GET(req("?game=ow"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leaderboard: rows });
  });
});
