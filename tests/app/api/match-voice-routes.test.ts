import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextResponse } from "next/server";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-voice");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  enforceRateLimit: jest.fn(() => null),
}));

import { PUT } from "@/app/api/admin/tournaments/[id]/voice-channels/route";
import { GET } from "@/app/api/matches/[matchId]/voice/route";
import { enforceRateLimit, MATCH_VOICE_READ_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { readMatchVoice, setTeamVoiceChannels } from "@/lib/server/tournaments/match-voice";
import { authUser } from "../../helpers/auth-user";

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"], pseudo: "ArbitrePseudo" });

function putReq(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/7/voice-channels", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const tournamentParams = (id: string) => ({ params: Promise.resolve({ id }) });
const matchParams = (matchId: string) => ({ params: Promise.resolve({ matchId }) });
const getReq = () => new Request("http://localhost/api/matches/9/voice");

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(setTeamVoiceChannels).mockResolvedValue({
    tournamentId: 7,
    tournamentName: "Coupe <@&1>",
    enabled: true,
    changed: true,
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT /api/admin/tournaments/[id]/voice-channels", () => {
  it("put_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await PUT(putReq({ enabled: true }), tournamentParams("7"))).status).toBe(401);
    expect(setTeamVoiceChannels).not.toHaveBeenCalled();
  });

  it("put_noTournamentsPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await PUT(putReq({ enabled: true }), tournamentParams("7"))).status).toBe(403);
    expect(setTeamVoiceChannels).not.toHaveBeenCalled();
  });

  it("put_badTournamentId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: true }), tournamentParams("0"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_TOURNAMENT_ID");
  });

  it("put_nonBooleanEnabled_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: "true" }), tournamentParams("7"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_TEAM_VOICE_CHANNELS");
    expect(setTeamVoiceChannels).not.toHaveBeenCalled();
  });

  it("put_unknownTournament_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTeamVoiceChannels).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    const res = await PUT(putReq({ enabled: true }), tournamentParams("7"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("TOURNAMENT_NOT_FOUND");
  });

  it("put_serviceThrows_returns500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTeamVoiceChannels).mockRejectedValue(new Error("boom"));
    const res = await PUT(putReq({ enabled: true }), tournamentParams("7"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("TEAM_VOICE_CHANNELS_UPDATE_FAILED");
  });

  it("put_changed_logsStaffActionWithoutPseudoInMessage", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const res = await PUT(putReq({ enabled: true }), tournamentParams("7"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, changed: true });
    expect(setTeamVoiceChannels).toHaveBeenCalledWith(7, true);
    const [message, actor] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(message).toContain("Salons vocaux d'équipe activés");
    expect(message).not.toContain("ArbitrePseudo");
    expect(message).not.toContain("<@&1>");
    expect(actor).toEqual({ id: 3, pseudo: "ArbitrePseudo" });
  });

  it("put_unchanged_logsNothing", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTeamVoiceChannels).mockResolvedValue({
      tournamentId: 7,
      tournamentName: "Coupe",
      enabled: false,
      changed: false,
    });
    const res = await PUT(putReq({ enabled: false }), tournamentParams("7"));
    expect(await res.json()).toEqual({ enabled: false, changed: false });
    expect(publishStaffAction).not.toHaveBeenCalled();
  });
});

describe("GET /api/matches/[matchId]/voice", () => {
  it("get_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(getReq(), matchParams("9"))).status).toBe(401);
  });

  it("get_badMatchId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await GET(getReq(), matchParams("abc"))).status).toBe(400);
  });

  it("get_matchNotVisible_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(readMatchVoice).mockResolvedValue(undefined);
    expect((await GET(getReq(), matchParams("9"))).status).toBe(404);
  });

  it("get_tracked_returnsVoiceCounts", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(readMatchVoice).mockResolvedValue({ team1Members: 3, team2Members: 5, pending: true });
    const res = await GET(getReq(), matchParams("9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voice: { team1Members: 3, team2Members: 5, pending: true } });
    expect(readMatchVoice).toHaveBeenCalledWith(9, true);
  });

  it("get_rateLimited_returns429WithoutRead", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(enforceRateLimit).mockReturnValueOnce(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));
    const res = await GET(getReq(), matchParams("9"));
    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(MATCH_VOICE_READ_RULE, 2);
    expect(readMatchVoice).not.toHaveBeenCalled();
  });

  it("get_readThrows_returns500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(readMatchVoice).mockRejectedValue(new Error("db"));
    const res = await GET(getReq(), matchParams("9"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("MATCH_VOICE_READ_FAILED");
  });
});
