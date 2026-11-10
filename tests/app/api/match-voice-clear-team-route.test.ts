import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextResponse } from "next/server";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-voice");
jest.mock("@/lib/server/tournaments/staff-action-logs");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  enforceRateLimit: jest.fn(() => null),
}));

import { POST } from "@/app/api/matches/[matchId]/voice/clear/route";
import { enforceRateLimit, VOICE_CLEAR_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { clearOwnTeamVoiceChannel } from "@/lib/server/tournaments/match-voice";
import { announceStaffMatchAction } from "@/lib/server/tournaments/staff-action-logs";
import { authUser } from "../../helpers/auth-user";

// Vidage du salon de sa propre équipe (décision D36, `docs/features/MATCH_VOICE.md`) :
// porte joueur, sans permission de plateforme ; le service juge le rôle et le camp.

const captain = authUser({ id: 2, isAdmin: false, roles: [], pseudo: "CaptainPseudo" });

function clearReq(body: unknown) {
  return new Request("http://localhost/api/matches/9/voice/clear", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const matchParams = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(captain);
  jest.mocked(clearOwnTeamVoiceChannel).mockResolvedValue("cleared");
});

describe("POST /api/matches/[matchId]/voice/clear", () => {
  it("clearTeam_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await POST(clearReq({ teamId: 4 }), matchParams("9"))).status).toBe(401);
    expect(clearOwnTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearTeam_throttled_returnsLimitResponse", async () => {
    jest.mocked(enforceRateLimit).mockReturnValueOnce(NextResponse.json({ error: "TOO_MANY_REQUESTS" }, { status: 429 }));
    expect((await POST(clearReq({ teamId: 4 }), matchParams("9"))).status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(VOICE_CLEAR_RULE, captain.id);
    expect(clearOwnTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearTeam_badMatchId_returns400", async () => {
    const res = await POST(clearReq({ teamId: 4 }), matchParams("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_MATCH_ID" });
  });

  it("clearTeam_teamIdZero_returns400", async () => {
    const res = await POST(clearReq({ teamId: 0 }), matchParams("9"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TEAM_ID" });
    expect(clearOwnTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearTeam_teamIdNotInteger_returns400", async () => {
    const res = await POST(clearReq({ teamId: 4.5 }), matchParams("9"));
    expect(res.status).toBe(400);
    expect(clearOwnTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearTeam_teamIdMissing_returns400", async () => {
    const res = await POST(clearReq({}), matchParams("9"));
    expect(res.status).toBe(400);
    expect(clearOwnTeamVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearTeam_teamIdOne_clearsAndReturns200", async () => {
    const res = await POST(clearReq({ teamId: 1 }), matchParams("9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: true });
    expect(clearOwnTeamVoiceChannel).toHaveBeenCalledWith(9, 1, captain.id);
  });

  it("clearTeam_noTournamentsPermission_stillReachesService", async () => {
    // Aucun rôle de plateforme : la porte de l'équipe ne demande que la session.
    await POST(clearReq({ teamId: 4 }), matchParams("9"));
    expect(clearOwnTeamVoiceChannel).toHaveBeenCalledWith(9, 4, captain.id);
  });

  it("clearTeam_cleared_neverAnnouncesNorAuditsStaff", async () => {
    await POST(clearReq({ teamId: 4 }), matchParams("9"));
    expect(announceStaffMatchAction).not.toHaveBeenCalled();
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("clearTeam_notLeader_returns403NotTeamLeader", async () => {
    jest.mocked(clearOwnTeamVoiceChannel).mockResolvedValue("notLeader");
    const res = await POST(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "VOICE_CLEAR_NOT_TEAM_LEADER" });
  });

  it("clearTeam_noOpenChannel_returns409", async () => {
    jest.mocked(clearOwnTeamVoiceChannel).mockResolvedValue("notOpen");
    const res = await POST(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "VOICE_CHANNEL_NOT_OPEN" });
  });

  it("clearTeam_botUnavailable_returns503", async () => {
    jest.mocked(clearOwnTeamVoiceChannel).mockResolvedValue("unavailable");
    const res = await POST(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "VOICE_CLEAR_UNAVAILABLE" });
  });

  it("clearTeam_serviceThrows_returns500", async () => {
    jest.mocked(clearOwnTeamVoiceChannel).mockRejectedValue(new Error("boom"));
    const res = await POST(clearReq({ teamId: 4 }), matchParams("9"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "VOICE_CLEAR_FAILED" });
    expect(auditStaffAction).not.toHaveBeenCalled();
  });
});
