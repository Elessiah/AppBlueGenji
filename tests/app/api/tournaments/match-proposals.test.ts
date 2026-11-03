import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  enforceRateLimit: jest.fn(),
}));

import { NextResponse } from "next/server";
import { GET } from "@/app/api/tournaments/[id]/matches/[matchId]/proposals/route";
import { MATCH_PROPOSALS_READ_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { getViewerMatchProposals } from "@/lib/server/tournaments-service";
import type { MatchProposalMaps } from "@/lib/shared/types";
import { authUser } from "../../../helpers/auth-user";

/**
 * Relecture légère des propositions d'un match (ERREUR.txt EF-15) : les
 * dialogues de score relisaient sinon tout le tournoi pour un seul match.
 */

const proposals: MatchProposalMaps = {
  matchId: 70,
  team1: null,
  team2: { reportedAt: "2026-11-03T18:00:00.000Z", maps: [{ mapNumber: 1, replayCode: "ABC123", team1Score: 0, team2Score: 2 }] },
};

function get(id: string, matchId: string) {
  return GET(new Request(`http://localhost/api/tournaments/${id}/matches/${matchId}/proposals`), {
    params: Promise.resolve({ id, matchId }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3 }));
  jest.mocked(enforceRateLimit).mockReturnValue(null);
  jest.mocked(getViewerMatchProposals).mockResolvedValue({ visible: true, proposals });
});

describe("GET /api/tournaments/[id]/matches/[matchId]/proposals", () => {
  it("GET_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await get("7", "70");

    expect(res.status).toBe(401);
    expect(getViewerMatchProposals).not.toHaveBeenCalled();
  });

  // Revue perf #542 : seau propre, distinct de la lecture REST du détail.
  it("GET_nominal_usesItsOwnRateBucket", async () => {
    await get("7", "70");

    expect(enforceRateLimit).toHaveBeenCalledWith(MATCH_PROPOSALS_READ_RULE, 3);
  });

  it("GET_rateLimited_returnsThrottleResponse", async () => {
    jest.mocked(enforceRateLimit).mockReturnValue(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));

    const res = await get("7", "70");

    expect(res.status).toBe(429);
    expect(getViewerMatchProposals).not.toHaveBeenCalled();
  });

  it("GET_zeroTournamentId_returns400", async () => {
    const res = await get("0", "70");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
  });

  it("GET_nonIntegerMatchId_returns400", async () => {
    const res = await get("7", "1.5");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_MATCH_ID" });
  });

  it("GET_zeroMatchId_returns400", async () => {
    const res = await get("7", "0");

    expect(res.status).toBe(400);
    expect(getViewerMatchProposals).not.toHaveBeenCalled();
  });

  it("GET_invisibleTournament_returns404", async () => {
    jest.mocked(getViewerMatchProposals).mockResolvedValue({ visible: false });

    const res = await get("7", "70");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
  });

  it("GET_player_returnsReadableProposalsOfThatMatch", async () => {
    const res = await get("7", "70");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposals });
    expect(getViewerMatchProposals).toHaveBeenCalledWith(7, 3, false, 70);
  });

  it("GET_nothingReadable_returnsNullProposals", async () => {
    jest.mocked(getViewerMatchProposals).mockResolvedValue({ visible: true, proposals: null });

    const res = await get("7", "70");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposals: null });
  });

  it("GET_staffViewer_readsWithCanManage", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: true }));

    await get("7", "70");

    expect(getViewerMatchProposals).toHaveBeenCalledWith(7, 1, true, 70);
  });
});
