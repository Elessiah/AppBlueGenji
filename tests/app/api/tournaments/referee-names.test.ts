import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/tournaments/referee-names", () => ({
  loadLiveRefereeNames: jest.fn(),
  markViewerReferee: jest.fn(),
  viewerDesignated: jest.fn(),
}));
jest.mock("@/lib/server/tournaments/match-launch", () => ({ loadViewerRefereeEligible: jest.fn() }));
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  enforceRateLimit: jest.fn(),
}));

import { NextResponse } from "next/server";
import { GET } from "@/app/api/tournaments/[id]/referee-names/route";
import { enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { loadViewerRefereeEligible } from "@/lib/server/tournaments/match-launch";
import { loadLiveRefereeNames, markViewerReferee, viewerDesignated, type RefereeNamesRead } from "@/lib/server/tournaments/referee-names";
import { authUser } from "../../../helpers/auth-user";
import { tournamentCard } from "../../../helpers/tournament-card";

/** Relecture légère des pseudos d'arbitre (MATCH-UI-NAMES, décision 52). */

function get(id: string) {
  return GET(new Request(`http://localhost/api/tournaments/${id}/referee-names`), { params: Promise.resolve({ id }) });
}

const READ: RefereeNamesRead = {
  names: [{ matchId: 5, refereeKey: "k", pseudo: "Alpha" }],
  designations: [{ matchId: 5, refereeKey: "k", pseudo: "Alpha", refereeUserId: 3 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3 }));
  jest.mocked(enforceRateLimit).mockReturnValue(null);
  jest.mocked(getVisibleTournamentCard).mockResolvedValue(tournamentCard({ id: 7, game: "MR" }));
  jest.mocked(loadLiveRefereeNames).mockResolvedValue(READ);
  jest.mocked(viewerDesignated).mockReturnValue(false);
  jest.mocked(loadViewerRefereeEligible).mockResolvedValue(true);
  jest.mocked(markViewerReferee).mockImplementation((read) => read.names);
});

describe("GET /api/tournaments/[id]/referee-names", () => {
  it("GET_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await get("7");

    expect(res.status).toBe(401);
    expect(loadLiveRefereeNames).not.toHaveBeenCalled();
  });

  it("GET_rateLimited_returnsThrottleResponse", async () => {
    jest.mocked(enforceRateLimit).mockReturnValue(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));

    const res = await get("7");

    expect(res.status).toBe(429);
    expect(getVisibleTournamentCard).not.toHaveBeenCalled();
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
    jest.mocked(getVisibleTournamentCard).mockResolvedValue(null);

    const res = await get("7");

    expect(res.status).toBe(404);
  });

  it("GET_visibleTournament_returnsRefereeNames", async () => {
    const res = await get("7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refereeNames: [{ matchId: 5, refereeKey: "k", pseudo: "Alpha" }] });
    expect(getVisibleTournamentCard).toHaveBeenCalledWith(7, { canManage: false });
  });

  it("GET_staffViewer_passesCanManage", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: true }));

    await get("7");

    expect(getVisibleTournamentCard).toHaveBeenCalledWith(7, { canManage: true });
  });

  it("GET_visibleTournament_readsNamesFromCardWithoutSnapshot", async () => {
    await get("7");

    expect(loadLiveRefereeNames).toHaveBeenCalledWith(expect.objectContaining({ id: 7, game: "MR" }));
  });

  it("GET_viewerNotDesignated_skipsIdentityRead", async () => {
    await get("7");

    expect(loadViewerRefereeEligible).not.toHaveBeenCalled();
    expect(markViewerReferee).toHaveBeenCalledWith(READ, 3, false);
  });

  it("GET_viewerDesignatedAndEligible_marksHisMatches", async () => {
    jest.mocked(viewerDesignated).mockReturnValue(true);
    jest.mocked(markViewerReferee).mockReturnValue([{ matchId: 5, refereeKey: "k", pseudo: "Alpha", mine: true }]);

    const res = await get("7");

    expect(await res.json()).toEqual({ refereeNames: [{ matchId: 5, refereeKey: "k", pseudo: "Alpha", mine: true }] });
    // Le lecteur lui-même, jamais un identifiant lu dans la requête.
    expect(loadViewerRefereeEligible).toHaveBeenCalledWith(3, false, "MR");
    expect(markViewerReferee).toHaveBeenCalledWith(READ, 3, true);
  });

  it("GET_viewerDesignatedButNoLongerEligible_passesNotEligible", async () => {
    jest.mocked(viewerDesignated).mockReturnValue(true);
    jest.mocked(loadViewerRefereeEligible).mockResolvedValue(false);

    await get("7");

    expect(markViewerReferee).toHaveBeenCalledWith(READ, 3, false);
  });

  it("GET_staffViewerDesignated_checksEligibilityWithPermission", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: true }));
    jest.mocked(viewerDesignated).mockReturnValue(true);

    await get("7");

    expect(loadViewerRefereeEligible).toHaveBeenCalledWith(1, true, "MR");
  });
});
