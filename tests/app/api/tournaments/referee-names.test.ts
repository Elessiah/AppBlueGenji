import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/tournaments/referee-names", () => ({ loadRefereeNames: jest.fn() }));
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  enforceRateLimit: jest.fn(),
}));

import { NextResponse } from "next/server";
import { GET } from "@/app/api/tournaments/[id]/referee-names/route";
import { enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { loadRefereeNames } from "@/lib/server/tournaments/referee-names";
import { authUser } from "../../../helpers/auth-user";
import { tournamentSnapshot } from "../../../helpers/tournament-detail";

/** Relecture légère des pseudos d'arbitre (MATCH-UI-NAMES, décision 52). */

function get(id: string) {
  return GET(new Request(`http://localhost/api/tournaments/${id}/referee-names`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3 }));
  jest.mocked(enforceRateLimit).mockReturnValue(null);
  jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(tournamentSnapshot());
  jest.mocked(loadRefereeNames).mockResolvedValue([{ matchId: 5, refereeKey: "k", pseudo: "Alpha" }]);
});

describe("GET /api/tournaments/[id]/referee-names", () => {
  it("GET_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await get("7");

    expect(res.status).toBe(401);
    expect(loadRefereeNames).not.toHaveBeenCalled();
  });

  it("GET_rateLimited_returnsThrottleResponse", async () => {
    jest.mocked(enforceRateLimit).mockReturnValue(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));

    const res = await get("7");

    expect(res.status).toBe(429);
    expect(getVisibleTournamentSnapshot).not.toHaveBeenCalled();
  });

  it("GET_nonIntegerId_returns400", async () => {
    const res = await get("abc");

    expect(res.status).toBe(400);
  });

  it("GET_zeroId_returns400", async () => {
    const res = await get("0");

    expect(res.status).toBe(400);
  });

  it("GET_invisibleTournament_returns404", async () => {
    jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(null);

    const res = await get("7");

    expect(res.status).toBe(404);
  });

  it("GET_visibleTournament_returnsRefereeNames", async () => {
    const res = await get("7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refereeNames: [{ matchId: 5, refereeKey: "k", pseudo: "Alpha" }] });
    expect(getVisibleTournamentSnapshot).toHaveBeenCalledWith(7, { canManage: false });
  });

  it("GET_staffViewer_passesCanManage", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: true }));

    await get("7");

    expect(getVisibleTournamentSnapshot).toHaveBeenCalledWith(7, { canManage: true });
  });
});
